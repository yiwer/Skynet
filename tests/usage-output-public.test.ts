import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { mcpSandbox } from './mcp-support.js';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { analysisFixture } from './analysis-fixture.js';
import { stop } from './support.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { chromium, expect, type Browser } from '@playwright/test';
import {collectUsage} from './usage-pages-support.js';

const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
test('usage output exposes the same verified contributions over HTTP, OAuth MCP, export and keyboard-accessible charts', { timeout: 150000 }, async () => {
  const sandbox = await mcpSandbox({reportClock:()=>new Date(Date.now()+2*86400000)});
  const first = '实现缓存接口；保留旧接口。上下文是缓存服务；验收为三个测试通过。';
  const correction = '不对，请保留旧接口，重新实现缓存。';
  const quote = (event: number, text: string) => ({ event, textOffset: 0, quote: text });
  const output = { items: [{ category: 'goal', assessment: 'claimed', text: '实现缓存', citations: [quote(0, first)] }],
    insights: { version: 'session-insights-1', taskType: { value: 'implementation', citations: [quote(0, first)] },
      prompts: [{ event: 0, elements: { goal: true, constraints: true, context: true, acceptance: true }, rework: false, citations: [quote(0, first)] },
        { event: 2, elements: { goal: true, constraints: true, context: false, acceptance: false }, rework: true, citations: [quote(2, correction)] }],
      replies: [{ event: 1, clarification: true, citations: [quote(1, '需要兼容旧接口吗？')] }, { event: 9, clarification: false, citations: [quote(9, '已经上线。')] }],
      outcomes: [{ status: 'verified', text: '# tests 3\n# pass 2\n# fail 1', citations: [quote(6, '# tests 3\n# pass 2\n# fail 1')] },
        { status: 'verified', text: '已经上线。', citations: [quote(9, '已经上线。')] },
        { status:'claimed', text:'跨日合成结论', citations:[quote(0,first),quote(2,correction)] }],
      suggestions: [{ text: '在开始前确认旧接口兼容要求。', citations: [quote(0, first)] }] } };
  const fixture = analysisFixture(output, join(sandbox.directory, 'forbidden')); fixture.server.listen(0, '127.0.0.1'); await once(fixture.server, 'listening');
  let child: ReturnType<typeof spawn> | undefined; let log = '';let client:Client|undefined;let browser:Browser|undefined;
  try {
    const employee = await sandbox.provision('真实链合成洞察');
    const enrollment = await (await sandbox.api('/api/devices/enroll', employee.enrollmentCredential, json({ installationId: randomUUID(), name: 'insights' }))).json();
    const message = (role: string, text: string) => ({ type: 'response_item', payload: { type: 'message', role, content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }] } });
    const call = (name: string, args: string, id: string) => ({ type: 'response_item', payload: { type: 'function_call', name, arguments: args, call_id: id } });
    const result = (text: string, id: string) => ({ type: 'response_item', payload: { type: 'function_call_output', output: text, call_id: id } });
    const bytes = Buffer.from([message('user', first), message('assistant', '需要兼容旧接口吗？'), message('user', correction),
      { type: 'response_item', payload: { type: 'custom_tool_call', name: 'apply_patch', call_id: 'patch', input: '*** Begin Patch\n*** Update File: cache.ts\n@@\n-old\n+new\n+second\n*** End Patch' } },
      { type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'patch', output: 'Success. Updated the following files:\nM cache.ts' } },
      call('exec_command', JSON.stringify({ cmd: 'node --test cache.test.js' }), 'tests'), result('# tests 3\n# pass 2\n# fail 1', 'tests'),
      call('exec_command', JSON.stringify({ cmd: 'git commit -m "cache"' }), 'commit'), result('[main abcdef1] cache\n 1 file changed, 2 insertions(+), 1 deletion(-)', 'commit'), message('assistant', '已经上线。')].map((row,index) => JSON.stringify({...row,timestamp:new Date(Date.now()+(index===2?86400000:60000)).toISOString()})).join('\n') + '\n');
    await sandbox.api(`/api/chunks/${hash(bytes)}`, enrollment.deviceCredential, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes });
    const archived = await (await sandbox.api('/api/snapshots', enrollment.deviceCredential, json({ protocolVersion: 1, sourceSessionId: randomUUID(), source: 'codex-cli', sourceVersion: '0.160.0', sourceOs: 'win32', project: '/synthetic/insights', hash: hash(bytes), byteLength: bytes.length, qualifiedAt: new Date().toISOString(), capability: 'unverified' }))).json();
    const configPath = join(sandbox.directory, 'analysis-config.json');
    await writeFile(configPath, JSON.stringify({ mode: 'fixture', executable: process.env.SKYNET_CLAUDE_RUNTIME, runtimeVersion: '2.1.281', model: 'claude-sonnet-4-5', workDirectory: join(sandbox.directory, 'jobs'), fixtureOrigin: `http://127.0.0.1:${(fixture.server.address() as {port:number}).port}`, gitBashPath: process.env.SKYNET_GIT_BASH, budgetId: 'insights-synthetic', budgetCny: 0, inputCnyPerMillion: 0, outputCnyPerMillion: 0, maxRequests: 3, maxOutputTokens: 4096, maxAttempts: 1, timeoutSeconds: 30 }));
    child = spawn(process.execPath, ['dist/apps/analysis/worker.js'], { env: { ...sandbox.env, SKYNET_ANALYSIS_CONFIG: configPath }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    child.stdout!.on('data', part => { log += part; }); child.stderr!.on('data', part => { log += part; });
    for (let attempt = 0; attempt < 60 && !log.includes('worker ready'); attempt++) await setTimeout(250);
    assert.match(log, /worker ready/);
    const job = await (await sandbox.api(`/api/snapshots/${archived.snapshotId}/analysis`, employee.readerCredential, json({}))).json();
    let run: any;
    for (let attempt = 0; attempt < 160; attempt++) { run = await (await sandbox.api(`/api/analysis/${job.id}`, employee.readerCredential)).json(); if (['failed', 'succeeded'].includes(run.state)) break; await setTimeout(250); }
    await writeFile(join(sandbox.directory, 'insights-native-evidence.json'), JSON.stringify({ run, requests: fixture.requests, log }, null, 2));
    assert.equal(run.state, 'succeeded', sandbox.directory);
    const view = await (await sandbox.api(`/api/snapshots/${archived.snapshotId}/insights`, employee.readerCredential)).json();
    assert.equal(view.state, 'complete');
    assert.equal(view.inferences.taskType.value, 'implementation');
    assert.deepEqual(view.metrics, { verified: 1, claimed: 2, rework: 1, clarifications: 1 });
    assert.equal(view.analysisVersion.id, job.id);
    assert.equal(view.inferences.outcomes[1].status, 'claimed');
    assert.equal(view.inferences.outcomes[1].classificationAdjusted, true);
    for (const entry of view.inferences.prompts) for (const cite of entry.citations) {
      const exact = await (await sandbox.api(`/api/snapshots/${cite.inputSnapshotId}/location?${new URLSearchParams(Object.entries(cite.inputLocation).filter(([,value])=>value!==undefined).map(([key,value])=>[key,String(value)]))}`, employee.readerCredential)).json();
      assert.ok(exact.events[0].text.startsWith(cite.quote));
    }
    assert.equal(view.facts.codeChanges.value, 3);
    assert.equal(view.facts.tests.value, 3);
    assert.equal(view.facts.tests.passed, 2);
    assert.equal(view.facts.commits.value, 1);
    await sandbox.restart();
    assert.deepEqual(await (await sandbox.api(`/api/snapshots/${archived.snapshotId}/insights?analysisId=${job.id}`, employee.readerCredential)).json(), view);
    const registration=await(await sandbox.api('/oauth/register',undefined,json({client_name:'V2 insights',redirect_uris:['http://127.0.0.1:47123/callback'],token_endpoint_auth_method:'none'}))).json();
    const verifier=randomBytes(48).toString('base64url'),resource=`${sandbox.origin}/mcp`;
    const callback=new URL(await sandbox.authorizationPage(`${sandbox.origin}/oauth/authorize?${new URLSearchParams({response_type:'code',client_id:registration.client_id,redirect_uri:registration.redirect_uris[0],scope:'archive:read',resource,state:randomUUID(),code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url')})}`,employee.readerCredential));
    const token=await(await sandbox.api('/oauth/token',undefined,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:registration.client_id,code:callback.searchParams.get('code')!,redirect_uri:registration.redirect_uris[0],code_verifier:verifier,resource}).toString()})).json();
    client=new Client({name:'session-insights-public',version:'1'});
    await client.connect(new StreamableHTTPClientTransport(new URL(resource),{fetch:sandbox.fetchTls,requestInit:{headers:{Authorization:`Bearer ${token.access_token}`}}}));
    const response = await sandbox.api('/api/usage-output?period=since-enrollment', employee.readerCredential);
    assert.equal(response.status, 200); const report = await response.json();
    assert.deepEqual([report.outputs.verified.value, report.outputs.claimed.value, report.outputs.codeChanges.known, report.outputs.tests.passed, report.outputs.commits.known], [1,null,3,2,1]);
    assert.equal(report.outputs.claimed.known,1,'ambiguous multi-date outcomes retain the known eligible result without inventing ownership');
    const mcp = await client.callTool({name:'read_usage_output',arguments:{period:'since-enrollment',version:report.version}});
    assert.notEqual(mcp.isError,true);
    assert.deepEqual(JSON.parse((mcp.content as {text:string}[])[0]!.text),report);
    const complete=await collectUsage(report,async(section,offset)=>{
      const response=await sandbox.api('/api/usage-output?'+new URLSearchParams({period:'since-enrollment',version:report.version,section,offset:String(offset)}),employee.readerCredential);
      assert.equal(response.status,200);return response.json();
    });
    assert.deepEqual(await(await sandbox.api('/api/usage-output/export?period=since-enrollment&version='+report.version,employee.readerCredential)).json(),complete);
    const peer=await sandbox.provision('参照员工');
    const peerDevice=await(await sandbox.api('/api/devices/enroll',peer.enrollmentCredential,json({installationId:randomUUID(),name:'reference'}))).json();
    const peerBytes=Buffer.from(JSON.stringify({...message('user','另一个合成任务'),timestamp:new Date().toISOString()})+'\n');
    await sandbox.api('/api/chunks/'+hash(peerBytes),peerDevice.deviceCredential,{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:peerBytes});
    await sandbox.api('/api/snapshots',peerDevice.deviceCredential,json({protocolVersion:1,sourceSessionId:randomUUID(),source:'codex-desktop',sourceVersion:'unsupported-synthetic',sourceOs:'win32',project:'/synthetic/reference',hash:hash(peerBytes),byteLength:peerBytes.length,qualifiedAt:new Date().toISOString(),capability:'unverified'}));
    browser=await chromium.launch({headless:true});const context=await browser.newContext();const page=await context.newPage();
    const automaticExports:string[]=[];page.on('request',request=>{if(new URL(request.url()).pathname==='/api/usage-output/export')automaticExports.push(request.url());});
    await context.route('**/*',async route=>{
      if(new URL(route.request().url()).origin!==sandbox.origin)return route.abort();
      const response=await sandbox.fetchTls(route.request().url(),{method:route.request().method(),headers:await route.request().allHeaders(),body:route.request().postData()});
      const headers:Record<string,string>={};response.headers.forEach((value,key)=>{headers[key]=value;});
      await route.fulfill({status:response.status,headers,body:Buffer.from(await response.arrayBuffer())});
    });
    await page.goto(sandbox.origin+'/#usage'); await page.getByLabel('个人读取凭据').fill(employee.readerCredential); await page.getByRole('button',{name:'进入存档',exact:true}).click();
    await page.getByRole('button',{name:'接入至今',exact:true}).click();
    const panel=page.getByRole('region',{name:'用量指标',exact:true});
    await expect(panel.getByRole('heading',{name:'每人产出',exact:true})).toBeVisible();
    await expect(panel.getByRole('heading',{name:'会话：Token 与已验证结果',exact:true})).toBeVisible();
    await expect(panel.getByRole('heading',{name:'每日 Token 输入',exact:true})).toBeVisible();
    assert.deepEqual(automaticExports,[],'charts read fixed sections without automatic full export');
    const outputRow=panel.getByRole('region',{name:'每人产出',exact:true}).getByRole('row').filter({hasText:'真实链合成洞察'});
    await expect(outputRow).toContainText('+2 / −1'); await expect(outputRow).toContainText('2 / 3');
    await panel.getByRole('button',{name:'会话散点切换为表格',exact:true}).click();
    await expect(panel.getByRole('region',{name:'会话散点',exact:true}).getByRole('table')).toBeVisible();
    await panel.getByRole('button',{name:'会话散点切换为图表',exact:true}).click();
    const point=panel.getByRole('region',{name:'会话散点',exact:true}).getByRole('link').first();
    await point.focus(); await expect(point).toBeFocused(); await expect(panel.getByRole('tooltip')).toBeVisible();
    await page.keyboard.press('Escape'); await expect(panel.getByRole('tooltip')).toHaveCount(0);
    await panel.getByRole('combobox',{name:/^员工/}).selectOption(employee.employeeId);
    await expect(panel.getByRole('region',{name:'每人产出',exact:true}).getByRole('row')).toHaveCount(2);
    await expect(panel.getByRole('region',{name:'会话散点',exact:true}).locator('[data-reference="true"]')).toHaveCount(1);
    await panel.getByRole('combobox',{name:/^Agent/}).selectOption('claude-code-cli');
    await expect(panel.getByText('暂无用量',{exact:true})).toBeVisible();
    await panel.getByRole('combobox',{name:/^Agent/}).selectOption('');
    await expect(panel.getByRole('region',{name:'会话散点',exact:true}).locator('[data-reference="true"]')).toHaveCount(1);
    await panel.getByRole('combobox',{name:/^员工/}).selectOption('');
    await expect(panel.getByRole('region',{name:'每人产出',exact:true}).getByRole('row')).toHaveCount(3);
    for(const width of [320,768,1280,1920])for(const theme of ['light','dark']){
      await page.setViewportSize({width,height:900});await page.evaluate(value=>document.documentElement.dataset.theme=value,theme);
      await panel.getByRole('heading',{name:'用量与产出'}).scrollIntoViewIfNeeded();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth||document.documentElement.scrollHeight>innerHeight),false,width+' '+theme+' no outer scroll');
      await page.screenshot({path:join(sandbox.directory,'usage-'+width+'-'+theme+'.png'),animations:'disabled'});
    }
    await writeFile(join(sandbox.directory,'usage-output-public.json'),JSON.stringify(report,null,2));
    console.log('Usage output public evidence: '+sandbox.directory);
  } finally { await client?.close();await browser?.close();await stop(child); fixture.server.closeAllConnections(); await new Promise<void>(resolve => fixture.server.close(() => resolve())); await sandbox.close(); }
});
