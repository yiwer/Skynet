import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout} from 'node:timers/promises';
import {mcpSandbox} from './mcp-support.js';
import {analysisFixture} from './analysis-fixture.js';
import {stop} from './support.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {chromium,expect,type Browser} from '@playwright/test';
const json=(body:unknown):RequestInit=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
test('prompt report counts complete original-message denominators and pairs prior context with subsequent rework',{timeout:150000},async()=>{
  const sandbox=await mcpSandbox({reportClock:()=>new Date(Date.now()+86400000)});
  let output:any;const fixture=analysisFixture(()=>output,join(sandbox.directory,'forbidden'));fixture.server.listen(0,'127.0.0.1');await once(fixture.server,'listening');
  let child:ReturnType<typeof spawn>|undefined,log='',client:Client|undefined,browser:Browser|undefined;
  try{
    const owner=await sandbox.provision('甲合成员工'),peer=await sandbox.provision('乙合成员工');
    const config=join(sandbox.directory,'analysis-config.json');await writeFile(config,JSON.stringify({mode:'fixture',executable:process.env.SKYNET_CLAUDE_RUNTIME,runtimeVersion:'2.1.281',model:'claude-sonnet-4-5',workDirectory:join(sandbox.directory,'jobs'),fixtureOrigin:`http://127.0.0.1:${(fixture.server.address() as {port:number}).port}`,gitBashPath:process.env.SKYNET_GIT_BASH,budgetId:'prompts',budgetCny:0,inputCnyPerMillion:0,outputCnyPerMillion:0,maxRequests:6,maxOutputTokens:4096,maxAttempts:1,timeoutSeconds:30}));
    child=spawn(process.execPath,['dist/apps/analysis/worker.js'],{env:{...sandbox.env,SKYNET_ANALYSIS_CONFIG:config},stdio:['ignore','pipe','pipe'],windowsHide:true});child.stdout!.on('data',part=>{log+=part;});child.stderr!.on('data',part=>{log+=part;});
    for(let i=0;i<80&&!log.includes('worker ready');i++)await setTimeout(250);assert.match(log,/worker ready/);
    async function upload(person:typeof owner,texts:string[],context:(boolean|null)[],rework:(boolean|null)[],clarification:(boolean|null)[],task:string,suggestion:string){
      const device=await(await sandbox.api('/api/devices/enroll',person.enrollmentCredential,json({installationId:randomUUID(),name:'prompt-native'}))).json();
      const replies=texts.map((_,i)=>'回复'+i),events=texts.flatMap((text,i)=>[{role:'user',text},{role:'assistant',text:replies[i]}]);
      const bytes=Buffer.from(events.map(row=>JSON.stringify({timestamp:new Date(Date.now()+60000).toISOString(),type:'response_item',payload:{type:'message',role:row.role,content:[{type:row.role==='user'?'input_text':'output_text',text:row.text}]}})).join('\n')+'\n');
      await sandbox.api('/api/chunks/'+hash(bytes),device.deviceCredential,{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:bytes});
      const snapshot=await(await sandbox.api('/api/snapshots',device.deviceCredential,json({protocolVersion:1,sourceSessionId:randomUUID(),source:'codex-cli',sourceVersion:'0.160.0',sourceOs:'win32',project:'/synthetic/prompts',hash:hash(bytes),byteLength:bytes.length,qualifiedAt:new Date().toISOString(),capability:'unverified'}))).json();
      const cite=(event:number)=>({event,textOffset:0,quote:events[event]!.text});
      output={items:[{category:'goal',assessment:'claimed',text:texts[0],citations:[cite(0)]}],insights:{version:'session-insights-1',taskType:{value:task,citations:[cite(0)]},prompts:texts.map((_,i)=>({event:i*2,elements:{goal:true,constraints:true,context:context[i],acceptance:i!==0},rework:rework[i],citations:[cite(i*2)]})),replies:replies.map((_,i)=>({event:i*2+1,clarification:clarification[i],citations:[cite(i*2+1)]})),outcomes:[],suggestions:[{text:suggestion,citations:[cite(0)]}]}};
      const job=await(await sandbox.api(`/api/snapshots/${snapshot.snapshotId}/analysis`,person.readerCredential,json({}))).json();let run:any;
      for(let i=0;i<160;i++){run=await(await sandbox.api('/api/analysis/'+job.id,person.readerCredential)).json();if(['succeeded','failed'].includes(run.state))break;await setTimeout(250);}assert.equal(run.state,'succeeded',JSON.stringify({run,log}));
      return snapshot;
    }
    await upload(owner,['实现接口','不对🛰','验收'.repeat(10)],[true,false,false],[true,true,false],[true,false,false],'implementation','开始前补充缓存验收步骤。');
    await upload(peer,['核查','继续'],[null,true],[null,null],[false,null],'investigation','先写清需要核查的文件。');
    const response=await sandbox.api('/api/prompt-report?period=since-enrollment',owner.readerCredential);assert.equal(response.status,200);const report=await response.json();
    assert.equal(report.kpis.prompts,5);assert.equal(report.kpis.medianLength.value,3);
    assert.deepEqual(report.kpis.context,{numerator:2,denominator:4,unknown:1,value:.5});
    assert.deepEqual(report.kpis.rework,{numerator:1,denominator:2,unknown:1,value:.5});
    assert.deepEqual(report.kpis.cleanSessions,{numerator:0,denominator:1,unknown:1,value:0});
    assert.deepEqual(report.kpis.clarification,{numerator:1,denominator:4,unknown:1,value:.25});
    assert.deepEqual(report.contextComparison.withContext,{numerator:1,denominator:1,unknown:0,value:1});assert.deepEqual(report.contextComparison.withoutContext,{numerator:0,denominator:1,unknown:0,value:0});assert.equal(report.contextComparison.unknownPairs,1);
    assert.equal(report.lengths[0].count,4);assert.deepEqual(report.lengths[0].rework,{numerator:1,denominator:1,unknown:1,value:1});assert.equal(report.lengths[1].count,1);assert.equal(report.lengths[1].rework.value,0);
    assert.equal(report.employees.find((row:any)=>row.employeeId===owner.employeeId).taskMix.find((row:any)=>row.taskType==='implementation').prompts,3);
    assert.equal(report.examples.positive.length,1);assert.equal(report.examples.negative.length,1);assert.equal(report.examples.negative[0].citations[0].quote,'实现接口');assert.equal(report.examples.negative[0].followingCitations[0].quote,'不对🛰');
    assert.deepEqual(new Set(report.suggestions.map((row:any)=>row.text)),new Set(['开始前补充缓存验收步骤。','先写清需要核查的文件。']));
    for(const example of [...report.examples.positive,...report.examples.negative,...report.suggestions])for(const citation of example.citations){const url=`/api/snapshots/${citation.inputSnapshotId}/location?${new URLSearchParams(Object.entries(citation.inputLocation).filter(([,value])=>value!==undefined).map(([key,value])=>[key,String(value)]))}`;const raw=await(await sandbox.api(url,owner.readerCredential)).json();assert.ok(raw.events[0].text.startsWith(citation.quote));}
    assert.deepEqual(await(await sandbox.api('/api/prompt-report/export?period=since-enrollment&version='+report.version,owner.readerCredential)).json(),report);
    const full=await(await sandbox.api('/api/prompt-report/recompute',owner.readerCredential,json({period:'since-enrollment'}))).json();assert.deepEqual(full.kpis,report.kpis);assert.deepEqual(full.employees,report.employees);
    const registration=await(await sandbox.api('/oauth/register',undefined,json({client_name:'prompt-public',redirect_uris:['http://127.0.0.1:47123/callback'],token_endpoint_auth_method:'none'}))).json();
    const verifier=randomBytes(48).toString('base64url'),resource=sandbox.origin+'/mcp';
    const callback=new URL(await sandbox.authorizationPage(sandbox.origin+'/oauth/authorize?'+new URLSearchParams({response_type:'code',client_id:registration.client_id,redirect_uri:registration.redirect_uris[0],scope:'archive:read',resource,state:randomUUID(),code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url')}),owner.readerCredential));
    const token=await(await sandbox.api('/oauth/token',undefined,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:registration.client_id,code:callback.searchParams.get('code')!,redirect_uri:registration.redirect_uris[0],code_verifier:verifier,resource}).toString()})).json();
    client=new Client({name:'prompt-public',version:'1'});await client.connect(new StreamableHTTPClientTransport(new URL(resource),{fetch:sandbox.fetchTls,requestInit:{headers:{Authorization:'Bearer '+token.access_token}}}));
    const result=await client.callTool({name:'read_prompt_report',arguments:{period:'since-enrollment',version:report.version}});assert.notEqual(result.isError,true);assert.deepEqual(JSON.parse((result.content as {text:string}[])[0]!.text),report);
    browser=await chromium.launch({headless:true});const context=await browser.newContext(),page=await context.newPage();
    await context.route('**/*',async route=>{if(new URL(route.request().url()).origin!==sandbox.origin)return route.abort();const response=await sandbox.fetchTls(route.request().url(),{method:route.request().method(),headers:await route.request().allHeaders(),body:route.request().postData()});const headers:Record<string,string>={};response.headers.forEach((value,key)=>{headers[key]=value;});await route.fulfill({status:response.status,headers,body:Buffer.from(await response.arrayBuffer())});});
    await page.goto(sandbox.origin+'/#prompts');await page.getByLabel('个人读取凭据').fill(owner.readerCredential);await page.getByRole('button',{name:'进入存档',exact:true}).click();await page.getByRole('button',{name:'接入至今',exact:true}).click();
    const panel=page.getByRole('region',{name:'提示词分析',exact:true});await expect(panel.getByRole('heading',{name:'提示词要素覆盖',exact:true})).toBeVisible();
    await expect(panel.getByRole('heading',{name:'按长度分段的数量',exact:true})).toBeVisible();await expect(panel.getByRole('heading',{name:'按长度分段的返工率',exact:true})).toBeVisible();
    await expect(panel.getByText('开始前补充缓存验收步骤。',{exact:true})).toBeVisible();await expect(panel.getByText('相关不等于因果',{exact:true})).toBeVisible();
    await panel.getByRole('button',{name:'长度数量切换为表格',exact:true}).click();await expect(panel.getByRole('region',{name:'长度数量',exact:true}).getByRole('table')).toBeVisible();await panel.getByRole('button',{name:'长度数量切换为图表',exact:true}).click();
    const bar=panel.getByRole('region',{name:'长度数量',exact:true}).getByRole('button',{name:/≤15 字/});await bar.focus();await expect(panel.getByRole('tooltip')).toBeVisible();await page.keyboard.press('Escape');await expect(panel.getByRole('tooltip')).toHaveCount(0);
    assert.ok((await bar.boundingBox())!.height>=44,'interactive length bars have a 44px touch target');
    assert.ok((await panel.getByRole('region',{name:'提示词要素覆盖',exact:true}).getByRole('button',{name:/甲合成员工 · 目标/}).boundingBox())!.height>=44,'heat cells have a 44px touch target');
    for(const label of ['提示词要素覆盖','上下文与返工','长度返工率','任务类型构成']){await panel.getByRole('button',{name:label+'切换为表格',exact:true}).click();await expect(panel.getByRole('region',{name:label,exact:true}).getByRole('table')).toBeVisible();await panel.getByRole('button',{name:label+'切换为图表',exact:true}).click();}
    const task=panel.getByRole('region',{name:'任务类型构成',exact:true}).getByRole('button',{name:/甲合成员工 · 实现与修复/});await task.focus();await expect(panel.getByRole('tooltip')).toBeInViewport();await page.keyboard.press('Escape');await expect(panel.getByRole('tooltip')).toHaveCount(0);
    const taskTarget=(await task.boundingBox())!;assert.ok(taskTarget.height>=44&&taskTarget.width>=44,'task detail has a 44px touch target without changing segment proportions');
    const downloadEvent=page.waitForEvent('download');await panel.getByRole('button',{name:'导出当前版本',exact:true}).click();const download=await downloadEvent;assert.match(download.suggestedFilename(),/^skynet-prompts-[a-f0-9]{64}\.json$/);assert.deepEqual(JSON.parse(await readFile((await download.path())!,'utf8')),report);
    await panel.getByRole('combobox',{name:/^员工/}).selectOption(owner.employeeId);await expect(panel.getByRole('region',{name:'提示词要素覆盖',exact:true}).getByRole('row')).toHaveCount(2);await panel.getByRole('combobox',{name:/^员工/}).selectOption('');
    for(const width of [320,768,1280,1920])for(const theme of ['light','dark']){await page.setViewportSize({width,height:900});await page.evaluate(value=>document.documentElement.dataset.theme=value,theme);await panel.getByRole('heading',{name:'提示词分析',exact:true}).scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth||document.documentElement.scrollHeight>innerHeight),false,width+' '+theme);await page.screenshot({path:join(sandbox.directory,`prompts-${width}-${theme}.png`),animations:'disabled'});await panel.getByRole('heading',{name:'写法建议 模型推断',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:join(sandbox.directory,`prompts-bottom-${width}-${theme}.png`),animations:'disabled'});await panel.locator('.workspace-scroll').evaluate(element=>{element.scrollTop=0;});}
    await page.goto(sandbox.origin+'/#prompts?period=since-enrollment&version='+report.version);await expect(panel.getByText('开始前补充缓存验收步骤。',{exact:true})).toBeVisible();
    await writeFile(join(sandbox.directory,'prompt-report-model.json'),JSON.stringify(report,null,2));console.log('Prompt model evidence: '+sandbox.directory);
  }finally{await client?.close();await browser?.close();await stop(child);fixture.server.closeAllConnections();await new Promise<void>(resolve=>fixture.server.close(()=>resolve()));await sandbox.close();}
});
