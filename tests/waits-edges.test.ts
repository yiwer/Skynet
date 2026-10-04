import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createSandbox } from './support.js';
import { createApp } from '../apps/server/app.js';
import { connect, digest } from '../apps/server/database.js';

test('duplicate and overlapping native lifecycle events cannot invent waits; incomplete sources remain unknown', { timeout: 120000 }, async () => {
  const sandbox = await createSandbox(), db = connect(sandbox.env.DATABASE_URL!);
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  try {
    const employee = await sandbox.provision('等待边界员工'), base = Date.now() + 60000;
    app = await createApp({ db, rawDirectory: sandbox.env.RAW_DIRECTORY!, reportClock: () => new Date(base + 3600000) });
    const api = (url: string, payload?: object | Buffer, credential = employee.readerCredential, method: 'GET' | 'POST' | 'PUT' = 'GET') => app!.inject({ method, url,
      headers: { Authorization: `Bearer ${credential}`, ...(Buffer.isBuffer(payload) ? { 'Content-Type': 'application/octet-stream' } : {}) }, ...(payload === undefined ? {} : { payload }) });
    const device = (await api('/api/devices/enroll', { installationId: randomUUID(), name: '等待边界设备' }, employee.enrollmentCredential, 'POST')).json();
    const time = (ms: number) => new Date(base + ms).toISOString();
    const msg = (role: string, ms: number) => ({ type: 'response_item', timestamp: time(ms), payload: { type: 'message', role, content: [{ type: role === 'user' ? 'input_text' : 'output_text', text: `边界 ${ms}` }] } });
    const event = (type: string, turn_id: string, ms: number, extra = {}) => ({ type: 'event_msg', timestamp: time(ms), payload: { type, turn_id, ...extra } });
    const upload = async (rows: unknown[], source = 'codex-cli', id = randomUUID(), project = '/synthetic/edges') => {
      const records = source === 'codex-cli' ? rows.map((row: any) => row.type === 'session_meta' ? { ...row, payload: { ...row.payload, id } } : row) : rows;
      const raw = Buffer.from(records.map(row => JSON.stringify(row)).join('\n') + '\n');
      assert.ok([200,201].includes((await api('/api/chunks/' + digest(raw), raw, device.deviceCredential, 'PUT')).statusCode));
      const result = await api('/api/snapshots', { protocolVersion: 1, sourceSessionId: id, source, sourceVersion: source === 'codex-cli' ? '0.160.0' : '2.1.281',
        sourceOs: process.platform, project, hash: digest(raw), byteLength: raw.length, qualifiedAt: time(0), capability: 'unverified' }, device.deviceCredential, 'POST');
      assert.equal(result.statusCode, 200, result.body); return { snapshotId: result.json().snapshotId as string, raw };
    };
    const read = async (id: string) => { const response = await api('/api/waits?snapshotId=' + id); assert.equal(response.statusCode, 200, response.body); return response.json(); };
    const id = randomUUID(), header = { type: 'session_meta', payload: { id } };
    const duplicateRows = [header, msg('user', 0), event('task_started', 'one', 1), msg('assistant', 100), event('task_complete', 'one', 1000),
      event('task_complete', 'one', 1000), msg('user', 601000), event('task_complete', 'one', 1000), msg('user', 701000)];
    const duplicated = await upload(duplicateRows, 'codex-cli', id), first = await read(duplicated.snapshotId);
    assert.equal(first.intervals.length, 1, 'repeated completion after the next user must not restart the same wait');
    assert.equal(first.intervals[0].durationMs, 600000);
    const conflict = await upload([...duplicateRows, event('task_complete', 'one', 2000)], 'codex-cli', id);
    const conflicted = await read(conflict.snapshotId); assert.equal(conflicted.intervals.length, 1); assert.equal(conflicted.intervals[0].durationMs, null);
    assert.equal(conflicted.summary.replyWaitMs, null);
    const parallel = await upload([header, msg('user', 0), event('task_started', 'active-one', 1), event('task_started', 'active-two', 2),
      msg('assistant', 100), event('task_complete', 'active-one', 1000), msg('user', 601000)]);
    assert.equal((await read(parallel.snapshotId)).intervals[0].durationMs, null, 'one complete event does not end another still-active turn');
    const aborted = await upload([header, msg('user', 0), event('task_started', 'aborted', 1), msg('assistant', 10), event('turn_aborted', 'aborted', 20), msg('user', 600000)]);
    assert.equal((await read(aborted.snapshotId)).intervals.length, 0);
    const reversed = await upload([header, msg('user', 0), msg('assistant', 10), event('task_complete', 'reverse', 700000), msg('user', 600000)]);
    assert.equal((await read(reversed.snapshotId)).intervals[0].durationMs, null);
    const exact = await upload([header, msg('user', 0), msg('assistant', 10), event('task_complete', 'exact', 999999, { completed_at: (base + 1000) / 1000 }), msg('user', 601000)]);
    assert.equal((await read(exact.snapshotId)).intervals[0].durationMs, 600000, 'native completed_at determines the endpoint when present');
    const claudeId = randomUUID();
    const claude = await upload([{ type: 'user', uuid: randomUUID(), sessionId: claudeId, timestamp: time(0), message: { role: 'user', content: '请求' } },
      { type: 'assistant', uuid: randomUUID(), sessionId: claudeId, timestamp: time(1000), message: { id: randomUUID(), role: 'assistant', content: [{ type: 'text', text: '没有持久化轮次结束' }] } },
      { type: 'user', uuid: randomUUID(), sessionId: claudeId, timestamp: time(601000), message: { role: 'user', content: '后续请求' } }], 'claude-code-cli', claudeId);
    const unsupported = await read(claude.snapshotId);
    assert.equal(unsupported.replySupport, 'unknown'); assert.equal(unsupported.intervals[0].durationMs, null);
    assert.equal(unsupported.summary.permissionWaitMs, null); assert.equal(unsupported.summary.permissionWaitCount, null);
    const untimed = await upload([header, msg('user', 0), msg('assistant', 10), event('task_complete', 'untimed', 1000),
      { ...msg('user', 601000), timestamp: 'source-time-unavailable' }]);
    const uncertain = await read(untimed.snapshotId);
    assert.equal(uncertain.intervals.length, 1, 'a missing user timestamp remains an unknown interval, not a known zero');
    assert.equal(uncertain.intervals[0].durationMs, null); assert.equal(uncertain.summary.replyWaitMs, null);
    const overlap = await upload([header, msg('user', 299000), event('task_started', 'overlap', 299001), msg('assistant', 299999),
      event('task_complete', 'overlap', 300000), msg('user', 900000)]);
    const simultaneousA = await read(duplicated.snapshotId), simultaneousB = await read(overlap.snapshotId);
    assert.equal(simultaneousA.intervals[0].parallel, 'observed'); assert.equal(simultaneousB.intervals[0].parallel, 'observed');
    assert.equal(simultaneousA.intervals[0].durationMs, 600000); assert.equal(simultaneousB.intervals[0].durationMs, 600000);
    const growingId = randomUUID(), prefix = [header, msg('user', 0), event('task_started', 'growing', 1), msg('assistant', 10)];
    const growing = await upload(prefix, 'codex-cli', growingId, '/synthetic/progressive');
    const progressPath = '/api/waits?period=since-enrollment&project=%2Fsynthetic%2Fprogressive';
    assert.equal((await api(progressPath)).json().summary.replyWaitMs, null);
    await upload([...prefix, event('task_complete', 'growing', 1000), msg('user', 601000)], 'codex-cli', growingId, '/synthetic/progressive');
    assert.equal((await api(progressPath)).json().summary.replyWaitMs, 600000, 'a complete continuation resolves the old incomplete input, without rewriting its original');
    assert.equal((await read(growing.snapshotId)).summary.replyWaitMs, null);
    assert.equal((await api('/api/waits?snapshotId=' + duplicated.snapshotId + '&offset=25')).statusCode, 400, 'paging needs a frozen version');
    assert.equal((await api('/api/waits?snapshotId=' + duplicated.snapshotId + '&version=' + first.version + '&lines=7')).json().intervals.length, 1);
    assert.equal((await api('/api/waits?snapshotId=' + duplicated.snapshotId + '&version=' + first.version + '&lines=2')).json().intervals.length, 0);
    await app.close(); app = await createApp({ db, rawDirectory: sandbox.env.RAW_DIRECTORY!, reportClock: () => new Date(base + 10 * 86400000) });
    assert.deepEqual((await api('/api/waits?snapshotId=' + duplicated.snapshotId + '&version=' + first.version)).json(), first);
    assert.deepEqual((await api('/api/snapshots/' + duplicated.snapshotId + '/raw')).rawPayload, duplicated.raw);
  } finally { await app?.close(); await db.end(); await sandbox.close(); }
});
