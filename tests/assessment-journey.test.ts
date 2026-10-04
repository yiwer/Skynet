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
const params = (object: object) => new URLSearchParams(Object.entries(object).map(([key, value]) => [key, String(value)]));

test('the current employee assessment exposes the same evidence and fixed model through Web, OAuth MCP and export', { timeout: 180_000 }, async () => {
  const source = new Date(Date.now() + 86400000), now = new Date(Date.now() + 28 * 86400000);
  const sandbox = await mcpSandbox({ reportClock: () => now });
  const directory = process.env.SKYNET_ASSESSMENT_EVIDENCE_DIR ?? join(sandbox.directory, 'assessment-evidence');
  let client: Client | undefined, browser: Browser | undefined;
  await mkdir(directory, { recursive: true });
  try {
    const employee = await sandbox.provision('画像公开旅程员工');
    const json = (value: object) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
    const api = (path: string, init: RequestInit = {}) => sandbox.api(path, employee.readerCredential, init);
    const device = await (await sandbox.api('/api/devices/enroll', employee.enrollmentCredential, json({ installationId: randomUUID(), name: '画像公开设备' }))).json();
    const id = randomUUID(), raw = Buffer.from(JSON.stringify({ type: 'response_item', timestamp: source.toISOString(), payload: {
      type: 'message', role: 'user', content: [{ type: 'input_text', text: '公开画像核查这条原始请求。' }] } }) + '\n');
    await sandbox.api('/api/chunks/' + digest(raw), device.deviceCredential, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: raw });
    const commit = await sandbox.api('/api/snapshots', device.deviceCredential, json({ protocolVersion: 1, sourceSessionId: id, source: 'codex-cli', sourceVersion: '0.160.0',
      sourceOs: process.platform, project: '/synthetic/profile', hash: digest(raw), byteLength: raw.length, qualifiedAt: source.toISOString(), capability: 'unverified' }));
    assert.equal(commit.status, 200); const snapshotId = (await commit.json()).snapshotId;
    const path = '/api/assessments/' + employee.employeeId, value = await (await api(path)).json();
    assert.equal(value.index, 17); assert.equal(value.level, '待定');
    const resource = sandbox.origin + '/mcp', registration = await (await api('/oauth/register', json({ client_name: 'Assessment reader', redirect_uris: ['http://127.0.0.1:47125/callback'], token_endpoint_auth_method: 'none' }))).json();
    const verifier = randomBytes(48).toString('base64url');
    const callback = new URL(await sandbox.authorizationPage(sandbox.origin + '/oauth/authorize?' + params({ response_type: 'code', client_id: registration.client_id,
      redirect_uri: registration.redirect_uris[0], scope: 'archive:read', resource, state: randomUUID(), code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url') }), employee.readerCredential));
    const token = await (await api('/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params({ grant_type: 'authorization_code',
      client_id: registration.client_id, code: callback.searchParams.get('code'), redirect_uri: registration.redirect_uris[0], code_verifier: verifier, resource }).toString() })).json();
    client = new Client({ name: 'assessment-public', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(resource), { fetch: sandbox.fetchTls, requestInit: { headers: { Authorization: `Bearer ${token.access_token}` } } }));
    const response = await client.callTool({ name: 'read_assessment', arguments: { employeeId: employee.employeeId, version: value.version } });
    assert.notEqual(response.isError, true, JSON.stringify(response));
    assert.deepEqual(JSON.parse((response.content as { text: string }[])[0]!.text), value);
    assert.deepEqual(await (await api(path + '/export?version=' + value.version)).json(), value);
    browser = await chromium.launch(); const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(sandbox.origin + '/#profile?employeeId=' + employee.employeeId + '&version=' + value.version);
    await page.getByLabel('个人读取凭据').fill(employee.readerCredential); await page.getByRole('button', { name: '进入存档', exact: true }).click();
    await expect(page.getByRole('heading', { name: employee.name ?? '画像公开旅程员工', exact: true })).toBeVisible();
    await expect(page.getByTestId('assessment-index')).toHaveText('17');
    await expect(page.getByLabel('评估结论')).toContainText('待定');
    await expect(page.getByLabel('使用深度指标')).toBeVisible();
    await expect(page.getByLabel('使用深度指标')).toContainText('30% → 90%');
    await expect(page.getByLabel('使用深度指标')).toContainText('样本 1');
    const shots: string[] = [];
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ['light', 'dark']) {
        await page.evaluate(t => { document.documentElement.dataset.theme = t; }, theme);
        await page.getByTestId('assessment-index').scrollIntoViewIfNeeded();
        const filename = join(directory, `assessment-${width}-${theme}.png`); await page.screenshot({ path: filename, animations: 'disabled' }); shots.push(filename);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight));
      }
    }
    await page.getByLabel('使用深度指标').getByRole('link', { name: '查看会话', exact: true }).first().click();
    await expect(page.getByLabel('对话阅读')).toContainText('公开画像核查这条原始请求。');
    await client.close(); client = undefined; await sandbox.restart();
    assert.deepEqual(await (await api(path + '?version=' + value.version)).json(), value); assert.deepEqual(errors, []);
    await writeFile(join(directory, 'browser-evidence.json'), JSON.stringify({ version: value.version, model: value.modelVersion, snapshotId, shots, errors }, null, 2));
  } finally { await client?.close(); await browser?.close(); await sandbox.close(); }
});
