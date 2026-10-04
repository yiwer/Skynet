import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createSandbox } from './support.js';
import { createApp } from '../apps/server/app.js';
import { connect, digest } from '../apps/server/database.js';

test('Codex 0.160 new sessions count their first native usage while copied or incomplete beginnings stay unknown', { timeout: 120000 }, async () => {
  const sandbox = await createSandbox(), db = connect(sandbox.env.DATABASE_URL!);
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  try {
    const person = await sandbox.provision('原生用量员工');
    const now = new Date(Date.now() + 60000), timestamp = now.toISOString();
    app = await createApp({ db, rawDirectory: sandbox.env.RAW_DIRECTORY!, reportClock: () => now });
    const api = (url: string, body?: unknown, credential = person.readerCredential, method: 'GET'|'POST'|'PUT' = 'GET') => app!.inject({ url, method,
      headers: { Authorization: `Bearer ${credential}`, ...(Buffer.isBuffer(body) ? { 'Content-Type': 'application/octet-stream' } : {}) }, ...(body === undefined ? {} : { payload: body as object }) });
    const device = (await api('/api/devices/enroll', { installationId: randomUUID(), name: '原生计数设备' }, person.enrollmentCredential, 'POST')).json();
    const encode = (rows: unknown[]) => Buffer.from(rows.map(row => JSON.stringify(row)).join('\n') + '\n');
    const counter = (input: number, output: number) => ({ timestamp, type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: {
      input_tokens: input, cached_input_tokens: 20, output_tokens: output, reasoning_output_tokens: 5, total_tokens: input + output } } } });
    const user = { timestamp, type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '检查原生计数' }] } };
    async function upload(extra: Record<string, unknown> = {}, omitHeader = false, old = false) {
      const id = randomUUID();
      const created = old ? new Date(now.getTime() - 86400000).toISOString() : timestamp;
      const meta = { timestamp: created, type: 'session_meta', payload: { id, timestamp: created, cli_version: '0.160.0', source: 'cli', cwd: '/synthetic/usage', ...extra } };
      const bytes = encode([...(omitHeader ? [] : [meta]), user, counter(100, 10), counter(150, 20), counter(150, 20)]);
      assert.equal((await api(`/api/chunks/${digest(bytes)}`, bytes, device.deviceCredential, 'PUT')).statusCode, 201);
      const committed = await api('/api/snapshots', { protocolVersion: 1, sourceSessionId: id, source: 'codex-cli', sourceVersion: '0.160.0', sourceOs: process.platform,
        project: '/synthetic/usage', hash: digest(bytes), byteLength: bytes.length, qualifiedAt: timestamp, capability: 'unverified' }, device.deviceCredential, 'POST');
      assert.equal(committed.statusCode, 200, committed.body); return { id, snapshotId: committed.json().snapshotId };
    }
    const original = await upload();
    const first = await api('/api/metrics?period=since-enrollment'); assert.equal(first.statusCode, 200, first.body);
    assert.deepEqual([first.json().totals.inputTokens, first.json().totals.outputTokens], [150, 20], 'the verified new session includes first cumulative usage exactly once');
    for (const value of [await upload({ forked_from_id: randomUUID() }), await upload({ history_base: { thread_id: randomUUID() } }), await upload({}, true), await upload({}, false, true)]) {
      const response = await api(`/api/snapshots/${value.snapshotId}/metrics?period=since-enrollment`); assert.equal(response.statusCode, 200, response.body);
      assert.equal(response.json().totals.inputTokens, null);
      assert.equal(response.json().totals.knownInputTokens, 50, 'only a subsequent observed delta is known');
    }
    const fixed = await api(`/api/metrics/export?period=since-enrollment&version=${first.json().version}`);
    assert.deepEqual(fixed.json(), first.json());
    const detail = await api(`/api/snapshots/${original.snapshotId}/metrics?period=since-enrollment`);
    assert.equal(detail.json().totals.inputTokens, 150);
  } finally { await app?.close(); await db.end(); await sandbox.close(); }
});

test('usage output groups native outcomes by original employee and date across append, recovery and frozen exports', { timeout: 120000 }, async () => {
  const sandbox = await createSandbox(), db = connect(sandbox.env.DATABASE_URL!);
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  try {
    const alpha = await sandbox.provision('甲原作者'), beta = await sandbox.provision('乙续作者');
    const now = new Date(Date.now() + 60000), timestamp = now.toISOString();
    app = await createApp({ db, rawDirectory: sandbox.env.RAW_DIRECTORY!, reportClock: () => new Date(now.getTime() + 86400000) });
    const api = (url: string, body?: unknown, credential = alpha.readerCredential, method: 'GET'|'POST'|'PUT' = 'GET') => app!.inject({ url, method,
      headers: { Authorization: `Bearer ${credential}`, ...(Buffer.isBuffer(body) ? { 'Content-Type': 'application/octet-stream' } : {}) }, ...(body === undefined ? {} : { payload: body as object }) });
    const enroll = async (person: typeof alpha) => (await api('/api/devices/enroll', { installationId: randomUUID(), name: '产出归属设备' }, person.enrollmentCredential, 'POST')).json();
    const a = await enroll(alpha), b = await enroll(beta), id = randomUUID();
    const message = (text: string) => ({ timestamp, type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } });
    const tool = (callId: string, cmd: string, output: string, at = timestamp) => [{ timestamp: at, type: 'response_item', payload: { type: 'function_call', name: 'exec_command', call_id: callId, arguments: JSON.stringify({ cmd }) } },
      { timestamp: at, type: 'response_item', payload: { type: 'function_call_output', call_id: callId, output } }];
    const encode = (rows: unknown[]) => Buffer.from(rows.map(row => JSON.stringify(row)).join('\n') + '\n');
    const initial = encode([message('核查三项测试'), ...tool('test-one', 'node --test example.js', '# tests 3\n# pass 2\n# fail 1')]);
    async function upload(device: typeof a, bytes: Buffer, restoredFrom?: object) {
      await api(`/api/chunks/${digest(bytes)}`, bytes, device.deviceCredential, 'PUT');
      const response = await api('/api/snapshots', { protocolVersion: 1, sourceSessionId: id, source: 'codex-cli', sourceVersion: '0.160.0', sourceOs: process.platform,
        project: '/synthetic/output', hash: digest(bytes), byteLength: bytes.length, qualifiedAt: timestamp, capability: 'unverified', ...(restoredFrom ? { restoredFrom } : {}) }, device.deviceCredential, 'POST');
      assert.equal(response.statusCode, 200, response.body); return response.json().snapshotId;
    }
    const firstId = await upload(a, initial);
    const firstResponse = await api('/api/usage-output?period=since-enrollment'); assert.equal(firstResponse.statusCode, 200, firstResponse.body);
    const first = firstResponse.json();
    assert.equal(first.outputs.tests.known, 3); assert.equal(first.outputs.tests.passed, 2); assert.equal(first.outputs.tests.failed, 1);
    assert.equal(first.outputs.verified.value, null, 'unavailable analysis is unknown rather than zero');
    assert.equal(first.outputs.codeChanges.value, 0, 'supported originals with no edit have a known zero');
    const continued = Buffer.concat([initial, encode(tool('commit-one', 'git commit -m change', '[main abcdef1] change\n 1 file changed, 1 insertion(+)'))]);
    const continuedId = await upload(a, continued); await upload(a, continued);
    const nextDay = new Date(now.getTime() + 86400000).toISOString();
    await upload(b, Buffer.concat([continued, encode(tool('test-two', 'node --test next.js', '# tests 2\n# pass 2\n# fail 0', nextDay))]), { snapshotId: continuedId, hash: digest(continued), byteLength: continued.length });
    const response = await api('/api/usage-output?period=since-enrollment'); assert.equal(response.statusCode, 200, response.body);
    const report = response.json();
    assert.deepEqual([report.totals.sessions, report.outputs.tests.known, report.outputs.tests.passed, report.outputs.commits.known], [1, 5, 4, 1]);
    assert.deepEqual(report.employees.map((row: any) => [row.employee, row.outputs.tests.known]), [['甲原作者', 3], ['乙续作者', 2]]);
    const selected = (await api(`/api/usage-output?period=since-enrollment&employeeId=${beta.employeeId}`)).json();
    assert.equal(selected.outputs.tests.known, 2); assert.equal(selected.employees.length, 1);
    assert.equal(selected.sessions.filter((row: any) => row.selected).length, 1);
    assert.ok(selected.sessions.some((row: any) => !row.selected), 'other employees remain available as grey scatter references');
    assert.deepEqual((await api(`/api/usage-output/export?period=since-enrollment&version=${first.version}`)).json(), first);
    assert.equal((await api(`/api/usage-output?period=since-enrollment&version=${first.version}&employeeId=${beta.employeeId}`)).statusCode, 409);
    assert.deepEqual((await api('/api/usage-output/recompute', { period: 'since-enrollment' }, alpha.readerCredential, 'POST')).json(), report);
    await app.close(); app = await createApp({ db, rawDirectory: sandbox.env.RAW_DIRECTORY! });
    assert.deepEqual((await api(`/api/usage-output?period=since-enrollment&version=${first.version}`)).json(), first);
  } finally { await app?.close(); await db.end(); await sandbox.close(); }
});
