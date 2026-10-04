import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../apps/server/app.js';
import { connect } from '../apps/server/database.js';
import { createSandbox } from './support.js';

test('an authenticated colleague appends a persisted review note with platform author and Beijing time without changing assessment', { timeout: 120_000 }, async () => {
  const sandbox = await createSandbox(), db = connect(sandbox.env.DATABASE_URL!);
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  try {
    const subject = await sandbox.provision('复核对象'), colleague = await sandbox.provision('备注作者');
    app = await createApp({ db, rawDirectory: sandbox.env.RAW_DIRECTORY! });
    const api = (url: string, body?: object, access = colleague.readerCredential) => app!.inject({ url, method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${access}` }, ...(body ? { payload: body } : {}) });
    const assessmentPath = `/api/assessments/${subject.employeeId}`, path = `/api/employees/${subject.employeeId}/review-notes`;
    const before = (await api(assessmentPath)).json();
    const start = Date.now(), payload = { requestId: randomUUID(), assessmentVersion: before.version, text: '本周以方案评审为主。\n保留原评估，补充工作背景。' };
    const response = await api(path, payload);
    assert.equal(response.statusCode, 201, response.body);
    const note = response.json();
    assert.equal(note.employeeId, subject.employeeId); assert.equal(note.text, payload.text);
    assert.deepEqual(note.author, { id: colleague.employeeId, name: '备注作者' });
    assert.equal(note.assessmentVersion, before.version); assert.match(note.createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}\+08:00$/);
    assert.ok(Date.parse(note.createdAt) >= start && Date.parse(note.createdAt) <= Date.now());
    assert.deepEqual((await api(assessmentPath)).json(), before);
    assert.deepEqual((await api(assessmentPath + '/export?version=' + before.version)).json(), before);
    await app.close(); app = await createApp({ db, rawDirectory: sandbox.env.RAW_DIRECTORY! });
    const page = (await api(path, undefined, subject.readerCredential)).json();
    assert.deepEqual(page.notes, [note]); assert.equal(page.count, 1); assert.equal(page.nextCursor, null);
    assert.equal((await app.inject({ url: path })).statusCode, 401);
    assert.equal((await app.inject({ method: 'POST', url: path, payload })).statusCode, 401);
    assert.equal((await api(path, { ...payload, requestId: randomUUID(), author: { id: subject.employeeId }, createdAt: '2000-01-01T00:00:00+08:00' })).statusCode, 400);
  } finally { await app?.close(); await db.end(); await sandbox.close(); }
});

test('concurrent review notes are retained and a retried submission cannot duplicate or replace its original', { timeout: 120_000 }, async () => {
  const sandbox = await createSandbox(), db = connect(sandbox.env.DATABASE_URL!);
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  try {
    const subject = await sandbox.provision('并发复核对象'), other = await sandbox.provision('另一备注作者');
    app = await createApp({ db, rawDirectory: sandbox.env.RAW_DIRECTORY! });
    const api = (url: string, body?: object, access = subject.readerCredential) => app!.inject({ url, method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${access}` }, ...(body ? { payload: body } : {}) });
    const path = `/api/employees/${subject.employeeId}/review-notes`, version = (await api(`/api/assessments/${subject.employeeId}`)).json().version;
    const first = { requestId: randomUUID(), assessmentVersion: version, text: '共同复核第一条' };
    const inputs = [first, first, { ...first, requestId: randomUUID(), text: '并发补充背景' }];
    const results = await Promise.all(inputs.map(body => api(path, body)));
    assert.ok(results.every(response => response.statusCode === 201));
    assert.deepEqual(results[0]!.json(), results[1]!.json(), 'uncertain-response retry returns the original persisted note');
    const peer = await api(path, first, other.readerCredential); assert.equal(peer.statusCode, 201);
    assert.notEqual(peer.json().id, results[0]!.json().id, 'a different platform author has an independent request namespace');
    assert.equal((await api(path, { ...first, text: '试图覆盖已提交备注' })).statusCode, 409);
    const page = (await api(path)).json(); assert.equal(page.count, 3);
    assert.deepEqual(new Set(page.notes.map((note: any) => note.id)), new Set([...results.map(response => response.json().id), peer.json().id]));
    for (const method of ['PUT', 'PATCH', 'DELETE'] as const) assert.equal((await app.inject({ method, url: path + '/' + peer.json().id, headers: { Authorization: `Bearer ${other.readerCredential}` }, payload: { text: '修改' } })).statusCode, 404);
    assert.deepEqual((await api(path)).json(), page);
  } finally { await app?.close(); await db.end(); await sandbox.close(); }
});

test('review notes paginate a stable list while newer notes are appended and reject invalid cursors', { timeout: 120_000 }, async () => {
  const sandbox = await createSandbox(), db = connect(sandbox.env.DATABASE_URL!);
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  try {
    const subject = await sandbox.provision('分页复核对象'), other = await sandbox.provision('另一分页对象');
    app = await createApp({ db, rawDirectory: sandbox.env.RAW_DIRECTORY! });
    const api = (url: string, body?: object) => app!.inject({ url, method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${subject.readerCredential}` }, ...(body ? { payload: body } : {}) });
    const path = `/api/employees/${subject.employeeId}/review-notes`, version = (await api(`/api/assessments/${subject.employeeId}`)).json().version;
    const ids: string[] = [];
    for (let n = 0; n < 23; n++) {
      const response = await api(path, { requestId: randomUUID(), assessmentVersion: version, text: `${n}：` + '复核上下文'.repeat(390) });
      assert.equal(response.statusCode, 201, response.body); ids.push(response.json().id);
    }
    const firstResponse = await api(path), first = firstResponse.json();
    assert.equal(first.notes.length, 10); assert.equal(first.count, 23); assert.ok(first.nextCursor);
    assert.ok(Buffer.byteLength(firstResponse.body) < 80 * 1024);
    for (const text of ['翻页期间新追加一', '翻页期间新追加二']) assert.equal((await api(path, { requestId: randomUUID(), assessmentVersion: version, text })).statusCode, 201);
    await app.close(); app = await createApp({ db, rawDirectory: sandbox.env.RAW_DIRECTORY! });
    const seen = [...first.notes.map((note: any) => note.id)]; let cursor = first.nextCursor;
    while (cursor) {
      const response = await api(path + '?cursor=' + cursor), page = response.json();
      assert.equal(response.statusCode, 200, response.body); assert.equal(page.count, 23); assert.ok(page.notes.length <= 10);
      seen.push(...page.notes.map((note: any) => note.id)); cursor = page.nextCursor;
    }
    assert.deepEqual(seen, [...ids].reverse()); assert.equal(new Set(seen).size, 23);
    assert.equal((await api(path)).json().count, 25);
    assert.equal((await api(path + '?cursor=invalid')).statusCode, 400);
    assert.equal((await api(`/api/employees/${other.employeeId}/review-notes?cursor=` + first.nextCursor)).statusCode, 400);
  } finally { await app?.close(); await db.end(); await sandbox.close(); }
});

test('review note writes require a live platform identity and a matching immutable assessment', { timeout: 120_000 }, async () => {
  const sandbox = await createSandbox(), db = connect(sandbox.env.DATABASE_URL!);
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  try {
    const subject = await sandbox.provision('复核权限对象'), author = await sandbox.provision('停用前备注作者'), manager = await sandbox.provision('复核身份维护者', true);
    app = await createApp({ db, rawDirectory: sandbox.env.RAW_DIRECTORY! });
    const api = (url: string, body?: object, access = author.readerCredential) => app!.inject({ url, method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${access}` }, ...(body ? { payload: body } : {}) });
    const path = `/api/employees/${subject.employeeId}/review-notes`, assessment = (await api(`/api/assessments/${subject.employeeId}`)).json();
    const foreign = (await api(`/api/assessments/${author.employeeId}`)).json();
    const body = { requestId: randomUUID(), assessmentVersion: assessment.version, text: '原作者的背景记录保留' };
    const device = (await api('/api/devices/enroll', { installationId: randomUUID(), name: '复核权限设备' }, author.enrollmentCredential)).json();
    for (const access of [author.enrollmentCredential, device.deviceCredential]) {
      assert.equal((await api(path, undefined, access)).statusCode, 401);
      assert.equal((await api(path, body, access)).statusCode, 401);
    }
    assert.equal((await api(path, { ...body, assessmentVersion: foreign.version })).statusCode, 404);
    assert.equal((await api(`/api/employees/${randomUUID()}/review-notes`, body)).statusCode, 404);
    for (const text of ['', '   ', '字'.repeat(2001), '隐\u0000藏']) assert.equal((await api(path, { ...body, text })).statusCode, 400);
    const created = await api(path, body); assert.equal(created.statusCode, 201); const note = created.json();
    assert.equal((await api(`/api/identities/employees/${author.employeeId}/disable`, {}, manager.readerCredential)).statusCode, 200);
    assert.equal((await api(path)).statusCode, 401); assert.equal((await api(path, body)).statusCode, 401);
    const notes = (await api(path, undefined, subject.readerCredential)).json(); assert.deepEqual(notes.notes, [note]);
    assert.equal(notes.notes[0].author.name, '停用前备注作者');
    assert.deepEqual((await api(`/api/assessments/${subject.employeeId}?version=${assessment.version}`, undefined, subject.readerCredential)).json(), assessment);
  } finally { await app?.close(); await db.end(); await sandbox.close(); }
});
