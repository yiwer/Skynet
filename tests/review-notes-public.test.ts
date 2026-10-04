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
