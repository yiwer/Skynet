import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createSandbox } from './support.js';
import { createApp } from '../apps/server/app.js';
import { connect, digest } from '../apps/server/database.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beijingDate } from '../packages/contracts/reports.js';

test('assembly audit explains upload replays without collapsing independent equal-text activity', { timeout: 120000 }, async () => {
  const sandbox = await createSandbox(), db = connect(sandbox.env.DATABASE_URL!);
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  try {
    const employee = await sandbox.provision('组装合成员工');
    app = await createApp({ db, rawDirectory: sandbox.env.RAW_DIRECTORY! });
    const api = (url: string, payload?: object | Buffer, credential = employee.readerCredential, method: 'GET' | 'POST' | 'PUT' = 'GET', key?: string) => app!.inject({
      url, method, headers: { Authorization: `Bearer ${credential}`, ...(key ? { 'Idempotency-Key': key } : {}), ...(payload instanceof Buffer ? { 'Content-Type': 'application/octet-stream' } : {}) }, ...(payload === undefined ? {} : { payload }) });
    const device = (await api('/api/devices/enroll', { installationId: randomUUID(), name: '组装设备' }, employee.enrollmentCredential, 'POST')).json();
    const session = randomUUID(), timestamp = new Date(Date.now() + 1000).toISOString();
    const bytes = Buffer.from([1, 2].map(() => JSON.stringify({ timestamp, type: 'user', uuid: randomUUID(), sessionId: session, message: { role: 'user', content: '相同文字，两次独立提交' } })).join('\n') + '\n');
    for (let i = 0; i < 2; i++) assert.equal((await api(`/api/chunks/${digest(bytes)}`, bytes, device.deviceCredential, 'PUT')).statusCode, 201);
    const manifest = { protocolVersion: 1, sourceSessionId: session, source: 'claude-code-cli', sourceVersion: '2.1.281', sourceOs: process.platform,
      project: '/synthetic/assembly', hash: digest(bytes), byteLength: bytes.length, qualifiedAt: timestamp, capability: 'unverified' };
    const key = randomUUID();
    const committed = await api('/api/snapshots', manifest, device.deviceCredential, 'POST', key);
    assert.equal(committed.statusCode, 200, committed.body);
    const snapshot = committed.json().snapshotId;
    const first = await api(`/api/snapshots/${snapshot}/assembly`);
    assert.equal(first.statusCode, 200, first.body);
    const original = first.json();
    assert.equal(original.state, 'assembled'); assert.equal(original.lineage.decision, 'independent');
    assert.deepEqual(original.records, { total: 2, unique: 2, inherited: 0, repeated: 0, compactSummaries: 0 });
    assert.equal(original.transport.chunkRequests, 2); assert.equal(original.transport.duplicateChunkRequests, 1);
    assert.equal(original.transport.snapshotReplays, 0); assert.equal(original.sources[0].chunkCount, 1);
    assert.equal((await api('/api/snapshots', manifest, device.deviceCredential, 'POST', key)).json().snapshotId, snapshot);
    const replay = (await api(`/api/snapshots/${snapshot}/assembly`)).json();
    assert.equal(replay.transport.snapshotReplays, 1); assert.notEqual(replay.version, original.version);
    assert.deepEqual((await api(`/api/snapshots/${snapshot}/assembly?version=${original.version}`)).json(), original);
    assert.deepEqual((await api(`/api/snapshots/${snapshot}/raw`)).rawPayload, bytes);
    const metrics = (await api('/api/metrics?period=since-enrollment')).json();
    assert.equal(metrics.totals.userTurns, 2); assert.equal(metrics.totals.sessions, 1);
    assert.equal((await api('/api/assembly?state=pending-lineage')).json().rows.length, 0);
    assert.deepEqual((await api(`/api/assembly/export?snapshotId=${snapshot}&version=${replay.version}`)).json(), replay);
    await app.close(); app = await createApp({ db, rawDirectory: sandbox.env.RAW_DIRECTORY! });
    assert.deepEqual((await api(`/api/snapshots/${snapshot}/assembly?version=${original.version}`)).json(), original);
  } finally { await app?.close(); await db.end(); await sandbox.close(); }
});

test('data processing measures actual native pickup through readable ACK, separate pipeline stages and unknown legacy timing', { timeout: 120000 }, async () => {
  const sandbox = await createSandbox();
  try {
    const server = await sandbox.startServer(), employee = await sandbox.provision('处理合成员工');
    const state = join(sandbox.directory, 'collector'), nativeRoot = join(sandbox.directory, 'native', 'projects');
    await mkdir(nativeRoot, { recursive: true });
    await sandbox.collectorCommand('setup', state, { server, enrollmentCredential: employee.enrollmentCredential, nativeRoot,
      source: 'claude-code-cli', sourceVersion: '2.1.281', sourceOs: process.platform });
    const sessionId = randomUUID(), transcript = join(nativeRoot, `${sessionId}.jsonl`);
    const bytes = Buffer.from(JSON.stringify({ type: 'user', sessionId, uuid: randomUUID(), version: '2.1.281', timestamp: new Date().toISOString(), message: { role: 'user', content: '处理链路合成提交' } }) + '\n');
    await writeFile(transcript, bytes);
    await sandbox.collectorCommand('hook', state, { hook_event_name: 'Stop', session_id: sessionId, transcript_path: transcript, cwd: '/synthetic/pipeline' });
    assert.equal(JSON.parse(await sandbox.collectorCommand('run', state)).committed, 1);
    const api = (path: string) => fetch(server + path, { headers: { Authorization: `Bearer ${employee.readerCredential}` } });
    const read = await api(`/api/processing?date=${beijingDate(new Date())}`);
    assert.equal(read.status, 200, await read.clone().text());
    const pipeline = await read.json();
    assert.equal(pipeline.latency.samples, 1); assert.equal(pipeline.latency.unknown, 0);
    assert.ok(pipeline.latency.p95Ms > 0); assert.ok(pipeline.latency.p95Ms < 60000);
    assert.equal(pipeline.latency.measurement, 'collector-monotonic-pickup-to-readable-ack');
    assert.deepEqual(pipeline.stages.map((stage: any) => stage.count), [1, 1, 0, 1, 1, 1, 0]);
    assert.equal(pipeline.pending.length, 0);
    assert.equal(pipeline.tokenCoverage.find((row: any) => row.source === 'claude-code-cli').unknownSessions, 1);
    assert.equal(pipeline.catalog.definitions.find((row: any) => row.key === 'userTurns').label, '用户轮次');
    const sessions = await (await api('/api/sessions')).json();
    const audit = await (await api(`/api/snapshots/${sessions.sessions[0].id}/assembly`)).json();
    assert.equal(audit.delivery.receiptCount, 1);
    assert.deepEqual(Buffer.from(await (await api(`/api/snapshots/${sessions.sessions[0].id}/raw`)).arrayBuffer()), bytes);
  } finally { await sandbox.close(); }
});

test('multi-part originals followed by append retain the full chunk lineage and independent raw bytes', { timeout: 120000 }, async () => {
  const sandbox = await createSandbox(), db = connect(sandbox.env.DATABASE_URL!); let app: Awaited<ReturnType<typeof createApp>> | undefined;
  try {
    const employee = await sandbox.provision('分块合成员工'); app = await createApp({ db, rawDirectory: sandbox.env.RAW_DIRECTORY! });
    const api = (url: string, payload?: object | Buffer, credential = employee.readerCredential, method: 'GET' | 'POST' | 'PUT' = 'GET') => app!.inject({ url, method,
      headers: { Authorization: `Bearer ${credential}`, ...(payload instanceof Buffer ? { 'Content-Type': 'application/octet-stream' } : {}) }, ...(payload === undefined ? {} : { payload }) });
    const device = (await api('/api/devices/enroll', { installationId: randomUUID(), name: '分块设备' }, employee.enrollmentCredential, 'POST')).json();
    const sourceSessionId = randomUUID(), timestamp = new Date(Date.now() + 1000).toISOString();
    const parts = [1, 2, 3].map(index => Buffer.from(JSON.stringify({ type: 'user', uuid: randomUUID(), sessionId: sourceSessionId, timestamp, message: { role: 'user', content: `独立提交 ${index}` } }) + '\n'));
    for (const part of parts) assert.equal((await api('/api/chunks/' + digest(part), part, device.deviceCredential, 'PUT')).statusCode, 201);
    const original = Buffer.concat(parts.slice(0, 2)), complete = Buffer.concat(parts);
    assert.equal((await api('/api/artifacts/assemble', { hash: digest(original), byteLength: original.length, chunks: parts.slice(0, 2).map(part => ({ hash: digest(part), byteLength: part.length })) }, device.deviceCredential, 'POST')).statusCode, 200);
    const manifest = { protocolVersion: 1, sourceSessionId, source: 'claude-code-cli', sourceVersion: '2.1.281', sourceOs: process.platform, project: '/synthetic/chunks', qualifiedAt: timestamp, capability: 'unverified', hash: digest(original), byteLength: original.length };
    const first = (await api('/api/snapshots', manifest, device.deviceCredential, 'POST')).json();
    const appended = await api('/api/snapshots/append', { baseSnapshotId: first.snapshotId, baseHash: digest(original), baseByteLength: original.length, appendHash: digest(parts[2]!), appendByteLength: parts[2]!.length, manifest: { ...manifest, hash: digest(complete), byteLength: complete.length } }, device.deviceCredential, 'POST');
    assert.equal(appended.statusCode, 200, appended.body);
    const audit = (await api(`/api/snapshots/${appended.json().snapshotId}/assembly`)).json();
    assert.equal(audit.sources[0].chunkCount, 3); assert.equal(audit.transport.chunkRequests, 3);
    assert.equal(audit.records.inherited, 2); assert.equal(audit.records.unique, 3);
    assert.equal((await api('/api/metrics?period=since-enrollment')).json().totals.userTurns, 3);
    assert.deepEqual((await api(`/api/snapshots/${first.snapshotId}/raw`)).rawPayload, original);
    assert.deepEqual((await api(`/api/snapshots/${appended.json().snapshotId}/raw`)).rawPayload, complete);
  } finally { await app?.close(); await db.end(); await sandbox.close(); }
});
