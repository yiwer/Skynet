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
import { readAnalysisConfig,publicConfig } from '../apps/analysis/config.js';
import { analysisQueue } from '../apps/analysis/queue.js';
import { executeAnalysis } from '../apps/analysis/execute.js';

const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
test('session insights preserve unavailable analysis and inspect recorded outcomes through the public archive', { timeout: 90000 }, async () => {
  const sandbox = await mcpSandbox();
  try {
    const employee = await sandbox.provision('洞察合成员工');
    const enrollment = await (await sandbox.api('/api/devices/enroll', employee.enrollmentCredential, json({ installationId: randomUUID(), name: 'insights' }))).json();
    const bytes = Buffer.from(JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '请实现一个可验证的改动。' }] } }) + '\n');
    await sandbox.api(`/api/chunks/${hash(bytes)}`, enrollment.deviceCredential, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes });
    const archived = await (await sandbox.api('/api/snapshots', enrollment.deviceCredential, json({ protocolVersion: 1, sourceSessionId: randomUUID(), source: 'codex-cli', sourceVersion: '0.160.0', sourceOs: 'win32', project: '/synthetic/insights', hash: hash(bytes), byteLength: bytes.length, qualifiedAt: new Date().toISOString(), capability: 'unverified' }))).json();
    const path = `/api/snapshots/${archived.snapshotId}/insights`;
    assert.equal((await sandbox.api(path)).status, 401);
    const response = await sandbox.api(path, employee.readerCredential);
    assert.equal(response.status, 200);
    const view = await response.json();
    assert.equal(view.state, 'unavailable');
    assert.equal(view.analysisVersion, null);
    assert.equal(view.metrics.verified, null);
    assert.equal(view.metrics.rework, null);
    assert.equal(view.facts.codeChanges.value, null);
    assert.equal(view.facts.tests.value, null);
    assert.equal(view.facts.commits.value, null);
    assert.equal(view.input.hash, hash(bytes));
    const other=await(await sandbox.api('/api/snapshots',enrollment.deviceCredential,json({protocolVersion:1,sourceSessionId:randomUUID(),source:'codex-cli',sourceVersion:'0.160.0',sourceOs:'win32',project:'/synthetic/other',hash:hash(bytes),byteLength:bytes.length,qualifiedAt:new Date().toISOString(),capability:'unverified'}))).json();
    const otherView=await(await sandbox.api(`/api/snapshots/${other.snapshotId}/insights`,employee.readerCredential)).json();
    assert.equal(otherView.snapshotId,other.snapshotId);
    assert.notEqual(otherView.version,view.version,'identical bytes in separate sessions cannot share an insight scope');
    const emptyId=randomUUID(),emptyBytes=Buffer.from(JSON.stringify({type:'session_meta',payload:{id:emptyId}})+'\n');
    await sandbox.api(`/api/chunks/${hash(emptyBytes)}`,enrollment.deviceCredential,{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:emptyBytes});
    const empty=await(await sandbox.api('/api/snapshots',enrollment.deviceCredential,json({protocolVersion:1,sourceSessionId:emptyId,source:'codex-cli',sourceVersion:'0.160.0',sourceOs:'win32',project:'/synthetic/empty',hash:hash(emptyBytes),byteLength:emptyBytes.length,qualifiedAt:new Date().toISOString(),capability:'unverified'}))).json();
    const emptyResponse=await sandbox.api(`/api/snapshots/${empty.snapshotId}/insights`,employee.readerCredential);assert.equal(emptyResponse.status,200);assert.equal((await emptyResponse.json()).facts.tests.value,null);
    assert.deepEqual(Buffer.from(await (await sandbox.api(`/api/snapshots/${archived.snapshotId}/raw`, employee.readerCredential)).arrayBuffer()), bytes);
  } finally { await sandbox.close(); }
});

test('recorded output distinguishes known zero, native summaries, missing evidence and historical context', {timeout:90000},async()=>{
  const sandbox=await mcpSandbox();
  try{
    const employee=await sandbox.provision('原件产出范围');
    const enrollment=await(await sandbox.api('/api/devices/enroll',employee.enrollmentCredential,json({installationId:randomUUID(),name:'facts'}))).json();
    const timestamp=new Date().toISOString();
    const user=(text:string)=>({type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text}]}});
    const call=(cmd:string)=>({type:'response_item',payload:{type:'function_call',name:'exec_command',call_id:'one',arguments:JSON.stringify({cmd})}});
    const result=(output:string)=>({type:'response_item',payload:{type:'function_call_output',call_id:'one',output}});
    async function inspect(rows:unknown[],at=timestamp){const bytes=Buffer.from(rows.map(row=>JSON.stringify({...(row as object),timestamp:at})).join('\n')+'\n');await sandbox.api(`/api/chunks/${hash(bytes)}`,enrollment.deviceCredential,{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:bytes});const archived=await(await sandbox.api('/api/snapshots',enrollment.deviceCredential,json({protocolVersion:1,sourceSessionId:randomUUID(),source:'codex-cli',sourceVersion:'0.160.0',sourceOs:'win32',project:'/synthetic/facts',hash:hash(bytes),byteLength:bytes.length,qualifiedAt:timestamp,capability:'unverified'}))).json();const response=await sandbox.api(`/api/snapshots/${archived.snapshotId}/insights`,employee.readerCredential);assert.equal(response.status,200);return(await response.json()).facts;}
    const empty=await inspect([user('请阅读这条消息。')]);
    assert.deepEqual(Object.values(empty).map((fact:any)=>[fact.value,fact.complete]),[[0,true],[0,true],[0,true]]);
    const formats=[['npx jest','Tests:       1 failed, 2 passed, 3 total'],['npx vitest run','      Tests  2 passed | 1 failed (3)'],['pytest tests/','================ 2 passed, 1 failed in 0.43s ================']];
    for(const [cmd,text]of formats){const facts=await inspect([user('检查测试'),call(cmd!),result(text!)]);assert.equal(facts.tests.value,3,cmd);assert.equal(facts.tests.passed,2,cmd);assert.equal(facts.tests.failed,1,cmd);assert.equal(facts.tests.complete,true,cmd);assert.equal(facts.tests.contributions.length,1);assert.equal(facts.tests.contributions[0].employeeId,employee.employeeId);}
    const missing=await inspect([user('运行测试'),call('node --test check.js')]);assert.equal(missing.tests.value,null);assert.equal(missing.tests.complete,false);
    const prose=await inspect([user('已经有 3 tests passed'),call('node --test check.js'),result('The agent said 3 tests passed')]);assert.equal(prose.tests.value,null);
    const reversed=await inspect([user('检查'),result('# tests 3\n# pass 3\n# fail 0'),call('node --test check.js')]);assert.equal(reversed.tests.value,null,'a result preceding the request is not its completion');
    const multiple=await inspect([user('检查'),call('node --test check.js'),result('# tests 3\n# pass 3\n# fail 0\n# tests 2\n# pass 2\n# fail 0')]);assert.equal(multiple.tests.value,null,'ambiguous repeated summaries cannot silently count only the first');
    const custom=await inspect([user('检查'),{type:'response_item',payload:{type:'function_call',name:'custom_unknown',call_id:'one',arguments:JSON.stringify({cmd:'node --test check.js'})}},result('# tests 3\n# pass 3\n# fail 0')]);assert.equal(custom.tests.value,null,'an unknown tool argument is not an executed shell command');
    const old=await inspect([user('运行测试'),call('node --test old.js'),result('# tests 3\n# pass 3\n# fail 0')],'2020-01-01T00:00:00.000Z');assert.equal(old.tests.value,0);assert.equal(old.tests.contributions.length,0);
  }finally{await sandbox.close();}
});

test('bounded inference segments keep every prompt, original offsets and immutable older versions', {timeout:90000},async()=>{
  const sandbox=await mcpSandbox();
  try{
    const employee=await sandbox.provision('分段洞察');
    const enrollment=await(await sandbox.api('/api/devices/enroll',employee.enrollmentCredential,json({installationId:randomUUID(),name:'segments'}))).json();
    const sessionId=randomUUID();
    const message=(role:string,text:string)=>({type:'response_item',payload:{type:'message',role,content:[{type:role==='user'?'input_text':'output_text',text}]}});
    const rows=[message('user','请实现缓存，并通过测试。'),{type:'response_item',payload:{type:'function_call_output',call_id:'long',output:'记录🛰'.repeat(4000)}},message('assistant','需要保留原来的接口吗？'),message('user','不对，需要保留旧接口。'),message('assistant','我会保留旧接口。')];
    async function upload(selected:unknown[]){const bytes=Buffer.from(selected.map(row=>JSON.stringify(row)).join('\n')+'\n');await sandbox.api(`/api/chunks/${hash(bytes)}`,enrollment.deviceCredential,{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:bytes});const result=await sandbox.api('/api/snapshots',enrollment.deviceCredential,json({protocolVersion:1,sourceSessionId:sessionId,source:'codex-cli',sourceVersion:'0.160.0',sourceOs:'win32',project:'/synthetic/segments',hash:hash(bytes),byteLength:bytes.length,qualifiedAt:new Date().toISOString(),capability:'unverified'}));assert.equal(result.status,200);return{...await result.json(),bytes};}
    const archived=await upload(rows),path=join(sandbox.directory,'config.json');
    await writeFile(path,JSON.stringify({mode:'fixture',executable:process.execPath,runtimeVersion:'2.1.281',model:'deterministic',workDirectory:join(sandbox.directory,'jobs'),fixtureOrigin:'http://127.0.0.1:12345',budgetId:'segments',budgetCny:0,inputCnyPerMillion:0,outputCnyPerMillion:0,maxInputBytes:8192,maxSessionBytes:131072,maxSegments:16,maxRequests:32,maxAttempts:1,timeoutSeconds:90}));
    const config=await readAnalysisConfig(path);
    await sandbox.testDatabase.query('INSERT INTO analysis_workers(id,config) VALUES($1,$2)',['deterministic-boundary',publicConfig(config)]);
    const job=await(await sandbox.api(`/api/snapshots/${archived.snapshotId}/analysis`,employee.readerCredential,json({}))).json();
    const queue=analysisQueue(sandbox.testDatabase,config,'deterministic-boundary');const claim=await queue.claim();assert.equal(claim!.id,job.id);
    const result=await executeAnalysis(config,claim!.input,new AbortController().signal,()=>queue.allowForward(claim!),async(_config,input,_signal,forward)=>{
      assert.equal(await forward!(),true);
      const cite=(event:number)=>({event,textOffset:0,quote:input.events[event]!.text.slice(0,128)});
      const items=[{category:'topic',assessment:'inferred',text:'缓存实现',citations:[cite(0)]}];
      return{usage:{inputTokens:100,outputTokens:20,runtimeCostUsd:null,providerBilledCny:null,requests:1},output:input.analysisContext?.phase==='aggregate'?{items}:{items,insights:{version:'session-insights-1',taskType:{value:'implementation',citations:[cite(0)]},prompts:input.events.flatMap((event,index)=>event.role==='user'?[{event:index,elements:{goal:true,constraints:true,context:false,acceptance:event.text.includes('测试')},rework:event.text.startsWith('不对'),citations:[cite(index)]}]:[]),replies:input.events.flatMap((event,index)=>event.role==='assistant'?[{event:index,clarification:event.text.includes('吗'),citations:[cite(index)]}]:[]),outcomes:[],suggestions:[]}}};
    });
    assert.equal(await queue.finish(claim!,result),true);
    const view=await(await sandbox.api(`/api/snapshots/${archived.snapshotId}/insights`,employee.readerCredential)).json();
    assert.equal(view.state,'complete');
    assert.equal(view.inferences.prompts.length,2);
    assert.deepEqual(view.inferences.prompts.map((prompt:any)=>prompt.event),[0,3]);
    assert.deepEqual(view.metrics,{verified:0,claimed:0,rework:1,clarifications:1});
    const newer=await upload([...rows,message('user','新增下一轮工作。')]);
    const latest=await(await sandbox.api(`/api/snapshots/${newer.snapshotId}/insights`,employee.readerCredential)).json();
    assert.equal(latest.state,'unavailable');assert.equal(latest.metrics.rework,null);
    const fixed=await(await sandbox.api(`/api/snapshots/${archived.snapshotId}/insights?version=${view.version}`,employee.readerCredential)).json();
    assert.deepEqual(fixed,view);
    assert.deepEqual(Buffer.from(await(await sandbox.api(`/api/snapshots/${archived.snapshotId}/raw`,employee.readerCredential)).arrayBuffer()),archived.bytes);
    console.log(`Segment insights evidence: ${sandbox.directory}`);
  }finally{await sandbox.close();}
});

test('public analysis rejects fabricated evidence and keeps partial or late inferences out of current metrics', {timeout:90000},async()=>{
  const sandbox=await mcpSandbox();
  try{
    const employee=await sandbox.provision('分析证据边界');const enrollment=await(await sandbox.api('/api/devices/enroll',employee.enrollmentCredential,json({installationId:randomUUID(),name:'validation'}))).json();
    const path=join(sandbox.directory,'config.json');await writeFile(path,JSON.stringify({mode:'fixture',executable:process.execPath,runtimeVersion:'2.1.281',model:'deterministic',workDirectory:join(sandbox.directory,'jobs'),fixtureOrigin:'http://127.0.0.1:12345',budgetId:'validation',budgetCny:0,inputCnyPerMillion:0,outputCnyPerMillion:0,maxInputBytes:4096,maxSessionBytes:131072,maxSegments:16,maxRequests:32,maxAttempts:1,timeoutSeconds:90}));
    const config=await readAnalysisConfig(path),queue=analysisQueue(sandbox.testDatabase,config,'validation');
    await sandbox.testDatabase.query('INSERT INTO analysis_workers(id,config) VALUES($1,$2)',['validation',publicConfig(config)]);
    async function upload(text:string,sessionId=randomUUID()){
      const bytes=Buffer.from([{type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text}]}},{type:'response_item',payload:{type:'function_call_output',call_id:'result',output:'文件存在'}},{type:'response_item',payload:{type:'message',role:'assistant',content:[{type:'output_text',text:'测试全部通过'}]}}].map(row=>JSON.stringify({...row,timestamp:new Date().toISOString()})).join('\n')+'\n');
      await sandbox.api(`/api/chunks/${hash(bytes)}`,enrollment.deviceCredential,{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:bytes});const archived=await(await sandbox.api('/api/snapshots',enrollment.deviceCredential,json({protocolVersion:1,sourceSessionId:sessionId,source:'codex-cli',sourceVersion:'0.160.0',sourceOs:'win32',project:'/synthetic/validation',hash:hash(bytes),byteLength:bytes.length,qualifiedAt:new Date().toISOString(),capability:'unverified'}))).json();return{...archived,sessionId};
    }
    async function prepare(archived:{snapshotId:string}){await sandbox.testDatabase.query("UPDATE analysis_workers SET updated_at=now() WHERE id='validation'");const job=await(await sandbox.api(`/api/snapshots/${archived.snapshotId}/analysis`,employee.readerCredential,json({}))).json();const claim=await queue.claim();assert.equal(claim!.id,job.id);return claim!;}
    const infer=async(claim:NonNullable<Awaited<ReturnType<typeof queue.claim>>>,mode:'valid'|'forged'|'missing'='valid')=>executeAnalysis(config,claim.input,new AbortController().signal,()=>queue.allowForward(claim),async(_config,input,_signal,forward)=>{
      assert.equal(await forward!(),true);const quote=(index:number)=>({event:index,textOffset:0,quote:input.events[index]!.text.slice(0,128)});
      const first=quote(0);const items=[{category:'goal',assessment:'inferred',text:'检查记录',citations:[first]}];
      if(input.analysisContext?.phase==='aggregate')return{usage:{inputTokens:1,outputTokens:1,runtimeCostUsd:null,providerBilledCny:null,requests:1},output:{items}};
      const insights={version:'session-insights-1',taskType:{value:'test',citations:[first]},prompts:input.events.flatMap((event,index)=>event.role==='user'?[{event:index,elements:{goal:true,constraints:false,context:false,acceptance:false},rework:null,citations:[quote(index)]}]:[]),replies:input.events.flatMap((event,index)=>event.role==='assistant'?[{event:index,clarification:false,citations:[quote(index)]}]:[]),outcomes:input.events.flatMap((event,index)=>event.role==='tool result'?[{status:'verified',text:'测试全部通过',citations:[mode==='forged'?{event:999,textOffset:0,quote:'假的'}:quote(index)]}]:[]),suggestions:[]};
      return{usage:{inputTokens:1,outputTokens:1,runtimeCostUsd:null,providerBilledCny:null,requests:1},output:mode==='missing'?{items}:{items,insights}};
    });
    const unrelated=await upload('请检查测试。'),unrelatedClaim=await prepare(unrelated);await queue.finish(unrelatedClaim,await infer(unrelatedClaim));
    const unrelatedView=await(await sandbox.api(`/api/snapshots/${unrelated.snapshotId}/insights`,employee.readerCredential)).json();assert.equal(unrelatedView.metrics.verified,0);assert.equal(unrelatedView.inferences.outcomes[0].status,'inferred');assert.equal(unrelatedView.metrics.rework,0,'first prompts do not enter the rework denominator');
    const forged=await upload('请检查伪造的引用。'),forgedClaim=await prepare(forged);await assert.rejects(infer(forgedClaim,'forged'));await queue.finish(forgedClaim,null,'合成证据校验失败');
    const failure=await(await sandbox.api(`/api/snapshots/${forged.snapshotId}/insights`,employee.readerCredential)).json();assert.equal(failure.state,'failed');assert.equal(failure.metrics.verified,null);
    const giant=await upload('目标🛰'.repeat(3500)),giantClaim=await prepare(giant);await queue.finish(giantClaim,await infer(giantClaim));const partial=await(await sandbox.api(`/api/snapshots/${giant.snapshotId}/insights`,employee.readerCredential)).json();assert.equal(partial.state,'partial');assert.equal(partial.metrics.rework,null);assert.equal(partial.inferences.prompts[0].elements.context,null,'fragments do not establish an absent element');
    const prior=await upload('旧工作输入。'),late=await prepare(prior);const lateResult=await infer(late);const newer=await upload('新的工作输入。',prior.sessionId);await queue.finish(late,lateResult);
    const latest=await(await sandbox.api(`/api/snapshots/${newer.snapshotId}/insights`,employee.readerCredential)).json();assert.equal(latest.state,'unavailable');assert.equal(latest.metrics.verified,null);
    const old=await(await sandbox.api(`/api/snapshots/${prior.snapshotId}/insights`,employee.readerCredential)).json();assert.equal(old.state,'stale');assert.equal(old.inferences,null);
    const history=await(await sandbox.api(`/api/snapshots/${prior.snapshotId}/insights?analysisId=${late.id}`,employee.readerCredential)).json();assert.equal(history.inferences.outcomes[0].status,'inferred');assert.equal(history.analysisVersion.applicable,false);
    console.log(`Inference validation evidence: ${sandbox.directory}`);
  }finally{await sandbox.close();}
});
