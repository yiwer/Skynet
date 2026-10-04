import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { chromium, expect, type Browser } from '@playwright/test';
import { mcpSandbox } from './mcp-support.js';
import { digest } from '../apps/server/database.js';
const params = (object: object) => new URLSearchParams(Object.entries(object).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]));

test('waiting report, conversation labels, OAuth MCP and export read one frozen source version', { timeout: 180000 }, async () => {
  const base = Date.now() + 60000;
  const sandbox = await mcpSandbox({ reportClock: () => new Date(base + 86400000) });
  let client: Client | undefined, browser: Browser | undefined;
  const directory = process.env.SKYNET_WAITS_EVIDENCE_DIR ?? join(sandbox.directory, 'waits-evidence');
  await mkdir(directory, { recursive: true });
  try {
    const employee = await sandbox.provision('等待公开旅程员工');
    const json = (value: object) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
    const api = (path: string, init: RequestInit = {}) => sandbox.api(path, employee.readerCredential, init);
    const device = await (await sandbox.api('/api/devices/enroll', employee.enrollmentCredential, json({ installationId: randomUUID(), name: '等待公开旅程设备' }))).json();
    const sessionId = randomUUID(), time = (ms: number) => new Date(base + ms).toISOString();
    const message = (role: string, text: string, ms: number) => ({ type: 'response_item', timestamp: time(ms), payload: { type: 'message', role, content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }] } });
    const rows: unknown[] = [{ type: 'session_meta', payload: { id: sessionId } }, message('user', '开始检查来源', 0)];
    for (let index = 0; index < 26; index++) rows.push(
      { type: 'event_msg', timestamp: time(index * 701000 + 1), payload: { type: 'task_started', turn_id: 'turn-' + index } },
      message('assistant', `第 ${index + 1} 轮结果`, index * 701000 + 10),
      { type: 'event_msg', timestamp: time(index * 701000 + 1000), payload: { type: 'task_complete', turn_id: 'turn-' + index } },
      message('user', `继续检查 ${index + 1}`, (index + 1) * 701000));
    const raw = Buffer.from(rows.map(row => JSON.stringify(row)).join('\n') + '\n');
    assert.equal((await sandbox.api('/api/chunks/' + digest(raw), device.deviceCredential, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: raw as any })).status, 201);
    const committed = await sandbox.api('/api/snapshots', device.deviceCredential, json({ protocolVersion: 1, sourceSessionId: sessionId, source: 'codex-cli', sourceVersion: '0.160.0',
      sourceOs: process.platform, project: '/synthetic/waiting-journey', hash: digest(raw), byteLength: raw.length, qualifiedAt: time(0), capability: 'unverified' }));
    assert.equal(committed.status, 200); const snapshotId = (await committed.json()).snapshotId;
    const otherId = randomUUID(), parallelRaw = Buffer.from(JSON.stringify({ type: 'user', uuid: randomUUID(), sessionId: otherId,
      timestamp: time(60000), message: { role: 'user', content: '另一项目期间活动' } }) + '\n');
    assert.equal((await sandbox.api('/api/chunks/' + digest(parallelRaw), device.deviceCredential, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: parallelRaw as any })).status, 201);
    assert.equal((await sandbox.api('/api/snapshots', device.deviceCredential, json({ protocolVersion: 1, sourceSessionId: otherId, source: 'claude-code-cli', sourceVersion: '2.1.281',
      sourceOs: process.platform, project: '/synthetic/parallel-project', hash: digest(parallelRaw), byteLength: parallelRaw.length, qualifiedAt: time(0), capability: 'unverified' }))).status, 200);
    const query = { period: 'since-enrollment' }, first = await (await api('/api/waits?' + params(query))).json();
    assert.equal(first.intervals.length, 25); assert.equal(first.total, 26); assert.equal(first.nextOffset, 25);
    assert.equal(first.intervals[0].parallel, 'observed');
    const fixed = { ...query, version: first.version }, second = await (await api('/api/waits?' + params({ ...fixed, offset: 25 }))).json();
    const exported = await (await api('/api/waits/export?' + params(fixed))).json();
    assert.deepEqual(exported.intervals, [...first.intervals, ...second.intervals]);
    assert.equal(exported.summary.permissionWaitMs, null);
    const resource = sandbox.origin + '/mcp';
    const registration = await (await api('/oauth/register', json({ client_name: 'Waiting public reader', redirect_uris: ['http://127.0.0.1:47125/callback'], token_endpoint_auth_method: 'none' }))).json();
    const verifier = randomBytes(48).toString('base64url');
    const callback = new URL(await sandbox.authorizationPage(sandbox.origin + '/oauth/authorize?' + params({ response_type: 'code', client_id: registration.client_id,
      redirect_uri: registration.redirect_uris[0], scope: 'archive:read', resource, state: randomUUID(), code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url') }), employee.readerCredential));
    const token = await (await api('/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params({ grant_type: 'authorization_code',
      client_id: registration.client_id, code: callback.searchParams.get('code'), redirect_uri: registration.redirect_uris[0], code_verifier: verifier, resource }).toString() })).json();
    client = new Client({ name: 'waits-public', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(resource), { fetch: sandbox.fetchTls, requestInit: { headers: { Authorization: `Bearer ${token.access_token}` } } }));
    const response = await client.callTool({ name: 'read_waits', arguments: fixed });
    assert.notEqual(response.isError, true, JSON.stringify(response));
    assert.deepEqual(JSON.parse((response.content as { text: string }[])[0]!.text), first);
    await client.close(); client = undefined; await sandbox.restart();
    assert.deepEqual(await (await api('/api/waits?' + params(fixed))).json(), first);
    browser = await chromium.launch();
    const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(sandbox.origin + '/#waits');
    await page.getByLabel('个人读取凭据').fill(employee.readerCredential); await page.getByRole('button', { name: '进入存档', exact: true }).click();
    await page.getByRole('button', { name: '接入至今', exact: true }).click();
    await expect(page.getByRole('heading', { name: '响应与等待', exact: true })).toBeVisible();
    await expect(page.getByTestId('wait-reply-total')).toHaveText('303 分 20 秒');
    await expect(page.getByTestId('wait-permission-total')).toHaveText('未知');
    await expect(page.getByRole('table', { name: '等待记录' }).locator('tbody tr')).toHaveCount(25);
    await page.getByRole('button', { name: '下一页等待', exact: true }).click();
    await expect(page.getByRole('table', { name: '等待记录' }).locator('tbody tr')).toHaveCount(1);
    await page.getByRole('button', { name: '上一页等待', exact: true }).click();
    const screenshots: string[] = [];
    for (const theme of ['light', 'dark']) {
      await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
      const path = join(directory, `waits-report-${theme}.png`); await page.screenshot({ path, animations: 'disabled' }); screenshots.push(path);
      assert.equal(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight), true);
    }
    await page.getByRole('link', { name: '查看对话', exact: true }).first().click();
    await expect(page.getByLabel('对话阅读')).toBeVisible();
    await expect(page.getByLabel('等待回复标记').first()).toContainText('11 分 40 秒');
    await expect(page.getByLabel('等待回复标记').first()).toContainText('期间在其他会话中活动');
    await page.getByLabel('等待回复标记').first().locator('summary').click();
    await expect(page.getByLabel('等待回复标记').first().getByRole('link', { name: '轮次结束原件' })).toBeVisible();
    await page.screenshot({ path: join(directory, 'waits-conversation.png'), animations: 'disabled' });
    await page.getByLabel('等待回复标记').first().getByRole('link', { name: '轮次结束原件' }).click();
    await expect(page.getByLabel('命中证据')).toBeVisible();
    for (const width of [390, 320]) {
      await page.goto(sandbox.origin + '/#waits');
      await page.setViewportSize({ width, height: 844 });
      await page.getByRole('button', { name: '接入至今', exact: true }).click();
      await expect(page.getByTestId('wait-reply-total')).toHaveText('303 分 20 秒');
      await expect.poll(() => page.locator('.platform-rail').evaluate(element => element.getBoundingClientRect().right)).toBeLessThanOrEqual(0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth), true);
      for (const theme of ['light', 'dark']) {
        await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
        const path = join(directory, `waits-report-${width}-${theme}.png`); await page.screenshot({ path, animations: 'disabled' }); screenshots.push(path);
      }
      await page.goto(sandbox.origin + '/' + first.intervals[0].end.conversationPath + '&waitVersion=' + first.version);
      const mark = page.getByLabel('等待回复标记').first();
      await expect(mark).toContainText('11 分 40 秒'); await mark.locator('summary').click();
      await expect(mark).toContainText('期间在其他会话中活动');
      await expect(mark.getByRole('link', { name: '轮次结束原件' })).toBeVisible();
      assert.equal(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth), true);
      const path = join(directory, `waits-conversation-${width}.png`); await page.screenshot({ path, animations: 'disabled' }); screenshots.push(path);
    }
    const unknownId = randomUUID(), unknownRaw = Buffer.from([
      { type: 'session_meta', payload: { id: unknownId } }, message('user', '请求', 0), message('assistant', '已完成本轮', 10),
      { type: 'event_msg', timestamp: time(1000), payload: { type: 'task_complete', turn_id: 'missing-user-time' } },
      { ...message('user', '缺来源时间的下一条消息', 601000), timestamp: 'unknown-source-time' },
    ].map(row => JSON.stringify(row)).join('\n') + '\n');
    assert.equal((await sandbox.api('/api/chunks/' + digest(unknownRaw), device.deviceCredential, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: unknownRaw as any })).status, 201);
    assert.equal((await sandbox.api('/api/snapshots', device.deviceCredential, json({ protocolVersion: 1, sourceSessionId: unknownId, source: 'codex-cli', sourceVersion: '0.160.0',
      sourceOs: process.platform, project: '/synthetic/unknown-timestamp', hash: digest(unknownRaw), byteLength: unknownRaw.length, qualifiedAt: time(0), capability: 'unverified' }))).status, 200);
    await page.goto(sandbox.origin + '/#waits'); await page.getByRole('button', { name: '接入至今', exact: true }).click();
    await page.getByLabel('项目路径').fill('/synthetic/unknown-timestamp'); await page.getByRole('button', { name: '应用', exact: true }).click();
    await expect(page.getByTestId('wait-reply-total')).toHaveText('未知');
    await expect(page.locator('.wait-stats .usage-stat').nth(1).locator('dd')).toHaveText('未知');
    await page.screenshot({ path: join(directory, 'waits-unknown-320.png'), animations: 'disabled' });
    assert.deepEqual(await (await api('/api/waits?' + params(fixed))).json(), first, 'late source does not alter report-linked conversation labels');
    assert.deepEqual(errors, []);
    await writeFile(join(directory, 'browser-evidence.json'), JSON.stringify({ snapshotId, version: first.version, count: first.total, replyMs: first.summary.knownReplyWaitMs,
      permissionMs: first.summary.permissionWaitMs, screenshots, browserErrors: errors }, null, 2));
  } finally { await browser?.close(); await client?.close(); await sandbox.close(); }
});
