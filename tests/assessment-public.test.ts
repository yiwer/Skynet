import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../apps/server/app.js';
import { connect, digest } from '../apps/server/database.js';
import { createSandbox } from './support.js';

test('an authenticated employee can read an empty, versioned assessment without a fabricated score', { timeout: 120_000 }, async () => {
  const sandbox = await createSandbox(), db = connect(sandbox.env.DATABASE_URL!);
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  try {
    const employee = await sandbox.provision('能力评估合成员工');
    app = await createApp({ db, rawDirectory: sandbox.env.RAW_DIRECTORY! });
    const url = `/api/assessments/${employee.employeeId}`;
    const headers = { Authorization: `Bearer ${employee.readerCredential}` };
    assert.equal((await app.inject({ url })).statusCode, 401);
    const response = await app.inject({ url, headers });
    assert.equal(response.statusCode, 200, response.body);
    const value = response.json();
    assert.equal(value.employee, '能力评估合成员工');
    assert.equal(value.period, '接入至今'); assert.equal(value.preset, '默认');
    assert.deepEqual([value.index, value.margin, value.confidence, value.level], [null, null, '低', '待定']);
    assert.equal(value.sample.sessions, 0); assert.equal(value.sample.prompts, 0);
    assert.deepEqual(Object.keys(value.dims).sort(), ['adopt', 'flow', 'iter', 'output', 'prompt', 'verify']);
    assert.equal(Object.values(value.dims).flatMap((d: any) => d.metrics).length, 13);
    assert.ok(Object.values(value.dims).every((d: any) => d.score === null));
    assert.deepEqual(value.strengths, []); assert.deepEqual(value.priorities, []);
    assert.match(value.version, /^[a-f0-9]{64}$/); assert.match(value.modelVersion, /^[a-f0-9]{64}$/);
    assert.match(value.inputs.baselineVersion, /^[a-f0-9]{64}$/);
    assert.deepEqual((await app.inject({ url: url + '/export?version=' + value.version, headers })).json(), value);
    const model = (await app.inject({ url: '/api/assessment-models/' + value.modelVersion, headers })).json();
    assert.deepEqual(model.presets['默认'], { adopt: 20, prompt: 20, iter: 20, verify: 20, output: 15, flow: 5 });
    assert.deepEqual(model.levels, [{ minimum: 72, label: '较好' }, { minimum: 60, label: '一般' }, { minimum: 0, label: '需提升' }]);
    await app.close(); app = await createApp({ db, rawDirectory: sandbox.env.RAW_DIRECTORY! });
    assert.deepEqual((await app.inject({ url: url + '?version=' + value.version, headers })).json(), value);
  } finally { await app?.close(); await db.end(); await sandbox.close(); }
});

test('recorded usage determines sample confidence while missing analysis stays unknown and a capture gap downgrades confidence', { timeout: 120_000 }, async () => {
  const sandbox = await createSandbox(), db = connect(sandbox.env.DATABASE_URL!);
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  try {
    const employee = await sandbox.provision('已接入能力样本');
    const day = new Date(); day.setUTCDate(day.getUTCDate() + 28); day.setUTCHours(2, 0, 0, 0);
    app = await createApp({ db, rawDirectory: sandbox.env.RAW_DIRECTORY!, reportClock: () => day });
    const api = (url: string, payload?: object | Buffer, credential = employee.readerCredential, method: 'GET' | 'POST' | 'PUT' = 'GET') => app!.inject({ method, url,
      headers: { Authorization: `Bearer ${credential}`, ...(Buffer.isBuffer(payload) ? { 'Content-Type': 'application/octet-stream' } : {}) }, ...(payload === undefined ? {} : { payload }) });
    const device = (await api('/api/devices/enroll', { installationId: randomUUID(), name: '评估合成设备' }, employee.enrollmentCredential, 'POST')).json();
    const sourceDate = new Date(day); while ([0, 6].includes(sourceDate.getUTCDay())) sourceDate.setUTCDate(sourceDate.getUTCDate() - 1);
    const timestamp = sourceDate.toISOString();
    for (let i = 0; i < 8; i++) {
      const id = randomUUID(), rows: object[] = [{ type: 'session_meta', timestamp, payload: { id } }];
      for (let turn = 0; turn < 5; turn++) rows.push({ type: 'response_item', timestamp, payload: { type: 'message', id: randomUUID(), role: 'user', content: [{ type: 'input_text', text: `合成请求 ${i}/${turn}` }] } });
      const bytes = Buffer.from(rows.map(row => JSON.stringify(row)).join('\n') + '\n');
      await api(`/api/chunks/${digest(bytes)}`, bytes, device.deviceCredential, 'PUT');
      const uploaded = await api('/api/snapshots', { protocolVersion: 1, source: 'codex-cli', sourceSessionId: id, sourceVersion: '0.160.0', sourceOs: process.platform,
        project: '/synthetic/assessment', hash: digest(bytes), byteLength: bytes.length, qualifiedAt: timestamp, capability: 'unverified' }, device.deviceCredential, 'POST');
      assert.equal(uploaded.statusCode, 200, uploaded.body);
    }
    const path = `/api/assessments/${employee.employeeId}`, response = await api(path); assert.equal(response.statusCode, 200, response.body);
    const value = response.json();
    assert.deepEqual([value.sample.sessions, value.sample.prompts, value.sample.activeDays, value.sample.unknownTokenSessions], [8, 40, 1, 8]);
    assert.deepEqual([value.index, value.margin, value.confidence, value.level], [50, 9, '高', '需提升']);
    assert.equal(value.dims.adopt.score, 50); assert.equal(value.dims.adopt.effectiveWeight, 100);
    assert.equal(value.dims.adopt.metrics.find((m: any) => m.key === 'activeShare').score, 0);
    assert.equal(value.dims.adopt.metrics.find((m: any) => m.key === 'perDay').score, 100);
    assert.equal(value.dims.prompt.metrics[0].state, 'unknown'); assert.equal(value.dims.prompt.score, null);
    assert.equal(value.dims.output.metrics[1].value, null); assert.deepEqual(value.priorities, ['adopt']);
    assert.equal(value.tips[0].text, '把排查、补测试、整理文档这类日常任务也交给 Agent，保持每个工作日都在用');
    assert.equal((await api(path, undefined, device.deviceCredential)).statusCode, 401);
    const now = new Date().toISOString();
    const fault = { id: randomUUID(), code: 'source-missing', scope: 'source', firstObservedAt: now, lastObservedAt: now, recoveredAt: null, coverage: 'unverified-range' };
    const health = await api('/api/devices/health', { nonce: randomUUID(), source: 'codex-cli', capture: { checkedAt: now, observation: 'host-event-observed', locallyPersisted: true, faults: [fault] } }, device.deviceCredential, 'POST');
    assert.equal(health.statusCode, 200, health.body);
    const updated = (await api(path)).json(); assert.notEqual(updated.version, value.version);
    assert.equal(updated.confidence, '中'); assert.equal(updated.index, 50); assert.ok(updated.coverageIssues.length > 0);
    assert.deepEqual((await api(path + '?version=' + value.version)).json(), value);
  } finally { await app?.close(); await db.end(); await sandbox.close(); }
});
