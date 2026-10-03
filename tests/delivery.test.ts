import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile, unlink, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { chromium, expect, type Browser } from '@playwright/test';
import { createSandbox } from './support.js';

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
test('frozen offline generations survive source loss and process/server restarts, back off, retain rejected evidence and recover through device Web', { timeout: 240_000 }, async () => {
  const sandbox = await createSandbox(); let browser: Browser | undefined;
  let upstream = ''; let mode: 'online' | 'offline' | 'limited' | 'server-error' | 'wrong-ack' = 'online';
  let archiveRequests = 0; const archiveRequestTimes: number[] = []; const committedResponses: any[] = [];
  const proxy = createServer(async (incoming, outgoing) => {
    try {
      const path = incoming.url!; const archive = path.startsWith('/api/chunks/') || path.startsWith('/api/snapshots') || path === '/api/artifacts/assemble';
      if (archive) { archiveRequests++; archiveRequestTimes.push(Date.now()); }
      if (mode === 'offline') { incoming.socket.destroy(); return; }
      if (archive && mode === 'limited') { outgoing.writeHead(429, { 'Retry-After': '1', 'Content-Type': 'application/json' }).end('{}'); return; }
      if (archive && mode === 'server-error') { outgoing.writeHead(503, { 'Content-Type': 'application/json' }).end('{}'); return; }
      const parts: Buffer[] = []; for await (const part of incoming) parts.push(Buffer.from(part));
      const response = await fetch(`${upstream}${path}`, { method: incoming.method,
        headers: { ...(incoming.headers.authorization ? { Authorization: incoming.headers.authorization } : {}),
          ...(incoming.headers['idempotency-key'] ? { 'Idempotency-Key': String(incoming.headers['idempotency-key']) } : {}),
          ...(incoming.headers['content-type'] ? { 'Content-Type': incoming.headers['content-type'] } : {}) },
        body: parts.length ? Buffer.concat(parts) : undefined });
      const content = Buffer.from(await response.arrayBuffer());
      if (path.startsWith('/api/snapshots') && incoming.method === 'POST' && response.ok) {
        committedResponses.push(JSON.parse(content.toString()));
        if (mode === 'wrong-ack') {
          outgoing.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ...committedResponses.at(-1), hash: '0'.repeat(64) })); return;
        }
      }
      outgoing.writeHead(response.status, { 'Content-Type': response.headers.get('content-type') ?? 'application/json' }).end(content);
    } catch { if (!outgoing.headersSent) outgoing.writeHead(503); outgoing.end(); }
  });
  await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve));
  const proxyOrigin = `http://127.0.0.1:${(proxy.address() as { port: number }).port}`;
  try {
    upstream = await sandbox.startServer(); const employee = await sandbox.provision('离线合成员工'); const reader = await sandbox.provision('共享同步读者');
    const state = join(sandbox.directory, 'collector'); const nativeRoot = join(sandbox.directory, 'native', 'projects');
    const project = join(nativeRoot, 'synthetic'); await mkdir(project, { recursive: true });
    const sessionId = randomUUID(); const transcriptPath = join(project, `${sessionId}.jsonl`);
    await sandbox.collectorCommand('setup', state, { server: proxyOrigin, enrollmentCredential: employee.enrollmentCredential,
      source: 'claude-code-cli', nativeRoot, sourceVersion: '2.1.281', sourceOs: process.platform });
    const record = (text: string) => ({ type: 'user', sessionId, version: '2.1.281', uuid: randomUUID(), timestamp: new Date().toISOString(), message: { role: 'user', content: text } });
    const bytes = (...records: unknown[]) => Buffer.from(records.map(item => JSON.stringify(item)).join('\n') + '\n');
    const firstRecord = record('已确认原始活动'); const original = bytes(firstRecord); await writeFile(transcriptPath, original);
    await sandbox.collectorCommand('hook', state, { hook_event_name: 'UserPromptSubmit', session_id: sessionId, transcript_path: transcriptPath, cwd: '/synthetic/delivery' });
    const api = (path: string, access = reader.readerCredential, init: RequestInit = {}) => fetch(`${upstream}${path}`, { ...init, headers: { ...init.headers, Authorization: `Bearer ${access}` } });
    const latest = async () => (await (await api('/api/sessions')).json()).sessions[0].id as string;
    const detail = async (id: string) => (await api(`/api/snapshots/${id}`)).json();
    const raw = async (id: string) => Buffer.from(await (await api(`/api/snapshots/${id}/raw`)).arrayBuffer());
    const run = async (command = 'run') => {
      if (command === 'retry') assert.equal(JSON.parse(await sandbox.collectorCommand('retry', state)).state, 'retry-requested');
      return JSON.parse(await sandbox.collectorCommand('run', state));
    };
    assert.equal((await run()).committed, 1); const firstId = await latest();
    const sidecarDir = join(project, sessionId, 'tool-results'); await mkdir(sidecarDir, { recursive: true });
    const sidecar = join(sidecarDir, 'large.txt'); const material = Buffer.alloc(9 * 1024 * 1024, 'm'); await writeFile(sidecar, material);
    const offlineA = bytes(firstRecord, record('离线第一次追加')); await writeFile(transcriptPath, offlineA); mode = 'offline';
    const frozenA = await run(); assert.equal(frozenA.delivery.pendingSnapshots, 1); assert.equal(frozenA.delivery.lastFailure.kind, 'disconnected');
    assert.equal(frozenA.delivery.pendingBytes, offlineA.length + material.length); assert.ok(frozenA.delivery.lastSuccessAt);
    assert.deepEqual(await raw(firstId), original, 'last committed original remains readable while delivery fails');
    const beforeSkipped = archiveRequests;
    const offlineB = bytes(record('离线重写后的活动')); await writeFile(transcriptPath, offlineB); await unlink(sidecar);
    const frozenB = await run(); assert.equal(frozenB.delivery.pendingSnapshots, 2);
    assert.ok(archiveRequestTimes.slice(beforeSkipped).every(at => at >= Date.parse(frozenA.delivery.nextAttemptAt)),
      'process restart never sends before persisted nextAttemptAt; a slow process launch may legitimately cross the deadline');
    if (archiveRequests === beforeSkipped) assert.equal(frozenB.delivery.nextAttemptAt, frozenA.delivery.nextAttemptAt);
    const plans = await readdir(join(state, 'delivery', 'pending')); assert.equal(plans.length, 2);
    for (const plan of plans) {
      const value = JSON.parse(await readFile(join(state, 'delivery', 'pending', plan), 'utf8'));
      assert.ok(value.payloads.some((payload: any) => payload.hash === hash(material)), 'deleted sidecar remains referenced in every pending generation that needs it');
    }
    await unlink(transcriptPath); // Only this test's source; delivery must no longer need it.
    const serverPort = Number(new URL(upstream).port); await sandbox.stopServer(); upstream = await sandbox.startServer(serverPort);
    mode = 'online'; await setTimeout(Math.max(0, Date.parse(frozenB.delivery.nextAttemptAt) - Date.now() + 30));
    const recovered = await run(); assert.equal(recovered.committed, 2); assert.equal(recovered.delivery.pendingSnapshots, 0);
    assert.ok(recovered.errors.some((message: string) => message.includes('ENOENT')), 'missing source remains a collection gap even when frozen bytes deliver');
    const afterLossId = await latest(); assert.deepEqual(await raw(afterLossId), offlineB);
    const history = (await (await api(`/api/snapshots/${afterLossId}/history`)).json()).snapshots;
    assert.equal(history.length, 3); const aSnapshot = history.find((item: any) => item.hash === hash(offlineA)); assert.ok(aSnapshot);
    assert.deepEqual(await raw(aSnapshot.id), offlineA);
    assert.equal((await detail(aSnapshot.id)).manifest.capture.previousSnapshotId, firstId);
    const recoveredDetail = await detail(afterLossId); const materialId = recoveredDetail.manifest.capture.materials[0].id;
    assert.equal(recoveredDetail.manifest.capture.previousSnapshotId, aSnapshot.id, 'offline generation resolves its predecessor only after that predecessor is committed');
    assert.deepEqual(Buffer.from(await (await api(`/api/snapshots/${afterLossId}/materials/${materialId}`)).arrayBuffer()), material);
    assert.equal((await readdir(join(state, 'delivery', 'blobs'))).length, 0, 'confirmed blobs are pruned only after all pending references retire');
    assert.equal(recoveredDetail.activity.today.counts.userTurns, 1, 'immutable generations do not inflate latest logical activity');

    await writeFile(transcriptPath, offlineB); await writeFile(sidecar, material);
    // Reintroducing a source resolves its missing-material gap as a new exact manifest.
    await run();
    const limitedBytes = Buffer.concat([offlineB, bytes(record('限流期间活动'))]); await writeFile(transcriptPath, limitedBytes); mode = 'limited';
    const limited = await run(); assert.equal(limited.delivery.lastFailure.kind, 'rate-limited'); assert.equal(limited.delivery.pendingSnapshots, 1);
    assert.ok(Date.parse(limited.delivery.nextAttemptAt) - Date.parse(limited.delivery.lastFailure.at) >= 1000);
    const requestCount = archiveRequests; await run();
    assert.ok(archiveRequestTimes.slice(requestCount).every(at => at >= Date.parse(limited.delivery.nextAttemptAt)), 'a restarted process respects persisted Retry-After');
    let deviceStatus = (await (await api('/api/devices/status')).json()).devices[0];
    assert.equal(deviceStatus.sources[0].report.pendingSnapshots, 1); assert.equal(deviceStatus.sources[0].report.lastFailure.kind, 'rate-limited');
    browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(upstream); await page.getByLabel('个人读取凭据').fill(reader.readerCredential); await page.getByRole('button', { name: '进入存档' }).click();
    await page.getByRole('navigation', { name: '平台页面', exact: true }).getByRole('button', { name: '接入与设备', exact: true }).click();
    await expect(page.getByRole('region', { name: '设备同步状态' })).toContainText('服务器限流 (429)');
    await page.screenshot({ path: join(sandbox.directory, 'delivery-backlog.png'), fullPage: true });
    mode = 'online'; await setTimeout(Math.max(0, Date.parse(limited.delivery.nextAttemptAt) - Date.now() + 30)); assert.equal((await run()).committed, 1);

    const settingsPath = join(state, 'settings.json'); const settings = JSON.parse(await readFile(settingsPath, 'utf8'));
    const rejectedBytes = Buffer.concat([limitedBytes, bytes(record('凭据修复后补传'))]); await writeFile(transcriptPath, rejectedBytes);
    await writeFile(settingsPath, JSON.stringify({ ...settings, deviceCredential: 'invalid-device-credential-for-isolated-test-only' }));
    const rejected = await run(); assert.equal(rejected.delivery.lastFailure.kind, 'credentials-rejected'); assert.equal(rejected.delivery.lastFailure.status, 401);
    assert.ok(Date.parse(rejected.delivery.nextAttemptAt) - Date.parse(rejected.delivery.lastFailure.at) >= 60_000);
    const rejectedCount = archiveRequests; await run(); assert.equal(archiveRequests, rejectedCount); assert.equal((await run()).delivery.pendingSnapshots, 1);
    await writeFile(settingsPath, JSON.stringify(settings)); const fixed = await run('retry'); assert.equal(fixed.delivery.pendingSnapshots, 0);
    assert.equal(fixed.delivery.lastFailure, null); assert.equal(fixed.delivery.lastRejection.kind, 'credentials-rejected');
    assert.deepEqual(await raw(await latest()), rejectedBytes);
    deviceStatus = (await (await api('/api/devices/status')).json()).devices[0]; assert.equal(deviceStatus.sources[0].report.lastRejection.status, 401);
    assert.equal((await api('/api/devices/status', settings.deviceCredential)).status, 401);
    assert.equal((await fetch(`${upstream}/api/devices/status`)).status, 401);
    assert.equal((await api('/api/devices/health', settings.deviceCredential, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nonce: randomUUID(), deviceId: randomUUID() }) })).status, 400, 'health ownership comes only from its device credential');

    const lastBytes = Buffer.concat([rejectedBytes, bytes(record('确认重试十次仍为一次活动'))]); await writeFile(transcriptPath, lastBytes); mode = 'wrong-ack';
    const ids: string[] = [];
    for (let attempt = 0; attempt < 10; attempt++) {
      const result = await run(attempt ? 'retry' : 'run'); assert.equal(result.delivery.pendingSnapshots, 1); assert.equal(result.delivery.lastFailure.kind, 'invalid-ack');
      ids.push(committedResponses.at(-1).snapshotId);
    }
    assert.equal(new Set(ids).size, 1, 'ten deliveries of an unconfirmed immutable manifest return one committed snapshot');
    assert.equal((await detail(ids[0]!)).activity.today.counts.userTurns, 4);
    mode = 'online'; const confirmed = await run('retry'); assert.equal(confirmed.delivery.pendingSnapshots, 0); assert.deepEqual(await raw(await latest()), lastBytes);
    const allHistory = (await (await api(`/api/snapshots/${await latest()}/history`)).json()).snapshots;
    assert.equal(allHistory.filter((item: any) => item.hash === hash(lastBytes)).length, 1);
    mode = 'server-error'; const failedBytes = Buffer.concat([lastBytes, bytes(record('503 后补传'))]); await writeFile(transcriptPath, failedBytes);
    const unavailable = await run(); assert.equal(unavailable.delivery.lastFailure.kind, 'server-unavailable');
    mode = 'online'; await setTimeout(Math.max(0, Date.parse(unavailable.delivery.nextAttemptAt) - Date.now() + 30)); assert.equal((await run()).committed, 1);
    await page.getByRole('button', { name: '刷新设备状态' }).click(); await expect(page.getByRole('region', { name: '设备同步状态' })).toContainText('设备凭据被拒绝 (401)');
    await expect(page.getByRole('region', { name: '设备同步状态' })).toContainText('0 份');
    await page.setViewportSize({ width: 375, height: 900 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: join(sandbox.directory, 'delivery-recovered-mobile.png'), fullPage: true });
    console.log(`Offline delivery API/UI evidence: ${sandbox.directory}; source deleted only after frozen local manifests, ten retry snapshots=${new Set(ids).size}`);
  } finally { proxy.closeAllConnections(); await new Promise<void>(resolve => proxy.close(() => resolve())); try { await browser?.close(); } finally { await sandbox.close(); } }
});
