import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { chromium, expect } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { mcpSandbox } from './mcp-support.js';
import { command } from './support.js';

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const json = (value: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
const encoded = (...rows: unknown[]) => Buffer.from(rows.map(row => JSON.stringify(row)).join('\n') + '\n');

test('restored associated native transcript qualifies only through host capture; A material → B primary → C preserves real evidence and counts', { timeout: 180_000 }, async () => {
  const s = await mcpSandbox(); let client: Client | undefined; let browser;
  console.log(`Material primary fixture directory: ${s.directory}`);
  try {
    (s.env as NodeJS.ProcessEnv).NODE_EXTRA_CA_CERTS = s.ca;
    const A = await s.provision('材料来源甲'); const B = await s.provision('材料续用乙'); const C = await s.provision('材料续用丙');
    const api = (path: string, token = A.readerCredential, init: RequestInit = {}) => s.api(path, token, init);
    const parentId = randomUUID(); const childId = randomUUID();
    const header = (id: string, extra = {}) => ({ type: 'session_meta', timestamp: '2026-09-20T01:00:00Z', payload: { id, timestamp: '2026-09-20T01:00:00Z', cwd: '/synthetic', source: 'cli', cli_version: '0.157.1', ...extra } });
    const row = (text: string, timestamp: string | null = new Date(Date.now() + 60_000).toISOString()) => ({ type: 'response_item', timestamp,
      payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } });
    const materialBytes = encoded(header(childId), row('材料中的历史活动🛰'), row('材料中的未知时间', null));
    const homeA = join(s.directory, 'A'); const rootA = join(homeA, 'sessions'); await mkdir(rootA, { recursive: true });
    const parentPath = join(rootA, `${parentId}.jsonl`); const childPath = join(rootA, `${childId}.jsonl`);
    await writeFile(childPath, materialBytes);
    await writeFile(parentPath, encoded(header(parentId, { forked_from_id: childId }), row('甲的主会话')));
    const db = new DatabaseSync(join(homeA, 'state_5.sqlite')); db.exec('CREATE TABLE threads(id TEXT PRIMARY KEY,rollout_path TEXT)');
    db.prepare('INSERT INTO threads VALUES(?,?)').run(childId, childPath); db.close();
    async function setup(name: string, employee: typeof A, root: string) {
      const state = join(s.directory, `collector-${name}`);
      await s.collectorCommand('setup', state, { source: 'codex-cli', server: s.origin, enrollmentCredential: employee.enrollmentCredential,
        nativeRoot: root, sourceVersion: '0.157.1', sourceOs: process.platform }); return state;
    }
    async function qualify(state: string, id: string, path: string, project: string) {
      await s.collectorCommand('hook', state, { hook_event_name: 'Stop', session_id: id, transcript_path: path, cwd: project });
      const result = JSON.parse(await s.collectorCommand('run', state)); assert.deepEqual(result.errors, []);
      return (await (await api('/api/sessions')).json()).sessions.find((item: any) => item.project === project).id;
    }
    const stateA = await setup('A', A, rootA); const parentSnapshot = await qualify(stateA, parentId, parentPath, '/source/A');
    const bundleA = await (await api(`/api/snapshots/${parentSnapshot}/recovery`)).json();
    const material = bundleA.manifest.capture.materials.find((item: any) => item.sourceSessionId === childId);
    assert.ok(material); const pre = await (await api('/api/activity-statistics')).json();
    assert.equal(pre.rows.reduce((n: number, item: any) => n + item.records, 0), 1, 'stored context alone creates no ledger activity');
    const homeB = join(s.directory, 'restored-B'); const runtime = process.env.SKYNET_CODEX_CLI_RUNTIME;
    let restored: any; let usedRestoreCli = false;
    if (runtime && process.platform === 'win32') {
      const packagePath = join(s.directory, 'source-package.json'); await writeFile(packagePath, JSON.stringify(bundleA));
      restored = JSON.parse(await command(process.execPath, ['dist/apps/collector/cli.js', 'restore', '--package', packagePath,
        '--target', homeB, '--source-version', '0.157.1', '--runtime', runtime], s.env)); usedRestoreCli = true;
    } else {
      const root = join(homeB, 'sessions'); await mkdir(root, { recursive: true });
      restored = { source: 'codex-cli', snapshotId: parentSnapshot, sourceSessionId: parentId, rolloutPath: join(root, `${parentId}.jsonl`),
        restoredFrom: { snapshotId: parentSnapshot, hash: bundleA.manifest.hash, byteLength: bundleA.manifest.byteLength },
        materials: [{ ...material, path: join(root, `${childId}.jsonl`) }] };
      await writeFile(restored.materials[0].path, materialBytes); await writeFile(join(homeB, 'restore-receipt.json'), JSON.stringify(restored));
    }
    const restoredPath = restored.materials.find((item: any) => item.id === material.id).path;
    const stateB = await setup('B', B, join(homeB, 'sessions'));
    assert.equal(JSON.parse(await s.collectorCommand('run', stateB)).committed, 0, 'a receipt never independently qualifies a material');
    await writeFile(restoredPath, Buffer.concat([materialBytes, encoded(row('乙的新增后缀'))]));
    const bId = await qualify(stateB, childId, restoredPath, '/current/B');
    const detail = await (await api(`/api/snapshots/${bId}`)).json();
    assert.deepEqual(detail.events.map((e: any) => [e.origin.employeeId, e.origin.project, e.context]), [
      [A.employeeId, '/source/A', 'historical'], [A.employeeId, '/source/A', 'unknown-time'], [B.employeeId, '/current/B', 'after-enrollment']]);
    assert.equal(detail.manifest.restoredFrom.materialId, material.id);
    assert.equal(detail.events[0].origin.snapshotId, parentSnapshot); assert.equal(detail.events[0].origin.materialId, material.id);
    assert.equal(detail.events[0].origin.location.kind, 'material');
    const originalLocation = detail.events[0].origin.location;
    const location = await (await api(`/api/snapshots/${parentSnapshot}/location?${new URLSearchParams(originalLocation)}`)).json();
    assert.ok(location.text.includes('材料中的历史活动')); assert.equal(location.ownership.employeeId, A.employeeId);
    const beforeLateQualification = await (await api('/api/activity-statistics')).json();
    const lateAId = await qualify(stateA, childId, childPath, '/later-qualified/A');
    const lateA = await (await api(`/api/snapshots/${lateAId}`)).json();
    assert.deepEqual(lateA.events.map((event: any) => event.origin.eventId), detail.events.slice(0, 2).map((event: any) => event.origin.eventId));
    assert.equal(lateA.events[0].context,'after-enrollment','original A independently proves its original post-enrollment activity');
    assert.equal(lateA.events[1].context,'unknown-time');
    const afterLateQualification = await (await api('/api/activity-statistics')).json();
    assert.equal(afterLateQualification.rows.reduce((n:number,row:any)=>n+row.records,0),beforeLateQualification.rows.reduce((n:number,row:any)=>n+row.records,0),'qualification never creates a second event');
    assert.equal(afterLateQualification.rows.filter((row:any)=>row.employeeId===A.employeeId).reduce((n:number,row:any)=>n+row.activityRecords,0),2);
    const repeatSettings = JSON.parse(await readFile(join(stateB, 'settings.json'), 'utf8'));
    const repeat = await api('/api/snapshots', repeatSettings.deviceCredential, json({ ...detail.manifest, qualifiedAt: new Date().toISOString() }));
    assert.equal(repeat.status, 200, await repeat.clone().text());
    assert.deepEqual(await (await api('/api/activity-statistics')).json(), afterLateQualification, 'later A proof never changes B material ownership or creates occurrence conflicts');
    const bundleB = await (await api(`/api/snapshots/${bId}/recovery`)).json();
    const homeC = join(s.directory, 'C'); const rootC = join(homeC, 'sessions'); await mkdir(rootC, { recursive: true });
    const pathC = join(rootC, `${childId}.jsonl`); await writeFile(pathC, Buffer.concat([Buffer.from(bundleB.artifact.data, 'base64'), encoded(row('丙的新增后缀'))]));
    await writeFile(join(homeC, 'restore-receipt.json'), JSON.stringify({ source: 'codex-cli', sourceSessionId: childId, rolloutPath: pathC,
      restoredFrom: { snapshotId: bId, hash: bundleB.manifest.hash, byteLength: bundleB.manifest.byteLength } }));
    const stateC = await setup('C', C, rootC); const cId = await qualify(stateC, childId, pathC, '/current/C');
    const third = await (await api(`/api/snapshots/${cId}`)).json();
    assert.deepEqual(third.events.slice(0, 3).map((e: any) => e.origin.eventId), detail.events.map((e: any) => e.origin.eventId));
    const stats = await (await api('/api/activity-statistics')).json();
    const totals = (owner: string, key: string) => stats.rows.filter((r: any) => r.employeeId === owner).reduce((n: number, r: any) => n + r[key], 0);
    assert.equal(totals(A.employeeId, 'records'), 3); assert.equal(totals(A.employeeId, 'activityRecords'), 2); assert.equal(totals(A.employeeId, 'unknownRecords'), 1);
    assert.equal(totals(B.employeeId, 'activityRecords'), 1); assert.equal(totals(C.employeeId, 'activityRecords'), 1);
    assert.equal(JSON.parse(await s.collectorCommand('run', stateB)).committed, 0);
    assert.deepEqual(await (await api('/api/activity-statistics')).json(), stats);
    const search = await (await api('/api/search?' + new URLSearchParams({ employee: '材料来源甲', project: '/source/A', content: '材料中的历史活动', history: 'all' }))).json();
    assert.ok(search.hits.some((hit: any) => hit.id === cId && hit.origin.materialId === material.id && hit.origin.webPath === detail.events[0].origin.webPath));
    const readable = await (await api(`/api/snapshots/${cId}/readable`)).text(); assert.ok(readable.includes(material.id) && readable.includes(detail.events[0].origin.webPath));
    assert.deepEqual(Buffer.from(await (await api(`/api/snapshots/${parentSnapshot}/materials/${material.id}`)).arrayBuffer()), materialBytes);
    const settings = JSON.parse(await readFile(join(stateB, 'settings.json'), 'utf8'));
    for (const claim of [{ ...detail.manifest.restoredFrom, hash: 'a'.repeat(64) }, { ...detail.manifest.restoredFrom, byteLength: materialBytes.length - 1 },
      { ...detail.manifest.restoredFrom, materialId: hash('unknown') }, { ...detail.manifest.restoredFrom, snapshotId: randomUUID() }]) {
      assert.equal((await api('/api/snapshots', settings.deviceCredential, json({ ...detail.manifest, restoredFrom: claim }))).status, 409);
    }
    assert.equal((await api('/api/snapshots', settings.deviceCredential, json({ ...detail.manifest, restoredFrom: { ...detail.manifest.restoredFrom, employeeId: C.employeeId } }))).status, 400);
    // Actual OAuth + SDK tools return the same original material location and ledger.
    const registration = await (await s.api('/oauth/register', undefined, json({ client_name: 'material primary fixture', redirect_uris: ['http://127.0.0.1:47123/callback'], token_endpoint_auth_method: 'none' }))).json();
    const verifier = randomBytes(48).toString('base64url'); const resource = s.origin + '/mcp';
    const parameters = { response_type: 'code', client_id: registration.client_id, redirect_uri: registration.redirect_uris[0], scope: 'archive:read', resource, state: randomUUID(),
      code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url') };
    const callback = new URL(await s.authorizationPage(s.origin + '/oauth/authorize?' + new URLSearchParams(parameters), B.readerCredential));
    const token = await (await s.api('/oauth/token', undefined, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({
      grant_type: 'authorization_code', client_id: registration.client_id, code: callback.searchParams.get('code')!, redirect_uri: parameters.redirect_uri, code_verifier: verifier, resource }).toString() })).json();
    client = new Client({ name: 'material-primary', version: '1' }); await client.connect(new StreamableHTTPClientTransport(new URL(resource), { fetch: s.fetchTls,
      requestInit: { headers: { Authorization: `Bearer ${token.access_token}` } } }));
    const result = await client.callTool({ name: 'read_snapshot', arguments: { snapshotId: cId } });
    assert.ok(JSON.stringify(result).includes(material.id) && JSON.stringify(result).includes(detail.events[0].origin.eventId));
    const mcpLocation = await client.callTool({ name: 'read_location', arguments: { snapshotId: parentSnapshot, location: originalLocation } });
    assert.ok(JSON.stringify(mcpLocation).includes('材料中的历史活动'));
    browser = await chromium.launch(); const page = await browser.newPage({ ignoreHTTPSErrors: true });
    await page.goto(s.origin + `/#${cId}`); await page.getByLabel('个人读取凭据').fill(B.readerCredential); await page.getByRole('button', { name: '进入存档' }).click();
    await page.getByRole('link', { name: '时间线', exact: true }).click();
    const link = page.getByRole('link', { name: '原始材料第 2 行' }); await expect(link).toHaveAttribute('href', detail.events[0].origin.webPath);
    await link.click(); await expect(page.getByRole('region', { name: '命中证据' })).toContainText('材料中的历史活动');
    await page.screenshot({ path: join(s.directory, 'material-primary.png'), fullPage: true });
    await writeFile(join(s.directory, 'material-primary-evidence.json'), JSON.stringify({ parentSnapshot, bId, cId, material, origins: third.events.map((e: any) => e.origin), stats, usedRestoreCli,
      boundary: 'Public collector host-event fixtures, recovery package, HTTP/Web/OAuth MCP; native model or Desktop UI continuation not claimed.' }, null, 2));
    console.log(`Material primary public-flow evidence: ${s.directory}`);
  } finally { await browser?.close(); await client?.close(); await s.close(); }
});

test('qualified primary origins are reused from parent/child/fork materials; foreign identity, changed prefix and context-only child claims cannot steal ownership', { timeout: 180_000 }, async () => {
  const s = await mcpSandbox();
  try {
    const A = await s.provision('材料与主会话甲'); const B = await s.provision('材料与主会话乙');
    const api = (path: string, token = A.readerCredential, init: RequestInit = {}) => s.api(path, token, init);
    const enroll = async (employee: typeof A) => (await api('/api/devices/enroll', employee.enrollmentCredential, json({ installationId: randomUUID(), name: 'same OS user' }))).json();
    const a = await enroll(A); const b = await enroll(B);
    const sessionId = randomUUID(); const parentId = randomUUID();
    const timestamp = new Date(Date.now() + 60_000).toISOString();
    const header = { type: 'session_meta', payload: { id: sessionId, cli_version: '0.157.1' } };
    const message = { type: 'response_item', timestamp, payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '原先独立采集的甲活动' }] } };
    const original = encoded(header, message);
    async function put(device: any, bytes: Buffer) {
      assert.equal((await api(`/api/chunks/${hash(bytes)}`, device.deviceCredential, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(bytes) })).status, 201);
    }
    async function commit(device: any, bytes: Buffer, id: string, extra = {}) {
      await put(device, bytes);
      const manifest = { protocolVersion: 1, source: 'codex-cli', sourceSessionId: id, sourceVersion: '0.157.1', sourceOs: process.platform,
        project: device.deviceId === a.deviceId ? '/qualified/A' : '/qualified/B', hash: hash(bytes), byteLength: bytes.length,
        qualifiedAt: new Date().toISOString(), capability: 'unverified', ...extra };
      const response = await api('/api/snapshots', device.deviceCredential, json(manifest));
      return { response, manifest };
    }
    const primary = await commit(a, original, sessionId); assert.equal(primary.response.status, 200);
    const primaryId = (await primary.response.json()).snapshotId;
    const prior = await (await api(`/api/snapshots/${primaryId}`)).json();
    await put(a, original);
    let materialSourceId = ''; let sourceMaterial: any;
    for (const role of ['parent-transcript', 'child-transcript', 'previous-transcript']) {
      const material = { id: hash(role), role, name: `${sessionId}.jsonl`, placement: 'codex-rollout', sourceSessionId: sessionId,
        hash: hash(original), byteLength: original.length, mediaType: 'jsonl' };
      const capture = { generation: hash(role + 'generation'), revision: 1, change: 'initial', materials: [material], gaps: [], lineage: [], compacted: false, partialLine: false };
      const stored = await commit(a, encoded({ type: 'session_meta', payload: { id: parentId, cli_version: '0.157.1' } }), parentId, { capture });
      assert.equal(stored.response.status, 200); const sourceId = (await stored.response.json()).snapshotId;
      materialSourceId = sourceId; sourceMaterial = material;
      const claim = { snapshotId: sourceId, materialId: material.id, hash: material.hash, byteLength: original.length };
      const restored = await commit(b, original, sessionId, { restoredFrom: claim }); assert.equal(restored.response.status, 200, await restored.response.clone().text());
      const restoredId = (await restored.response.json()).snapshotId;
      const detail = await (await api(`/api/snapshots/${restoredId}`)).json();
      assert.equal(detail.events[0].origin.eventId, prior.events[0].origin.eventId);
      assert.equal(detail.events[0].origin.snapshotId, primaryId); assert.equal(detail.events[0].context, 'after-enrollment', 'proven primary activity is never downgraded to context history');
      const changed = encoded(header, { ...message, payload: { ...message.payload, content: [{ type: 'input_text', text: 'changed native bytes' }] } });
      assert.equal((await commit(b, changed, sessionId, { restoredFrom: claim })).response.status, 409);
      assert.equal((await commit(b, original.subarray(0, original.length - 1), sessionId, { restoredFrom: claim })).response.status, 409);
      assert.equal((await commit(b, original, randomUUID(), { restoredFrom: claim })).response.status, 409);
    }
    const stats = await (await api('/api/activity-statistics')).json();
    assert.equal(stats.rows.reduce((n: number, row: any) => n + row.records, 0), 1, 'qualification through multiple roles and snapshots never duplicates the known primary');
    const portableMaterial = { ...sourceMaterial, placement: 'portable' };
    const portableSource = await commit(a, encoded({ type: 'session_meta', payload: { id: parentId, cli_version: '0.157.1' } }), parentId,
      { capture: { generation: hash('portable-generation'), revision: 1, change: 'initial', materials: [portableMaterial], gaps: [], lineage: [], compacted: false, partialLine: false } });
    assert.equal(portableSource.response.status, 200);
    const portableId = (await portableSource.response.json()).snapshotId;
    assert.equal((await commit(b, original, sessionId, { restoredFrom: { snapshotId: portableId, materialId: portableMaterial.id,
      hash: portableMaterial.hash, byteLength: portableMaterial.byteLength } })).response.status, 409, 'unknown native material placement cannot claim independent restore lineage');
    // The related transcript grows on B while only its parent is captured. The
    // saved context is not activity; later C qualification keeps both owners.
    const betaContext = encoded({ ...message, payload: { ...message.payload, content: [{ type: 'input_text', text: '乙保存的关联新上下文' }] } });
    const grown = Buffer.concat([original, betaContext]); await put(b, grown);
    const parentBytes = encoded({ type: 'session_meta', payload: { id: parentId, cli_version: '0.157.1' } });
    const updatedMaterial = { ...sourceMaterial, hash: hash(grown), byteLength: grown.length };
    const updatedCapture = { generation: hash('updated-material-generation'), revision: 1, change: 'initial', materials: [updatedMaterial], gaps: [], lineage: [], compacted: false, partialLine: false };
    const parentB = await commit(b, parentBytes, parentId, { capture: updatedCapture,
      restoredFrom: { snapshotId: materialSourceId, hash: hash(parentBytes), byteLength: parentBytes.length } });
    assert.equal(parentB.response.status, 200); const parentBId = (await parentB.response.json()).snapshotId;
    assert.equal((await (await api('/api/activity-statistics')).json()).rows.reduce((n: number, row: any) => n + row.records, 0), 1);
    const C = await s.provision('材料与主会话丙'); const c = await enroll(C);
    const suffix = encoded({ ...message, payload: { ...message.payload, content: [{ type: 'input_text', text: '丙的独立新后缀' }] } });
    const third = await commit(c, Buffer.concat([grown, suffix]), sessionId,
      { restoredFrom: { snapshotId: parentBId, materialId: sourceMaterial.id, hash: hash(grown), byteLength: grown.length } });
    assert.equal(third.response.status, 200); const thirdId = (await third.response.json()).snapshotId;
    const thirdDetail = await (await api(`/api/snapshots/${thirdId}`)).json();
    assert.deepEqual(thirdDetail.events.map((event: any) => [event.origin.employeeId, event.context]),
      [[A.employeeId, 'after-enrollment'], [B.employeeId, 'historical'], [C.employeeId, 'after-enrollment']]);
    assert.equal(thirdDetail.events[0].origin.eventId, prior.events[0].origin.eventId);
    assert.equal(thirdDetail.events[1].origin.snapshotId, parentBId); assert.equal(thirdDetail.events[1].origin.materialId, sourceMaterial.id);
    const rewritten = encoded(header, { ...message, payload: { ...message.payload, content: [{ type: 'input_text', text: '同原生会话材料被改写' }] } });
    await put(b, rewritten);
    const rewrittenMaterial = { ...sourceMaterial, hash: hash(rewritten), byteLength: rewritten.length };
    const changedParent = await commit(b, parentBytes, parentId, { capture: { ...updatedCapture, materials: [rewrittenMaterial], revision: 2 },
      restoredFrom: { snapshotId: materialSourceId, hash: hash(parentBytes), byteLength: parentBytes.length } });
    assert.equal(changedParent.response.status, 200); const changedParentId = (await changedParent.response.json()).snapshotId;
    const D = await s.provision('改写材料独立续用丁'); const d = await enroll(D);
    const changedClaim = await commit(d, rewritten, sessionId, { restoredFrom: { snapshotId: changedParentId, materialId: sourceMaterial.id, hash: hash(rewritten), byteLength: rewritten.length } });
    assert.equal(changedClaim.response.status, 200); const changedId = (await changedClaim.response.json()).snapshotId;
    const changedDetail = await (await api(`/api/snapshots/${changedId}`)).json();
    assert.match(changedDetail.provenance.warning, /重写或截断/); assert.equal(changedDetail.events[0].origin.employeeId, B.employeeId);
    assert.notEqual(changedDetail.events[0].origin.eventId, prior.events[0].origin.eventId);
    assert.ok((await (await api('/api/activity-statistics')).json()).warnings.uncertainRewriteSnapshots > 0);
    // Actual Claude subagent bytes use parent sessionId plus a distinct agentId.
    // A short child ID is not an independently resumable primary identity.
    const claude = encoded({ type: 'user', sessionId: parentId, agentId: 'child-agent', uuid: randomUUID(), version: '2.1.281', timestamp,
      message: { role: 'user', content: 'subagent context, not an independent primary' } });
    await put(a, claude); await put(b, claude);
    const material = { id: hash('actual-shaped-Claude-child'), role: 'subagent', name: 'subagents/agent-child-agent.jsonl', placement: 'claude-session',
      sourceSessionId: 'child-agent', hash: hash(claude), byteLength: claude.length, mediaType: 'jsonl' };
    const capture = { generation: hash('claude-generation'), revision: 1, change: 'initial', materials: [material], gaps: [], lineage: [], compacted: false, partialLine: false };
    const sourceManifest = { protocolVersion: 1, source: 'claude-code-cli', sourceSessionId: parentId, sourceVersion: '2.1.281', sourceOs: process.platform,
      project: '/qualified/A', hash: hash(claude), byteLength: claude.length, qualifiedAt: new Date().toISOString(), capability: 'unverified', capture };
    const sourceResponse = await api('/api/snapshots', a.deviceCredential, json(sourceManifest)); assert.equal(sourceResponse.status, 200);
    const sourceId = (await sourceResponse.json()).snapshotId;
    const claimed = await api('/api/snapshots', b.deviceCredential, json({ ...sourceManifest, sourceSessionId: 'child-agent', capture: undefined,
      restoredFrom: { snapshotId: sourceId, materialId: material.id, hash: material.hash, byteLength: material.byteLength } }));
    assert.equal(claimed.status, 409); assert.match(await claimed.text(), /原生身份/);
    assert.deepEqual(Buffer.from(await (await api(`/api/snapshots/${primaryId}/raw`)).arrayBuffer()), original);
    console.log(`Material proven-primary/rejection fixture evidence: ${s.directory}`);
  } finally { await s.close(); }
});
