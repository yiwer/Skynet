import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
import { writeFile, readdir } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import { chromium, expect, type Browser } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { mcpSandbox } from './mcp-support.js';
import { analysisFixture } from './analysis-fixture.js';
import { stop } from './support.js';
import { connect, digest } from '../apps/server/database.js';
import { readAnalysisConfig, publicConfig } from '../apps/analysis/config.js';
import { analysisQueue } from '../apps/analysis/queue.js';
import { executeAnalysis } from '../apps/analysis/execute.js';
import type { AnalysisInput } from '../apps/server/analysis.js';
import type { AnalysisRun } from '../packages/contracts/analysis.js';

function selectedInput(body: any): AnalysisInput {
  for (const message of body.messages) for (const block of typeof message.content === 'string' ? [{text:message.content}] : message.content) {
    if (typeof block.text !== 'string') continue;
    const start = block.text.indexOf('{"warning":'); if (start < 0) continue;
    return JSON.parse(block.text.slice(start, block.text.lastIndexOf('}') + 1));
  }
  throw new Error('Missing isolated archived prompt');
}
function findings(input: AnalysisInput, fail = false) {
  if (fail && input.analysisContext?.phase === 'extract' && input.events.some(event => event.text.includes('FAIL_SEGMENT'))) {
    return {items:[{category:'outcome',assessment:'observed',text:'unvalidated',citations:[{event:999,textOffset:0,quote:'false'}]}]};
  }
  const markers = ['GOAL_ALPHA🛰', 'BEGIN_PROOF🛰', 'END_PROOF🛰'];
  const citations = input.events.flatMap((event,index) => markers.flatMap(quote => {
    const offset = event.text.indexOf(quote); return offset < 0 ? [] : [{event:index,textOffset:offset,quote}];
  })).slice(0,3);
  if (!citations.length) citations.push({event:0,textOffset:0,quote:input.events[0]!.text.slice(0,8)});
  return {items:[{category:'topic',assessment:'inferred',text:input.analysisContext?.phase === 'aggregate' ? '跨段目标与工具记录，仅为合成推断' : '合成原句提取',citations}]};
}
export async function longAnalysisPublic(native: boolean) {
  const runtime = process.env.SKYNET_CLAUDE_RUNTIME; if (native) assert.ok(runtime, 'Explicit installed Claude runtime; synthetic loopback, no paid calls');
  const sandbox = await mcpSandbox(); const db = connect(sandbox.env.DATABASE_URL!); let worker: ChildProcess | undefined; let browser: Browser | undefined; let client: Client | undefined;
  let failed = false; const fixture = analysisFixture((body: unknown) => findings(selectedInput(body),failed), join(sandbox.directory,'MUST_NOT_EXIST'));
  const jobs = join(sandbox.directory,'analysis-jobs'); const configPath = join(sandbox.directory,'analysis.json'); let workerLogs = ''; let workerErrors = '';
  try {
    fixture.server.listen(0,'127.0.0.1'); await once(fixture.server,'listening');
    const configJson = {mode:'fixture',executable:native?runtime:process.execPath,runtimeVersion:'2.1.281',model:'claude-sonnet-4-5',workDirectory:jobs,
      fixtureOrigin:`http://127.0.0.1:${(fixture.server.address() as {port:number}).port}`,budgetId:'long-synthetic',budgetCny:0,inputCnyPerMillion:0,outputCnyPerMillion:0,
      maxInputBytes:8192,maxSessionBytes:131072,maxSegments:8,maxRequests:20,maxOutputTokens:512,timeoutSeconds:90,maxAttempts:1,autoAnalyzeUpdates:false,
      ...(native && process.platform==='win32'?{gitBashPath:'C:/Program Files/Git/bin/bash.exe'}:{})};
    await writeFile(configPath,JSON.stringify(configJson)); const config = await readAnalysisConfig(configPath);
    const employee = await sandbox.provision('长会话原员工'); const reader = await sandbox.provision('长会话共享读者');
    const json = (value: unknown): RequestInit => ({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
    const enrollment = await (await sandbox.api('/api/devices/enroll',employee.enrollmentCredential,json({installationId:randomUUID(),name:'long fixture'}))).json();
    async function upload(failing: boolean, huge = false) {
      const sessionId = randomUUID();
      const text = 'BEGIN_PROOF🛰' + 'x'.repeat(huge?90000:18000) + (failing?'FAIL_SEGMENT':'') + 'END_PROOF🛰';
      const bytes = Buffer.from([
        {timestamp:'2026-09-28T01:02:03Z',type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'GOAL_ALPHA🛰'}]}},
        {timestamp:'2026-09-28T01:02:03Z',type:'response_item',payload:{type:'function_call_output',call_id:'result',output:text}},
        {timestamp:'2026-09-28T01:02:03Z',type:'response_item',payload:{type:'message',role:'assistant',content:[{type:'output_text',text:'声称交付，没有独立外部核验'}]}},
        {type:'unknown_future_event',text:'NOT_ANALYZED'},
      ].map(item=>JSON.stringify(item)).join('\n')+'\n{"unfinished":');
      const hash = digest(bytes); assert.equal((await sandbox.api(`/api/chunks/${hash}`,enrollment.deviceCredential,{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:bytes})).status,201);
      const result = await sandbox.api('/api/snapshots',enrollment.deviceCredential,json({protocolVersion:1,sourceSessionId:sessionId,source:'codex-cli',sourceVersion:'0.157.1',sourceOs:'win32',project:'/synthetic/long',hash,byteLength:bytes.length,qualifiedAt:new Date().toISOString(),capability:'unverified'}));
      assert.equal(result.status,200); return {...await result.json(),bytes};
    }
    if (native) {
      worker = spawn(process.execPath,['dist/apps/analysis/worker.js'],{env:{...sandbox.env,SKYNET_ANALYSIS_CONFIG:configPath},windowsHide:true,stdio:['ignore','pipe','pipe']});
      worker.stdout!.on('data',part=>{workerLogs+=part;}); worker.stderr!.on('data',part=>{workerErrors+=part;});
      for(let i=0;i<60&&!workerLogs.includes('worker ready')&&worker.exitCode===null;i++) await setTimeout(500);
      assert.match(workerLogs,/worker ready/,workerErrors);
    } else await db.query('INSERT INTO analysis_workers(id,config) VALUES($1,$2)',['long-test',publicConfig(config)]);
    const queue = analysisQueue(db,config,'long-test');
    async function analyze(archived: {snapshotId:string}, failing=false) {
      failed=failing;
      if (!native) await db.query("UPDATE analysis_workers SET updated_at=now() WHERE id='long-test'");
      const request = await sandbox.api(`/api/snapshots/${archived.snapshotId}/analysis`,reader.readerCredential,json({})); assert.equal(request.status,202);
      const job = await request.json();
      if (!native) {
        const claim = await queue.claim(); assert.equal(claim!.id,job.id);
        const result = await executeAnalysis(config,claim!.input,new AbortController().signal,()=>queue.allowForward(claim!),async (_config,input,_signal,forward)=>{
          assert.equal(await forward!(),true); return {output:findings(input,failing),usage:{inputTokens:100,outputTokens:20,runtimeCostUsd:null,providerBilledCny:null,requests:1}};
        });
        assert.equal(await queue.finish(claim!,result),true);
      }
      for(let i=0;i<200;i++) {
        const run: AnalysisRun = await (await sandbox.api(`/api/analysis/${job.id}`,reader.readerCredential)).json();
        if (['succeeded','failed'].includes(run.state)) { assert.equal(run.state,'succeeded',`${sandbox.directory};${workerErrors};${JSON.stringify(run)}`); return run; }
        await setTimeout(500);
      }
      throw new Error('Long job did not finish');
    }
    const archived = await upload(false); const run = await analyze(archived);
    assert.equal(run.result!.processing!.complete,true); assert.equal(run.result!.processing!.aggregation,'succeeded'); assert.ok(run.result!.processing!.ranges.length>=3);
    assert.deepEqual(run.result!.items[0]!.citations.map(c=>c.quote),['GOAL_ALPHA🛰','BEGIN_PROOF🛰','END_PROOF🛰']);
    assert.equal(run.input.coverage.unrecognizedLines,1); assert.equal(run.input.coverage.partialLine,true);
    for(const citation of run.result!.items.flatMap(item=>item.citations)) {
      assert.equal(citation.origin!.employeeId,employee.employeeId); assert.equal(citation.context,'historical');
      const params=new URLSearchParams(Object.entries(citation.inputLocation).filter(([,v])=>v!==undefined).map(([k,v])=>[k,String(v)]));
      const location=await(await sandbox.api(`/api/snapshots/${citation.inputSnapshotId}/location?${params}`,reader.readerCredential)).json(); assert.ok(location.events[0].text.startsWith(citation.quote));
    }
    const partial = await analyze(await upload(true),true); assert.equal(partial.result!.processing!.complete,false); assert.ok(partial.result!.processing!.ranges.some(r=>r.state==='failed')); assert.equal(partial.result!.usage.inputTokens,null);
    const truncated = await analyze(await upload(false,true)); assert.equal(truncated.result!.processing!.complete,false); assert.ok(truncated.result!.processing!.ranges.some(r=>r.state==='skipped'));
    assert.ok([run,partial,truncated].every(value=>value.result!.usage.requests<=config.maxRequests && value.attemptHistory[0]!.requests===value.result!.usage.requests));
    await sandbox.restart(); assert.deepEqual(await(await sandbox.api(`/api/analysis/${run.id}`,reader.readerCredential)).json(),run);
    const registration=await(await sandbox.api('/oauth/register',undefined,json({client_name:'long evidence',redirect_uris:['http://127.0.0.1:47123/callback'],token_endpoint_auth_method:'none'}))).json();
    const verifier=randomBytes(48).toString('base64url');const resource=`${sandbox.origin}/mcp`;
    const callback=new URL(await sandbox.authorizationPage(`${sandbox.origin}/oauth/authorize?${new URLSearchParams({response_type:'code',client_id:registration.client_id,redirect_uri:registration.redirect_uris[0],scope:'archive:read',resource,state:randomUUID(),code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url')})}`,reader.readerCredential));
    const token=await(await sandbox.api('/oauth/token',undefined,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:registration.client_id,code:callback.searchParams.get('code')!,redirect_uri:registration.redirect_uris[0],code_verifier:verifier,resource}).toString()})).json();
    client=new Client({name:'long-test',version:'1'});await client.connect(new StreamableHTTPClientTransport(new URL(resource),{fetch:sandbox.fetchTls,requestInit:{headers:{Authorization:`Bearer ${token.access_token}`}}}));
    const mcp=await client.callTool({name:'read_analysis',arguments:{snapshotId:archived.snapshotId}});assert.notEqual(mcp.isError,true);assert.deepEqual(JSON.parse((mcp.content as {text:string}[])[0]!.text),await(await sandbox.api(`/api/snapshots/${archived.snapshotId}/analysis`,reader.readerCredential)).json());
    browser=await chromium.launch();const context=await browser.newContext();const page=await context.newPage();await context.route('**/*',async route=>{if(new URL(route.request().url()).origin!==sandbox.origin)return route.abort();const response=await sandbox.fetchTls(route.request().url(),{method:route.request().method(),headers:await route.request().allHeaders(),body:route.request().postData()});const headers:Record<string,string>={};response.headers.forEach((v,k)=>{headers[k]=v;});await route.fulfill({status:response.status,headers,body:Buffer.from(await response.arrayBuffer())});});
    await page.goto(`${sandbox.origin}/#${archived.snapshotId}`);await page.getByLabel('个人读取凭据').fill(reader.readerCredential);await page.getByRole('button',{name:'进入存档',exact:true}).click();
    const panel=page.getByRole('region',{name:'会话分析',exact:true});await expect(panel.getByLabel('分析处理范围')).toContainText('已完成提取');
    await panel.getByRole('link',{name:'查看原句 · 第 2 行',exact:true}).last().click();await expect(page.getByRole('region',{name:'命中证据',exact:true})).toContainText('END_PROOF🛰');
    await page.goto(`${sandbox.origin}/#${partial.snapshotId}`);await expect(page.getByRole('region',{name:'会话分析',exact:true})).toContainText('部分处理，不能视为完整会话分析');
    assert.deepEqual(Buffer.from(await(await sandbox.api(`/api/snapshots/${archived.snapshotId}/raw`,reader.readerCredential)).arrayBuffer()),archived.bytes);
    if(native) {assert.ok(fixture.requests.length>3);assert.deepEqual(await readdir(jobs),[]);}
    await writeFile(join(sandbox.directory,'analysis-long-evidence.json'),JSON.stringify({native,run,partial,truncated,workerLogs,workerErrors,requests:fixture.requests.length,provider:'synthetic loopback, no Qwen calls',originalBytesUnchanged:true},null,2));
    console.log(`Long analysis evidence: ${sandbox.directory}`);
  } finally {await client?.close();await browser?.close();await stop(worker);fixture.server.closeAllConnections();if(fixture.server.listening)await new Promise<void>(r=>fixture.server.close(()=>r()));await db.end();await sandbox.close();}
}
