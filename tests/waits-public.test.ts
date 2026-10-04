import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../apps/server/app.js';
import { connect, digest } from '../apps/server/database.js';
import { createSandbox } from './support.js';

test('waits use native turn completion and the next real user message, never assistant prose or tail idle', { timeout: 120_000 }, async () => {
  const sandbox = await createSandbox(), db = connect(sandbox.env.DATABASE_URL!);
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  try {
    const employee = await sandbox.provision('等待合成员工');
    const base = Date.now() + 60_000;
    app = await createApp({ db, rawDirectory: sandbox.env.RAW_DIRECTORY!, reportClock: () => new Date(base + 3600_000) });
    const api = (url: string, payload?: object | Buffer, credential = employee.readerCredential, method: 'GET' | 'POST' | 'PUT' = 'GET') => app!.inject({
      method, url, headers: { Authorization: `Bearer ${credential}`, ...(Buffer.isBuffer(payload) ? { 'Content-Type': 'application/octet-stream' } : {}) },
      ...(payload === undefined ? {} : { payload }) });
    const device = (await api('/api/devices/enroll', { installationId: randomUUID(), name: '等待合成设备' }, employee.enrollmentCredential, 'POST')).json();
    const sessionId = randomUUID(), time = (ms: number) => new Date(base + ms).toISOString();
    const message = (role: string, text: string, ms: number) => ({ type: 'response_item', timestamp: time(ms), payload: {
      type: 'message', id: randomUUID(), role, content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }] } });
    const lifecycle = (type: string, turn: string, ms: number) => ({ type: 'event_msg', timestamp: time(ms), payload: { type, turn_id: turn } });
    const rows = [
      { type: 'session_meta', timestamp: time(0), payload: { id: sessionId } },
      message('user', '第一次请求', 0), lifecycle('task_started', 'turn-1', 1),
      message('assistant', '这只是中间消息，不能提前开始等待。', 1000),
      lifecycle('task_complete', 'turn-1', 10_000),
      message('user', '<environment_context>machine only</environment_context>', 20_000),
      message('user', '恰好十分钟后的真实请求', 610_000), lifecycle('task_started', 'turn-2', 610_001),
      message('assistant', '最后一次回复之后的空闲不计。', 620_000), lifecycle('task_complete', 'turn-2', 620_001),
    ];
    const raw = Buffer.from(rows.map(row => JSON.stringify(row)).join('\n') + '\n');
    assert.equal((await api(`/api/chunks/${digest(raw)}`, raw, device.deviceCredential, 'PUT')).statusCode, 201);
    const committed = await api('/api/snapshots', { protocolVersion: 1, sourceSessionId: sessionId, source: 'codex-cli', sourceVersion: '0.160.0',
      sourceOs: process.platform, project: '/synthetic/waits', hash: digest(raw), byteLength: raw.length, qualifiedAt: time(0), capability: 'unverified' }, device.deviceCredential, 'POST');
    assert.equal(committed.statusCode, 200, committed.body); const snapshotId = committed.json().snapshotId;
    assert.equal((await api(`/api/waits?snapshotId=${snapshotId}`, undefined, device.deviceCredential)).statusCode, 401);
    const response = await api(`/api/waits?snapshotId=${snapshotId}`);
    assert.equal(response.statusCode, 200, response.body);
    const waits = response.json();
    assert.equal(waits.intervals.length, 1);
    assert.deepEqual(waits.intervals.map((value: any) => [value.durationMs, value.long, value.startedAt, value.endedAt]), [[600_000, true, time(10_000), time(610_000)]]);
    assert.equal(waits.intervals[0].start.line, 5); assert.equal(waits.intervals[0].end.line, 7);
    assert.equal(waits.summary.replyWaitCount, 1); assert.equal(waits.summary.knownReplyWaitMs, 600_000);
    assert.equal(waits.summary.permissionWaitMs, null); assert.equal(waits.summary.permissionWaitCount, null);
    assert.deepEqual((await api('/api/waits/recompute', { snapshotId }, employee.readerCredential, 'POST')).json(), waits);
    assert.deepEqual((await api(`/api/waits/export?snapshotId=${snapshotId}&version=${waits.version}`)).json(), waits);
    assert.deepEqual((await api(`/api/snapshots/${snapshotId}/raw`)).rawPayload, raw);
  } finally { await app?.close(); await db.end(); await sandbox.close(); }
});

test('source-time wait reports preserve thresholds, midnight portions and late cross-project activity at fixed versions', { timeout: 120_000 }, async () => {
  const sandbox = await createSandbox(), db = connect(sandbox.env.DATABASE_URL!);
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  try {
    const employee = await sandbox.provision('跨会话等待员工'), other = await sandbox.provision('其他等待员工');
    const midnight = new Date(); midnight.setUTCDate(midnight.getUTCDate() + 1); midnight.setUTCHours(15, 59, 0, 0);
    const base = midnight.getTime(), time = (ms: number) => new Date(base + ms).toISOString();
    app = await createApp({ db, rawDirectory: sandbox.env.RAW_DIRECTORY!, reportClock: () => new Date(base + 3600_000) });
    const api = (url: string, payload?: object | Buffer, credential = employee.readerCredential, method: 'GET' | 'POST' | 'PUT' = 'GET') => app!.inject({
      method, url, headers: { Authorization: `Bearer ${credential}`, ...(Buffer.isBuffer(payload) ? { 'Content-Type': 'application/octet-stream' } : {}) },
      ...(payload === undefined ? {} : { payload }) });
    const enroll = async (owner: any) => (await api('/api/devices/enroll', { installationId: randomUUID(), name: '跨会话设备' }, owner.enrollmentCredential, 'POST')).json();
    const device = await enroll(employee), otherDevice = await enroll(other);
    const sessionId = randomUUID();
    const message = (role: string, text: string, ms: number) => ({ type: 'response_item', timestamp: time(ms), payload: { type: 'message', id: randomUUID(), role, content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }] } });
    const lifecycle = (type: string, turn: string, ms: number) => ({ type: 'event_msg', timestamp: time(ms), payload: { type, turn_id: turn } });
    const rows = [ { type: 'session_meta', payload: { id: sessionId } }, message('user', '请求一', -1000), lifecycle('task_started', 'one', -999),
      message('assistant', '回复一', -1), lifecycle('task_complete', 'one', 0), message('user', '599秒', 599_000),
      lifecycle('task_started', 'two', 599_001), message('assistant', '回复二', 599_999), lifecycle('task_complete', 'two', 600_000),
      message('user', '600秒', 1200_000), lifecycle('task_started', 'three', 1200_001), message('assistant', '回复三', 1200_999),
      lifecycle('task_complete', 'three', 1201_000), message('user', '601秒', 1802_000) ];
    const upload = async (owner: any, records: unknown[], id = randomUUID(), source = 'codex-cli', project = '/synthetic/other', extra = {}) => {
      const normalized = source === 'codex-cli' ? records.map((row: any) => row.type === 'session_meta' ? { ...row, payload: { ...row.payload, id } } : row) : records;
      const raw = Buffer.from(normalized.map(value => JSON.stringify(value)).join('\n') + '\n');
      assert.ok([200, 201].includes((await api(`/api/chunks/${digest(raw)}`, raw, owner.deviceCredential, 'PUT')).statusCode));
      const manifest = { protocolVersion: 1, sourceSessionId: id, source, sourceVersion: source === 'claude-code-cli' ? '2.1.281' : '0.160.0', sourceOs: process.platform,
        project, hash: digest(raw), byteLength: raw.length, qualifiedAt: time(-1000), capability: 'unverified', ...extra };
      const response = await api('/api/snapshots', manifest, owner.deviceCredential, 'POST'); assert.equal(response.statusCode, 200, response.body);
      return { snapshotId: response.json().snapshotId, raw, manifest };
    };
    const a = await upload(device, rows, sessionId, 'codex-cli', '/synthetic/focus');
    const boundaryRows = [{ type: 'user', uuid: randomUUID(), sessionId: randomUUID(), timestamp: time(599_000), message: { role: 'user', content: '恰在第一个等待的结束边界' } }];
    const b = await upload(device, boundaryRows, boundaryRows[0]!.sessionId, 'claude-code-cli', '/different/project');
    await upload(otherDevice, [{ type: 'session_meta', payload: { id: randomUUID() } }, message('user', '其他员工期间有活动', 100_000)]);
    const query = new URLSearchParams({ period: 'since-enrollment', employeeId: employee.employeeId, source: 'codex-cli', project: '/synthetic/focus' });
    const firstResponse = await api('/api/waits?' + query);
    assert.equal(firstResponse.statusCode, 200, firstResponse.body); const first = firstResponse.json();
    assert.deepEqual(first.intervals.map((item: any) => [item.durationMs, item.long, item.parallel]), [[599_000, false, 'not-observed'], [600_000, true, 'not-observed'], [601_000, true, 'not-observed']]);
    assert.deepEqual(first.daily.map((day: any) => day.knownReplyWaitMs), [60_000, 1740_000]);
    assert.equal(first.summary.knownReplyWaitMs, 1800_000); assert.equal(first.summary.longWaitCount, 2);
    const duplicate = await upload(device, rows, sessionId, 'codex-cli', '/synthetic/focus'); assert.equal(duplicate.snapshotId, a.snapshotId);
    assert.deepEqual((await api('/api/waits?' + query)).json(), first);
    const late = await upload(device, [...boundaryRows, { type: 'user', uuid: randomUUID(), sessionId: boundaryRows[0]!.sessionId,
      timestamp: time(900_000), message: { role: 'user', content: '迟到的另一Agent和项目活动' } }], boundaryRows[0]!.sessionId, 'claude-code-cli', '/different/project');
    assert.notEqual(late.snapshotId, b.snapshotId);
    const updated = (await api('/api/waits?' + query)).json(); assert.notEqual(updated.version, first.version);
    assert.deepEqual(updated.intervals.map((item: any) => item.parallel), ['not-observed', 'observed', 'not-observed']);
    assert.equal(updated.intervals[1].parallelEvidence[0].snapshotId, late.snapshotId);
    assert.deepEqual((await api('/api/waits?' + query + '&version=' + first.version)).json(), first);
    assert.deepEqual((await api('/api/waits/recompute', Object.fromEntries(query), employee.readerCredential, 'POST')).json(), updated);
    const session = (await api('/api/waits?snapshotId=' + a.snapshotId)).json();
    assert.deepEqual(session.intervals.map((item: any) => item.parallel), ['not-observed', 'observed', 'not-observed']);
    const restoredDevice = await enroll(employee);
    const restored = await upload(restoredDevice, [...rows, message('user', '恢复后新请求不重复等待', 1900_000)], sessionId, 'codex-cli', '/synthetic/focus',
      { restoredFrom: { snapshotId: a.snapshotId, hash: digest(a.raw), byteLength: a.raw.length } });
    const afterRestore = (await api('/api/waits?' + query)).json();
    assert.deepEqual(afterRestore.intervals.map((item: any) => [item.durationMs, item.parallel]), updated.intervals.map((item: any) => [item.durationMs, item.parallel]));
    assert.equal(afterRestore.summary.replyWaitCount, 3);
    assert.deepEqual((await api('/api/waits/recompute', Object.fromEntries(query), employee.readerCredential, 'POST')).json(), afterRestore);
    assert.deepEqual((await api(`/api/snapshots/${restored.snapshotId}/raw`)).rawPayload, restored.raw);
  } finally { await app?.close(); await db.end(); await sandbox.close(); }
});
