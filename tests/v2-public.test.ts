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
import { readRecoveryPackage } from '../packages/recovery.js';

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
    const unknownRaw = encoded([{ type: 'response_item', timestamp, payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '没有原生用量字段，必须显示未知' }] } }]);
    const unknownSnapshotId = await upload(unknownRaw, unknownId, 'codex-cli', '');
    assert.equal((await sandbox.api('/api/metrics')).status, 401);
    assert.equal((await sandbox.api(`/api/snapshots/${snapshotId}/conversation`)).status, 401);
    const expectedAuthenticationErrors = sandbox.serverErrors.length;
    const selection = { period: 'this-week' };
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
    await page.getByRole('navigation', { name: '平台页面', exact: true }).getByRole('button', { name: '用量与产出', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`#metrics$`));
    await expect(page.getByRole('region', {name:'用量指标',exact:true})).toHaveAttribute('aria-busy','false');
    await expect(page.getByRole('region', {name:'用量指标',exact:true}).getByRole('button',{name:'重试指标',exact:true})).toHaveCount(0);
    await page.getByRole('region', { name: '会话用量', exact: true }).locator(`a[href^="#${snapshotId}?insightVersion="]`).click();
    await expect(conversation).toContainText(inputText);
    assert.equal(new URL(page.url()).hash.split('?')[0], `#${snapshotId}`);
    assert.equal(defaultPages[0]!.messages.find(message => message.line === 2)!.toolEvidence, 'none-observed');
    assert.equal(defaultPages[0]!.status.verification, 'not-assessed');
    await expect(conversation.getByRole('button', { name: '显示 1 次工具调用、2 条工具记录', exact: true })).toBeVisible();
    assert.deepEqual([defaultPages[0]!.trailingHiddenToolCalls, defaultPages[0]!.trailingHiddenToolEvents], [0, 0]);
    await expect(conversation.getByRole('button', { name: '显示 1 次工具调用', exact: true })).toHaveCount(0);
    assert.equal(await conversation.locator('pre').filter({ hasText: injection }).count(), 0);
    await conversation.getByLabel('显示工具调用与结果').check();
    const toolMessage = conversation.locator('.conversation-message').filter({ hasText: '工具实际返回：测试尚未执行' });
    await expect(toolMessage.locator('.conversation-tool-card')).not.toHaveAttribute('open');
    await toolMessage.locator('.conversation-tool-card > summary').click();
    await expect(toolMessage.locator('pre')).toBeVisible();
    const expectedToolText = `read-1\n工具实际返回：测试尚未执行\n${injection}`;
    await expect(toolMessage.locator('pre')).toHaveText(expectedToolText);
    assert.equal(await toolMessage.locator('pre').textContent(), expectedToolText);
    assert.equal(await page.evaluate(() => Reflect.get(window, 'skynetV2Injected')), undefined);
    await toolMessage.locator('.conversation-evidence > summary').click();
    await toolMessage.getByRole('link', { name: '此消息链接', exact: true }).click();
    await expect(conversation.locator('.conversation-focused')).toContainText(injection);
    await expect(conversation.locator('.conversation-focused .conversation-tool-card pre')).toBeVisible();
    await expect(conversation.getByLabel('显示工具调用与结果')).toBeChecked();
    await conversation.getByLabel('显示工具调用与结果').uncheck();
    await expect(conversation.locator('.conversation-message pre')).toHaveText(defaultPages[0]!.messages.map(message => message.text));
    await expect(conversation.getByLabel('显示工具调用与结果')).not.toBeChecked();
    let segmentContinuations = 0;
    for (const [index, expectedPage] of defaultPages.entries()) {
      await expect(conversation.locator('.conversation-message pre')).toHaveText(expectedPage.messages.map(message => message.text));
      assert.deepEqual(await conversation.locator('.conversation-message pre').allTextContents(), expectedPage.messages.map(message => message.text));
      if (index + 1 < defaultPages.length) {
        const last = expectedPage.messages.at(-1)!;
        const fragmented = last.textOffset + last.text.length < last.textLength;
        if (fragmented) segmentContinuations++;
        await conversation.getByRole('button', { name: fragmented ? '继续读取下一段' : '继续阅读对话', exact: true }).click();
      }
    }
    assert.ok(segmentContinuations > 0, 'the long original must be read through the explicit segment action');
    assert.deepEqual([defaultPages.at(-1)!.trailingHiddenToolCalls, defaultPages.at(-1)!.trailingHiddenToolEvents], [1, 1]);
    await expect(conversation.getByRole('button', { name: '显示 1 次工具调用', exact: true })).toBeVisible();
    await expect(conversation.getByRole('button', { name: '继续阅读对话', exact: true })).toBeDisabled();
    await page.keyboard.press('Control+k');
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
        await target.evaluate(() => {
          window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
          document.querySelectorAll<HTMLElement>('main, main *').forEach(element => {
            if (element.scrollTop || element.scrollLeft) element.scrollTo({ top: 0, left: 0, behavior: 'instant' });
          });
        });
        const name = `v2-${surface}-${width}-${colorScheme}.png`;
        await target.screenshot({ path: join(sandbox.directory, name), fullPage: true, animations: 'disabled' }); screenshots.push(name);
        const viewportName = `v2-${surface}-${width}-${colorScheme}-viewport.png`;
        await target.screenshot({ path: join(sandbox.directory, viewportName), fullPage: false, animations: 'disabled' }); screenshots.push(viewportName);
      }
    }
    await capture(page, 'conversation');
    await conversation.locator('.conversation-focused .conversation-evidence > summary').click();
    await conversation.locator('.conversation-focused').getByRole('link', { name: '在时间线核查原句', exact: true }).click();
    await expect(page.getByRole('region', { name: '命中证据', exact: true })).toContainText('V2_EXACT_MESSAGE_MATCH');
    await page.getByRole('navigation', { name: '会话阅读方式', exact: true }).getByRole('link', { name: '原件 JSONL', exact: true }).click();
    await expect(page.getByRole('region', { name: '命中证据', exact: true })).toContainText('"type":"user"');
    await page.getByRole('navigation', { name: '平台页面', exact: true }).getByRole('button', { name: '会话找回', exact: true }).click();
    const recovery = page.getByRole('region', { name: '会话找回', exact: true });
    await recovery.getByRole('group', { name: '选择员工', exact: true }).getByRole('button', { name: 'V2合成员工·有原件', exact: true }).click();
    const commitDate = recovery.getByLabel('提交日期', { exact: true }); const populatedDate = await commitDate.inputValue();
    await commitDate.fill('1900-01-01');
    await expect(commitDate).toHaveValue('1900-01-01');
    await expect(recovery.getByRole('region', { name: '选择会话', exact: true }).getByRole('button')).toHaveCount(0);
    await expect(recovery.getByRole('button', { name: '下一步 →', exact: true })).toHaveCount(0);
    await commitDate.fill(populatedDate);
    await recovery.getByRole('region', { name: '选择会话', exact: true }).getByRole('button').filter({ hasText: 'v2-public' }).click();
    await recovery.getByRole('button', { name: '下一步 →', exact: true }).click();
    await expect(recovery.getByRole('list', { name: '找回步骤', exact: true }).locator('[aria-current="step"]')).toContainText('选择格式');
    await expect(recovery.getByRole('radio', { name: /完整可读导出/ })).toBeChecked();
    await expect(recovery).toContainText(digest(raw));
    await recovery.getByRole('button', { name: '下一步 →', exact: true }).click();
    await expect(recovery.getByRole('list', { name: '找回步骤', exact: true }).locator('[aria-current="step"]')).toContainText('下载');
    async function recoveryDownload(button: string, filename: string) {
      const pending = page.waitForEvent('download'); await recovery.getByRole('button', { name: button, exact: true }).click();
      const exported = await pending; const path = join(sandbox.directory, filename); await exported.saveAs(path); return readFile(path);
    }
    const readable = await recoveryDownload('下载完整可读材料', 'v2-readable-export.txt');
    assert.equal(readable.toString('utf8'), await (await api(`/api/snapshots/${snapshotId}/readable`)).text());
    assert.ok(readable.toString('utf8').includes(longText)); assert.ok(readable.toString('utf8').includes(injection));
    assert.deepEqual(await recoveryDownload('下载原件 JSONL', 'v2-original-export.jsonl'), raw);
    await recovery.getByRole('button', { name: '← 返回选择方式', exact: true }).click();
    await recovery.getByRole('radio', { name: /恢复资料包/ }).check();
    await expect(recovery.getByRole('radio', { name: /恢复资料包/ })).toBeChecked();
    await recovery.getByRole('button', { name: '下一步 →', exact: true }).click();
    const restored = readRecoveryPackage(await recoveryDownload('下载恢复资料包', 'v2-recovery-export.json'));
    assert.equal(restored.snapshot.id, snapshotId); assert.equal(restored.manifest.hash, digest(raw)); assert.deepEqual(restored.bytes, raw);
    // Change only the public route's snapshot while recovery remains mounted. The
    // next export must use the newly selected original, never the previous detail.
    await page.goto(sandbox.origin + `/#recovery?snapshot=${unknownSnapshotId}`);
    await expect(recovery.getByRole('list', { name: '找回步骤', exact: true }).locator('[aria-current="step"]')).toContainText('选择格式');
    await expect(recovery).toContainText(digest(unknownRaw));
    await expect(recovery.getByRole('link', { name: '阅读会话', exact: true })).toHaveAttribute('href', `#${unknownSnapshotId}`);
    await recovery.getByRole('button', { name: '下一步 →', exact: true }).click();
    assert.deepEqual(await recoveryDownload('下载原件 JSONL', 'v2-changed-snapshot-export.jsonl'), unknownRaw);
    await page.goto(sandbox.origin + `/#recovery?snapshot=${snapshotId}`);
    await expect(recovery).toContainText(digest(raw));
    await recovery.getByRole('radio', { name: /恢复资料包/ }).check();
    await recovery.getByRole('button', { name: '下一步 →', exact: true }).click();
    await capture(page, 'recovery');
    await page.getByRole('navigation', { name: '平台页面', exact: true }).getByRole('button', { name: '用量与产出', exact: true }).click();
    const usagePage = page.getByRole('region', { name: '用量指标', exact: true });
    await expect(usagePage.getByRole('heading', { name: '用量与产出', exact: true })).toBeVisible();
    await expect(usagePage.getByRole('region', { name: '会话用量', exact: true }).getByRole('link', { name: '查看会话', exact: true })).toHaveCount(2);
    await page.evaluate(() => { location.hash = 'metrics?source=codex-cli'; });
    const sessionLinks = usagePage.getByRole('region', { name: '会话用量', exact: true }).getByRole('link', { name: '查看会话', exact: true });
    await expect(sessionLinks).toHaveCount(1);
    await expect(sessionLinks).toHaveAttribute('href', new RegExp(`^#${unknownSnapshotId}\\?insightVersion=`));
    await page.evaluate(() => { location.hash = 'metrics'; });
    await expect(sessionLinks).toHaveCount(2);
    const dailyPoint = usagePage.getByRole('region', {name:'每日用量',exact:true}).locator('[tabindex="0"][aria-label*="110"]').first();
    await expect(dailyPoint).toHaveCount(1);
    await dailyPoint.focus();
    await expect(usagePage.getByRole('tooltip')).toContainText('110');
    await page.keyboard.press('Escape');
    await expect(usagePage.getByRole('tooltip')).toHaveCount(0);
    await usagePage.locator('.usage-bar-segment').first().focus();
    await expect(usagePage.getByRole('tooltip')).toContainText('Claude Code CLI');
    await page.keyboard.press('Tab');
    await expect(usagePage.getByRole('tooltip')).toHaveCount(0);
    await expect(usagePage.getByRole('heading', { name: /^(每人产出|会话：Token 与已验证结果)$/ })).toHaveCount(2);
    await expect(usagePage.getByRole('group', { name: '时间范围', exact: true }).getByRole('button')).toHaveText(['本周', '上周', '接入至今']);
    await expect(usagePage).toHaveAttribute('aria-busy', 'false');
    await usagePage.getByRole('combobox', { name: /^Agent/ }).selectOption('claude-code-cli');
    await expect(usagePage.getByRole('region', { name: '会话用量', exact: true }).getByRole('link', { name: '查看会话', exact: true })).toHaveCount(1);
    const filteredSelection = { ...selection, source: 'claude-code-cli' };
    const filtered: MetricsPage = await (await api('/api/metrics?' + params(filteredSelection))).json();
    assert.equal(filtered.totals.inputTokens, 110); assert.equal(filtered.totals.unknownTokenSessions, 0);
    await expect(usagePage.getByRole('region', { name: '会话用量', exact: true }).getByRole('cell', { name: '110', exact: true })).toBeVisible();
    await expect(usagePage.getByRole('region', { name: '会话用量', exact: true }).getByRole('cell', { name: '22', exact: true })).toBeVisible();
    const downloadPending = page.waitForEvent('download'); await usagePage.getByRole('button', { name: '导出当前版本', exact: true }).click();
    const download = await downloadPending; const downloadPath = await download.path(); assert.ok(downloadPath);
    const downloadedUsage=JSON.parse(await readFile(downloadPath!, 'utf8'));
    assert.deepEqual(downloadedUsage, await (await api('/api/usage-output/export?' + params({...filteredSelection,version:downloadedUsage.version}))).json());
    const addedId = randomUUID(); await upload(encoded([native('user', '后续新增会话，不应改变旧指标版本', undefined, addedId)]), addedId);
    await usagePage.getByRole('button', { name: '从原件重算', exact: true }).click();
    await expect(usagePage.getByRole('region', { name: '会话用量', exact: true }).getByRole('link', { name: '查看会话', exact: true })).toHaveCount(2);
    const recomputed: MetricsPage = await (await api('/api/metrics?' + params(filteredSelection))).json();
    assert.notEqual(recomputed.version, filtered.version); assert.equal(recomputed.totals.sessions, 2);
    assert.equal(recomputed.totals.unknownTokenSessions, 1);
    assert.deepEqual(await tool('get_report_summary', { ...filteredSelection, version: recomputed.version }), recomputed);
    assert.deepEqual(await tool('get_report_summary', { ...filteredSelection, version: filtered.version }), filtered);
    assert.deepEqual(await (await api('/api/metrics/export?' + params({ ...filteredSelection, version: filtered.version }))).json(), filtered);
    const dailyUsage = usagePage.getByRole('region', { name: '每日用量', exact: true });
    await dailyUsage.getByRole('button', { name: '每日用量切换为图表', exact: true }).click();
    await expect(dailyUsage.getByRole('group', { name: /每日 Token$/ })).toHaveCount(1);
    await dailyUsage.getByRole('button', { name: '每日用量切换为表格', exact: true }).click();
    await expect(usagePage.getByRole('table', { name: '员工每日输入 Token', exact: true })).toBeVisible();
    await capture(page, 'metrics');
    assert.equal(await page.evaluate(() => Reflect.get(window, 'skynetV2Injected')), undefined);
    assert.deepEqual(pageErrors, []); assert.deepEqual(sandbox.serverErrors.slice(expectedAuthenticationErrors), []);
    assert.deepEqual(Buffer.from(await (await api(`/api/snapshots/${snapshotId}/raw`)).arrayBuffer()), raw);
    await writeFile(join(sandbox.directory, 'v2-public-evidence.json'), JSON.stringify({ snapshotId, rawHash: digest(raw),
      originalUtf16: longText.length, conversationPages: defaultPages.length, mcpConversationPages: toolPages, exactAnchor: anchor,
      metrics: { original: metrics.version, filtered: filtered.version, recomputed: recomputed.version,
        knownInputTokens: recomputed.totals.knownInputTokens, unknownTokenSessions: recomputed.totals.unknownTokenSessions },
      oauth: 'actual authorization code + PKCE over private CA-validated HTTPS', sameVersionWebHttpMcp: true,
      sameSnapshotNavigation: true, toolCardExpandedOriginal: true, toolAnchorCanHideTools: true,
      segmentContinuations, exactSearchSubstringHighlighted: true,
      recovery: { threeStepSelection: true, emptyDatePreserved: true, routeSnapshotChangesExport: true,
        readableTextComplete: true, rawBytesExact: true, packageVerified: true, nativeRecovery: 'not-executed' },
      rawUnchanged: true, scriptExecuted: false, screenshots, pageErrors }, null, 2));
  } finally { await client?.close(); await browser?.close(); await sandbox.close(); }
});
