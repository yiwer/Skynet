import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { rename } from 'node:fs/promises';
import { createSandbox } from './support.js';
import { createApp } from '../apps/server/app.js';
import { connect, digest } from '../apps/server/database.js';
import type { MetricsPage } from '../packages/contracts/metrics.js';

test('recorded metrics count human submissions while retaining machine context as original evidence', { timeout: 120000 }, async () => {
  const sandbox = await createSandbox(), db = connect(sandbox.env.DATABASE_URL!);
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  try {
    const employee = await sandbox.provision('指标合成员工');
    const now = new Date(Date.now() + 60000), timestamp = now.toISOString();
    app = await createApp({ db, rawDirectory: sandbox.env.RAW_DIRECTORY!, reportClock: () => now });
    const api = (url: string, payload?: object | Buffer, credential = employee.readerCredential, method: 'GET' | 'POST' | 'PUT' = 'GET') => app!.inject({
      url, method, headers: { Authorization: `Bearer ${credential}`, ...(payload instanceof Buffer ? { 'Content-Type': 'application/octet-stream' } : {}) }, ...(payload === undefined ? {} : { payload }) });
    const device = (await api('/api/devices/enroll', { installationId: randomUUID(), name: '指标设备' }, employee.enrollmentCredential, 'POST')).json();
    const session = randomUUID();
    const user = (text: string) => ({ timestamp, type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } });
    const bytes = Buffer.from([
      { timestamp, type: 'session_meta', payload: { id: session } },
      user('<environment_context>\n<cwd>/synthetic</cwd>\n</environment_context>'),
      user('<environment_context>机器环境</environment_context>\n请检查日志。'),
      user('<environment_context>一</environment_context><environment_context>二</environment_context>'),
      user('请保留三条真实用户提交。'),
      { timestamp, type: 'response_item', payload: { type: 'function_call', name: 'shell', arguments: '{"command":"synthetic"}', call_id: 'call-1' } },
    ].map(value => JSON.stringify(value)).join('\n') + '\n');
    assert.equal((await api(`/api/chunks/${digest(bytes)}`, bytes, device.deviceCredential, 'PUT')).statusCode, 201);
    const manifest = { protocolVersion: 1, sourceSessionId: session, source: 'codex-cli', sourceVersion: '0.157.1', sourceOs: process.platform,
      project: '/synthetic/metrics', hash: digest(bytes), byteLength: bytes.length, qualifiedAt: timestamp, capability: 'unverified' };
    const committed = await api('/api/snapshots', manifest, device.deviceCredential, 'POST'); assert.equal(committed.statusCode, 200, committed.body);
    assert.equal((await api('/api/snapshots', manifest, device.deviceCredential, 'POST')).json().snapshotId, committed.json().snapshotId);
    const [response, selected] = await Promise.all([api('/api/metrics?period=since-enrollment'), api(`/api/metrics?period=since-enrollment&employeeId=${employee.employeeId}`)]);
    assert.equal(response.statusCode, 200, response.body); assert.equal(selected.statusCode, 200, selected.body);
    assert.deepEqual(selected.json<MetricsPage>().totals, response.json<MetricsPage>().totals, 'concurrent overlapping scopes publish complete results');
    const metrics = response.json<MetricsPage>();
    assert.deepEqual([metrics.totals.sessions, metrics.totals.userTurns, metrics.totals.toolCalls, metrics.totals.inputTokens], [1, 3, 1, null]);
    assert.equal(metrics.catalogVersion.startsWith('recorded-metrics-3/'), true);
    assert.deepEqual((await api('/api/metrics/recompute', { period: 'since-enrollment' }, employee.readerCredential, 'POST')).json(), metrics);
    await app.close(); app = await createApp({ db, rawDirectory: sandbox.env.RAW_DIRECTORY!, reportClock: () => now });
    assert.deepEqual((await api('/api/metrics?period=since-enrollment')).json(), metrics);
    assert.deepEqual((await api(`/api/metrics/export?period=since-enrollment&version=${metrics.version}`)).json(), metrics);
    const raw = await api(`/api/snapshots/${committed.json().snapshotId}/raw`);
    assert.deepEqual(raw.rawPayload, bytes);
    const corrupt = Buffer.concat([bytes, Buffer.from('{"invalid":"'), Buffer.from([255]), Buffer.from('"}\n')]);
    assert.equal((await api(`/api/chunks/${digest(corrupt)}`, corrupt, device.deviceCredential, 'PUT')).statusCode, 201);
    const corruptUpload = await api('/api/snapshots', { ...manifest, hash: digest(corrupt), byteLength: corrupt.length }, device.deviceCredential, 'POST');
    assert.equal(corruptUpload.statusCode, 200, corruptUpload.body);
    const unavailable = await api('/api/metrics?period=since-enrollment');assert.equal(unavailable.statusCode, 200, unavailable.body);
    const gap = unavailable.json<MetricsPage>();
    assert.deepEqual([gap.totals.sessions, gap.totals.userTurns, gap.totals.toolCalls, gap.totals.inputTokens], [1, 3, 1, null], 'readable machine context remains excluded beside invalid bytes');
    assert.equal(gap.sourceInputsComplete, false);assert.notEqual(gap.version, metrics.version);
    assert.deepEqual((await api('/api/metrics/recompute', { period: 'since-enrollment' }, employee.readerCredential, 'POST')).json(), gap);
    assert.deepEqual((await api(`/api/metrics/export?period=since-enrollment&version=${metrics.version}`)).json(), metrics);
    assert.deepEqual((await api(`/api/snapshots/${corruptUpload.json().snapshotId}/raw`)).rawPayload, corrupt);
  } finally { await app?.close(); await db.end(); await sandbox.close(); }
});

test('report filters expose only this week, last week and since enrollment while rejecting arbitrary live ranges', { timeout: 120000 }, async () => {
  const sandbox = await createSandbox(), db = connect(sandbox.env.DATABASE_URL!);
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  try {
    const employee = await sandbox.provision('范围合成员工');
    app = await createApp({ db, rawDirectory: sandbox.env.RAW_DIRECTORY! });
    const api = (query: string) => app!.inject({ url: '/api/metrics?' + query, headers: { Authorization: `Bearer ${employee.readerCredential}` } });
    for (const period of ['this-week', 'last-week', 'since-enrollment']) assert.equal((await api(`period=${period}`)).statusCode, 200);
    assert.equal((await api('period=custom&from=2026-10-01&to=2026-10-02')).statusCode, 400);
    assert.equal((await api('period=this-week&from=2026-10-01&to=2026-10-02')).statusCode, 400);
  } finally { await app?.close(); await db.end(); await sandbox.close(); }
});

test('fixed metrics survive a storage outage while live reporting and explicit recomputation report the missing original', { timeout: 120000 }, async () => {
  const sandbox = await createSandbox(), db = connect(sandbox.env.DATABASE_URL!);
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  let originalMoved = false;
  try {
    const employee = await sandbox.provision('可重算指标员工');
    const now = new Date(Date.now() + 60000), timestamp = now.toISOString();
    const open = () => createApp({ db, rawDirectory: sandbox.env.RAW_DIRECTORY!, reportClock: () => now });
    app = await open();
    const api = (url: string, payload?: object | Buffer, credential = employee.readerCredential, method: 'GET' | 'POST' | 'PUT' = 'GET') => app!.inject({
      url, method, headers: { Authorization: `Bearer ${credential}`, ...(payload instanceof Buffer ? { 'Content-Type': 'application/octet-stream' } : {}) }, ...(payload === undefined ? {} : { payload }) });
    const device = (await api('/api/devices/enroll', { installationId: randomUUID(), name: '持久结果设备' }, employee.enrollmentCredential, 'POST')).json();
    const session = randomUUID();
    const bytes = Buffer.from([
      { timestamp, type: 'user', uuid: randomUUID(), sessionId: session, message: { role: 'user', content: '合成任务' } },
      { timestamp, type: 'assistant', uuid: randomUUID(), sessionId: session, message: { id: randomUUID(), role: 'assistant', content: [{ type: 'text', text: '合成结果' }],
        usage: { input_tokens: 80, cache_read_input_tokens: 10, cache_creation_input_tokens: 5, output_tokens: 20 } } },
    ].map(value => JSON.stringify(value)).join('\n') + '\n');
    assert.equal((await api(`/api/chunks/${digest(bytes)}`, bytes, device.deviceCredential, 'PUT')).statusCode, 201);
    const committed = await api('/api/snapshots', { protocolVersion: 1, sourceSessionId: session, source: 'claude-code-cli', sourceVersion: '2.1.281', sourceOs: process.platform,
      project: '/synthetic/durable', hash: digest(bytes), byteLength: bytes.length, qualifiedAt: timestamp, capability: 'unverified' }, device.deviceCredential, 'POST');
    assert.equal(committed.statusCode, 200, committed.body);
    const first = (await api('/api/metrics?period=since-enrollment')).json<MetricsPage>();
    assert.deepEqual([first.totals.sessions, first.totals.userTurns, first.totals.inputTokens, first.totals.outputTokens], [1, 1, 95, 20]);
    await app.close(); app = undefined;
    await rename(sandbox.env.RAW_DIRECTORY!, sandbox.env.RAW_DIRECTORY! + '-temporarily-unavailable'); originalMoved = true;
    app = await open();
    const liveGap = (await api('/api/metrics?period=since-enrollment')).json<MetricsPage>();
    assert.equal(liveGap.sourceInputsComplete, false); assert.equal(liveGap.totals.inputTokens, null);
    const gap = (await api('/api/metrics/recompute', { period: 'since-enrollment' }, employee.readerCredential, 'POST')).json<MetricsPage>();
    assert.equal(gap.sourceInputsComplete, false); assert.equal(gap.totals.inputTokens, null);
    assert.notEqual(gap.version, first.version);
    assert.deepEqual((await api(`/api/metrics/export?period=since-enrollment&version=${first.version}`)).json(), first);
    await rename(sandbox.env.RAW_DIRECTORY! + '-temporarily-unavailable', sandbox.env.RAW_DIRECTORY!); originalMoved = false;
    assert.deepEqual((await api('/api/metrics/recompute', { period: 'since-enrollment' }, employee.readerCredential, 'POST')).json(), first);
  } finally {
    if (originalMoved) await rename(sandbox.env.RAW_DIRECTORY! + '-temporarily-unavailable', sandbox.env.RAW_DIRECTORY!);
    await app?.close(); await db.end(); await sandbox.close();
  }
});
