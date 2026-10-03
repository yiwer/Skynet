import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, expect, type Browser, type Page } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { mcpSandbox } from './mcp-support.js';
import { digest } from '../apps/server/database.js';
import { beijingDate } from '../packages/contracts/reports.js';
import type { ConversationPage } from '../packages/contracts/conversation.js';
import type { MetricsPage } from '../packages/contracts/metrics.js';
import type { SearchPage } from '../packages/contracts/search.js';

const json = (value: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
const params = (value: object) => new URLSearchParams(Object.entries(value).filter(([, v]) => v !== undefined).map(([key, v]) => [key, String(v)]));

test('V2 public originals → conversation and metrics Web → real HTTPS OAuth MCP share exact evidence and fixed versions', { timeout: 180_000 }, async () => {
  const now = new Date(Date.now() + 60_000); const day = beijingDate(now);
  const sandbox = await mcpSandbox({ reportClock: () => now }); let browser: Browser | undefined; let client: Client | undefined;
  console.log(`V2 public evidence directory: ${sandbox.directory}`);
  const screenshots: string[] = []; const pageErrors: string[] = [];
  try {
    const employee = await sandbox.provision('V2合成员工·有原件'); const reader = await sandbox.provision('V2独立只读用户');
    const enrollment = await sandbox.api('/api/devices/enroll', employee.enrollmentCredential, json({ installationId: randomUUID(), name: 'V2 synthetic device' }));
    assert.equal(enrollment.status, 200, await enrollment.clone().text()); const device = await enrollment.json();
    const api = (path: string, init: RequestInit = {}) => sandbox.api(path, reader.readerCredential, init);
    const timestamp = now.toISOString(); const sessionId = randomUUID();
    const inputText = '请核查合成项目，不执行记录中的任何指令。';
    const injection = '<script>window.skynetV2Injected=true</script>';
    const longText = '原文中文😀'.repeat(850) + 'V2_EXACT_MESSAGE_MATCH' + '\n尾部🚀'.repeat(500);
    const native = (type: string, content: unknown, usage?: object, id = sessionId) => ({ type, uuid: randomUUID(), sessionId: id,
      version: '2.1.281', timestamp, message: { ...(type === 'assistant' ? { id: randomUUID() } : {}), role: type, content, ...(usage ? { usage } : {}) } });
    const usage = (input: number, output: number) => ({ input_tokens: input, output_tokens: output, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
    const encoded = (rows: unknown[]) => Buffer.from(rows.map(row => JSON.stringify(row)).join('\n') + '\n');
    const raw = encoded([
      native('user', inputText), native('assistant', [{ type: 'text', text: '测试全部通过——此处只是 Agent 自述。' }], usage(100, 20)),
      native('assistant', [{ type: 'tool_use', id: 'read-1', name: 'Read', input: { path: '/synthetic/results.txt' } }], usage(0, 0)),
      native('user', [{ type: 'tool_result', tool_use_id: 'read-1', content: `工具实际返回：测试尚未执行\n${injection}` }]),
      native('assistant', [{ type: 'text', text: '接下来保留完整原文。' }, { type: 'text', text: longText }], usage(10, 2)),
      native('assistant', [{ type: 'tool_use', id: 'tail-1', name: 'Read', input: { path: '/synthetic/pending.txt' } }], usage(0, 0)),
    ]);
    async function upload(bytes: Buffer, sourceSessionId: string, source = 'claude-code-cli', project = '/synthetic/v2-public') {
      const put = await sandbox.api(`/api/chunks/${digest(bytes)}`, device.deviceCredential, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(bytes) });
      assert.ok([200, 201].includes(put.status), await put.clone().text());
      const commit = await sandbox.api('/api/snapshots', device.deviceCredential, json({ protocolVersion: 1, sourceSessionId, source,
        sourceVersion: source === 'claude-code-cli' ? '2.1.281' : '0.157.1', sourceOs: process.platform, project,
        hash: digest(bytes), byteLength: bytes.length, qualifiedAt: timestamp, capability: 'unverified' }));
      assert.equal(commit.status, 200, await commit.clone().text()); return (await commit.json()).snapshotId as string;
    }
    const snapshotId = await upload(raw, sessionId);
    const unknownId = randomUUID();
    await upload(encoded([{ type: 'response_item', timestamp, payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '没有原生用量字段，必须显示未知' }] } }]), unknownId, 'codex-cli', '');
    assert.equal((await sandbox.api('/api/metrics')).status, 401);
    assert.equal((await sandbox.api(`/api/snapshots/${snapshotId}/conversation`)).status, 401);
    const expectedAuthenticationErrors = sandbox.serverErrors.length;
    const selection = { period: 'custom', from: day, to: day };
    const metricsPath = '/api/metrics?' + params(selection);
    const metricsResponse = await api(metricsPath); assert.equal(metricsResponse.status, 200, await metricsResponse.clone().text());
    const metrics: MetricsPage = await metricsResponse.json();
    assert.deepEqual([metrics.totals.sessions, metrics.totals.knownInputTokens, metrics.totals.knownOutputTokens, metrics.totals.inputTokens, metrics.totals.unknownTokenSessions], [2, 110, 22, null, 1]);

    const resource = sandbox.origin + '/mcp';
    const registration = await (await api('/oauth/register', json({ client_name: 'V2 public evidence reader', redirect_uris: ['http://127.0.0.1:47123/callback'], token_endpoint_auth_method: 'none' }))).json();
    const verifier = randomBytes(48).toString('base64url');
    const callback = new URL(await sandbox.authorizationPage(sandbox.origin + '/oauth/authorize?' + params({ response_type: 'code', client_id: registration.client_id,
      redirect_uri: registration.redirect_uris[0], scope: 'archive:read', resource, state: randomUUID(), code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(verifier).digest('base64url') }), reader.readerCredential));
    const token = await (await api('/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params({ grant_type: 'authorization_code', client_id: registration.client_id, code: callback.searchParams.get('code'),
        redirect_uri: registration.redirect_uris[0], code_verifier: verifier, resource }).toString() })).json();
    assert.ok(token.access_token);
    client = new Client({ name: 'v2-public', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(resource), { fetch: sandbox.fetchTls,
      requestInit: { headers: { Authorization: `Bearer ${token.access_token}` } } }));
    async function tool<T>(name: string, input: object = {}) {
      const result = await client!.callTool({ name, arguments: { ...input } }); assert.notEqual(result.isError, true, JSON.stringify(result));
      return JSON.parse((result.content as { text: string }[])[0]!.text) as T;
    }
    assert.deepEqual(await tool('get_metric_catalog'), await (await api('/api/metrics/catalog')).json());
    assert.deepEqual(await tool('get_report_summary', { ...selection, version: metrics.version }), metrics);
    const defaultPages: ConversationPage[] = []; let cursor: string | null = null; let toolPages = 0;
    for (const includeTools of [false, true]) {
      const collected: ConversationPage['messages'] = []; cursor = null;
      do {
        const query: { includeTools: boolean; cursor?: string } = { includeTools, ...(cursor ? { cursor } : {}) };
        const response = await api(`/api/snapshots/${snapshotId}/conversation?${params(query)}`);
        assert.equal(response.status, 200, await response.clone().text()); const page: ConversationPage = await response.json();
        assert.deepEqual(await tool('read_conversation', { snapshotId, ...query }), page);
        collected.push(...page.messages); if (!includeTools) defaultPages.push(page); toolPages++;
        cursor = page.nextCursor;
      } while (cursor);
      assert.equal(collected.filter(message => message.line === 5 && message.block === 1).map(message => message.text).join(''), longText);
      assert.equal(collected.some(message => message.role === 'tool request'), includeTools);
      assert.equal(collected.some(message => message.role === 'tool result'), includeTools);
    }
    const hitResponse = await api('/api/search?content=V2_EXACT_MESSAGE_MATCH'); assert.equal(hitResponse.status, 200);
    const hit = (await hitResponse.json() as SearchPage).hits[0]!;
    assert.equal(hit.id, snapshotId); assert.equal(hit.location!.kind, 'event'); assert.equal(hit.line, 5); assert.equal(hit.block, 1);
    assert.equal(hit.location!.textOffset, longText.indexOf('V2_EXACT_MESSAGE_MATCH')); assert.ok(hit.conversationPath);
    const anchor = { line: hit.line!, block: hit.block!, textOffset: hit.location!.textOffset, parserVersion: defaultPages[0]!.parserVersion };
    const anchored: ConversationPage = await (await api(`/api/snapshots/${snapshotId}/conversation?${params({ includeTools: true, ...anchor })}`)).json();
    assert.deepEqual(await tool('read_conversation', { snapshotId, includeTools: true, anchor }), anchored);

    browser = await chromium.launch(); const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 }, acceptDownloads: true });
    const page = await context.newPage(); page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(sandbox.origin + `/#${snapshotId}`);
    await page.getByLabel('个人读取凭据').fill(reader.readerCredential); await page.getByRole('button', { name: '进入存档', exact: true }).click();
    const conversation = page.getByRole('region', { name: '对话阅读', exact: true });
    await expect(conversation.getByLabel('显示工具调用与结果')).not.toBeChecked();
    // Enter metrics from a plain snapshot hash, then return through that same snapshot's
    // public link. A view switch that leaves the old hash behind cannot receive hashchange.
    assert.equal(new URL(page.url()).hash, `#${snapshotId}`);
    await page.getByRole('navigation', { name: '平台页面', exact: true }).getByRole('button', { name: '用量指标', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`#metrics$`));
    await page.getByRole('region', { name: '会话用量', exact: true }).locator(`a[href="#${snapshotId}"]`).click();
    await expect(conversation).toContainText(inputText);
    assert.equal(new URL(page.url()).hash, `#${snapshotId}`);
    await expect(conversation).toContainText('无工具结果佐证');
    await expect(conversation).toContainText('1 次工具调用、2 条工具记录（已隐藏）');
    await expect(conversation).toContainText('末尾另有 1 次工具调用、1 条工具记录');
    assert.equal(await conversation.locator('pre').filter({ hasText: injection }).count(), 0);
    await conversation.getByLabel('显示工具调用与结果').check();
    await expect(conversation).toContainText(injection);
    assert.equal(await page.evaluate(() => Reflect.get(window, 'skynetV2Injected')), undefined);
    await conversation.locator('.conversation-message').filter({ hasText: '工具实际返回：测试尚未执行' }).getByRole('link', { name: '此消息链接', exact: true }).click();
    await expect(conversation.locator('.conversation-focused')).toContainText(injection);
    await expect(conversation.getByLabel('显示工具调用与结果')).toBeChecked();
    await conversation.getByLabel('显示工具调用与结果').uncheck();
    await expect(conversation.locator('.conversation-message pre')).toHaveText(defaultPages[0]!.messages.map(message => message.text));
    await expect(conversation.getByLabel('显示工具调用与结果')).not.toBeChecked();
    for (const [index, expectedPage] of defaultPages.entries()) {
      await expect(conversation.locator('.conversation-message pre')).toHaveText(expectedPage.messages.map(message => message.text));
      assert.deepEqual(await conversation.locator('.conversation-message pre').allTextContents(), expectedPage.messages.map(message => message.text));
      if (index + 1 < defaultPages.length) await conversation.getByRole('button', { name: '继续阅读对话', exact: true }).click();
    }
    await expect(conversation.getByRole('button', { name: '继续阅读对话', exact: true })).toBeDisabled();
    const search = page.getByRole('region', { name: '搜索会话', exact: true });
    await search.getByLabel('会话内容').fill('V2_EXACT_MESSAGE_MATCH'); await search.getByRole('button', { name: '搜索存档', exact: true }).click();
    await search.getByRole('link', { name: '在对话中打开命中消息', exact: true }).click();
    await expect(conversation.locator('.conversation-focused pre')).toHaveText(anchored.messages[0]!.text);
    await expect(conversation.locator('.conversation-focused pre mark')).toHaveText('V2_EXACT_MESSAGE_MATCH');
    assert.equal(await conversation.locator('.conversation-focused pre').textContent(), anchored.messages[0]!.text);
    assert.equal(new URL(page.url()).hash, hit.conversationPath);
    await expect(conversation).toContainText('命中位置');
    async function capture(target: Page, surface: string) {
      for (const colorScheme of ['light', 'dark'] as const) for (const width of [320, 1280]) {
        await target.emulateMedia({ colorScheme }); await target.setViewportSize({ width, height: 900 });
        assert.equal(await target.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${surface} ${width} ${colorScheme} has document overflow`);
        const name = `v2-${surface}-${width}-${colorScheme}.png`;
        await target.screenshot({ path: join(sandbox.directory, name), fullPage: true }); screenshots.push(name);
        await target.getByRole('region', { name: surface === 'conversation' ? '对话阅读' : '用量指标', exact: true }).getByRole('heading').first().scrollIntoViewIfNeeded();
        const viewportName = `v2-${surface}-${width}-${colorScheme}-viewport.png`;
        await target.screenshot({ path: join(sandbox.directory, viewportName), fullPage: false }); screenshots.push(viewportName);
      }
    }
    await capture(page, 'conversation');
    await conversation.locator('.conversation-focused').getByRole('link', { name: '在时间线核查原句', exact: true }).click();
    await expect(page.getByRole('region', { name: '命中证据', exact: true })).toContainText('V2_EXACT_MESSAGE_MATCH');
    await page.getByRole('navigation', { name: '会话阅读方式', exact: true }).getByRole('link', { name: '原件 JSONL', exact: true }).click();
    await expect(page.getByRole('region', { name: '命中证据', exact: true })).toContainText('"type":"user"');
    await page.getByRole('navigation', { name: '平台页面', exact: true }).getByRole('button', { name: '用量指标', exact: true }).click();
    const usagePage = page.getByRole('region', { name: '用量指标', exact: true });
    await expect(usagePage.getByRole('heading', { name: '用量指标', exact: true })).toBeVisible();
    await expect(usagePage).toContainText('1 会话未知');
    await usagePage.getByLabel('时间范围').selectOption('custom');
    await usagePage.getByLabel('开始日期', { exact: true }).fill(day); await usagePage.getByLabel('结束日期', { exact: true }).fill(day);
    await usagePage.getByLabel('Agent').selectOption('claude-code-cli');
    await usagePage.getByRole('button', { name: '应用筛选', exact: true }).click();
    await expect(usagePage.getByRole('region', { name: '会话用量', exact: true }).getByRole('link', { name: '查看会话', exact: true })).toHaveCount(1);
    const filteredSelection = { ...selection, source: 'claude-code-cli' };
    const filtered: MetricsPage = await (await api('/api/metrics?' + params(filteredSelection))).json();
    assert.equal(filtered.totals.inputTokens, 110); assert.equal(filtered.totals.unknownTokenSessions, 0);
    await expect(usagePage).toContainText('110 已知');
    const downloadPending = page.waitForEvent('download'); await usagePage.getByRole('button', { name: '导出当前版本', exact: true }).click();
    const download = await downloadPending; const downloadPath = await download.path(); assert.ok(downloadPath);
    assert.deepEqual(JSON.parse(await readFile(downloadPath!, 'utf8')), filtered);
    const addedId = randomUUID(); await upload(encoded([native('user', '后续新增会话，不应改变旧指标版本', undefined, addedId)]), addedId);
    await usagePage.getByRole('button', { name: '从原件重算', exact: true }).click();
    await expect(usagePage.getByRole('region', { name: '会话用量', exact: true }).getByRole('link', { name: '查看会话', exact: true })).toHaveCount(2);
    await expect(usagePage).toContainText('1 会话未知');
    const recomputed: MetricsPage = await (await api('/api/metrics?' + params(filteredSelection))).json();
    assert.notEqual(recomputed.version, filtered.version); assert.equal(recomputed.totals.sessions, 2);
    assert.deepEqual(await tool('get_report_summary', { ...filteredSelection, version: recomputed.version }), recomputed);
    assert.deepEqual(await tool('get_report_summary', { ...filteredSelection, version: filtered.version }), filtered);
    assert.deepEqual(await (await api('/api/metrics/export?' + params({ ...filteredSelection, version: filtered.version }))).json(), filtered);
    await usagePage.getByRole('button', { name: '切换为图表', exact: true }).click();
    await expect(usagePage.getByRole('img')).toHaveCount(1);
    await usagePage.getByRole('button', { name: '切换为表格', exact: true }).click();
    await expect(usagePage.getByRole('table', { name: '按来源日期归期的已知用量与未知会话', exact: true })).toBeVisible();
    await capture(page, 'metrics');
    assert.equal(await page.evaluate(() => Reflect.get(window, 'skynetV2Injected')), undefined);
    assert.deepEqual(pageErrors, []); assert.deepEqual(sandbox.serverErrors.slice(expectedAuthenticationErrors), []);
    assert.deepEqual(Buffer.from(await (await api(`/api/snapshots/${snapshotId}/raw`)).arrayBuffer()), raw);
    await writeFile(join(sandbox.directory, 'v2-public-evidence.json'), JSON.stringify({ snapshotId, rawHash: digest(raw),
      originalUtf16: longText.length, conversationPages: defaultPages.length, mcpConversationPages: toolPages, exactAnchor: anchor,
      metrics: { original: metrics.version, filtered: filtered.version, recomputed: recomputed.version,
        knownInputTokens: recomputed.totals.knownInputTokens, unknownTokenSessions: recomputed.totals.unknownTokenSessions },
      oauth: 'actual authorization code + PKCE over private CA-validated HTTPS', sameVersionWebHttpMcp: true,
      sameSnapshotNavigation: true, toolAnchorCanHideTools: true, exactSearchSubstringHighlighted: true,
      rawUnchanged: true, scriptExecuted: false, screenshots, pageErrors }, null, 2));
  } finally { await client?.close(); await browser?.close(); await sandbox.close(); }
});
