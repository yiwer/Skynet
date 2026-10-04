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

test('the current employee assessment exposes the same evidence and fixed model through Web, OAuth MCP and export', { timeout: 180_000 }, async () => {
  const sandbox = await assessmentFixture();
  const directory = process.env.SKYNET_ASSESSMENT_EVIDENCE_DIR ?? join(sandbox.directory, 'assessment-evidence');
  let client: Client | undefined, browser: Browser | undefined;
  await mkdir(directory, { recursive: true });
  try {
    const employee = await sandbox.owner('画像公开旅程员工');
    const emptyEmployee = await sandbox.owner('暂无会话员工');
    const json = (value: object) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
    const api = (path: string, init: RequestInit = {}) => sandbox.nativeApi(path, employee.readerCredential, init);
    const first = await sandbox.session(employee, { prompts: 3 });
    for (let index = 0; index < 2; index++) await sandbox.session(employee, { prompts: 3 });
    const snapshotId = first.snapshotId;
    const path = '/api/assessments/' + employee.employeeId, value = await (await api(path)).json();
    assert.equal(value.index, 73); assert.equal(value.level, '待定');
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
    const remainingInputsResponse = await api(path + '?version=' + value.version + '&inputOffset=1');
    assert.equal(remainingInputsResponse.status, 200);
    const remainingInputs = await remainingInputsResponse.json();
    assert.deepEqual(remainingInputs.inputs.analysisVersions, value.inputs.analysisVersions.slice(1));
    assert.deepEqual(remainingInputs.inputs.insightVersions, value.inputs.insightVersions.slice(1));
    const mcpInputs = await client.callTool({ name: 'read_assessment', arguments: { employeeId: employee.employeeId, version: value.version, inputOffset: 1 } });
    assert.notEqual(mcpInputs.isError, true); assert.deepEqual(JSON.parse((mcpInputs.content as { text: string }[])[0]!.text), remainingInputs);
    browser = await chromium.launch(); const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(sandbox.origin + '/#profile?employeeId=' + employee.employeeId + '&version=' + value.version);
    await page.getByLabel('个人读取凭据').fill(employee.readerCredential); await page.getByRole('button', { name: '进入存档', exact: true }).click();
    await expect(page.getByRole('heading', { name: employee.name ?? '画像公开旅程员工', exact: true })).toBeVisible();
    await expect(page.getByTestId('assessment-index')).toHaveText('73');
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
    await page.getByText('计算规则与版本', { exact: true }).click();
    const modelDownload = page.waitForEvent('download'); await page.getByRole('button', { name: '导出模型参数', exact: true }).click();
    const downloaded = await modelDownload;
    assert.deepEqual(JSON.parse(await readFile((await downloaded.path())!, 'utf8')).presets['默认'], { adopt: 20, prompt: 20, iter: 20, verify: 20, output: 15, flow: 5 });
    const baselineDownload = page.waitForEvent('download'); await page.getByRole('button', { name: '导出基线', exact: true }).click();
    assert.equal(JSON.parse(await readFile((await (await baselineDownload).path())!, 'utf8')).tasks.implementation.sessions, 3);
    await page.getByRole('button', { name: '导出基线', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(directory, 'assessment-method-320-dark.png'), animations: 'disabled' });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight));
    await page.getByLabel('使用深度指标').getByRole('link', { name: '查看会话', exact: true }).first().click();
    await expect(page.getByLabel('对话阅读')).toContainText('请求 0 elements=3');
    await page.goto(sandbox.origin + '/#profile?employeeId=' + emptyEmployee.employeeId);
    await expect(page.getByTestId('assessment-empty')).toHaveText('暂无会话');
    await expect(page.getByTestId('assessment-index')).toHaveCount(0);
    await expect(page.getByLabel('使用深度指标')).toHaveCount(0);
    const many = await sandbox.owner('分页输入员工');
    for (let index = 0; index < 35; index++) { const record = sandbox.rows({ prompts: 1 }); await sandbox.upload(many, record.rows, record.sessionId); }
    const manyPath = '/api/assessments/' + many.employeeId, head = await (await api(manyPath)).json();
    assert.equal(head.inputPage.insightCount, 35); assert.equal(head.inputPage.nextOffset, 32); assert.equal(head.inputs.insightVersions.length, 32);
    assert.equal((await api(manyPath + '?inputOffset=32')).status, 400);
    const tail = await (await api(manyPath + '?version=' + head.version + '&inputOffset=32')).json();
    assert.equal(tail.inputPage.nextOffset, null); assert.equal(tail.inputs.insightVersions.length, 3);
    const allInputs = await (await api(manyPath + '/export?version=' + head.version)).json();
    assert.deepEqual([...head.inputs.insightVersions, ...tail.inputs.insightVersions], allInputs.inputs.insightVersions);
    const tailMcp = await client.callTool({ name: 'read_assessment', arguments: { employeeId: many.employeeId, version: head.version, inputOffset: 32 } });
    assert.notEqual(tailMcp.isError, true); assert.deepEqual(JSON.parse((tailMcp.content as { text: string }[])[0]!.text), tail);
    await client.close(); client = undefined; await sandbox.restart();
    assert.deepEqual(await (await api(path + '?version=' + value.version)).json(), value); assert.deepEqual(errors, []);
    await writeFile(join(directory, 'browser-evidence.json'), JSON.stringify({ version: value.version, model: value.modelVersion, snapshotId, shots, errors }, null, 2));
  } finally { await client?.close(); await browser?.close(); await sandbox.close(); }
});
