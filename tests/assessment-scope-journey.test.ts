import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { chromium, expect, type Browser } from '@playwright/test';
import { assessmentFixture } from './assessment-fixture.js';
const params = (object: object) => new URLSearchParams(Object.entries(object).map(([key, value]) => [key, String(value)]));

test('Web and OAuth MCP select fixed assessment scopes, explain actual weights and reopen the same historical result', { timeout: 180_000 }, async () => {
  const sandbox = await assessmentFixture(), directory = process.env.SKYNET_ASSESSMENT_SCOPE_EVIDENCE_DIR ?? join(sandbox.directory, 'scope-evidence');
  let client: Client | undefined, browser: Browser | undefined;
  await mkdir(directory, { recursive: true });
  try {
    const owner = await sandbox.owner('周期与历史旅程');
    for (let i = 0; i < 3; i++) await sandbox.session(owner, { prompts: 3 });
    const path = '/api/assessments/' + owner.employeeId, standard = await (await sandbox.api(owner, path)).json();
    const quality = await (await sandbox.api(owner, path + '?period=since-enrollment&preset=' + encodeURIComponent('重质量'))).json();
    const currentWeek = await (await sandbox.api(owner, path + '?period=this-week')).json();
    const resource = sandbox.origin + '/mcp', registration = await (await sandbox.api(owner, '/oauth/register', { client_name: 'Scoped assessment', redirect_uris: ['http://127.0.0.1:47126/callback'], token_endpoint_auth_method: 'none' })).json();
    const verifier = randomBytes(48).toString('base64url');
    const callback = new URL(await sandbox.authorizationPage(sandbox.origin + '/oauth/authorize?' + params({ response_type: 'code', client_id: registration.client_id,
      redirect_uri: registration.redirect_uris[0], scope: 'archive:read', resource, state: randomUUID(), code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url') }), owner.readerCredential));
    const token = await (await sandbox.nativeApi('/oauth/token', owner.readerCredential, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params({ grant_type: 'authorization_code',
      client_id: registration.client_id, code: callback.searchParams.get('code'), redirect_uri: registration.redirect_uris[0], code_verifier: verifier, resource }).toString() })).json();
    client = new Client({ name: 'assessment-scope-public', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(resource), { fetch: sandbox.fetchTls, requestInit: { headers: { Authorization: `Bearer ${token.access_token}` } } }));
    const call = async (name: string, args: object) => { const response = await client!.callTool({ name, arguments: { employeeId: owner.employeeId, ...args } }); assert.notEqual(response.isError, true, JSON.stringify(response)); return JSON.parse((response.content as { text: string }[])[0]!.text); };
    assert.deepEqual(await call('read_assessment', { period: 'this-week' }), currentWeek);
    assert.deepEqual(await call('read_assessment', { period: 'since-enrollment', preset: '重质量', version: quality.version }), quality);
    assert.deepEqual(await call('list_assessment_history', { period: 'since-enrollment' }), await (await sandbox.api(owner, path + '/history?period=since-enrollment')).json());
    browser = await chromium.launch(); const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 } });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(sandbox.origin + '/#profile?employeeId=' + owner.employeeId);
    await page.getByLabel('个人读取凭据').fill(owner.readerCredential); await page.getByRole('button', { name: '进入存档', exact: true }).click();
    await expect(page.getByTestId('assessment-index')).toHaveText('73');
    await page.getByRole('group', { name: '评估周期' }).getByRole('button', { name: '本周', exact: true }).click();
    await expect(page.getByTestId('assessment-empty')).toHaveText('暂无会话');
    await expect(page.getByLabel('评估范围')).toContainText(currentWeek.period);
    await page.getByRole('group', { name: '评估周期' }).getByRole('button', { name: '上周', exact: true }).click();
    await expect(page.getByRole('group', { name: '评估周期' }).getByRole('button', { name: '上周', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('group', { name: '评估周期' }).getByRole('button', { name: '接入至今', exact: true }).click();
    await expect(page.getByTestId('assessment-index')).toHaveText('73');
    await page.getByRole('group', { name: '权重方案' }).getByRole('button', { name: '重质量', exact: true }).click();
    await expect(page.getByTestId('assessment-index')).toHaveText('75');
    await page.getByText('计算规则与版本', { exact: true }).click();
    await expect(page.getByRole('table', { name: '当前评估权重' }).getByRole('row', { name: '协作节奏 0% 0%' })).toBeVisible();
    await expect(page.getByRole('table', { name: '当前评估权重' }).getByRole('row', { name: '验证把关 30% 30%' })).toBeVisible();
    const download = page.waitForEvent('download'); await page.getByRole('button', { name: '导出评估', exact: true }).click();
    assert.deepEqual(JSON.parse(await readFile((await (await download).path())!, 'utf8')), quality);
    await page.getByText('计算规则与版本', { exact: true }).click();
    const shots: string[] = [];
    for (const width of [1280, 390, 320]) { await page.setViewportSize({ width, height: 900 });
      for (const theme of ['light', 'dark']) { await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
        await page.getByTestId('assessment-index').scrollIntoViewIfNeeded(); const filename = join(directory, `scope-${width}-${theme}.png`);
        await page.screenshot({ path: filename, animations: 'disabled' }); shots.push(filename);
        const targets=await page.locator('.assessment-controls button,.assessment-controls select,.assessment-history>summary').evaluateAll(nodes=>nodes.map(node=>{const box=node.getBoundingClientRect();return {text:node.textContent?.trim(),width:box.width,height:box.height};}));
        assert.ok(targets.every(box=>box.width>=44&&box.height>=44),JSON.stringify({width,theme,targets}));
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight));
      }
    }
    await page.getByText('历史评估', { exact: true }).click();
    const historyTargets=await page.locator('.assessment-history li>a').evaluateAll(nodes=>nodes.map(node=>{const box=node.getBoundingClientRect();return {width:box.width,height:box.height};}));assert.ok(historyTargets.every(box=>box.width>=44&&box.height>=44));
    await page.locator(`a[href*="version=${standard.version}"]`).click();
    await expect(page.getByTestId('assessment-index')).toHaveText('73'); await expect(page.getByLabel('评估范围')).toContainText('历史');
    const currentTarget=await page.getByRole('link',{name:'查看当前评估',exact:true}).boundingBox();assert.ok(currentTarget&&currentTarget.width>=44&&currentTarget.height>=44);
    await sandbox.session(owner, { prompts: 3 });
    await page.getByRole('button', { name: '刷新', exact: true }).click(); await expect(page.getByLabel('评估结论')).toContainText('3 个会话');
    assert.deepEqual(await call('read_assessment', { version: standard.version }), standard);
    await page.getByRole('link', { name: '查看当前评估', exact: true }).click(); await expect(page.getByLabel('评估结论')).toContainText('4 个会话');
    await page.getByText('计算规则与版本', { exact: true }).click(); await page.getByRole('table', { name: '当前评估权重' }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(directory, 'scope-method-320-dark.png'), animations: 'disabled' });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight));
    assert.deepEqual(errors, []); await writeFile(join(directory, 'browser-evidence.json'), JSON.stringify({ standard: standard.version, quality: quality.version, currentWeek: currentWeek.version, shots, errors }, null, 2));
  } finally { await client?.close(); await browser?.close(); await sandbox.close(); }
});
