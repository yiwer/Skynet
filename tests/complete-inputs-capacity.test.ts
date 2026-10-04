import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,resolve,basename} from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {restoreBundle,seedBundle,disposeOwned,appendLate} from './ac32-fixture.js';
import {mcpSandbox} from './mcp-support.js';

// Reuse only the verified, stopped source bundle; each test gets its own DB/raw
// copy. Without an explicit bundle, prepare the same full public-upload fixture.
test('complete reports retain 1,000 sessions and 19,000 waits independently of bounded transport pages', {timeout:600000}, async t=>{
  const directory=process.env.SKYNET_CAPACITY_SOURCE??await mkdtemp(join(tmpdir(),'skynet-capacity-'));
  const source=process.env.SKYNET_CAPACITY_SOURCE??join(directory,'source');
  if(!process.env.SKYNET_CAPACITY_SOURCE)await seedBundle(source,'capacity-functional',false,true);
  const {sandbox,owner,bundle}=await restoreBundle(source);
  const f=await mcpSandbox({sandbox,reportClock:()=>new Date(bundle.clock)}).catch(async error=>{await disposeOwned(sandbox,owner);throw error;});
  let client:Client|undefined;
  const api=(path:string,body?:object)=>f.api(path,bundle.people[0]!.readerCredential,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});
  const read=async(path:string,body?:object)=>{const response=await api(path,body),text=await response.text();assert.equal(response.status,200,path+': '+text);return JSON.parse(text);};
  try{
    assert.deepEqual([bundle.dataset.sessions,bundle.dataset.businessEvents,bundle.dataset.waits,bundle.dataset.analyzedSessions],[1000,80000,19000,20]);
    assert.equal(bundle.preparation.reportRequests,0);
    const query='period=since-enrollment';
    const waits=await read('/api/waits?'+query);
    assert.equal(waits.total,19000);assert.equal(waits.intervals.length,25);
    const report=await read('/api/wait-report?'+query+'&waitVersion='+waits.version);
    assert.equal(report.waitVersion,waits.version);
    assert.deepEqual([report.summary.knownCount,report.summary.unknownCount,report.summary.medianMs,report.summary.p90Ms],[19000,0,36000,36000]);
    assert.equal(report.summary.permissionMedianMs,null);
    assert.equal(report.people.length,10);assert.ok(report.people.every((person:any)=>person.count===1900));
    assert.equal(report.heatmap.reduce((sum:number,cell:any)=>sum+cell.count,0),19000);
    assert.deepEqual(await read('/api/wait-report?'+query+'&version='+report.version),report);
    assert.deepEqual(await read('/api/waits/recompute',{period:'since-enrollment'}),waits);
    assert.deepEqual(await read('/api/wait-report?'+query),report);
    const prompts=await read('/api/prompt-report?'+query);
    assert.deepEqual([prompts.kpis.sessions,prompts.kpis.prompts,prompts.kpis.context.denominator,prompts.kpis.context.unknown],[1000,20000,400,19600]);
    assert.deepEqual(await read('/api/prompt-report/recompute',{period:'since-enrollment'}),prompts);
    const assessmentPath='/api/assessments/'+bundle.people[0]!.employeeId;
    const assessment=await read(assessmentPath+'?'+query);
    assert.deepEqual([assessment.sample.sessions,assessment.sample.prompts,assessment.sample.activeDays],[100,2000,20]);
    assert.equal(assessment.inputs.usageVersion,prompts.usageVersion);assert.equal(assessment.inputs.waitsVersion,waits.version);
    assert.equal(assessment.dims.flow.metrics.find((metric:any)=>metric.key==='permMed').value,null);
    assert.deepEqual(await read(assessmentPath+'/recompute',{period:'since-enrollment'}),assessment);
    const usage=await read('/api/usage-output/export?'+query+'&version='+prompts.usageVersion);
    assert.equal(usage.sessions.length,1000);assert.ok(usage.sessions.every((row:any)=>row.selected));
    assert.deepEqual([usage.totals.userTurns,usage.totals.toolCalls,usage.totals.inputTokens,usage.totals.outputTokens],[20000,20000,2000000,500000]);
    assert.deepEqual([usage.outputs.verified.known,usage.outputs.verified.value,usage.outputs.verified.unknownSessions,usage.outputs.tests.known],[20,null,980,60000]);
    const tail=await read('/api/waits?'+query+'&version='+waits.version+'&offset=18975');
    assert.equal(tail.intervals.length,25);assert.equal(tail.nextOffset,null);assert.ok(tail.intervals.every((row:any)=>row.start?.snapshotId&&row.end.snapshotId));
    for(const extra of ['employeeId='+bundle.people[0]!.employeeId,'source=claude-code-cli','project=/different']){
      assert.equal((await api('/api/wait-report?'+query+'&waitVersion='+waits.version+'&'+extra)).status,400);
      assert.equal((await api('/api/prompt-report?'+query+'&usageVersion='+usage.version+'&'+extra)).status,409);
    }
    assert.equal((await api('/api/waits/recompute',{period:'since-enrollment',version:waits.version})).status,400);
    assert.equal((await api('/api/waits/recompute',{snapshotId:bundle.first.snapshotId,lines:'3'})).status,400);
    assert.equal((await api('/api/prompt-report/recompute',{period:'since-enrollment',usageVersion:usage.version})).status,400);
    const resource=f.origin+'/mcp',registration=await(await api('/oauth/register',{client_name:'Complete report input reader',redirect_uris:['http://127.0.0.1:47125/callback'],token_endpoint_auth_method:'none'})).json();
    const verifier=randomBytes(48).toString('base64url');
    const callback=new URL(await f.authorizationPage(f.origin+'/oauth/authorize?'+new URLSearchParams({response_type:'code',client_id:registration.client_id,redirect_uri:registration.redirect_uris[0],scope:'archive:read',resource,state:randomUUID(),code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url')}),bundle.people[0]!.readerCredential));
    const token=await(await f.api('/oauth/token',undefined,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:registration.client_id,code:callback.searchParams.get('code')!,redirect_uri:registration.redirect_uris[0],code_verifier:verifier,resource}).toString()})).json();
    client=new Client({name:'complete-inputs-public',version:'1'});
    await client.connect(new StreamableHTTPClientTransport(new URL(resource),{fetch:f.fetchTls,requestInit:{headers:{Authorization:'Bearer '+token.access_token}}}));
    for(const [name,value,extra] of [['read_wait_report',report,{}],['read_prompt_report',prompts,{}],['read_assessment',assessment,{employeeId:bundle.people[0]!.employeeId}]] as const){
      const result=await client.callTool({name,arguments:{period:'since-enrollment',version:value.version,...extra}});
      assert.notEqual(result.isError,true,JSON.stringify(result));assert.deepEqual(JSON.parse((result.content as {text:string}[])[0]!.text),value);
      assert.ok(Buffer.byteLength(JSON.stringify(result))<=48*1024);t.diagnostic(name+' MCP bytes='+Buffer.byteLength(JSON.stringify(result)));
    }
    await client.close();client=undefined;
    await appendLate(f.api,source,bundle);
    const nextWait=await read('/api/wait-report?'+query),nextPrompt=await read('/api/prompt-report?'+query),nextAssessment=await read(assessmentPath+'?'+query);
    assert.equal(nextWait.summary.knownCount,19001);assert.equal(nextPrompt.kpis.prompts,20001);assert.equal(nextAssessment.sample.prompts,2001);
    for(const [before,after]of [[report,nextWait],[prompts,nextPrompt],[assessment,nextAssessment]])assert.notEqual(after.version,before.version);
    assert.deepEqual(await read('/api/prompt-report/recompute',{period:'since-enrollment'}),nextPrompt);
    assert.deepEqual(await read(assessmentPath+'/recompute',{period:'since-enrollment'}),nextAssessment);
    const fullWait=await read('/api/waits/recompute',{period:'since-enrollment'});assert.equal(fullWait.total,19001);assert.equal(fullWait.version,nextWait.waitVersion);
    await f.restart();
    for(const [path,value]of [['/api/wait-report',report],['/api/prompt-report',prompts],[assessmentPath,assessment]] as const)assert.deepEqual(await read(path+'?'+query+'&version='+value.version),value);
    assert.deepEqual(await read('/api/usage-output/export?'+query+'&version='+usage.version),usage);
    t.diagnostic(JSON.stringify({kind:'capacity-functional-not-ac32',sourceBundleHash:bundle.bundleHash,dataset:bundle.dataset,fixedWaitVersion:waits.version,fixedUsageVersion:usage.version}));
  }finally{await client?.close();await disposeOwned(f,owner);if(!process.env.SKYNET_CAPACITY_SOURCE){assert.equal(dirname(resolve(directory)),resolve(tmpdir()));assert.match(basename(directory),/^skynet-capacity-/);await rm(directory,{recursive:true,force:true});}}
});
