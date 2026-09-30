import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID,randomBytes,createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { mcpSandbox } from './mcp-support.js';
import { chromium,type Browser } from '@playwright/test';
import { join } from 'node:path';
import { writeFile,access } from 'node:fs/promises';
import { backupHelper } from './backup-support.js';
import { createSandbox } from './support.js';
import { digest } from '../apps/server/database.js';
import { readAnalysisConfig,publicConfig } from '../apps/analysis/config.js';
import { analysisQueue } from '../apps/analysis/queue.js';
import { executeAnalysis } from '../apps/analysis/execute.js';
import { beijingDate } from '../packages/contracts/reports.js';
import { monday,addDays } from '../packages/contracts/work-views.js';

const json=(body:unknown):RequestInit=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
async function grantedReader(s:Awaited<ReturnType<typeof mcpSandbox>>,credential:string){
  const registered=await(await s.api('/oauth/register',undefined,json({client_name:'backup public reader',redirect_uris:['http://127.0.0.1:47123/callback'],token_endpoint_auth_method:'none'}))).json();
  const verifier=randomBytes(48).toString('base64url'),resource=s.origin+'/mcp';
  const parameters={response_type:'code',client_id:registered.client_id,redirect_uri:registered.redirect_uris[0],scope:'archive:read',resource,state:randomUUID(),code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url')};
  const callback=new URL(await s.authorizationPage(s.origin+'/oauth/authorize?'+new URLSearchParams(parameters),credential));
  const token=await(await s.api('/oauth/token',undefined,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:registered.client_id,code:callback.searchParams.get('code')!,redirect_uri:parameters.redirect_uri,code_verifier:verifier,resource}).toString()})).json();
  const client=new Client({name:'backup-reader-proof',version:'1'});await client.connect(new StreamableHTTPClientTransport(new URL(resource),{fetch:s.fetchTls,requestInit:{headers:{Authorization:`Bearer ${token.access_token}`}}}));return client;
}

test('fresh restore preserves authenticated Web/MCP fixed report history, quotes and complete exports',{timeout:360000},async()=>{
  const s=await mcpSandbox();let client:Client|undefined,browser:Browser|undefined;
  try{
    const employee=await s.provision('灾备平台合成读者');client=await grantedReader(s,employee.readerCredential);
    const called=await client.callTool({name:'read_server_operations',arguments:{}});assert.notEqual(called.isError,true);
    const result=JSON.parse((called.content as {text:string}[])[0]!.text),http=await(await s.api('/api/server/operations',employee.readerCredential)).json();
    for(const field of ['committedObjects','committedBytes','stagedObjects','automaticDeletion'])assert.equal(result.storage[field],http.storage[field]);
    for(const value of [result.storage,http.storage])for(const field of ['filesystemBytes','freeBytes']){assert.ok(value[field]===null||Number.isSafeInteger(value[field])&&value[field]>=0);if(value[field]===null)assert.ok(value.capacityError);}
    assert.equal(result.latestBackup,null);assert.equal(result.latestRestore,null);assert.equal(result.reception,'single-copy');
    browser=await chromium.launch({headless:true});const page=await browser.newPage({ignoreHTTPSErrors:true});await page.goto(s.origin);
    await page.getByLabel('个人读取凭据').fill(employee.readerCredential);await page.getByRole('button',{name:'进入存档',exact:true}).click();await page.getByRole('button',{name:'运行与备份',exact:true}).click();
    await page.getByText('尚无成功备份记录。',{exact:true}).waitFor();assert.equal(await page.getByRole('heading',{name:'原件容量',exact:true}).count(),1);assert.equal(await page.getByText('尚无恢复完整性校验记录。',{exact:true}).count(),1);assert.equal(await page.getByText('上传确认仅表示单副本接收。成功备份与恢复演练各自记录范围，原件不自动删除。',{exact:true}).count(),1);
    const screenshots:string[]=[];
    async function capture(page:import('@playwright/test').Page,state:string){for(const colorScheme of ['light','dark'] as const)for(const width of [320,1280]){
      await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),`${state}/${colorScheme}/${width} no horizontal overflow`);
      const name=`server-operations-${state}-${colorScheme}-${width}.png`;await page.screenshot({path:join(s.directory,name),fullPage:true});screenshots.push(name);
    }}
    await capture(page,'empty');
    await page.route('**/api/server/operations',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'合成故障：服务器容量状态暂不可读'})}));
    await page.getByRole('button',{name:'会话存档',exact:true}).click();await page.getByRole('button',{name:'运行与备份',exact:true}).click();await page.getByRole('alert').getByText('合成故障：服务器容量状态暂不可读',{exact:true}).waitFor();await capture(page,'error');
    await page.unroute('**/api/server/operations');await page.getByRole('button',{name:'会话存档',exact:true}).click();await page.getByRole('button',{name:'运行与备份',exact:true}).click();await page.getByText('尚无成功备份记录。',{exact:true}).waitFor();
    const api=(path:string,init:RequestInit={})=>s.api(path,employee.readerCredential,init);
    const device=await(await s.api('/api/devices/enroll',employee.enrollmentCredential,json({installationId:randomUUID(),name:'report backup source'}))).json();
    const sessionId=randomUUID(),timestamp=new Date(Date.now()+10).toISOString(),quote='灾备后这句原始目标与工具上下文保持逐字可查🛰';
    const bytes=Buffer.from([{timestamp,type:'session_meta',payload:{id:sessionId,cli_version:'0.157.1',source:'cli',cwd:'/synthetic/backup-report'}},
      {timestamp,type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:quote}]}},
      {timestamp,type:'response_item',payload:{type:'function_call_output',call_id:'synthetic-tool',output:'合成原工具结果：两项检查已记录'}},
      {type:'unknown_future_event',keep:'unknown exact raw bytes remain available'}].map(row=>JSON.stringify(row)).join('\n')+'\n');
    const binary=Buffer.from([0,255,17,128,0,10]),material={id:digest('backup reader binary'),hash:digest(binary),byteLength:binary.length,mediaType:'binary',role:'attachment',name:'files/backup-fixture.bin',placement:'portable'};
    for(const raw of [bytes,binary])assert.equal((await s.api(`/api/chunks/${digest(raw)}`,device.deviceCredential,{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:raw})).status,201);
    const ack=await(await s.api('/api/snapshots',device.deviceCredential,json({protocolVersion:1,sourceSessionId:sessionId,source:'codex-cli',sourceVersion:'0.157.1',sourceOs:'win32',project:'/synthetic/backup-report',hash:digest(bytes),byteLength:bytes.length,qualifiedAt:timestamp,capability:'unverified',capture:{generation:digest(sessionId),revision:1,change:'initial',materials:[material],lineage:[],compacted:false,partialLine:false,gaps:[{code:'missing',reference:'synthetic absent sidecar; never certify complete'}]}}))).json();
    const policy=join(s.directory,'backup-fixture-policy.json');await writeFile(policy,JSON.stringify({mode:'fixture',executable:process.execPath,runtimeVersion:'2.1.281',model:'synthetic-backup-report',workDirectory:join(s.directory,'no-native-runner'),fixtureOrigin:'http://127.0.0.1:9',budgetId:'backup-fixture',budgetCny:0,inputCnyPerMillion:0,outputCnyPerMillion:0,maxRequests:3,maxAttempts:1,autoAnalyzeUpdates:false}));
    const config=await readAnalysisConfig(policy),queue=analysisQueue(s.testDatabase,config,'backup-fixture-worker');await s.testDatabase.query('INSERT INTO analysis_workers(id,config) VALUES($1,$2)',['backup-fixture-worker',publicConfig(config)]);
    const date=beijingDate(),dailyPath=`/api/daily-reports/${employee.employeeId}/${date}`;assert.equal((await api(dailyPath,json({}))).status,202);
    let daily:any;
    for(let tick=0;tick<80;tick++){
      await s.testDatabase.query("UPDATE analysis_workers SET updated_at=now() WHERE id='backup-fixture-worker'");
      const job=await queue.claim();if(job){const output=await executeAnalysis(config,job.input,new AbortController().signal,()=>queue.allowForward(job),async(_config,input,_signal,beforeForward)=>{
        assert.equal(await beforeForward!(),true);const event=input.events.findIndex(item=>item.text===quote);assert.ok(event>=0);
        return {output:{items:[{category:'goal',assessment:'claimed',text:'合成目标，仅原句自述',citations:[{event,textOffset:0,quote}]},{category:'topic',assessment:'inferred',text:'合成主题关联，尚非独立核验',citations:[{event,textOffset:0,quote}]}]},usage:{requests:1,inputTokens:100,outputTokens:20,runtimeCostUsd:null,providerBilledCny:null}};
      });assert.equal(await queue.finish(job,output),true);}
      daily=await(await api(dailyPath)).json();if(daily.items?.length&& !daily.refreshPending)break;await new Promise(resolve=>setTimeout(resolve,200));
    }
    assert.ok(daily.items.length>0);assert.equal(daily.state,'partial');assert.equal(daily.coverage.fixture,true);
    const fixedStatistic=daily.coverage.workStatistics;assert.ok(fixedStatistic);
    assert.equal(fixedStatistic.employeeId,employee.employeeId);assert.equal(fixedStatistic.date,date);assert.ok(fixedStatistic.revision>0);assert.match(fixedStatistic.version,/^[a-f0-9]{64}$/);
    const statisticPath=`/api/work-statistics/${fixedStatistic.employeeId}?`+new URLSearchParams({date:fixedStatistic.date,revision:String(fixedStatistic.revision)});
    const sourceStatisticResponse=await api(statisticPath);assert.equal(sourceStatisticResponse.status,200);const sourceStatisticBody=await sourceStatisticResponse.text(),sourceStatistic=JSON.parse(sourceStatisticBody);
    assert.deepEqual({employeeId:sourceStatistic.employeeId,date:sourceStatistic.date,revision:sourceStatistic.revision,version:sourceStatistic.version},fixedStatistic);
    assert.equal(sourceStatistic.sourceInputsComplete,false,'unknown complete original format remains a gap before backup');
    assert.equal(sourceStatistic.nextOffset,null,'this small fixed statistic fits one complete page');
    const fixedPaths=[dailyPath+`?revision=${daily.revision}`];
    for(const parameters of [{kind:'weekly',subject:employee.employeeId,from:monday(date),to:addDays(monday(date),6)},{kind:'project',subject:'/synthetic/backup-report',from:date,to:date}]){
      const path='/api/work-view?'+new URLSearchParams(parameters);assert.equal((await api(path,json({}))).status,202);let view:any;
      for(let tick=0;tick<80;tick++){view=await(await api(path)).json();if(view.revision>0&&!view.refreshPending)break;await new Promise(resolve=>setTimeout(resolve,200));}
      assert.ok(view.revision>0);fixedPaths.push(path+`&revision=${view.revision}`);
    }
    const oldBodies=await Promise.all(fixedPaths.map(async path=>await(await api(path)).text()));
    // Week/project preparation may publish another daily version. Keep the
    // original fixed history above, but edit the current public revision.
    const currentResponse=await api(dailyPath);assert.equal(currentResponse.status,200);const current=await currentResponse.json();assert.ok(current.revision>=daily.revision);
    const correction=await api(dailyPath+'/corrections',json({requestId:randomUUID(),kind:'note',expectedRevision:current.revision,reason:'灾备合成说明：不增改活动或原件',note:'仅更正工作说明，保留原句与旧版本。'}));
    const corrected=await correction.json();assert.equal(correction.status,202,JSON.stringify({response:corrected,expectedRevision:current.revision}));assert.ok(corrected.revision>current.revision);fixedPaths.push(dailyPath+`?revision=${corrected.revision}`);oldBodies.push(await(await api(fixedPaths.at(-1)!)).text());
    const history=await(await api(dailyPath+'/corrections')).text(),detail=await(await api(`/api/snapshots/${ack.snapshotId}`)).json();
    assert.ok(detail.events.some((event:any)=>event.text===quote&&event.origin.employeeId===employee.employeeId));
    const exports=new Map<string,Buffer>();for(const format of ['raw','readable','recovery'])exports.set(format,Buffer.from(await(await api(`/api/snapshots/${ack.snapshotId}/${format}`)).arrayBuffer()));assert.deepEqual(exports.get('raw'),bytes);
    const helper=await backupHelper(s.directory),backupDirectory=join(s.directory,'backups');
    const barrier=`import{backupArchive}from'./dist/apps/server/server-backup.js';import{writeFile,access}from'node:fs/promises';import{setTimeout}from'node:timers/promises';let input='';process.stdin.setEncoding('utf8');for await(const part of process.stdin)input+=part;const options=JSON.parse(input);const result=await backupArchive(process.env.DATABASE_URL,options,{stage:async phase=>{if(phase!=='dump-completed')return;await writeFile('/backups/.owned-boundary-ready','dump-completed');for(let tick=0;tick<200;tick++){try{await access('/backups/.owned-boundary-release');return;}catch{}await setTimeout(100);}throw new Error('owned-boundary-timeout');}});console.log(JSON.stringify(result));`;
    const backing=helper.run({action:'backup',rawDirectory:'/data/raw',backupDirectory:'/backups',failureDomain:'same-host'},s.containerDatabaseUrl,[{source:s.env.RAW_DIRECTORY!,target:'/data/raw',readonly:true},{source:backupDirectory,target:'/backups'}],barrier);void backing.catch(()=>undefined);
    let ready=false;for(let tick=0;tick<100;tick++){try{await access(join(backupDirectory,'.owned-boundary-ready'));ready=true;break;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}assert.equal(ready,true,'backup reached dump-completed before ALL chunks enumeration');
    let outside:any;const outsideBytes=Buffer.from(JSON.stringify({timestamp:new Date().toISOString(),type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'边界之后的新原件不能混入较早SQL灾备'}]}})+'\n');
    try{assert.equal((await s.api(`/api/chunks/${digest(outsideBytes)}`,device.deviceCredential,{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:outsideBytes})).status,201);
      outside=await(await s.api('/api/snapshots',device.deviceCredential,json({protocolVersion:1,sourceSessionId:randomUUID(),source:'codex-cli',sourceVersion:'0.157.1',sourceOs:'win32',project:'/synthetic/outside-backup-boundary',hash:digest(outsideBytes),byteLength:outsideBytes.length,qualifiedAt:new Date().toISOString(),capability:'unverified'}))).json();assert.ok(outside.snapshotId);assert.deepEqual(Buffer.from(await(await api(`/api/snapshots/${outside.snapshotId}/raw`)).arrayBuffer()),outsideBytes);
    }finally{await writeFile(join(backupDirectory,'.owned-boundary-release'),'public-upload-completed');}
    const backup=JSON.parse(await backing);assert.equal(backup.receipt.objects,2);assert.equal(backup.receipt.bytes,bytes.length+binary.length);
    const bare=await createSandbox();let fresh:Awaited<ReturnType<typeof mcpSandbox>>|undefined,restoredClient:Client|undefined;
    try{
      const restored=JSON.parse(await helper.run({action:'restore',bundleDirectory:'/bundle',rawDirectory:'/data/raw'},bare.containerDatabaseUrl,[{source:join(backupDirectory,backup.receipt.id),target:'/bundle',readonly:true},{source:bare.env.RAW_DIRECTORY!,target:'/data/raw'}]));
      fresh=await mcpSandbox({sandbox:bare});const read=(path:string)=>fresh!.api(path,employee.readerCredential);
      assert.equal((await read(`/api/snapshots/${outside.snapshotId}`)).status,404,'source snapshot committed between SQL dump and raw enumeration stays outside restored SQL/raw boundary');
      const restoredInventory=(await(await read('/api/server/operations')).json()).storage;
      assert.equal(restoredInventory.committedObjects,backup.receipt.objects);assert.equal(restoredInventory.committedBytes,backup.receipt.bytes);assert.equal(restoredInventory.stagedObjects,0);
      const missingHash=await fresh.api('/api/snapshots',device.deviceCredential,json({protocolVersion:1,sourceSessionId:randomUUID(),source:'codex-cli',sourceVersion:'0.157.1',sourceOs:'win32',project:'/synthetic/outside-backup-boundary',hash:digest(outsideBytes),byteLength:outsideBytes.length,qualifiedAt:new Date().toISOString(),capability:'unverified'}));
      assert.equal(missingHash.status,409,'restored public snapshot cannot commit the later hash without upload');
      for(const [index,path]of fixedPaths.entries())assert.equal(await(await read(path)).text(),oldBodies[index],'full immutable report response exact after restore');
      const restoredStatisticResponse=await read(statisticPath);assert.equal(restoredStatisticResponse.status,200);assert.equal(await restoredStatisticResponse.text(),sourceStatisticBody,'report-bound fixed statistic page is byte-exact after restore');
      assert.equal(await(await read(dailyPath+'/corrections')).text(),history,'authenticated actor/reason/time and correction history exact');
      const currentDetail=await(await read(`/api/snapshots/${ack.snapshotId}`)).json();assert.deepEqual(currentDetail.events,detail.events);assert.deepEqual(currentDetail.manifest,detail.manifest);
      for(const [format,original]of exports)assert.deepEqual(Buffer.from(await(await read(`/api/snapshots/${ack.snapshotId}/${format}`)).arrayBuffer()),original,`complete ${format} export exact`);
      restoredClient=await grantedReader(fresh,employee.readerCredential);
      const tool=async(name:string,args:Record<string,unknown>)=>{const result=await restoredClient!.callTool({name,arguments:args});assert.notEqual(result.isError,true,JSON.stringify(result));return JSON.parse((result.content as{text:string}[])[0]!.text);};
      assert.deepEqual(await tool('read_daily_report',{employeeId:employee.employeeId,date,revision:daily.revision}),JSON.parse(oldBodies[0]!));
      assert.deepEqual(await tool('read_work_statistics',{employeeId:fixedStatistic.employeeId,date:fixedStatistic.date,revision:fixedStatistic.revision}),sourceStatistic,'OAuth MCP reads the same restored fixed statistic identity and final page');
      assert.deepEqual(await tool('read_report_corrections',{employeeId:employee.employeeId,date}),JSON.parse(history));
      const quoted=daily.items.flatMap((item:any)=>item.citations).find((citation:any)=>citation.quote===quote);assert.ok(quoted?.location);const located=await tool('read_location',{snapshotId:quoted.snapshotId,location:quoted.location});assert.ok(JSON.stringify(located).includes(quote));
      const operations=await tool('read_server_operations',{});assert.equal(operations.latestBackup.id,backup.receipt.id);assert.equal(operations.latestRestore.verification,'integrity-only');assert.equal(operations.reception,'single-copy');
      const targetPage=await browser.newPage({ignoreHTTPSErrors:true});await targetPage.goto(fresh.origin);await targetPage.getByLabel('个人读取凭据').fill(employee.readerCredential);await targetPage.getByRole('button',{name:'进入存档',exact:true}).click();await targetPage.getByRole('button',{name:'运行与备份',exact:true}).click();await targetPage.getByText('仅完整性校验；尚未验证原生续聊、异机重建和第二维护者操作。',{exact:true}).waitFor();assert.ok((await targetPage.getByRole('region',{name:'服务器运行与备份'}).innerText()).includes(backup.receipt.id));
      await capture(targetPage,'populated');
      await writeFile(join(s.directory,'backup-restored-readers-public.json'),JSON.stringify({receipt:backup.receipt,restored,snapshotId:ack.snapshotId,eventIds:detail.events.map((event:any)=>event.origin.eventId),fixedPaths,frozenBodiesExact:true,correctionsExact:true,correctionVersions:{originalFixed:daily.revision,submittedCurrent:current.revision,corrected:corrected.revision},fixedStatistic:{identity:fixedStatistic,path:statisticPath,sourceBodySha256:digest(sourceStatisticBody),sourceInputsComplete:sourceStatistic.sourceInputsComplete,nextOffset:sourceStatistic.nextOffset,httpExact:true,oauthMcpExact:true},exports:Array.from(exports,([format,bytes])=>({format,hash:digest(bytes),byteLength:bytes.length})),operations,outsideBoundary:{snapshotId:outside.snapshotId,sourceReadable:true,restoredStatus:404,restoredChunkAbsent:true},fixtureReportOnly:true,screenshots},null,2));console.log(`Server backup readers/report evidence: ${s.directory}`);
    }finally{await restoredClient?.close();if(fresh)await fresh.close();else await bare.close();}
  }finally{await browser?.close();await client?.close();await s.close();}
});
