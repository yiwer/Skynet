import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createSandbox} from './support.js';
import {createApp} from '../apps/server/app.js';
import {connect,digest} from '../apps/server/database.js';
import {monday,addDays} from '../packages/contracts/work-views.js';
import {beijingDate} from '../packages/contracts/reports.js';

test('team overview freezes shared report values, includes inactive samples and preserves unknowns',{timeout:120000},async()=>{
  const sandbox=await createSandbox(),db=connect(sandbox.env.DATABASE_URL!);let app:Awaited<ReturnType<typeof createApp>>|undefined;
  try{
    const owner=await sandbox.provision('甲团队成员'),peer=await sandbox.provision('乙团队成员'),now=new Date(Date.now()+60000),timestamp=now.toISOString();
    app=await createApp({db,rawDirectory:sandbox.env.RAW_DIRECTORY!,reportClock:()=>now});
    const api=(url:string,payload?:object|Buffer,credential=owner.readerCredential,method:'GET'|'POST'|'PUT'='GET')=>app!.inject({url,method,headers:{Authorization:`Bearer ${credential}`,...(Buffer.isBuffer(payload)?{'Content-Type':'application/octet-stream'}:{})},...(payload===undefined?{}:{payload})});
    const path='/api/team-report?period=this-week';assert.equal((await app.inject({url:path})).statusCode,401);
    const device=(await api('/api/devices/enroll',{installationId:randomUUID(),name:'team-device'},owner.enrollmentCredential,'POST')).json();
    const id=randomUUID();
    async function upload(texts:string[]){const bytes=Buffer.from([{timestamp,type:'session_meta',payload:{id,timestamp,cli_version:'0.160.0',source:'cli'}},...texts.map(text=>({timestamp,type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text}]}})),{timestamp,type:'event_msg',payload:{type:'token_count',info:{total_token_usage:{input_tokens:150,cached_input_tokens:20,output_tokens:20,reasoning_output_tokens:5,total_tokens:170}}}}].map(row=>JSON.stringify(row)).join('\n')+'\n');await api('/api/chunks/'+digest(bytes),bytes,device.deviceCredential,'PUT');const response=await api('/api/snapshots',{protocolVersion:1,sourceSessionId:id,source:'codex-cli',sourceVersion:'0.160.0',sourceOs:process.platform,project:'/synthetic/team',hash:digest(bytes),byteLength:bytes.length,qualifiedAt:timestamp,capability:'unverified'},device.deviceCredential,'POST');assert.equal(response.statusCode,200,response.body);}
    await upload(['修复接口','补齐测试']);const response=await api(path);assert.equal(response.statusCode,200,response.body);const report=response.json();
    assert.deepEqual(report.activeEmployees,{active:1,total:2});assert.equal(report.totals.sessions,1);assert.equal(report.totals.knownInputTokens,150);assert.equal(report.prompts.prompts,2);assert.equal(report.outputs.verified.value,null);assert.equal(report.waits.medianMs,null);
    assert.deepEqual(report.people.map((row:any)=>[row.employee,row.prompts.prompts]),[['甲团队成员',2],['乙团队成员',0]]);
    assert.equal(report.people[1].employeeId,peer.employeeId);assert.equal(report.people[0].prompts.rework.value,null);assert.equal(report.daily.length,7);
    const usage=(await api(report.links.usage.api)).json(),prompts=(await api(report.links.prompts.api)).json(),waits=(await api(report.links.waits.api)).json();
    assert.deepEqual(report.totals,usage.totals);assert.deepEqual(report.outputs,usage.outputs);assert.deepEqual(report.prompts,prompts.kpis);assert.deepEqual(report.waits,waits.summary);
    assert.deepEqual((await api(path)).json(),report,'unchanged live input keeps one fixed version');
    assert.deepEqual((await api(path+'&version='+report.version)).json(),report);assert.deepEqual((await api('/api/team-report/export?period=this-week&version='+report.version)).json(),report);
    assert.equal((await api(path,undefined,device.deviceCredential)).statusCode,401);
    await upload(['修复接口','补齐测试','补充验收']);assert.equal((await api(path)).json().prompts.prompts,3);assert.deepEqual((await api(path+'&version='+report.version)).json(),report);
    await app.close();app=await createApp({db,rawDirectory:sandbox.env.RAW_DIRECTORY!,reportClock:()=>new Date(now.getTime()+8*86400000)});assert.deepEqual((await api(path+'&version='+report.version)).json(),report);
  }finally{await app?.close();await db.end();await sandbox.close();}
});

test('weekly profile pins its selected historical week and employee filters without exposing arbitrary live report ranges',{timeout:120000},async()=>{
  const sandbox=await createSandbox(),db=connect(sandbox.env.DATABASE_URL!);let app:Awaited<ReturnType<typeof createApp>>|undefined;
  try{
    const owner=await sandbox.provision('历史周成员'),now=new Date(Date.now()+60000),timestamp=now.toISOString(),week=monday(beijingDate(now));let clock=new Date(now.getTime()+15*86400000);
    app=await createApp({db,rawDirectory:sandbox.env.RAW_DIRECTORY!,reportClock:()=>clock});
    const api=(url:string,payload?:object|Buffer,credential=owner.readerCredential,method:'GET'|'POST'|'PUT'='GET')=>app!.inject({url,method,headers:{Authorization:`Bearer ${credential}`,...(Buffer.isBuffer(payload)?{'Content-Type':'application/octet-stream'}:{})},...(payload===undefined?{}:{payload})});
    const device=(await api('/api/devices/enroll',{installationId:randomUUID(),name:'weekly-device'},owner.enrollmentCredential,'POST')).json();
    for(const project of ['/synthetic/week','/synthetic/other']){const bytes=Buffer.from(JSON.stringify({timestamp,type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'完成所选项目'}]}})+'\n');await api('/api/chunks/'+digest(bytes),bytes,device.deviceCredential,'PUT');await api('/api/snapshots',{protocolVersion:1,sourceSessionId:randomUUID(),source:'codex-cli',sourceVersion:'0.160.0',sourceOs:process.platform,project,hash:digest(bytes),byteLength:bytes.length,qualifiedAt:timestamp,capability:'unverified'},device.deviceCredential,'POST');}
    const query=new URLSearchParams({week,employeeId:owner.employeeId,source:'codex-cli',project:'/synthetic/week'}),path='/api/team-report/weekly?'+query;
    const response=await api(path);assert.equal(response.statusCode,200,response.body);const report=response.json();assert.equal(report.scope.from,week);assert.equal(report.scope.to,addDays(week,6));assert.equal(report.prompts.prompts,1);assert.equal(report.totals.inputTokens,null);assert.equal(report.totals.unknownInputSessions,1);assert.equal(report.daily.find((day:any)=>day.date===beijingDate(now)).inputTokens,null);
    for(const link of Object.values(report.links) as {api:string}[]){const response=await api(link.api);assert.equal(response.statusCode,200,response.body);assert.equal(response.json().scope.from,week);assert.equal(response.json().scope.employeeId,owner.employeeId);assert.equal(response.json().scope.project,'/synthetic/week');assert.equal(response.json().scope.source,'codex-cli');assert.ok([400,409].includes((await api(link.api+'&week='+addDays(week,7))).statusCode),'duplicate or mismatching fixed week cannot select a different range');}
    const fixed='/api/team-report?period=this-week&'+query+'&version='+report.version;assert.deepEqual((await api(fixed)).json(),report);
    assert.equal((await api('/api/team-report?period=this-week&'+query)).statusCode,400,'live arbitrary week has no generic report route');
    assert.equal((await api('/api/team-report/weekly?'+new URLSearchParams({week:addDays(week,1),employeeId:owner.employeeId}))).statusCode,400);
    clock=new Date(clock.getTime()+8*86400000);assert.deepEqual((await api(fixed)).json(),report);assert.equal((await api('/api/team-report?period=this-week&employeeId='+owner.employeeId)).json().prompts.prompts,0);
    assert.deepEqual((await api(path)).json().totals,report.totals,'historical weekly live materialization retains original source dates');
  }finally{await app?.close();await db.end();await sandbox.close();}
});
