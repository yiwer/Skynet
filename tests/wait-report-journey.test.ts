import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { chromium, expect, type Browser } from '@playwright/test';
import { mcpSandbox } from './mcp-support.js';
import { digest } from '../apps/server/database.js';
const params = (object: object) => new URLSearchParams(Object.entries(object).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]));

test('waiting statistics charts, keyboard tables and OAuth MCP preserve the exact recorded interval version', { timeout: 180000 }, async () => {
  const base = Date.now() + 60000;
  const sandbox = await mcpSandbox({ reportClock: () => new Date(base + 86400000) });
  let client: Client | undefined, browser: Browser | undefined;
  const directory = process.env.SKYNET_WAIT_REPORT_EVIDENCE_DIR ?? join(sandbox.directory, 'waits-evidence');
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
    const report = await (await api('/api/wait-report?' + params({...query,waitVersion:first.version}))).json();
    assert.equal(report.summary.medianMs,700000); assert.equal(report.summary.p90Ms,700000);
    assert.deepEqual(report.summary.longFraction,{numerator:26,denominator:26,value:1});
    assert.equal(report.summary.parallelFraction.numerator,1);
    const reportFixed={...query,version:report.version};
    assert.deepEqual(await(await api('/api/wait-report/export?'+params(reportFixed))).json(),report);
    const resource = sandbox.origin + '/mcp';
    const registration = await (await api('/oauth/register', json({ client_name: 'Waiting public reader', redirect_uris: ['http://127.0.0.1:47125/callback'], token_endpoint_auth_method: 'none' }))).json();
    const verifier = randomBytes(48).toString('base64url');
    const callback = new URL(await sandbox.authorizationPage(sandbox.origin + '/oauth/authorize?' + params({ response_type: 'code', client_id: registration.client_id,
      redirect_uri: registration.redirect_uris[0], scope: 'archive:read', resource, state: randomUUID(), code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url') }), employee.readerCredential));
    const token = await (await api('/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params({ grant_type: 'authorization_code',
      client_id: registration.client_id, code: callback.searchParams.get('code'), redirect_uri: registration.redirect_uris[0], code_verifier: verifier, resource }).toString() })).json();
    client = new Client({ name: 'waits-public', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(resource), { fetch: sandbox.fetchTls, requestInit: { headers: { Authorization: `Bearer ${token.access_token}` } } }));
    const response = await client.callTool({ name: 'read_wait_report', arguments: reportFixed });
    assert.notEqual(response.isError, true, JSON.stringify(response));
    assert.deepEqual(JSON.parse((response.content as { text: string }[])[0]!.text), report);
    await client.close(); client = undefined; await sandbox.restart();
    assert.deepEqual(await (await api('/api/waits?' + params(fixed))).json(), first);
    assert.deepEqual(await(await api('/api/wait-report?'+params(reportFixed))).json(),report);
    browser=await chromium.launch();const page=await browser.newPage({ignoreHTTPSErrors:true,viewport:{width:1280,height:900}});
    const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(sandbox.origin+'/#waits');await page.getByLabel('个人读取凭据').fill(employee.readerCredential);await page.getByRole('button',{name:'进入存档',exact:true}).click();
    await page.getByRole('button',{name:'接入至今',exact:true}).click();
    await expect(page.getByTestId('wait-report-median')).toHaveText('11 分 40 秒');await expect(page.getByTestId('wait-report-p90')).toHaveText('11 分 40 秒');
    await expect(page.getByTestId('wait-report-long')).toHaveText('100%');await expect(page.getByTestId('wait-report-parallel')).toHaveText('3.8%');
    await expect(page.getByTestId('wait-report-permission')).toHaveText('未知');
    const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'导出统计',exact:true}).click({timeout:5000})]);
    assert.deepEqual(JSON.parse(await readFile((await download.path())!,'utf8')),report);
    const heat=page.getByRole('region',{name:'星期与小时'}),people=page.getByRole('region',{name:'按人等待分布'});
    await heat.getByRole('button',{name:'热力图表格'}).focus();await page.keyboard.press('Enter');
    await expect(heat.getByRole('table',{name:'星期与小时等待中位数'})).toBeVisible();
    assert.equal(await heat.getByRole('table').locator('tbody tr').count(),168);
    await people.getByRole('button',{name:'人员分布表格'}).click();await expect(people.getByRole('table',{name:'按人等待分布'})).toContainText('等待公开旅程员工');
    await heat.getByRole('button',{name:'热力图图表'}).click();await people.getByRole('button',{name:'人员分布图表'}).click();
    await heat.getByRole('button',{name:/条等待/}).first().focus();await expect(heat.getByRole('status')).toContainText('11 分 40 秒');
    const screenshots:string[]=[];
    for(const width of [320,768,1280,1920]){await page.setViewportSize({width,height:900});
      if(width<1100)await expect.poll(()=>page.locator('.platform-rail').evaluate(el=>el.getBoundingClientRect().right)).toBeLessThanOrEqual(0);
      else await expect.poll(()=>page.locator('.platform-rail').evaluate(el=>el.getBoundingClientRect().left)).toBeGreaterThanOrEqual(0);
      await expect(page.getByTestId('wait-report-median')).toBeVisible();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight&&document.documentElement.scrollWidth<=innerWidth),true);
      for(const theme of ['light','dark']){await page.evaluate(value=>document.documentElement.dataset.theme=value,theme);const path=join(directory,'report-'+width+'-'+theme+'.png');await page.screenshot({path,animations:'disabled'});screenshots.push(path);}
    }
    await page.getByLabel('项目路径').fill('/synthetic/no-records');await page.getByRole('button',{name:'应用',exact:true}).click();
    await expect(page.getByTestId('wait-report-median')).toHaveText('未知');await expect(page.getByTestId('wait-report-long')).toHaveText('未知');
    await expect(people).toContainText('暂无等待分布');assert.deepEqual(errors,[]);
    await writeFile(join(directory,'browser-evidence.json'),JSON.stringify({version:report.version,waitVersion:report.waitVersion,summary:report.summary,screenshots,errors},null,2));
  }finally{await browser?.close();await client?.close();await sandbox.close();}
});
