import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { chromium, expect, type Browser } from '@playwright/test';
import { assessmentFixture } from './assessment-fixture.js';

test('all four employee groups share scoped assessments through keyboard cards, OAuth MCP and downloads', { timeout: 180000 }, async () => {
  const sandbox = await assessmentFixture(); let client: Client | undefined, browser: Browser | undefined;
  const directory = process.env.SKYNET_PEOPLE_EVIDENCE_DIR ?? join(sandbox.directory, 'people-evidence');
  await mkdir(directory, { recursive: true });
  try {
    const good = await sandbox.owner('Alpha'), medium = await sandbox.owner('Beta'), poor = await sandbox.owner('Gamma'), pending = await sandbox.owner('Delta');
    for (let i = 0; i < 5; i++) {
      await sandbox.session(good, { prompts: 5, verified: 1, claimed: 0, elements: 4 });
      await sandbox.session(medium, { prompts: 5, verified: 1, claimed: 1, elements: 0 });
      await sandbox.session(poor, { prompts: 5, verified: 0, claimed: 1, elements: 0, rework: true, long: true });
    }
    const api = (path: string, init: RequestInit = {}) => sandbox.nativeApi(path, good.readerCredential, init);
    const report = await (await api('/api/capability-people')).json();
    assert.deepEqual(report.groups.map((g: any) => [g.level, g.count]), [['较好', 1], ['一般', 1], ['需提升', 1], ['待定', 1]]);
    const json = (body: unknown) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const registration = await (await api('/oauth/register', json({ client_name: 'Employee overview', redirect_uris: ['http://127.0.0.1:47129/callback'], token_endpoint_auth_method: 'none' }))).json();
    const verifier = randomBytes(48).toString('base64url'), resource = sandbox.origin + '/mcp';
    const callback = new URL(await sandbox.authorizationPage(sandbox.origin + '/oauth/authorize?' + new URLSearchParams({ response_type: 'code', client_id: registration.client_id,
      redirect_uri: registration.redirect_uris[0], scope: 'archive:read', resource, state: randomUUID(), code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url') }), good.readerCredential));
    const token = await (await api('/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code',
      client_id: registration.client_id, code: callback.searchParams.get('code')!, redirect_uri: registration.redirect_uris[0], code_verifier: verifier, resource }).toString() })).json();
    client = new Client({ name: 'people-public', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(resource), { fetch: sandbox.fetchTls, requestInit: { headers: { Authorization: `Bearer ${token.access_token}` } } }));
    const mcp = await client.callTool({ name: 'list_capability', arguments: { version: report.version } });
    assert.notEqual(mcp.isError, true); assert.deepEqual(JSON.parse((mcp.content as { text: string }[])[0]!.text), report);
    browser = await chromium.launch(); const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 } });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(sandbox.origin + '/#people?version=' + report.version);
    await page.getByLabel('个人读取凭据').fill(good.readerCredential); await page.getByRole('button', { name: '进入存档', exact: true }).click();
    const panel = page.getByRole('region', { name: '员工一览', exact: true });
    await expect(panel.getByRole('heading', { name: '员工', exact: true })).toBeVisible();
    await expect(panel.getByRole('region', { name: '较好', exact: true })).toContainText('Alpha');
    await expect(panel.getByRole('region', { name: '一般', exact: true })).toContainText('Beta');
    await expect(panel.getByRole('region', { name: '需提升', exact: true })).toContainText('Gamma');
    await expect(panel.getByRole('region', { name: '待定', exact: true })).toContainText('Delta');
    const card = panel.getByRole('link', { name: 'Alpha：打开员工画像', exact: true });
    await card.focus(); await card.press('Enter');
    await expect(page.getByRole('heading', { name: 'Alpha', exact: true })).toBeVisible();
    await expect(page.getByTestId('assessment-index')).toHaveText(String(report.employees.find((p: any) => p.employeeId === good.employeeId).index));
    await page.goBack(); await expect(panel).toBeVisible();
    await panel.getByRole('button', { name: '员工表格', exact: true }).click();
    await expect(panel.getByRole('table', { name: '员工能力', exact: true })).toContainText('Delta');
    await panel.getByRole('button', { name: '员工卡片', exact: true }).click();
    const downloadPromise = page.waitForEvent('download'); await panel.getByRole('button', { name: '导出当前版本', exact: true }).click();
    assert.deepEqual(JSON.parse(await readFile((await (await downloadPromise).path())!, 'utf8')), report);
    await panel.getByRole('button', { name: '重质量', exact: true }).click();
    await expect(panel.getByRole('button', { name: '重质量', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const qualityResponse = await api('/api/capability-people?preset=' + encodeURIComponent('重质量'));
    assert.equal(qualityResponse.status, 200, await qualityResponse.clone().text());
    const quality = await qualityResponse.json();
    assert.notEqual(quality.version, report.version);
    for (const p of quality.employees) assert.deepEqual(p.dims, report.employees.find((old: any) => old.employeeId === p.employeeId).dims);
    await panel.getByRole('button', { name: '上周', exact: true }).click();
    await expect(panel).toContainText('暂无会话');
    await panel.getByRole('button', { name: '接入至今', exact: true }).click();
    await expect(panel.getByRole('link', { name: 'Alpha：打开员工画像', exact: true })).toBeVisible();
    await panel.getByRole('button', { name: '默认', exact: true }).click();
    await panel.getByText('评估方法与口径', { exact: true }).click();
    await expect(panel.getByRole('table', { name: '评估方法', exact: true })).toContainText('首条提示词要素覆盖');
    await panel.getByText('评估方法与口径', { exact: true }).click();
    for (const width of [320, 768, 1280, 1920]) for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width, height: 900 }); await page.evaluate(t => { document.documentElement.dataset.theme = t; }, theme);
      await panel.locator('.people-scroll').evaluate(el => { el.scrollTop = 0; });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight), false);
      assert.deepEqual(await panel.getByRole('button').evaluateAll(nodes => nodes.filter(node => { const r = node.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.width < 43.9 || r.height < 43.9); }).map(node => node.textContent)), []);
      await page.screenshot({ path: join(directory, `people-${width}-${theme}.png`), animations: 'disabled' });
    }
    assert.deepEqual(errors, []); await writeFile(join(directory, 'people-public.json'), JSON.stringify(report, null, 2));
    console.log('Employee overview evidence: ' + directory);
  } finally { await client?.close(); await browser?.close(); await sandbox.close(); }
});
