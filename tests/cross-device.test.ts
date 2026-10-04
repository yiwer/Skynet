import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { join } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium, expect, type Browser } from '@playwright/test';
import { createSandbox } from './support.js';

const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('public capture and verified A→B→C recovery preserve event owners, projects, unique statistics and exports', { timeout: 180_000 }, async () => {
  const sandbox = await createSandbox(); let browser: Browser | undefined;
  try {
    const alpha = await sandbox.provision('谱系员工甲'); const beta = await sandbox.provision('谱系员工乙');
    const origin = await sandbox.startServer();
    const api = (path: string, credential = alpha.readerCredential, init: RequestInit = {}) => fetch(origin + path, { ...init,
      headers: { ...init.headers, Authorization: `Bearer ${credential}` } });
    const sessionId = randomUUID();
    const row = (role: string, text: string, timestamp = new Date(Date.now() + 60_000).toISOString()) => JSON.stringify({ timestamp,
      type: 'response_item', payload: { type: 'message', role, content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }] } }) + '\n';
    const header = JSON.stringify({ timestamp: '2026-09-20T01:00:00Z', type: 'session_meta', payload: { id: sessionId, cli_version: 'synthetic-fixture-1' } }) + '\n';
    // Both devices run under this same OS user. Their enrollment credentials, not
    // local user names or uploader-supplied names, determine attribution.
    async function collect(name: string, employee: typeof alpha, bytes: Buffer, restored?: any, project = `/synthetic/${name}`) {
      const home = join(sandbox.directory, name); const root = join(home, 'sessions'); await mkdir(root, { recursive: true });
      const transcriptPath = join(root, `${sessionId}.jsonl`); await writeFile(transcriptPath, bytes);
      if (restored) await writeFile(join(home, 'restore-receipt.json'), JSON.stringify({ source: 'codex-desktop', sourceSessionId: sessionId,
        rolloutPath: transcriptPath, restoredFrom: { snapshotId: restored.snapshot.id, hash: restored.manifest.hash, byteLength: restored.manifest.byteLength } }));
      const state = join(sandbox.directory, `collector-${name}`);
      const setup = JSON.parse(await sandbox.collectorCommand('setup', state, { server: origin, enrollmentCredential: employee.enrollmentCredential,
        nativeRoot: root, sourceVersion: 'synthetic-fixture-1', sourceOs: process.platform }));
      await sandbox.collectorCommand('hook', state, { hook_event_name: 'Stop', session_id: sessionId, transcript_path: transcriptPath, cwd: project });
      const status = JSON.parse(await sandbox.collectorCommand('run', state)); assert.deepEqual(status.errors, []);
      const sessions = (await (await api('/api/sessions')).json()).sessions;
      const session = sessions.find((item: any) => item.project === project); assert.ok(session);
      return { state, transcriptPath, deviceId: setup.deviceId, snapshotId: session.id, bytes };
    }
    const first = await collect('A', alpha, Buffer.from(header + row('user', '原始历史', '2026-09-20T01:01:00Z')));
    await writeFile(first.transcriptPath, Buffer.concat([first.bytes, Buffer.from(row('user', '甲接入后独立活动'))]));
    await sandbox.collectorCommand('run', first.state);
    const firstLatest = (await (await api('/api/sessions')).json()).sessions.find((s: any) => s.project === '/synthetic/A');
    const bundleA = await (await api(`/api/snapshots/${firstLatest.id}/recovery`)).json();
    const bBytes = Buffer.concat([Buffer.from(bundleA.artifact.data, 'base64'), Buffer.from(row('user', '相同文字也可能是独立活动'))]);
    const second = await collect('B', beta, bBytes, bundleA);
    const bundleB = await (await api(`/api/snapshots/${second.snapshotId}/recovery`)).json();
    const cBytes = Buffer.concat([Buffer.from(bundleB.artifact.data, 'base64'), Buffer.from(row('user', '相同文字也可能是独立活动'))]);
    const third = await collect('C', alpha, cBytes, bundleB);
    const detail = await (await api(`/api/snapshots/${third.snapshotId}`)).json();
    assert.equal(detail.employee, '谱系员工甲'); assert.equal(detail.provenance.relation, 'verified-restoration');
    assert.equal(detail.provenance.sourceSnapshotId, second.snapshotId);
    assert.deepEqual(detail.events.map((event: any) => [event.origin.employee, event.origin.project, event.context]), [
      ['谱系员工甲', '/synthetic/A', 'historical'], ['谱系员工甲', '/synthetic/A', 'after-enrollment'],
      ['谱系员工乙', '/synthetic/B', 'after-enrollment'], ['谱系员工甲', '/synthetic/C', 'after-enrollment'],
    ]);
    assert.equal(detail.events[2].origin.deviceId, second.deviceId); assert.equal(detail.events[3].origin.deviceId, third.deviceId);
    assert.notEqual(detail.events[2].origin.eventId, detail.events[3].origin.eventId, 'identical text from independent occurrences stays distinct');
    assert.equal(detail.events[0].origin.snapshotId, first.snapshotId, 'transitive original evidence anchor survives');
    const searched = await (await api('/api/search?' + new URLSearchParams({ employee: '谱系员工乙', project: '/synthetic/B', content: '相同文字', history: 'latest' }))).json();
    assert.ok(searched.hits.some((hit: any) => hit.id === third.snapshotId && hit.employee === '谱系员工乙' && hit.project === '/synthetic/B'), 'search matches the historical event owner/project inside a third-device snapshot');
    const impossible = await (await api('/api/search?' + new URLSearchParams({ employee: '谱系员工甲', project: '/synthetic/B', content: '相同文字', history: 'latest' }))).json();
    assert.deepEqual(impossible.hits, [], 'filters apply to one event origin, not separate matching portions of a copied snapshot');
    const beforeCopy = await (await api('/api/activity-statistics')).json();
    const total = (employee: string, field: string, stats = beforeCopy) => stats.rows.filter((row: any) => row.employee === employee).reduce((n: number, row: any) => n + row[field], 0);
    assert.equal(total('谱系员工甲', 'records'), 3); assert.equal(total('谱系员工乙', 'records'), 1);
    assert.equal(total('谱系员工甲', 'activityUserTurns'), 2); assert.equal(total('谱系员工甲', 'historicalRecords'), 1);
    const secondSettings = JSON.parse(await readFile(join(second.state, 'settings.json'), 'utf8'));
    const repeatedClaim = await api('/api/snapshots', secondSettings.deviceCredential, json({ ...bundleB.manifest, qualifiedAt: new Date(Date.now() + 1).toISOString() }));
    assert.equal(repeatedClaim.status, 200); assert.deepEqual(await (await api('/api/activity-statistics')).json(), beforeCopy, 'repeated restoration reference retains the already recorded target suffix');
    // Exact retries and another capture of the same source do not inflate the ledger.
    await sandbox.collectorCommand('run', third.state);
    assert.deepEqual(await (await api('/api/activity-statistics')).json(), beforeCopy);
    const readable = await (await api(`/api/snapshots/${third.snapshotId}/readable`, beta.readerCredential)).text();
    assert.ok(readable.includes(second.deviceId) && readable.includes(first.snapshotId) && readable.includes('谱系员工乙'));
    assert.ok(readable.endsWith(cBytes.toString('utf8')));
    assert.deepEqual(Buffer.from(await (await api(`/api/snapshots/${third.snapshotId}/raw`)).arrayBuffer()), cBytes);
    const bundleC = await (await api(`/api/snapshots/${third.snapshotId}/recovery`)).json();
    assert.deepEqual(Buffer.from(bundleC.artifact.data, 'base64'), cBytes); assert.equal(bundleC.manifest.restoredFrom.snapshotId, second.snapshotId);
    // Copied identity/bytes without the server reference cannot silently merge ownership.
    const unconfirmed = await collect('unknown-copy', beta, cBytes);
    const unknown = await (await api(`/api/snapshots/${unconfirmed.snapshotId}`)).json();
    assert.equal(unknown.provenance.relation, 'unconfirmed'); assert.match(unknown.provenance.warning, /保持独立/);
    assert.ok(unknown.events.every((event: any) => event.origin.employee === '谱系员工乙'));
    assert.equal(total('谱系员工乙', 'records', await (await api('/api/activity-statistics')).json()), 5);
    // Device credentials cannot read; uploader cannot fabricate an employee or a
    // mismatching source prefix. This uses only public request contracts.
    const settings = JSON.parse(await readFile(join(second.state, 'settings.json'), 'utf8'));
    assert.equal((await api('/api/activity-statistics', settings.deviceCredential)).status, 401);
    assert.equal((await api('/api/snapshots', settings.deviceCredential, json({ ...bundleB.manifest, employeeId: alpha.employeeId }))).status, 400);
    const wrong = { ...bundleB.manifest, restoredFrom: { snapshotId: third.snapshotId, hash: hash(cBytes), byteLength: cBytes.length } };
    assert.equal((await api('/api/snapshots', settings.deviceCredential, json(wrong))).status, 409);
    const nonexistent = { ...bundleB.manifest, restoredFrom: { snapshotId: randomUUID(), hash: bundleA.manifest.hash, byteLength: bundleA.manifest.byteLength } };
    assert.equal((await api('/api/snapshots', settings.deviceCredential, json(nonexistent))).status, 409);
    const afterCopy = await (await api('/api/activity-statistics')).json();
    assert.equal(total('谱系员工乙', 'records', afterCopy), 5, 'rejected claims do not change the durable ledger');
    browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(`${origin}/#${third.snapshotId}`); await page.getByLabel('个人读取凭据').fill(beta.readerCredential);
    await page.getByRole('button', { name: '进入存档' }).click();
    const assembly = page.getByRole('region', { name: '组装与去重', exact: true });
    await expect(assembly).toContainText('恢复历史合并');
    await expect(assembly.getByRole('link', { name: '查看原始归属', exact: true })).toHaveAttribute('href', '#' + second.snapshotId);
    await page.getByRole('link', { name: '时间线', exact: true }).click();
    await expect(page.getByRole('link', { name: '时间线', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('article', { name: '会话详情' })).toContainText('原始归属：谱系员工乙');
    await page.screenshot({ path: join(sandbox.directory, 'cross-device-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 375, height: 1000 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.screenshot({ path: join(sandbox.directory, 'cross-device-mobile.png'), fullPage: true });
    const persisted = await (await api('/api/activity-statistics')).json();
    await sandbox.stopServer(); const newOrigin = await sandbox.startServer(Number(new URL(origin).port)); assert.equal(newOrigin, origin);
    assert.deepEqual(await (await api('/api/activity-statistics')).json(), persisted);
    await writeFile(join(sandbox.directory, 'cross-device-evidence.json'), JSON.stringify({ first, second, third, originalOrigins: detail.events.map((e: any) => e.origin), statistics: persisted,
      unconfirmedCopySeparated: true, mismatchingClaimRejected: true, originalBytesPreserved: true, serverRestart: true,
      boundary: 'Synthetic public host events and receipt fixture; native restore/normal hook continuation covered by explicit native Claude test.' }, null, 2));
    console.log(`Cross-device public-flow evidence: ${sandbox.directory}`);
  } finally { await browser?.close(); await sandbox.close(); }
});

test('stable native occurrences retain copied origins through rewrites; changed bytes and independent identities remain separate', { timeout: 180_000 }, async () => {
  const sandbox = await createSandbox();
  try {
    const alpha = await sandbox.provision('同名员工'); const beta = await sandbox.provision('同名员工');
    assert.notEqual(alpha.employeeId, beta.employeeId);
    const origin = await sandbox.startServer();
    const api = (path: string, token = alpha.readerCredential, init: RequestInit = {}) => fetch(origin + path, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } });
    const enroll = async (employee: typeof alpha) => (await api('/api/devices/enroll', employee.enrollmentCredential, json({ installationId: randomUUID(), name: 'same-local-user' }))).json();
    const A = await enroll(alpha); const B = await enroll(beta); const sessionId = randomUUID();
    const nativeRow = (uuid: string, content: string) => ({ type: 'user', uuid, sessionId, version: '2.1.281',
      timestamp: new Date(Date.now() + 60_000).toISOString(), message: { role: 'user', content } });
    const a1 = nativeRow(randomUUID(), '完全相同的文字'); const a2 = nativeRow(randomUUID(), '完全相同的文字');
    const b1 = nativeRow(randomUUID(), '乙的新增记录'); const b2 = nativeRow(randomUUID(), '乙在重写后的新增记录');
    const encoded = (rows: unknown[]) => Buffer.from(rows.map(row => JSON.stringify(row)).join('\n') + '\n');
    async function commit(device: typeof A, bytes: Buffer, restoredFrom?: any) {
      assert.equal((await api(`/api/chunks/${hash(bytes)}`, device.deviceCredential, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(bytes) })).status, 201);
      const manifest = { protocolVersion: 1, source: 'claude-code-cli', sourceSessionId: sessionId, sourceVersion: '2.1.281', sourceOs: process.platform,
        project: device.deviceId === A.deviceId ? '/synthetic/original-A' : '/synthetic/current-B', hash: hash(bytes), byteLength: bytes.length,
        qualifiedAt: new Date().toISOString(), capability: 'unverified', ...(restoredFrom ? { restoredFrom } : {}) };
      const response = await api('/api/snapshots', device.deviceCredential, json(manifest)); assert.equal(response.status, 200, await response.clone().text());
      return (await response.json()).snapshotId;
    }
    const aBytes = encoded([a1, a2]); const aId = await commit(A, aBytes);
    const bId = await commit(B, encoded([a1, a2, b1]), { snapshotId: aId, hash: hash(aBytes), byteLength: aBytes.length });
    const before = await (await api(`/api/snapshots/${bId}`)).json();
    const rewriteBytes = encoded([b1, a2, a1, b2, b2]);
    const rewritten = await commit(B, rewriteBytes);
    const after = await (await api(`/api/snapshots/${rewritten}`)).json();
    assert.match(after.provenance.warning, /重写或截断/);
    assert.equal(after.events[1].origin.employeeId, alpha.employeeId); assert.equal(after.events[2].origin.employeeId, alpha.employeeId);
    assert.equal(after.events[1].origin.project, '/synthetic/original-A');
    assert.equal(after.events[2].origin.eventId, before.events[0].origin.eventId);
    assert.equal(after.events[3].origin.eventId, after.events[4].origin.eventId, 'one native UUID and exact same raw record is one known occurrence');
    const stats = await (await api('/api/activity-statistics')).json();
    const sum = (ownerId: string, value = stats) => value.rows.filter((r: any) => r.employeeId === ownerId).reduce((n: number, r: any) => n + r.records, 0);
    assert.equal(sum(alpha.employeeId), 2); assert.equal(sum(beta.employeeId), 2, 'same display name does not merge identities');
    const changed = await commit(B, encoded([{ ...a1, message: { role: 'user', content: '同 UUID 内容已改写' } }, b1, b2]));
    const changedDetail = await (await api(`/api/snapshots/${changed}`)).json();
    assert.equal(changedDetail.events[0].origin.employeeId, beta.employeeId, 'native UUID without byte equality cannot reassign history');
    assert.notEqual(changedDetail.events[0].origin.eventId, before.events[0].origin.eventId);
    assert.equal(sum(beta.employeeId, await (await api('/api/activity-statistics')).json()), 3);
    assert.deepEqual(Buffer.from(await (await api(`/api/snapshots/${rewritten}/raw`)).arrayBuffer()), rewriteBytes);
    console.log(`Native occurrence rewrite fixture evidence: ${sandbox.directory}`);
  } finally { await sandbox.close(); }
});
