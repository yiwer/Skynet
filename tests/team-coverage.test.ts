import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { mcpSandbox } from './mcp-support.js';
import { beijingDate } from '../packages/contracts/reports.js';

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const json = (value: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
const bytes = (...rows: unknown[]) => Buffer.from(rows.map(row => JSON.stringify(row)).join('\n') + '\n');

test('public coverage matrix, frozen source-day statistics and original evidence agree across HTTP/Web/OAuth MCP', { timeout: 180000 }, async () => {
  const s = await mcpSandbox(); let client: Client | undefined; let browser;
  console.log(`Coverage fixture directory: ${s.directory}`);
  try {
    const A = await s.provision('覆盖甲：有活动与缺口'); const B = await s.provision('覆盖乙：宿主确认待核对'); const C = await s.provision('覆盖丙：旧客户端未知');
    const api = (path: string, token = A.readerCredential, init: RequestInit = {}) => s.api(path, token, init);
    const enroll = async (employee: typeof A) => (await api('/api/devices/enroll', employee.enrollmentCredential, json({ installationId: randomUUID(), name: employee.employeeId }))).json();
    const a = await enroll(A); const b = await enroll(B); const c = await enroll(C);
    const now = Date.now() + 60000; const timestamp = new Date(now).toISOString(); const day = beijingDate(new Date(now));
    const priorDay = beijingDate(new Date(now - 86400000)); const sessionId = randomUUID();
    const tokenRow = (time: string, total: number) => ({ timestamp: time, type: 'event_msg', payload: { type: 'token_count', info: {
      total_token_usage: { input_tokens: total * 2 / 3, cached_input_tokens: total / 3, output_tokens: total / 3, reasoning_output_tokens: 0, total_tokens: total } } } });
    const user = (text: string, time = timestamp) => ({ timestamp: time, type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } });
    const original = bytes({ timestamp, type: 'session_meta', payload: { id: sessionId, cwd: '/synthetic', source: 'cli', cli_version: '0.157.1' } },
      tokenRow(new Date(Date.now() - 60000).toISOString(), 60), user('结构化路径与来源 Token 合成记录'),
      { timestamp, type: 'response_item', payload: { type: 'custom_tool_call', name: 'apply_patch', call_id: 'fixture-patch-1', input: '*** Begin Patch\n*** Add File: synthetic/code.ts\n+export const fixture = true;\n*** End Patch' } },
      tokenRow(timestamp, 90));
    async function upload(device: typeof a, content: Buffer, restoredFrom?: unknown, extra: object = {}) {
      assert.equal((await api(`/api/chunks/${hash(content)}`, device.deviceCredential, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(content) })).status, 201);
      const manifest = { protocolVersion: 1, sourceSessionId: sessionId, source: 'codex-cli', sourceVersion: '0.157.1', sourceOs: process.platform,
        project: '/synthetic/coverage', hash: hash(content), byteLength: content.length, qualifiedAt: timestamp, capability: 'unverified', ...(restoredFrom ? { restoredFrom } : {}), ...extra };
      const response = await api('/api/snapshots', device.deviceCredential, json(manifest)); assert.equal(response.status, 200, await response.clone().text());
      return (await response.json()).snapshotId;
    }
    const snapshotId = await upload(a, original);
    const health = (device: typeof a, value: unknown) => api('/api/devices/health', device.deviceCredential, json({ nonce: randomUUID(), ...value as object }));
    assert.equal((await health(a, { source: 'codex-cli', installation: { clients: [{ source: 'codex-cli', configured: true, hostEvent: 'observed' }] },
      capture: { checkedAt: new Date().toISOString(), observation: 'host-event-observed', locallyPersisted: true,
        faults: [{ id: randomUUID(), code: 'source-missing', scope: 'source', firstObservedAt: new Date().toISOString(), lastObservedAt: new Date().toISOString(), recoveredAt: null, coverage: 'unverified-range' }] } })).status, 200);
    assert.equal((await health(b, { installation: { clients: [{ source: 'codex-cli', configured: true, hostEvent: 'not-observed' }] } })).status, 200);
    assert.equal((await health(c, {})).status, 200);
    // Isolated clock fixture: simulate a formerly observed device being currently
    // disconnected without waiting 90s. This does not create historical coverage.
    await s.testDatabase.query(`UPDATE device_health SET received_at=now()-interval '2 minutes' WHERE device_id=$1`, [c.deviceId]);
    assert.equal((await s.api(`/api/team-coverage?date=${day}`)).status, 401);
    assert.equal((await api(`/api/team-coverage?date=${day}`, a.deviceCredential)).status, 401);
    assert.equal((await api('/api/team-coverage?date=2026-02-30')).status, 400);
    const matrix = await (await api(`/api/team-coverage?date=${day}`)).json();
    const cell = (employeeId: string, date = day) => matrix.rows.find((row: any) => row.employeeId === employeeId).cells.find((row: any) => row.date === date);
    assert.equal(cell(A.employeeId).records, 2); assert.equal(cell(A.employeeId).collection, 'gap-observed');
    assert.equal(cell(B.employeeId).hostConfirmation, 'pending-confirmation'); assert.equal(cell(B.employeeId).activity, 'none-observed');
    assert.equal(cell(C.employeeId).configured, 'unknown'); assert.equal(cell(C.employeeId).hostConfirmation, 'unknown'); assert.equal(cell(C.employeeId).currentConnection, 'not-connected');
    for (const employee of [A, B, C]) assert.equal(cell(employee.employeeId, priorDay).collection, 'unknown');
    assert.equal((await health(a, { source: 'codex-cli', capture: { checkedAt: '2000-01-01T00:00:00.000Z', observation: 'host-event-observed', locallyPersisted: true, faults: [] } })).status, 200);
    const recoveredMatrix = await (await api(`/api/team-coverage?date=${day}`)).json();
    assert.equal(recoveredMatrix.rows.find((row: any) => row.employeeId === A.employeeId).cells.at(-1).collection, 'gap-observed', 'later recovery retains the received-hour adverse observation');
    const statsPath = `/api/work-statistics/${A.employeeId}?date=${day}`;
    const statistics = await (await api(statsPath)).json();
    assert.deepEqual([statistics.records, statistics.sessions, statistics.userTurns, statistics.toolCalls], [2, 1, 1, 1]);
    assert.equal(statistics.files.observedCount, 1); assert.equal(statistics.files.complete, true);
    assert.equal(statistics.tokens.total, 30); assert.equal(statistics.tokens.input, 20); assert.equal(statistics.tokens.cachedInput, 10);
    assert.equal(statistics.tokens.cacheWriteInput, null); assert.equal(statistics.humanWorkHours, null);
    const reference = statistics.references.find((item: any) => item.kind === 'file'); assert.ok(reference.webPath.includes(snapshotId));
    const bRaw = Buffer.concat([original, bytes(user('乙的新增 suffix', new Date(now + 60000).toISOString()), tokenRow(new Date(now + 60000).toISOString(), 120))]);
    const restored = await upload(b, bRaw, { snapshotId, hash: hash(original), byteLength: original.length });
    const bStatistics = await (await api(`/api/work-statistics/${B.employeeId}?date=${day}`)).json();
    assert.equal(bStatistics.records, 1); assert.equal(bStatistics.tokens.total, 30); assert.equal(bStatistics.files.observedCount, 0);
    assert.deepEqual(await (await api(statsPath + `&revision=${statistics.revision}`)).json(), statistics);
    assert.deepEqual(Buffer.from(await (await api(`/api/snapshots/${snapshotId}/raw`)).arrayBuffer()), original);

    // The sourceSnapshotId below points to a parent whose main raw is different.
    // Auxiliary usage must resolve the ORIGINAL MATERIAL, and qualify it only
    // when A's ordinary primary proves the exact same bytes on A's own device.
    const childId = randomUUID(); const parentId = randomUUID(); const childTime = new Date(now + 120000).toISOString();
    const child = bytes({ timestamp: childTime, type: 'session_meta', payload: { id: childId, cwd: '/synthetic', source: 'cli', cli_version: '0.157.1' } },
      tokenRow(new Date(Date.now() - 60000).toISOString(), 60), user('材料自己的活动', childTime),
      { timestamp: childTime, type: 'response_item', payload: { type: 'custom_tool_call', name: 'apply_patch', call_id: 'child-patch', input: '*** Begin Patch\n*** Add File: synthetic/child.ts\n+export const child = true;\n*** End Patch' } }, tokenRow(childTime, 90));
    const material = { id: hash('coverage-child-material'), hash: hash(child), byteLength: child.length, mediaType: 'jsonl', role: 'child-transcript',
      name: 'sessions/child.jsonl', placement: 'codex-rollout', sourceSessionId: childId };
    assert.equal((await api(`/api/chunks/${material.hash}`, a.deviceCredential, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(child) })).status, 201);
    const parent = bytes({ timestamp, type: 'session_meta', payload: { id: parentId, cwd: '/synthetic', source: 'cli', cli_version: '0.157.1' } }, user('父件没有 child Token 记录'));
    const parentSnapshot = await upload(a, parent, undefined, { sourceSessionId: parentId, capture: { generation: hash(parentId), revision: 1,
      change: 'initial', materials: [material], lineage: [], compacted: false, partialLine: false, gaps: [] } });
    await upload(b, child, { snapshotId: parentSnapshot, materialId: material.id, hash: material.hash, byteLength: material.byteLength }, { sourceSessionId: childId });
    const beforeMaterialProof = await (await api(statsPath)).json(); assert.equal(beforeMaterialProof.tokens.total, 30);
    const proofSnapshot = await upload(a, child, undefined, { sourceSessionId: childId });
    const materialStatistics = await (await api(statsPath)).json();
    assert.equal(materialStatistics.records, 5); assert.equal(materialStatistics.tokens.total, 60); assert.equal(materialStatistics.files.observedCount, 2);
    const materialUsage = materialStatistics.references.find((item: any) => item.kind === 'usage' && item.materialId === material.id);
    assert.ok(materialUsage && materialUsage.snapshotId === parentSnapshot && materialUsage.webPath.includes('kind=material'));
    assert.equal((await (await api(`/api/work-statistics/${B.employeeId}?date=${day}`)).json()).tokens.total, 30);
    assert.deepEqual(await (await api(statsPath + `&revision=${statistics.revision}`)).json(), statistics);

    const registration = await (await s.api('/oauth/register', undefined, json({ client_name: 'coverage tracer', redirect_uris: ['http://127.0.0.1:47123/callback'], token_endpoint_auth_method: 'none' }))).json();
    const verifier = randomBytes(48).toString('base64url'); const resource = s.origin + '/mcp';
    const parameters = { response_type: 'code', client_id: registration.client_id, redirect_uri: registration.redirect_uris[0], scope: 'archive:read', resource, state: randomUUID(), code_challenge_method: 'S256', code_challenge: hash(verifier) };
    parameters.code_challenge = createHash('sha256').update(verifier).digest('base64url');
    const callback = new URL(await s.authorizationPage(s.origin + '/oauth/authorize?' + new URLSearchParams(parameters), A.readerCredential));
    const token = await (await s.api('/oauth/token', undefined, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({
      grant_type: 'authorization_code', client_id: registration.client_id, code: callback.searchParams.get('code')!, redirect_uri: parameters.redirect_uri, code_verifier: verifier, resource }).toString() })).json();
    client = new Client({ name: 'coverage-public-tracer', version: '1' }); await client.connect(new StreamableHTTPClientTransport(new URL(resource), { fetch: s.fetchTls,
      requestInit: { headers: { Authorization: `Bearer ${token.access_token}` } } }));
    const result = await client.callTool({ name: 'read_work_statistics', arguments: { employeeId: A.employeeId, date: day, revision: statistics.revision } });
    assert.deepEqual(JSON.parse((result.content as { text: string }[])[0]!.text), statistics);
    const mcpMatrix = await client.callTool({ name: 'read_team_coverage', arguments: { date: day } });
    const httpMatrix = await (await api(`/api/team-coverage?date=${day}`)).json();
    assert.deepEqual(JSON.parse((mcpMatrix.content as { text: string }[])[0]!.text).rows, httpMatrix.rows);
    browser = await chromium.launch({ headless: true }); const page = await browser.newPage({ ignoreHTTPSErrors: true });
    await page.goto(s.origin); await page.getByLabel('个人读取凭据').fill(A.readerCredential); await page.getByRole('button', { name: '进入存档' }).click();
    await page.getByRole('button', { name: '团队覆盖', exact: true }).click();
    await expect(page.getByRole('region', { name: '团队覆盖矩阵' })).toContainText('采集缺口已观察');
    await expect(page.getByRole('complementary', { name: '选中员工与日期' })).toContainText('来源 Token 总量');
    await page.getByText('原件统计引用', { exact: true }).click(); await page.getByRole('link', { name: 'synthetic/code.ts', exact: true }).click();
    await expect(page.getByRole('region', { name: '命中证据' })).toContainText('*** Add File: synthetic/code.ts');
    await page.getByRole('button', { name: '团队覆盖', exact: true }).click();
    const layouts = [];
    const evidence = join('F:/GenCode/Skynet-evidence/v1-2026-09-30', `coverage-${snapshotId}`); await mkdir(evidence, { recursive: true });
    for (const width of [320, 375, 760, 1280, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.getByRole('region', { name: '团队覆盖矩阵' })).toBeVisible();
      const dimensions = await page.evaluate(() => ({ width: innerWidth, contentWidth: document.documentElement.scrollWidth }));
      assert.ok(dimensions.contentWidth <= width, JSON.stringify(dimensions)); layouts.push(dimensions);
      await page.screenshot({ path: join(evidence, `coverage-${width}.png`), fullPage: true });
    }
    const corruptId = randomUUID(); const corruptPrefix = bytes({ timestamp, type: 'session_meta', payload: { id: corruptId, cwd: '/synthetic', source: 'cli', cli_version: '0.157.1' } });
    const corrupt = Buffer.concat([corruptPrefix, Buffer.from(`{"timestamp":"${timestamp}","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"`),
      Buffer.from([0xff]), Buffer.from('"}]}}\n'), bytes(tokenRow(timestamp, 120))]);
    const corruptSnapshot = await upload(a, corrupt, undefined, { sourceSessionId: corruptId });
    const corruptStatistics = await (await api(statsPath)).json();
    assert.equal(corruptStatistics.tokens.total, null); assert.equal(corruptStatistics.files.complete, false); assert.equal(corruptStatistics.sourceInputsComplete, false);
    assert.deepEqual(Buffer.from(await (await api(`/api/snapshots/${corruptSnapshot}/raw`)).arrayBuffer()), corrupt);
    assert.equal((await api('/api/sessions')).status, 200); assert.equal((await api('/health')).status, 200);
    await s.restart();
    assert.deepEqual(await (await api(statsPath + `&revision=${statistics.revision}`)).json(), statistics);
    assert.equal((await (await api(`/api/team-coverage?date=${day}`)).json()).rows.find((row: any) => row.employeeId === A.employeeId).cells.at(-1).collection, 'gap-observed');
    await writeFile(join(evidence, 'public-flow.json'), JSON.stringify({ snapshotId, restored, matrix: httpMatrix, statistics, bStatistics, parentSnapshot, proofSnapshot, materialStatistics, corruptSnapshot, corruptStatistics, layouts,
      boundary: 'Public authenticated synthetic upload and native-record-schema rows, immutable export, Web/OAuth MCP and restart; no real provider/model/paid call or Task setup.' }, null, 2));
    console.log(`Coverage public-flow evidence: ${evidence}`);
  } finally { await browser?.close(); await client?.close(); await s.close(); }
});
