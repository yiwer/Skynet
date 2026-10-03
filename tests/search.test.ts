import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { mcpSandbox } from './mcp-support.js';
import type { SearchInput, SearchHit, EvidenceLocation } from '../packages/contracts/search.js';
import { connect } from '../apps/server/database.js';

const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const hash = (input: Buffer | string) => createHash('sha256').update(input).digest('hex');
const params = (input: object) => new URLSearchParams(Object.entries(input).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]));
test('public search spans all pages, history, original evidence, Web and authenticated MCP', { timeout: 180_000 }, async () => {
  const sandbox = await mcpSandbox(); const browser = await chromium.launch(); let client: Client | undefined;
  const faultDb = connect(sandbox.env.DATABASE_URL!);
  const proof: Record<string, unknown> = {};
  try {
    const employee = await sandbox.provision('检索合成员工甲'); const employee2 = await sandbox.provision('检索合成员工乙');
    const reader = await sandbox.provision('检索合成读者'); const manager = await sandbox.provision('检索合成维护者', true);
    const enroll = async (key: string) => (await sandbox.api('/api/devices/enroll', key, json({ installationId: randomUUID(), name: 'search fixture' }))).json();
    const device = await enroll(employee.enrollmentCredential); const device2 = await enroll(employee2.enrollmentCredential);
    const put = async (bytes: Buffer, credential = device.deviceCredential) => {
      const response = await sandbox.api(`/api/chunks/${hash(bytes)}`, credential, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(bytes) });
      assert.ok([200, 201].includes(response.status));
    };
    async function commit(bytes: Buffer, options: Record<string, unknown> = {}, credential = device.deviceCredential) {
      await put(bytes, credential);
      const response = await sandbox.api('/api/snapshots', credential, json({ protocolVersion: 1, sourceSessionId: randomUUID(), source: 'codex-cli',
        sourceVersion: '0.157.1', sourceOs: 'win32', project: '/synthetic/search', hash: hash(bytes), byteLength: bytes.length,
        qualifiedAt: new Date().toISOString(), capability: 'unverified', ...options }));
      const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result)); return result.snapshotId as string;
    }
    const raw = (text: string, timestamp = '2026-09-27T16:00:01.000Z') => Buffer.from(JSON.stringify({ type: 'response_item', timestamp,
      payload: { type: 'function_call_output', call_id: 'fixture', output: text } }) + '\n');
    const old = await commit(raw('SKYNET_HISTORY_ONLY'), { sourceSessionId: 'history-one', capture: { generation: hash('before'), revision: 1,
      change: 'initial', materials: [], lineage: [], gaps: [], compacted: false, partialLine: false } });
    const changed = await commit(raw('rewritten without old term'), { sourceSessionId: 'history-one', capture: { generation: hash('after'), revision: 1,
      change: 'rewrite', previousSnapshotId: old, materials: [], lineage: [], gaps: [], compacted: false, partialLine: false } });
    const matchIds: string[] = [];
    // More than 100 distinct sessions; same text must never merge independent source identities.
    const sameBytes = raw('SAME_SEARCH_WORD');
    for (let index = 0; index < 105; index++) matchIds.push(await commit(sameBytes));
    // An initial empty result page must still expose the cursor that reaches earlier matches.
    for (let index = 0; index < 9; index++) await commit(raw('not a matching phrase'));
    const largeText = '前文😀'.repeat(1800) + 'SKYNET_LONG_MATCH ' + '后文🚀'.repeat(2200) + 'TAIL_SEARCH_COMPLETE';
    const largeBytes = raw(largeText); const largeId = await commit(largeBytes, { project: '/synthetic/large' });
    const unknownId = await commit(Buffer.from('{"type":"future","value":"SKYNET_UNKNOWN_RECORD"}\n{"partial":"SKYNET_PARTIAL_RECORD'), { project: '' });
    const materialBytes = Buffer.from('附件前文 '.repeat(1000) + 'SKYNET_MATERIAL_MATCH' + '附件后文 '.repeat(1000));
    await put(materialBytes);
    const material = { id: hash('text-result'), hash: hash(materialBytes), byteLength: materialBytes.length, mediaType: 'text', role: 'tool-result', name: 'tool-results/synthetic.txt', placement: 'portable' };
    const materialId = await commit(raw('main with sidecar'), { capture: { generation: hash('material'), revision: 1, change: 'initial', materials: [material], lineage: [], gaps: [], compacted: false, partialLine: false } });
    const claudeBytes = Buffer.from(JSON.stringify({ type: 'assistant', timestamp: '2026-09-28T01:00:00.000Z', message: { role: 'assistant',
      content: [{ type: 'text', text: 'first block' }, { type: 'text', text: '中文😀 BLOCK_SEARCH_MATCH 结尾' }] } }) + '\n');
    const claudeId = await commit(claudeBytes, { source: 'claude-code-cli', sourceVersion: '2.1.281', project: '' }, device2.deviceCredential);
    await commit(raw('SAME_SEARCH_WORD', '2026-09-27T15:59:59.000Z'), { project: '/synthetic/before-midnight' }, device2.deviceCredential);
    await sandbox.restart();
    assert.equal((await sandbox.api('/api/search?content=SAME_SEARCH_WORD')).status, 401);
    assert.equal((await sandbox.api('/api/search', device.deviceCredential)).status, 401);
    assert.equal((await sandbox.api('/api/search?from=2026-10-01&to=2026-09-01', reader.readerCredential)).status, 400);
    async function search(input: SearchInput) {
      const response = await sandbox.api(`/api/search?${params(input)}`, reader.readerCredential);
      assert.equal(response.status, 200, await response.clone().text()); return response.json();
    }
    const query = { content: 'same_search_word', employee: '员工甲', project: '/synthetic/search', source: 'codex-cli' as const, from: '2026-09-28', to: '2026-09-28', limit: 3 };
    // Fault injection only: hold a transaction after its original bytes passed public upload.
    // Its server timestamp predates the search, while visibility starts after the first page.
    const delayed = await faultDb.connect(); let first;
    try {
      const sample = await (await sandbox.api(`/api/snapshots/${matchIds[0]}?summary=true`, reader.readerCredential)).json();
      const manifest = { ...sample.manifest, sourceSessionId: randomUUID() };
      await delayed.query('BEGIN');
      await delayed.query('INSERT INTO snapshots(id,device_id,source_session_id,manifest_hash,manifest,hash) VALUES($1,$2,$3,$4,$5,$6)',
        [randomUUID(), device.deviceId, manifest.sourceSessionId, hash(JSON.stringify(manifest)), manifest, manifest.hash]);
      first = await search(query); assert.equal(first.hits.length, 0); assert.ok(first.nextCursor); assert.equal(first.complete, false);
      await delayed.query('COMMIT');
    } finally { await delayed.query('ROLLBACK'); delayed.release(); }
    await sandbox.restart(); // Continuation membership is persisted, not lost with server memory.
    const all: SearchHit[] = []; let next = first; let calls = 1;
    // A post-ceiling upload cannot shift this ongoing scan, including a new version of a source.
    await commit(sameBytes); await commit(raw('newest history'), { sourceSessionId: 'history-one' });
    while (next.nextCursor) { next = await search({ ...query, cursor: next.nextCursor }); all.push(...next.hits); calls++; }
    assert.equal(next.complete, true); assert.equal(all.length, 105); assert.deepEqual(new Set(all.map(hit => hit.id)), new Set(matchIds));
    assert.equal((await sandbox.api(`/api/search?${params({ ...query, content: 'changed', cursor: first.nextCursor })}`, reader.readerCredential)).status, 400);
    const scanId = JSON.parse(Buffer.from(first.nextCursor, 'base64url').toString()).scan;
    await faultDb.query("UPDATE archive_search_scans SET created_at=now()-interval '16 minutes' WHERE id=$1", [scanId]);
    assert.equal((await sandbox.api(`/api/search?${params({ ...query, cursor: first.nextCursor })}`, reader.readerCredential)).status, 410);
    async function collect(input: SearchInput) {
      const hits: SearchHit[] = []; let cursor: string | undefined;
      do { const page = await search({ ...input, cursor }); hits.push(...page.hits); cursor = page.nextCursor ?? undefined; } while (cursor);
      return hits;
    }
    assert.deepEqual(await collect({ content: 'SKYNET_HISTORY_ONLY' }), []);
    assert.deepEqual((await collect({ content: 'SKYNET_HISTORY_ONLY', history: 'all' })).map(hit => hit.id), [old]);
    const rawHit = (await collect({ content: 'SKYNET_UNKNOWN_RECORD', projectState: 'unclassified' }))[0]!;
    assert.equal(rawHit.id, unknownId); assert.equal(rawHit.location?.kind, 'raw'); assert.equal(rawHit.line, 1);
    const partialHit = (await collect({ content: 'SKYNET_PARTIAL_RECORD' }))[0]!; assert.equal(partialHit.line, 2);
    const attachedHit = (await collect({ content: 'SKYNET_MATERIAL_MATCH' }))[0]!;
    assert.equal(attachedHit.id, materialId); assert.equal(attachedHit.location?.kind, 'material');
    assert.equal((await collect({ content: 'SKYNET_MATERIAL_MATCH', from: '2026-09-28' })).length, 0);
    const blockHit = (await collect({ content: 'BLOCK_SEARCH_MATCH', employee: '员工乙', source: 'claude-code-cli', projectState: 'unclassified', from: '2026-09-28' }))[0]!;
    assert.equal(blockHit.id, claudeId); assert.equal(blockHit.line, 1); assert.equal(blockHit.block, 1); assert.equal(blockHit.location?.textOffset, '中文😀 '.length);
    const longHit = (await collect({ content: 'SKYNET_LONG_MATCH' }))[0]!; assert.equal(longHit.id, largeId); assert.equal(longHit.location?.kind, 'event');
    assert.equal(longHit.location?.textOffset, largeText.indexOf('SKYNET_LONG_MATCH'));
    assert.equal((await sandbox.api(`/api/snapshots/${largeId}/location?${params({ ...longHit.location, parserVersion: 'changed-parser' })}`, reader.readerCredential)).status, 409);
    const resolvedByLine = await (await sandbox.api(`/api/snapshots/${largeId}/location?${params({ ...longHit.location, offset: 999 })}`, reader.readerCredential)).json();
    assert.ok(resolvedByLine.events[0].text.startsWith('SKYNET_LONG_MATCH'), 'original line wins over a stale event index');

    const resource = `${sandbox.origin}/mcp`;
    const registration = await (await sandbox.api('/oauth/register', undefined, json({ client_name: 'Search evidence fixture', redirect_uris: ['http://127.0.0.1:47123/callback'], token_endpoint_auth_method: 'none' }))).json();
    const verifier = randomBytes(48).toString('base64url');
    const authorization = new URL(await sandbox.authorizationPage(`${sandbox.origin}/oauth/authorize?${params({ response_type: 'code', client_id: registration.client_id,
      redirect_uri: registration.redirect_uris[0], scope: 'archive:read', resource, state: randomUUID(), code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url') })}`, reader.readerCredential));
    const tokens = await (await sandbox.api('/oauth/token', undefined, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params({ grant_type: 'authorization_code', client_id: registration.client_id, code: authorization.searchParams.get('code'), redirect_uri: registration.redirect_uris[0], code_verifier: verifier, resource }).toString() })).json();
    assert.ok(tokens.access_token);
    client = new Client({ name: 'search-proof', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(resource), { fetch: sandbox.fetchTls, requestInit: { headers: { Authorization: `Bearer ${tokens.access_token}` } } }));
    async function tool(name: string, input: object) {
      const result = await client!.callTool({ name, arguments: { ...input } }); assert.notEqual(result.isError, true, JSON.stringify(result));
      return JSON.parse((result.content as { text: string }[])[0]!.text);
    }
    for (const content of ['SKYNET_LONG_MATCH', 'SKYNET_UNKNOWN_RECORD', 'SKYNET_MATERIAL_MATCH', 'BLOCK_SEARCH_MATCH']) {
      const web = await search({ content }); const mcp = await tool('search_sessions', { content });
      assert.deepEqual(mcp.hits, web.hits); assert.ok(Buffer.byteLength(JSON.stringify(mcp)) < 8192);
      const hit = web.hits[0]!;
      assert.deepEqual(await tool('read_location', { snapshotId: hit.id, location: hit.location }),
        await (await sandbox.api(`/api/snapshots/${hit.id}/location?${params(hit.location)}`, reader.readerCredential)).json());
    }
    let position: EvidenceLocation | null = longHit.location; let suffix = ''; let pages = 0;
    while (position) {
      const page = await tool('read_location', { snapshotId: largeId, location: position });
      suffix += page.events.map((event: { text: string }) => event.text).join(''); position = page.next; pages++;
    }
    assert.equal(suffix, largeText.slice(longHit.location!.textOffset)); assert.ok(pages > 4);
    const exported = await tool('prepare_export', { snapshotId: largeId, format: 'raw' });
    assert.equal(exported.sha256, hash(largeBytes));
    assert.deepEqual(Buffer.from(await (await sandbox.api(`/api/snapshots/${largeId}/raw`, reader.readerCredential)).arrayBuffer()), largeBytes);

    const origin = await sandbox.startServer(); const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(origin); await page.getByLabel('个人读取凭据').fill(reader.readerCredential); await page.getByRole('button', { name: '进入存档' }).click();
    await expect(page.getByRole('navigation', { name: '平台页面', exact: true }).getByRole('button', { name: '会话', exact: true })).toBeEnabled();
    await page.keyboard.press('Control+k');
    const searchRegion = page.getByRole('region', { name: '搜索会话', exact: true });
    await searchRegion.getByLabel('会话内容').fill('SKYNET_LONG_MATCH'); await searchRegion.getByRole('button', { name: '搜索存档', exact: true }).click();
    await searchRegion.getByRole('link').filter({ hasText: 'SKYNET_LONG_MATCH' }).click();
    const focused = page.getByRole('region', { name: '命中证据' });
    await expect(focused).toContainText('SKYNET_LONG_MATCH'); assert.equal(new URL(page.url()).hash, longHit.webPath);
    assert.equal(await focused.locator('pre').first().textContent(), suffix.slice(0, 2048 - (/[\uD800-\uDBFF]/.test(suffix[2047]!) ? 1 : 0)));
    await focused.getByRole('button', { name: '继续读取原文' }).click(); await expect(focused).not.toContainText('SKYNET_LONG_MATCH');
    await focused.getByRole('button', { name: '上一段原文' }).click(); await expect(focused).toContainText('SKYNET_LONG_MATCH');
    // Escape schedules a native dialog close event. Reopening immediately must
    // remain usable even if that previous close event is delivered afterward.
    const rapidSearchReopens = 10;
    await page.keyboard.press('Control+k'); await expect(searchRegion).toBeVisible();
    for (let attempt = 0; attempt < rapidSearchReopens; attempt++) {
      await page.keyboard.press('Escape'); await page.keyboard.press('Control+k');
      await expect(searchRegion).toBeVisible();
      await searchRegion.getByLabel('会话内容').fill(`未提交的搜索草稿 ${attempt}`);
      await expect(searchRegion.getByLabel('会话内容')).toHaveValue(`未提交的搜索草稿 ${attempt}`);
      assert.equal(new URL(page.url()).hash, longHit.webPath);
    }
    await page.keyboard.press('Escape');
    for (const width of [320, 375, 1440]) {
      await page.setViewportSize({ width, height: 1000 }); await page.keyboard.press('Control+k'); await searchRegion.scrollIntoViewIfNeeded();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `horizontal overflow at ${width}`);
      await page.screenshot({ path: join(sandbox.directory, `search-${width}.png`), fullPage: true });
      await page.keyboard.press('Escape');
    }
    await page.reload(); await page.getByLabel('个人读取凭据').fill(reader.readerCredential); await page.getByRole('button', { name: '进入存档' }).click();
    await expect(page.getByRole('region', { name: '命中证据' })).toContainText('SKYNET_LONG_MATCH');
    await sandbox.api(`/api/identities/employees/${reader.employeeId}/disable`, manager.readerCredential, json({}));
    assert.equal((await sandbox.api('/api/search?content=SAME_SEARCH_WORD', reader.readerCredential)).status, 401);
    assert.equal((await sandbox.api('/mcp', tokens.access_token, json({}))).status, 401);
    proof.matches = all.length; proof.searchPages = calls; proof.largeOutputPages = pages; proof.history = { old, changed };
    proof.locations = { rawHit, attachedHit, blockHit, longHit }; proof.viewportWidths = [320, 375, 1440]; proof.exportSha256 = exported.sha256;
    proof.rapidSearchReopens = rapidSearchReopens;
    await writeFile(join(sandbox.directory, 'search-evidence.json'), JSON.stringify(proof, null, 2));
    console.log(`Search public-flow evidence: ${sandbox.directory}; ${calls} pages, ${all.length} independent sessions, Web/MCP parity`);
  } finally { await client?.close(); await browser.close(); await faultDb.end(); await sandbox.close(); }
});
