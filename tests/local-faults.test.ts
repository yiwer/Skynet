import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createSandbox, syntheticSession } from './support.js';

test('public source deletion reports survive process/server restart, stay separate from immutable originals, and cannot be forged by readers', { timeout: 60_000 }, async () => {
  const sandbox = await createSandbox();
  try {
    const employee = await sandbox.provision('缺口测试员工'); const reader = await sandbox.provision('共享缺口读取者');
    let origin = await sandbox.startServer(); const root = join(sandbox.directory, 'native'); const state = join(sandbox.directory, 'state');
    await mkdir(root); const session = await syntheticSession(root);
    await sandbox.collectorCommand('setup', state, { server: origin, enrollmentCredential: employee.enrollmentCredential,
      nativeRoot: root, source: 'codex-cli', sourceVersion: '0.157.1', sourceOs: process.platform });
    const settings = JSON.parse(await readFile(join(state, 'settings.json'), 'utf8'));
    const api = (path: string, token = reader.readerCredential, init: RequestInit = {}) => fetch(`${origin}${path}`, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } });
    const detail = async (id: string) => (await api(`/api/snapshots/${id}`)).json();
    await sandbox.collectorCommand('hook', state, session.event); await sandbox.collectorCommand('run', state);
    const snapshot = (await (await api('/api/sessions')).json()).sessions[0];
    const initial = await detail(snapshot.id); assert.equal(initial.captureHealth.total, 0);
    await unlink(session.transcriptPath); await sandbox.collectorCommand('run', state);
    const missing = await detail(snapshot.id); assert.equal(missing.captureHealth.faults[0].code, 'source-missing');
    assert.equal(missing.captureHealth.faults[0].sessionId, session.sessionId); assert.equal(missing.captureHealth.faults[0].recoveredAt, null);
    assert.deepEqual(initial.manifest, missing.manifest); assert.deepEqual(initial.activity, missing.activity, 'health never creates activity');
    const gapId = missing.captureHealth.faults[0].id;
    assert.equal((await api(`/api/snapshots/${snapshot.id}/capture-status`, '')).status, 401);
    assert.equal((await api(`/api/snapshots/${snapshot.id}/capture-status`, settings.deviceCredential)).status, 401);
    const forged = { nonce: randomUUID(), source: 'codex-cli', capture: { checkedAt: new Date().toISOString(), observation: 'host-event-observed', locallyPersisted: true, faults: [] }, deviceId: randomUUID() };
    assert.equal((await api('/api/devices/health', reader.readerCredential, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(forged) })).status, 401);
    assert.equal((await api('/api/devices/health', settings.deviceCredential, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(forged) })).status, 400);
    await sandbox.stopServer(); origin = await sandbox.startServer(Number(new URL(origin).port));
    assert.equal((await detail(snapshot.id)).captureHealth.faults[0].id, gapId);
    await writeFile(session.transcriptPath, session.bytes); await sandbox.collectorCommand('run', state);
    const restored = await detail(snapshot.id); assert.equal(restored.captureHealth.faults[0].id, gapId);
    assert.ok(restored.captureHealth.faults[0].recoveredAt); assert.equal(restored.captureHealth.faults[0].coverage, 'unverified-range');
    assert.deepEqual(Buffer.from(await (await api(`/api/snapshots/${snapshot.id}/raw`)).arrayBuffer()), session.bytes);
    assert.equal((await (await api('/api/sessions')).json()).sessions.length, 1);
    const local = JSON.parse(await sandbox.collectorCommand('status', state)); assert.ok(local['capture-health.json'].faults[0].recoveredAt);
    // An event lost before any successful snapshot still appears at device scope.
    const absentId = randomUUID(); await sandbox.collectorCommand('hook', state, { ...session.event, session_id: absentId, transcript_path: join(root, `${absentId}.jsonl`) });
    await sandbox.collectorCommand('run', state);
    const devices = (await (await api('/api/devices/status')).json()).devices;
    assert.ok(devices[0].capture[0].faults.some((item: any) => item.sessionId === absentId));
    assert.equal((await detail(snapshot.id)).captureHealth.total, 1, 'another missing session does not contaminate this session');
    // Bounded pages preserve prior faults; omission from later reports is not deletion.
    const report = JSON.parse(await readFile(join(state, 'capture-health.json'), 'utf8'));
    const additions = Array.from({ length: 12 }, (_, index) => ({ ...report.faults[0], id: randomUUID(), sessionId: session.sessionId,
      firstObservedAt: new Date(Date.now() + index).toISOString() }));
    const response = await api('/api/devices/health', settings.deviceCredential, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nonce: randomUUID(), source: 'codex-cli', capture: { ...report, faults: additions } }) }); assert.equal(response.status, 200);
    let next = 0; const ids: string[] = [];
    do { const page = await (await api(`/api/snapshots/${snapshot.id}/capture-status?offset=${next}`)).json(); ids.push(...page.faults.map((item: any) => item.id)); next = page.nextOffset; } while (next !== null);
    assert.equal(new Set(ids).size, 13); assert.ok(ids.includes(gapId));
    await writeFile(join(sandbox.directory, 'local-fault-evidence.json'), JSON.stringify({ snapshotId: snapshot.id, gapId, recovered: restored.captureHealth, noSnapshotGapVisible: true, faultCount: ids.length }, null, 2));
    console.log(`Public local fault evidence: ${sandbox.directory}`);
  } finally { await sandbox.close(); }
});
