import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createSandbox } from './support.js';
import { createApp } from '../apps/server/app.js';
import { connect, digest } from '../apps/server/database.js';
import { beijingDate } from '../packages/contracts/reports.js';
import { addDays } from '../packages/contracts/work-views.js';
import { metricsQuerySchema, type MetricsPage } from '../packages/contracts/metrics.js';

test('metric scope rejects invalid calendar dates and incomplete custom ranges', () => {
  assert.equal(metricsQuerySchema.safeParse({ period: 'custom', from: '2026-02-30', to: '2026-03-01' }).success, false);
  assert.equal(metricsQuerySchema.safeParse({ period: 'custom', from: '2026-10-01' }).success, false);
  assert.equal(metricsQuerySchema.parse({}).period, 'this-week');
});

test('public uploads produce frozen same-source metrics: known zero, unknown, source days, restoration, filters and complete export', { timeout: 180000 }, async () => {
  const sandbox = await createSandbox(); const db = connect(sandbox.env.DATABASE_URL!);
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  try {
    const alpha = await sandbox.provision('甲：原始员工'), beta = await sandbox.provision('乙：未上报员工');
    const now = new Date(Date.now() + 60000); const day = beijingDate(now), tomorrow = addDays(day, 1);
    app = await createApp({ db, rawDirectory: sandbox.env.RAW_DIRECTORY!, reportClock: () => new Date(now.getTime() + 86400000) });
    const api = (url: string, credential = alpha.readerCredential, body?: unknown, method: 'GET' | 'POST' | 'PUT' = 'GET') => app!.inject({
      url, method, headers: { Authorization: `Bearer ${credential}`, ...(body instanceof Buffer ? { 'Content-Type': 'application/octet-stream' } : {}) },
      ...(body !== undefined ? { payload: body instanceof Buffer ? body : body as object } : {}) });
    const enroll = async (employee: typeof alpha) => {
      const response = await api('/api/devices/enroll', employee.enrollmentCredential, { installationId: randomUUID(), name: '合成指标设备' }, 'POST');
      assert.equal(response.statusCode, 200, response.body); return response.json();
    };
    const a = await enroll(alpha), restoredDevice = await enroll(alpha), b = await enroll(beta);
    const t1 = now.toISOString(), t2 = new Date(now.getTime() + 86400000).toISOString();
    const session = randomUUID();
    const user = (id: string, time: string, text = '合成用户消息') => ({ type: 'user', uuid: randomUUID(), sessionId: id, version: '2.1.281', timestamp: time, message: { role: 'user', content: text } });
    const assistant = (id: string, time: string, input: number, output: number, cache = 0, write = 0) => ({
      type: 'assistant', uuid: randomUUID(), sessionId: id, version: '2.1.281', timestamp: time,
      message: { id: randomUUID(), role: 'assistant', content: [{ type: 'text', text: '合成回答' }],
        usage: { input_tokens: input, output_tokens: output, cache_read_input_tokens: cache, cache_creation_input_tokens: write } } });
    const encode = (rows: unknown[]) => Buffer.from(rows.map(row => JSON.stringify(row)).join('\n') + '\n');
    async function upload(device: typeof a, id: string, content: Buffer, project: string, restoredFrom?: object) {
      assert.equal((await api(`/api/chunks/${digest(content)}`, device.deviceCredential, content, 'PUT')).statusCode, 201);
      const manifest = { protocolVersion: 1, sourceSessionId: id, source: 'claude-code-cli', sourceVersion: '2.1.281', sourceOs: process.platform,
        project, hash: digest(content), byteLength: content.length, qualifiedAt: now.toISOString(), capability: 'unverified', ...(restoredFrom ? { restoredFrom } : {}) };
      const response = await api('/api/snapshots', device.deviceCredential, manifest, 'POST');
      assert.equal(response.statusCode, 200, response.body); return response.json().snapshotId as string;
    }
    const original = encode([user(session, t1), assistant(session, t1, 100, 20, 5, 2),
      { ...user(session, t1, '原件明确标记的压缩摘要，不是新提示词'), isCompactSummary: true }, user(session, t2), assistant(session, t2, 30, 10)]);
    const firstId = await upload(a, session, original, '/synthetic/metrics');
    assert.equal(await upload(a, session, original, '/synthetic/metrics'), firstId, 'exact commit retries reuse the same snapshot');
    const restoredBytes = Buffer.concat([original, encode([user(session, t2, '恢复后的独立新轮次'), assistant(session, t2, 5, 1)])]);
    await upload(restoredDevice, session, restoredBytes, '/synthetic/metrics', { snapshotId: firstId, hash: digest(original), byteLength: original.length });
    const unknownId = randomUUID(); await upload(b, unknownId, encode([user(unknownId, t1)]), '/synthetic/unknown');
    const zeroId = randomUUID(); await upload(b, zeroId, encode([user(zeroId, t1), assistant(zeroId, t1, 0, 0)]), '/synthetic/zero');
    const selection = { period: 'since-enrollment' };
    const path = '/api/metrics?' + new URLSearchParams(selection);
    assert.equal((await app.inject({ url: path })).statusCode, 401);
    assert.equal((await api(path, a.deviceCredential)).statusCode, 401);
    const response = await api(path); assert.equal(response.statusCode, 200, response.body);
    const first = response.json<MetricsPage>();
    assert.deepEqual([first.totals.sessions, first.totals.userTurns, first.totals.toolCalls], [3, 5, 0]);
    assert.deepEqual([first.totals.knownInputTokens, first.totals.knownOutputTokens, first.totals.inputTokens, first.totals.unknownTokenSessions], [142, 31, null, 1]);
    assert.equal(first.sessions.find(s => s.sourceSessionId === zeroId)!.inputTokens, 0, 'reported zero remains known zero');
    assert.equal(first.sessions.find(s => s.sourceSessionId === unknownId)!.inputTokens, null, 'missing usage remains unknown');
    assert.equal(first.sessions.find(s => s.sourceSessionId === session)!.inputTokens, 142, 'restored prefix and retries contribute once');
    assert.deepEqual(first.daily.map(row => [row.date, row.knownInputTokens, row.knownOutputTokens]), [[day, 107, 20], [tomorrow, 35, 11]]);
    assert.equal(first.daily.reduce((sum, row) => sum + row.userTurns, 0), first.totals.userTurns);
    assert.equal(first.employees.reduce((sum, row) => sum + row.knownInputTokens, 0), first.totals.knownInputTokens);
    assert.equal((await api(path + `&employeeId=${alpha.employeeId}`)).json<MetricsPage>().totals.inputTokens, 142);
    assert.equal((await api(path + '&project=%2Fsynthetic%2Funknown')).json<MetricsPage>().totals.unknownTokenSessions, 1);
    assert.deepEqual((await api('/api/metrics/recompute', alpha.readerCredential, selection, 'POST')).json(), first, 'unchanged full recompute is version-idempotent');
    const fixed = path + `&version=${first.version}`;
    const exportResponse = await api('/api/metrics/export?' + new URLSearchParams({ ...selection, version: first.version }));
    assert.equal(exportResponse.statusCode, 200, exportResponse.body); assert.deepEqual(exportResponse.json(), first);
    assert.equal((await api(fixed + '&employeeId=' + beta.employeeId)).statusCode, 409, 'frozen versions reject a different scope');
    assert.equal((await api(path + '&offset=20')).statusCode, 400, 'paging requires a fixed version');
    assert.ok((await api('/api/metrics/catalog')).json().definitions.find((row: { key: string }) => row.key === 'inputTokens'));
    // More than one page and a later archive mutation must not move a reader's
    // original fixed input, even though live reads and full recompute advance.
    for (let index = 0; index < 20; index++) {
      const id = randomUUID(); await upload(b, id, encode([user(id, t1), assistant(id, t1, 0, 0)]), '/synthetic/pagination');
    }
    const next = (await api(path)).json<MetricsPage>(); assert.notEqual(next.version, first.version);
    assert.equal(next.sessions.length, 20); assert.equal(next.nextOffset, 20); assert.equal(next.totals.sessions, 23);
    const second = (await api(path + `&version=${next.version}&offset=20`)).json<MetricsPage>();
    assert.equal(second.sessions.length, 3); assert.equal(second.nextOffset, null);
    const complete = (await api('/api/metrics/export?' + new URLSearchParams({ ...selection, version: next.version }))).json<MetricsPage>();
    assert.deepEqual(complete.sessions, [...next.sessions, ...second.sessions]);
    assert.deepEqual(complete.totals, next.totals); assert.deepEqual((await api(fixed)).json(), first);
    await app.close(); app = await createApp({ db, rawDirectory: sandbox.env.RAW_DIRECTORY!, reportClock: () => new Date(now.getTime() + 10 * 86400000) });
    assert.deepEqual((await api(fixed)).json(), first, 'persisted fixed version survives server restart and clock movement');
  } finally { await app?.close(); await db.end(); await sandbox.close(); }
});

test('Codex cumulative counters require a baseline; resets, unsupported versions and zero-event raw gaps stay unknown', { timeout: 120000 }, async () => {
  const sandbox = await createSandbox(); const db = connect(sandbox.env.DATABASE_URL!);
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  try {
    const employee = await sandbox.provision('累计计数员工');
    app = await createApp({ db, rawDirectory: sandbox.env.RAW_DIRECTORY! });
    const api = (url: string, body?: unknown, credential = employee.readerCredential, method: 'GET' | 'POST' | 'PUT' = 'GET') => app!.inject({
      url, method, headers: { Authorization: `Bearer ${credential}`, ...(body instanceof Buffer ? { 'Content-Type': 'application/octet-stream' } : {}) },
      ...(body !== undefined ? { payload: body as object } : {}) });
    const device = (await api('/api/devices/enroll', { installationId: randomUUID(), name: '累计计数合成设备' }, employee.enrollmentCredential, 'POST')).json();
    const timestamp = new Date(Date.now() + 60000).toISOString(), baseline = new Date(Date.now() - 86400000).toISOString(), day = beijingDate(new Date(timestamp));
    const scope = new URLSearchParams({ period: 'since-enrollment' });
    const native = randomUUID();
    const counter = (time: string, value: number) => ({ timestamp: time, type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: {
      input_tokens: value * 2, cached_input_tokens: value, output_tokens: value, reasoning_output_tokens: 0, total_tokens: value * 3 } } } });
    const event = (id: string) => ({ timestamp, type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: id }] } });
    const encode = (...rows: unknown[]) => Buffer.from(rows.map(row => JSON.stringify(row)).join('\n') + '\n');
    const header = (id: string) => ({ timestamp: baseline, type: 'session_meta', payload: { id } });
    async function upload(id: string, content: Buffer, version = '0.157.1') {
      assert.equal((await api('/api/chunks/' + digest(content), content, device.deviceCredential, 'PUT')).statusCode, 201);
      const response = await api('/api/snapshots', { protocolVersion: 1, sourceSessionId: id, source: 'codex-cli', sourceVersion: version, sourceOs: process.platform,
        project: '/synthetic/counters', hash: digest(content), byteLength: content.length, qualifiedAt: timestamp, capability: 'unverified' }, device.deviceCredential, 'POST');
      assert.equal(response.statusCode, 200, response.body); return response.json().snapshotId;
    }
    const original = encode(header(native), counter(baseline, 10), event(native), counter(timestamp, 20), counter(timestamp, 20));
    const snapshotId = await upload(native, original);
    const firstResponse = await api('/api/metrics?' + scope); assert.equal(firstResponse.statusCode, 200, firstResponse.body);
    const first = firstResponse.json<MetricsPage>();
    assert.deepEqual([first.totals.sessions, first.totals.userTurns, first.totals.inputTokens, first.totals.outputTokens], [1, 1, 20, 10]);
    const detail = await api(`/api/snapshots/${snapshotId}/metrics?${scope}`); assert.equal(detail.statusCode, 200, detail.body);
    assert.equal(detail.json().totals.inputTokens, 20);
    await upload(native, Buffer.concat([original, encode(counter(new Date(Date.parse(timestamp) + 1000).toISOString(), 5))]));
    const reset = (await api('/api/metrics?' + scope)).json<MetricsPage>();
    assert.equal(reset.totals.inputTokens, null); assert.equal(reset.totals.knownInputTokens, 20); assert.equal(reset.totals.unknownTokenSessions, 1);
    assert.deepEqual((reset.daily[0] as any).tokenTrend, { inputTokens: null, outputTokens: null, includedSessions: 0, excludedSessions: 1 }, 'a session with a reset may retain known totals but contributes no point to the Token trend');
    assert.deepEqual((await api('/api/metrics?' + scope + '&version=' + first.version)).json(), first);
    const unsupported = randomUUID(); await upload(unsupported, encode(header(unsupported), counter(baseline, 10), event(unsupported), counter(timestamp, 20)), 'future-unverified');
    const unknown = (await api('/api/metrics?' + scope)).json<MetricsPage>();
    assert.equal(unknown.totals.unknownTokenSessions, 2); assert.equal(unknown.totals.knownInputTokens, 20);
    const damaged = randomUUID(); await upload(damaged, encode(header(damaged), { timestamp, type: 'unknown_source_record', opaque: 'preserved synthetic bytes' }));
    const gap = (await api('/api/metrics?' + scope)).json<MetricsPage>();
    assert.equal(gap.totals.sessions, 2, 'unparsed bytes must not invent an observed session');
    assert.equal(gap.sourceInputsComplete, false); assert.ok(gap.unknownReasons.some(reason => reason.includes('来源日期不能确定')));
  } finally { await app?.close(); await db.end(); await sandbox.close(); }
});

test('Codex usage on a day without business events retains its source date, ownership and frozen export', { timeout: 120000 }, async () => {
  const sandbox = await createSandbox(); const db = connect(sandbox.env.DATABASE_URL!);
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  try {
    const employee = await sandbox.provision('跨日计数员工');
    app = await createApp({ db, rawDirectory: sandbox.env.RAW_DIRECTORY! });
    const api = (url: string, body?: unknown, credential = employee.readerCredential, method: 'GET' | 'POST' | 'PUT' = 'GET') => app!.inject({
      url, method, headers: { Authorization: `Bearer ${credential}`, ...(body instanceof Buffer ? { 'Content-Type': 'application/octet-stream' } : {}) },
      ...(body !== undefined ? { payload: body as object } : {}) });
    const device = (await api('/api/devices/enroll', { installationId: randomUUID(), name: '跨日合成设备' }, employee.enrollmentCredential, 'POST')).json();
    const day = addDays(beijingDate(new Date()), 1), nextDay = addDays(day, 1);
    const baseline = new Date(Date.now() - 86400000).toISOString();
    const native = randomUUID();
    const counter = (timestamp: string, value: number) => ({ timestamp, type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: {
      input_tokens: value * 2, cached_input_tokens: value, output_tokens: value, reasoning_output_tokens: 0, total_tokens: value * 3 } } } });
    const content = Buffer.from([
      { timestamp: baseline, type: 'session_meta', payload: { id: native } }, counter(baseline, 10),
      { timestamp: `${day}T23:59:00+08:00`, type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '跨日合成提示词' }] } },
      counter(`${day}T23:59:30+08:00`, 20), counter(`${nextDay}T00:00:01+08:00`, 30),
    ].map(row => JSON.stringify(row)).join('\n') + '\n');
    assert.equal((await api('/api/chunks/' + digest(content), content, device.deviceCredential, 'PUT')).statusCode, 201);
    const commit = await api('/api/snapshots', { protocolVersion: 1, sourceSessionId: native, source: 'codex-cli', sourceVersion: '0.157.1', sourceOs: process.platform,
      project: '/synthetic/midnight', hash: digest(content), byteLength: content.length, qualifiedAt: new Date(`${nextDay}T00:00:01+08:00`).toISOString(), capability: 'unverified' }, device.deviceCredential, 'POST');
    assert.equal(commit.statusCode, 200, commit.body); const snapshotId = commit.json().snapshotId;
    const query = (from: string, to: string) => new URLSearchParams({ date: to, view: from === to ? 'day' : 'week' });
    const singleResponse = await api('/api/team-coverage/metrics?' + query(nextDay, nextDay)); assert.equal(singleResponse.statusCode, 200, singleResponse.body);
    const single = singleResponse.json<MetricsPage>();
    assert.deepEqual([single.totals.sessions, single.totals.userTurns, single.totals.toolCalls, single.totals.inputTokens, single.totals.outputTokens], [0, 0, 0, 20, 10]);
    assert.equal(single.sourceInputsComplete, true); assert.deepEqual(single.sessions[0]!.snapshotIds, [snapshotId]);
    assert.deepEqual(single.daily.map(row => [row.date, row.sessions, row.userTurns, row.inputTokens, row.outputTokens]), [[nextDay, 0, 0, 20, 10]]);
    const bothResponse = await api('/api/team-coverage/metrics?' + query(day, nextDay)); assert.equal(bothResponse.statusCode, 200, bothResponse.body);
    const both = bothResponse.json<MetricsPage>();
    assert.deepEqual([both.totals.sessions, both.totals.userTurns, both.totals.toolCalls, both.totals.inputTokens, both.totals.outputTokens], [1, 1, 0, 40, 20]);
    assert.equal(both.sourceInputsComplete, true);
    assert.deepEqual(both.daily.map(row => [row.date, row.sessions, row.userTurns, row.inputTokens, row.outputTokens]), [[day, 1, 1, 20, 10], [nextDay, 0, 0, 20, 10]]);
    for (let [selection, payload] of [[query(nextDay, nextDay), single], [query(day, nextDay), both]] as const) {
      selection = new URLSearchParams({ period: 'custom', from: payload.scope.from, to: payload.scope.to, version: payload.version });
      assert.deepEqual((await api('/api/metrics?' + selection)).json(), payload);
      assert.deepEqual((await api('/api/metrics/export?' + selection)).json(), payload);
      const detail = await api(`/api/snapshots/${snapshotId}/metrics?${selection}`); assert.equal(detail.statusCode, 200, detail.body);
      assert.deepEqual(detail.json().totals, payload.totals);
    }
    // A later manifest label cannot move already-recorded usage into its new
    // project, including when the selected day has no ordinary event at all.
    const relabel = await api('/api/snapshots', { protocolVersion: 1, sourceSessionId: native, source: 'codex-cli', sourceVersion: '0.157.1', sourceOs: process.platform,
      project: '/synthetic/relabeled', hash: digest(content), byteLength: content.length, qualifiedAt: new Date(`${nextDay}T00:01:00+08:00`).toISOString(), capability: 'unverified' }, device.deviceCredential, 'POST');
    assert.equal(relabel.statusCode, 200, relabel.body);
    const originalProject = (await api('/api/team-coverage/metrics?' + query(nextDay, nextDay) + '&project=%2Fsynthetic%2Fmidnight')).json<MetricsPage>();
    assert.equal(originalProject.totals.inputTokens, 20); assert.equal(originalProject.sessions[0]!.project, '/synthetic/midnight');
    assert.deepEqual(originalProject.sessions[0]!.snapshotIds, [snapshotId]);
    const relabeledProject = (await api('/api/team-coverage/metrics?' + query(nextDay, nextDay) + '&project=%2Fsynthetic%2Frelabeled')).json<MetricsPage>();
    assert.equal(relabeledProject.totals.inputTokens, 0); assert.equal(relabeledProject.sessions.length, 0);
    // Verified recovery copies include both dates but only their new suffix is
    // new usage. It must not invent business activity on the token-only day.
    const restoredDevice = (await api('/api/devices/enroll', { installationId: randomUUID(), name: '跨日恢复合成设备' }, employee.enrollmentCredential, 'POST')).json();
    const restored = Buffer.concat([content, Buffer.from(JSON.stringify(counter(`${nextDay}T00:02:00+08:00`, 40)) + '\n')]);
    assert.equal((await api('/api/chunks/' + digest(restored), restored, restoredDevice.deviceCredential, 'PUT')).statusCode, 201);
    const recovery = await api('/api/snapshots', { protocolVersion: 1, sourceSessionId: native, source: 'codex-cli', sourceVersion: '0.157.1', sourceOs: process.platform,
      project: '/synthetic/midnight', hash: digest(restored), byteLength: restored.length, qualifiedAt: new Date(`${nextDay}T00:02:00+08:00`).toISOString(), capability: 'unverified',
      restoredFrom: { snapshotId, hash: digest(content), byteLength: content.length } }, restoredDevice.deviceCredential, 'POST');
    assert.equal(recovery.statusCode, 200, recovery.body);
    const continued = (await api('/api/team-coverage/metrics?' + query(nextDay, nextDay))).json<MetricsPage>();
    assert.deepEqual([continued.totals.sessions, continued.totals.userTurns, continued.totals.toolCalls, continued.totals.inputTokens, continued.totals.outputTokens], [0, 0, 0, 40, 20]);
    assert.equal(continued.sessions.length, 1); assert.equal(continued.sourceInputsComplete, true);
    assert.deepEqual((await api('/api/team-coverage/metrics?' + query(nextDay, nextDay) + '&version=' + single.version)).json(), single);
    // The same discovery path retains unknown usage from an unsupported source
    // version even if that original has no business events on any date.
    const unknownNative = randomUUID();
    const unknownRaw = Buffer.from([
      { timestamp: baseline, type: 'session_meta', payload: { id: unknownNative } }, counter(baseline, 10), counter(`${nextDay}T00:03:00+08:00`, 20),
    ].map(row => JSON.stringify(row)).join('\n') + '\n');
    assert.equal((await api('/api/chunks/' + digest(unknownRaw), unknownRaw, device.deviceCredential, 'PUT')).statusCode, 201);
    const unknownCommit = await api('/api/snapshots', { protocolVersion: 1, sourceSessionId: unknownNative, source: 'codex-cli', sourceVersion: 'future-unverified', sourceOs: process.platform,
      project: '/synthetic/unknown-token-only', hash: digest(unknownRaw), byteLength: unknownRaw.length, qualifiedAt: new Date(`${nextDay}T00:03:00+08:00`).toISOString(), capability: 'unverified' }, device.deviceCredential, 'POST');
    assert.equal(unknownCommit.statusCode, 200, unknownCommit.body);
    const unknown = (await api('/api/team-coverage/metrics?' + query(nextDay, nextDay) + '&project=%2Fsynthetic%2Funknown-token-only')).json<MetricsPage>();
    assert.deepEqual([unknown.totals.sessions, unknown.totals.userTurns, unknown.totals.inputTokens, unknown.totals.unknownTokenSessions, unknown.sourceInputsComplete], [0, 0, null, 1, false]);
  } finally { await app?.close(); await db.end(); await sandbox.close(); }
});
