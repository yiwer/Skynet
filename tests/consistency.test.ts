import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, expect, type Browser } from '@playwright/test';
import { crash, createSandbox } from './support.js';

const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
function latch<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

test('public upload survives killed processes and lost confirmations with one immutable result and recoverable enrollment', { timeout: 180_000 }, async () => {
  const sandbox = await createSandbox(); let browser: Browser | undefined; let child: ChildProcess | undefined;
  let childError = '';
  let upstream = '';
  let mode: 'online' | 'enrollment-held' | 'before-commit' | 'after-commit' | 'lost-ack' | 'wrong-key' = 'online';
  let arrived = latch<any>(); let released = latch<void>();
  const commits: { snapshotId: string; uploadId: string }[] = [];
  const transfers: { path: string; status: number; uploadId?: string }[] = [];
  const proxy = createServer(async (incoming, outgoing) => {
    try {
      const path = incoming.url!; const isCommit = path.startsWith('/api/snapshots') && incoming.method === 'POST';
      const parts: Buffer[] = []; for await (const part of incoming) parts.push(Buffer.from(part));
      const body = Buffer.concat(parts);
      if (mode === 'before-commit' && isCommit) {
        arrived.resolve({ body: JSON.parse(body.toString()), uploadId: incoming.headers['idempotency-key'] });
        await released.promise; incoming.socket.destroy(); return;
      }
      const response = await fetch(`${upstream}${path}`, { method: incoming.method,
        headers: { ...(incoming.headers.authorization ? { Authorization: incoming.headers.authorization } : {}),
          ...(incoming.headers['content-type'] ? { 'Content-Type': incoming.headers['content-type'] } : {}),
          ...(incoming.headers['idempotency-key'] ? { 'Idempotency-Key': String(incoming.headers['idempotency-key']) } : {}) },
        ...(body.length ? { body } : {}) });
      const content = Buffer.from(await response.arrayBuffer());
      transfers.push({ path, status: response.status, uploadId: incoming.headers['idempotency-key'] as string | undefined });
      if (response.ok && ((mode === 'enrollment-held' && path === '/api/devices/enroll') || (mode === 'after-commit' && isCommit))) {
        const result = JSON.parse(content.toString()); if (isCommit) commits.push(result);
        arrived.resolve(result); await released.promise; incoming.socket.destroy(); return;
      }
      if (response.ok && isCommit) {
        const result = JSON.parse(content.toString()); commits.push(result);
        if (mode === 'lost-ack') { incoming.socket.destroy(); return; }
        if (mode === 'wrong-key') { outgoing.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ...result, uploadId: randomUUID() })); return; }
      }
      outgoing.writeHead(response.status, { 'Content-Type': response.headers.get('content-type') ?? 'application/json' }).end(content);
    } catch { if (!outgoing.headersSent) outgoing.writeHead(503); outgoing.end(); }
  });
  await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve));
  const proxyOrigin = `http://127.0.0.1:${(proxy.address() as { port: number }).port}`;
  const hold = (next: typeof mode) => { mode = next; arrived = latch(); released = latch(); };
  const signal = () => Promise.race([arrived.promise, new Promise<never>((_, reject) => {
    const timer = setTimeout(() => reject(new Error(`Fault boundary ${mode} was not reached: ${childError}`)), 20_000); timer.unref();
  })]);
  const spawnCommand = (action: string, state: string, input?: unknown) => {
    childError = '';
    child = spawn(process.execPath, ['dist/apps/collector/cli.js', action, '--state', state, ...(action === 'run' ? ['--once'] : [])],
      { env: sandbox.env, windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
    child.stderr!.on('data', part => { childError += part; });
    child.stdin!.end(input ? JSON.stringify(input) : '');
    return child;
  };
  try {
    upstream = await sandbox.startServer();
    const employee = await sandbox.provision('一致性合成员工'); const reader = await sandbox.provision('一致性读者');
    const manager = await sandbox.provision('一致性维护者', true);
    const state = join(sandbox.directory, 'collector'); const nativeRoot = join(sandbox.directory, 'native'); await mkdir(nativeRoot);
    const setup = { server: proxyOrigin, enrollmentCredential: employee.enrollmentCredential, source: 'claude-code-cli',
      nativeRoot, sourceVersion: '2.1.281', sourceOs: process.platform };
    const api = (path: string, init: RequestInit = {}, credential = reader.readerCredential) => fetch(`${upstream}${path}`, {
      ...init, headers: { ...init.headers, Authorization: `Bearer ${credential}` } });
    const post = (path: string, body: unknown, credential: string, uploadId?: string) => api(path, { method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(uploadId ? { 'Idempotency-Key': uploadId } : {}) }, body: JSON.stringify(body) }, credential);
    const sessions = async () => (await (await api('/api/sessions')).json()).sessions;
    const raw = async (id: string) => Buffer.from(await (await api(`/api/snapshots/${id}/raw`)).arrayBuffer());
    const detail = async (id: string) => (await api(`/api/snapshots/${id}`)).json();
    const restartServer = async () => { upstream = await sandbox.startServer(Number(new URL(upstream).port)); };
    const run = async (retry = false) => {
      if (retry) await sandbox.collectorCommand('retry', state);
      return JSON.parse(await sandbox.collectorCommand('run', state));
    };

    // The installer is killed after the real server committed, while its first
    // successful response remains held by the external network proxy.
    hold('enrollment-held'); spawnCommand('setup', state, setup); const enrolled = await signal();
    const proof = JSON.parse(await readFile(join(state, 'enrollment.json'), 'utf8'));
    await assert.rejects(sandbox.collectorCommand('setup', state, setup), /Another setup/);
    assert.equal(proof.deviceCredential, enrolled.deviceCredential); assert.equal(proof.server, proxyOrigin);
    assert.ok(!JSON.stringify(proof).includes(employee.enrollmentCredential));
    await assert.rejects(readFile(join(state, 'settings.json')), { code: 'ENOENT' });
    await crash(child); await sandbox.crashServer(); released.resolve(); mode = 'online'; await restartServer();
    await assert.rejects(sandbox.collectorCommand('setup', state, { ...setup, enrollmentCredential: reader.enrollmentCredential }), /another server or personal authorization/);
    assert.deepEqual(JSON.parse(await readFile(join(state, 'enrollment.json'), 'utf8')), proof);
    const recovered = JSON.parse(await sandbox.collectorCommand('setup', state, setup));
    assert.equal(recovered.deviceId, enrolled.deviceId);
    const settings = JSON.parse(await readFile(join(state, 'settings.json'), 'utf8'));
    assert.equal(settings.deviceCredential, enrolled.deviceCredential); assert.equal(settings.enrolledAt, enrolled.enrolledAt);
    const enrollmentRequest = { installationId: proof.installationId, name: proof.name, deviceCredential: proof.deviceCredential };
    const repeat = await (await post('/api/devices/enroll', enrollmentRequest, employee.enrollmentCredential)).json();
    assert.equal(repeat.deviceId, enrolled.deviceId); assert.equal(repeat.enrolledAt, enrolled.enrolledAt);
    assert.equal((await post('/api/devices/enroll', { ...enrollmentRequest, deviceCredential: randomBytes(32).toString('base64url') }, employee.enrollmentCredential)).status, 409);
    assert.equal((await post('/api/devices/enroll', { installationId: proof.installationId, name: proof.name }, employee.enrollmentCredential)).status, 409);
    assert.equal((await (await api('/api/devices/status')).json()).devices.length, 1, 'lost enrollment response never created a second device');

    const sessionId = randomUUID(); const transcript = join(nativeRoot, `${sessionId}.jsonl`);
    const record = (text: string) => ({ type: 'user', sessionId, uuid: randomUUID(), version: '2.1.281', timestamp: new Date().toISOString(), message: { role: 'user', content: text } });
    const bytes = (...records: unknown[]) => Buffer.from(records.map(value => JSON.stringify(value)).join('\n') + '\n');
    const original = bytes(record('先前已确认材料')); await writeFile(transcript, original);
    await sandbox.collectorCommand('hook', state, { hook_event_name: 'UserPromptSubmit', session_id: sessionId, transcript_path: transcript, cwd: '/synthetic/consistency' });
    assert.equal((await run()).committed, 1); const oldId = (await sessions())[0].id;

    // A rewrite forces a full raw upload. Its staging response proves server
    // durability was reached, but no snapshot request crosses the proxy.
    const secondRecords = [record('崩溃前已冻结第一条'), record('崩溃前已冻结第二条')]; const secondBytes = bytes(...secondRecords);
    await writeFile(transcript, secondBytes); hold('before-commit'); spawnCommand('run', state); const waiting = await signal();
    await assert.rejects(sandbox.collectorCommand('run', state), /Another collector/);
    assert.equal(waiting.body.hash, hash(secondBytes));
    assert.ok(transfers.some(item => item.path === `/api/chunks/${hash(secondBytes)}` && item.status === 201));
    assert.equal((await sessions())[0].id, oldId); assert.deepEqual(await raw(oldId), original);
    await crash(child); await sandbox.crashServer(); await unlink(transcript); released.resolve(); mode = 'online'; await restartServer();
    assert.equal((await sessions())[0].id, oldId);
    assert.equal((await run(true)).committed, 1); const secondId = (await sessions())[0].id;
    assert.deepEqual(await raw(secondId), secondBytes); assert.deepEqual(await raw(oldId), original);

    // The next append is committed, then both processes are forcibly killed
    // before the successful confirmation reaches the collector's cursor.
    const thirdBytes = bytes(...secondRecords, record('确认丢失十次只出现一次的活动'));
    await writeFile(transcript, thirdBytes); hold('after-commit'); spawnCommand('run', state); const committed = await signal();
    assert.equal(JSON.parse(await readFile(join(state, 'tracked.json'), 'utf8'))[0].acknowledgedSnapshotId, secondId);
    assert.deepEqual(await raw(committed.snapshotId), thirdBytes);
    await crash(child); await sandbox.crashServer(); await unlink(transcript); released.resolve(); await restartServer();
    mode = 'wrong-key'; const invalidAck = await run(true);
    assert.equal(invalidAck.delivery.lastFailure.kind, 'invalid-ack'); assert.equal(invalidAck.delivery.pendingSnapshots, 1);
    mode = 'lost-ack'; const replayStart = commits.length;
    for (let attempt = 0; attempt < 10; attempt++) {
      const result = await run(true); assert.equal(result.delivery.lastFailure.kind, 'disconnected'); assert.equal(result.delivery.pendingSnapshots, 1);
      assert.equal(JSON.parse(await readFile(join(state, 'tracked.json'), 'utf8'))[0].acknowledgedSnapshotId, secondId);
    }
    const replays = commits.slice(replayStart); assert.equal(replays.length, 10);
    assert.deepEqual([...new Set(replays.map(item => item.snapshotId))], [committed.snapshotId]);
    assert.deepEqual([...new Set(replays.map(item => item.uploadId))], [committed.uploadId]);
    const backlog = (await (await api('/api/devices/status')).json()).devices[0].sources[0].report;
    assert.equal(backlog.pendingSnapshots, 1);
    mode = 'online'; assert.equal((await run(true)).delivery.pendingSnapshots, 0);
    const final = await detail(committed.snapshotId); assert.equal(final.activity.today.counts.userTurns, 3);
    assert.equal((await sessions()).length, 1);
    const history = (await (await api(`/api/snapshots/${committed.snapshotId}/history`)).json()).snapshots;
    assert.equal(history.length, 3); assert.equal(history.filter((item: any) => item.id === committed.snapshotId).length, 1);
    assert.equal((await readdir(join(state, 'delivery', 'pending'))).length, 0);

    // Public HTTP invalid requests cannot alter committed evidence. The upload
    // key is device scoped; a server-owned enrollment time is normalized before
    // fingerprinting. Parallel identical retries bind one immutable result.
    const manifest = final.manifest; const token = settings.deviceCredential; const uploadId = randomUUID();
    const concurrent = await Promise.all(Array.from({ length: 10 }, () => post('/api/snapshots', manifest, token, uploadId).then(response => response.json())));
    assert.ok(concurrent.every(item => item.snapshotId === committed.snapshotId && item.uploadId === uploadId && item.committedAt === final.committedAt));
    const normalized = await post('/api/snapshots', { ...manifest, enrolledAt: '2000-01-01T00:00:00.000Z' }, token, uploadId);
    assert.equal(normalized.status, 200); assert.equal((await normalized.json()).snapshotId, committed.snapshotId);
    assert.equal((await post('/api/snapshots', { ...manifest, project: '/different' }, token, uploadId)).status, 409);
    assert.equal((await post('/api/snapshots', { ...manifest, source: 'codex-cli' }, token, uploadId)).status, 409);
    const conflictingBytes = bytes(record('同一上传键不能替换原件'));
    assert.equal((await api(`/api/chunks/${hash(conflictingBytes)}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(conflictingBytes) }, token)).status, 201);
    assert.equal((await post('/api/snapshots', { ...manifest, hash: hash(conflictingBytes), byteLength: conflictingBytes.length }, token, uploadId)).status, 409);
    assert.equal((await post('/api/snapshots', { ...manifest, hash: hash('missing') }, token, randomUUID())).status, 409);
    assert.equal((await post('/api/snapshots', { ...manifest, byteLength: manifest.byteLength + 1 }, token, randomUUID())).status, 409);
    assert.equal((await api(`/api/chunks/${hash('not these bytes')}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: 'actual bytes' }, token)).status, 422);
    assert.equal((await post('/api/artifacts/assemble', { hash: hash('missing'), byteLength: 7, chunks: [{ hash: hash('missing'), byteLength: 7 }] }, token)).status, 409);
    assert.equal((await post('/api/artifacts/assemble', { hash: hash('wrong result'), byteLength: thirdBytes.length, chunks: [{ hash: hash(thirdBytes), byteLength: thirdBytes.length }] }, token)).status, 422);
    const missingMaterial = { id: hash('missing-material-id'), role: 'tool-result', name: 'missing.txt', placement: 'portable', hash: hash('missing material'), byteLength: 16, mediaType: 'text' };
    assert.equal((await post('/api/snapshots', { ...manifest, capture: { ...manifest.capture, materials: [...manifest.capture.materials, missingMaterial] } }, token, randomUUID())).status, 409);
    assert.equal((await sessions())[0].id, committed.snapshotId); assert.deepEqual(await raw(oldId), original);
    assert.deepEqual(await raw(committed.snapshotId), thirdBytes);
    const recovery = await (await api(`/api/snapshots/${committed.snapshotId}/recovery`)).json();
    assert.deepEqual(Buffer.from(recovery.artifact.data, 'base64'), thirdBytes); assert.deepEqual(recovery.manifest, manifest);
    assert.ok((await (await api(`/api/snapshots/${committed.snapshotId}/readable`)).text()).includes(thirdBytes.toString()));

    browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(upstream + '/#sessions'); await page.getByLabel('个人读取凭据').fill(reader.readerCredential); await page.getByRole('button', { name: '进入存档' }).click();
    await page.getByRole('row').filter({ hasText: '一致性合成员工' }).getByRole('link').click();
    await expect(page.getByRole('article', { name: '会话详情' })).toContainText('确认丢失十次只出现一次的活动');
    const downloadReady = page.waitForEvent('download'); await page.getByRole('button', { name: '下载原件', exact: true }).click();
    const downloadPath = await (await downloadReady).path(); assert.ok(downloadPath);
    assert.deepEqual(await readFile(downloadPath), thirdBytes);
    await page.screenshot({ path: join(sandbox.directory, 'consistency-final.png'), fullPage: true });

    assert.equal((await post(`/api/identities/devices/${enrolled.deviceId}/disable`, {}, manager.readerCredential)).status, 200);
    assert.equal((await post('/api/devices/enroll', enrollmentRequest, employee.enrollmentCredential)).status, 403);
    assert.equal((await post(`/api/identities/employees/${employee.employeeId}/disable`, {}, manager.readerCredential)).status, 200);
    assert.equal((await post('/api/devices/enroll', enrollmentRequest, employee.enrollmentCredential)).status, 401);
    assert.deepEqual(await raw(committed.snapshotId), thirdBytes, 'disabled writer does not remove committed shared evidence');
    await writeFile(join(sandbox.directory, 'consistency-evidence.json'), JSON.stringify({ processPlatform: process.platform,
      killedAt: ['enrollment committed before response', 'raw staged before snapshot commit', 'snapshot committed before client cursor'],
      enrollmentDeviceStable: true, enrollmentTimeStable: true, stolenInstallationIdRejected: true, disabledRetryRejected: true,
      oldSnapshotId: oldId, latestSnapshotId: committed.snapshotId, latestHash: hash(thirdBytes), latestBytes: thirdBytes.length,
      lostConfirmations: replays.length, uniqueRetriedSnapshotIds: 1, uniqueRetriedUploadIds: 1, finalUserTurns: 3,
      concurrentIdenticalRetries: 10, sourceDeletedBeforeRecovery: true, invalidRequestsPreserveOldSnapshot: true,
      rawReadableRecoveryAndWebVerified: true, powerLossTested: false }, null, 2));
    console.log(`Process crash and confirmation evidence: ${sandbox.directory}`);
  } finally {
    released.resolve(); await crash(child); proxy.closeAllConnections(); await new Promise<void>(resolve => proxy.close(() => resolve()));
    await browser?.close(); await sandbox.close();
  }
});
