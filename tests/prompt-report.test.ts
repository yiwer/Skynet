import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createSandbox} from './support.js';
import {createApp} from '../apps/server/app.js';
import {connect,digest} from '../apps/server/database.js';

test('prompt report retains actual lengths without model inference and freezes its public source version', {timeout:120000},async()=>{
  const sandbox=await createSandbox(),db=connect(sandbox.env.DATABASE_URL!);let app:Awaited<ReturnType<typeof createApp>>|undefined;
  try{
    const owner=await sandbox.provision('提示词合成员工'),now=new Date(Date.now()+60000);
    app=await createApp({db,rawDirectory:sandbox.env.RAW_DIRECTORY!,reportClock:()=>now});
    const api=(url:string,payload?:object|Buffer,credential=owner.readerCredential,method:'GET'|'POST'|'PUT'='GET')=>app!.inject({url,method,headers:{Authorization:`Bearer ${credential}`,...(Buffer.isBuffer(payload)?{'Content-Type':'application/octet-stream'}:{})},...(payload===undefined?{}:{payload})});
    const path='/api/prompt-report?period=since-enrollment';
    assert.equal((await app.inject({url:path})).statusCode,401);
    const empty=await api(path);assert.equal(empty.statusCode,200,empty.body);assert.equal(empty.json().kpis.prompts,0);assert.equal(empty.json().kpis.medianLength.value,null);assert.equal(empty.json().kpis.context.value,null);
    const device=(await api('/api/devices/enroll',{installationId:randomUUID(),name:'提示词设备'},owner.enrollmentCredential,'POST')).json();
    const id=randomUUID(),encode=(texts:string[])=>Buffer.from(texts.map(text=>JSON.stringify({timestamp:now.toISOString(),type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text}]}})).join('\n')+'\n');
    async function upload(texts:string[]){const bytes=encode(texts);await api(`/api/chunks/${digest(bytes)}`,bytes,device.deviceCredential,'PUT');const response=await api('/api/snapshots',{protocolVersion:1,sourceSessionId:id,source:'codex-cli',sourceVersion:'0.160.0',sourceOs:process.platform,project:'/synthetic/prompts',hash:digest(bytes),byteLength:bytes.length,qualifiedAt:now.toISOString(),capability:'unverified'},device.deviceCredential,'POST');assert.equal(response.statusCode,200,response.body);}
    await upload(['修复接口','不对🛰','保留兼容并执行测试']);
    const response=await api(path);assert.equal(response.statusCode,200,response.body);const report=response.json();
    assert.equal(report.kpis.prompts,3);assert.equal(report.kpis.medianLength.value,4);assert.equal(report.kpis.medianLength.knownCount,3);
    assert.deepEqual(report.kpis.context,{numerator:0,denominator:0,unknown:3,value:null});
    assert.deepEqual(report.kpis.rework,{numerator:0,denominator:0,unknown:2,value:null});
    assert.equal(report.lengths[0].count,3,'native Unicode lengths are available before analysis');
    assert.equal(report.employees[0].employee,'提示词合成员工');
    assert.equal((await api(path,undefined,device.deviceCredential)).statusCode,401);
    assert.deepEqual((await api(`/api/prompt-report/export?period=since-enrollment&version=${report.version}`)).json(),report);
    await upload(['修复接口','不对🛰','保留兼容并执行测试','增加一项验收']);
    assert.equal((await api(path)).json().kpis.prompts,4);
    assert.deepEqual((await api(`/api/prompt-report?period=since-enrollment&version=${report.version}`)).json(),report);
    await app.close();app=await createApp({db,rawDirectory:sandbox.env.RAW_DIRECTORY!});
    assert.deepEqual((await api(`/api/prompt-report?period=since-enrollment&version=${report.version}`)).json(),report);
  }finally{await app?.close();await db.end();await sandbox.close();}
});

test('a compacted rewrite cannot establish a new first prompt or a complete length distribution',{timeout:120000},async()=>{
  const sandbox=await createSandbox(),db=connect(sandbox.env.DATABASE_URL!);let app:Awaited<ReturnType<typeof createApp>>|undefined;
  try{const owner=await sandbox.provision('压缩提示词'),at=new Date(Date.now()+60000).toISOString();app=await createApp({db,rawDirectory:sandbox.env.RAW_DIRECTORY!,reportClock:()=>new Date(Date.now()+86400000)});
    const api=(url:string,payload?:object|Buffer,credential=owner.readerCredential,method:'GET'|'POST'|'PUT'='GET')=>app!.inject({url,method,headers:{Authorization:`Bearer ${credential}`,...(Buffer.isBuffer(payload)?{'Content-Type':'application/octet-stream'}:{})},...(payload===undefined?{}:{payload})});
    const device=(await api('/api/devices/enroll',{installationId:randomUUID(),name:'compacted'},owner.enrollmentCredential,'POST')).json();
    const bytes=Buffer.from(JSON.stringify({timestamp:at,type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'继续剩余任务'}]}})+'\n');
    await api('/api/chunks/'+digest(bytes),bytes,device.deviceCredential,'PUT');const response=await api('/api/snapshots',{protocolVersion:1,sourceSessionId:randomUUID(),source:'codex-cli',sourceVersion:'0.160.0',sourceOs:process.platform,project:'/synthetic/compacted',hash:digest(bytes),byteLength:bytes.length,qualifiedAt:at,capability:'unverified',capture:{generation:digest(Buffer.from('compacted-prompts')),revision:2,change:'rewrite',materials:[],lineage:[],gaps:[],compacted:true,partialLine:false}},device.deviceCredential,'POST');assert.equal(response.statusCode,200,response.body);
    const report=(await api('/api/prompt-report?period=since-enrollment')).json();assert.equal(report.kpis.prompts,1);assert.equal(report.kpis.rework.unknown,1,'compaction cannot invent a first prompt exclusion');assert.equal(report.sourceInputsComplete,false);assert.equal(report.kpis.medianLength.value,null);assert.equal(report.kpis.medianLength.knownMedian,6);
  }finally{await app?.close();await db.end();await sandbox.close();}
});

test('prompt report preserves original owners across recovery, same-byte retries, and native multi-block messages',{timeout:120000},async()=>{
  const sandbox=await createSandbox(),db=connect(sandbox.env.DATABASE_URL!);let app:Awaited<ReturnType<typeof createApp>>|undefined;
  try{
    const a=await sandbox.provision('甲原提示词'),b=await sandbox.provision('乙续提示词'),at=new Date(Date.now()+60000).toISOString();
    app=await createApp({db,rawDirectory:sandbox.env.RAW_DIRECTORY!,reportClock:()=>new Date(Date.now()+86400000)});
    const api=(url:string,payload?:object|Buffer,credential=a.readerCredential,method:'GET'|'POST'|'PUT'='GET')=>app!.inject({url,method,headers:{Authorization:`Bearer ${credential}`,...(Buffer.isBuffer(payload)?{'Content-Type':'application/octet-stream'}:{})},...(payload===undefined?{}:{payload})});
    const enroll=async(person:typeof a)=>(await api('/api/devices/enroll',{installationId:randomUUID(),name:'original-prompts'},person.enrollmentCredential,'POST')).json(),da=await enroll(a),dbb=await enroll(b),id=randomUUID();
    const line=(texts:string[])=>JSON.stringify({type:'user',uuid:randomUUID(),timestamp:at,message:{role:'user',content:texts.map(text=>({type:'text',text}))}})+'\n';
    const initial=Buffer.from(line(['明确目标','验收标准']));
    async function upload(device:typeof da,bytes:Buffer,restoredFrom?:object){await api('/api/chunks/'+digest(bytes),bytes,device.deviceCredential,'PUT');const result=await api('/api/snapshots',{protocolVersion:1,sourceSessionId:id,source:'claude-code-cli',sourceVersion:'2.1.281',sourceOs:process.platform,project:'/synthetic/native-blocks',hash:digest(bytes),byteLength:bytes.length,qualifiedAt:at,capability:'unverified',...(restoredFrom?{restoredFrom}:{})},device.deviceCredential,'POST');assert.equal(result.statusCode,200,result.body);return result.json().snapshotId;}
    const original=await upload(da,initial);await upload(da,initial);
    const before=(await api('/api/prompt-report?period=since-enrollment')).json();assert.equal(before.kpis.prompts,1);assert.equal(before.kpis.medianLength.value,9,'native message text blocks join with one newline');assert.equal(before.kpis.rework.unknown,0);
    const continued=Buffer.concat([initial,Buffer.from(line(['继续']))]);await upload(dbb,continued,{snapshotId:original,hash:digest(initial),byteLength:initial.length});await upload(dbb,continued,{snapshotId:original,hash:digest(initial),byteLength:initial.length});
    const response=await api('/api/prompt-report?period=since-enrollment');assert.equal(response.statusCode,200,response.body);const report=response.json();assert.equal(report.kpis.prompts,2);assert.equal(report.kpis.sessions,1);assert.equal(report.kpis.medianLength.value,5.5);assert.equal(report.kpis.rework.unknown,1);assert.deepEqual(report.employees.map((row:any)=>[row.employee,row.prompts]),[['甲原提示词',1],['乙续提示词',1]]);
    const scoped=(await api('/api/prompt-report?period=since-enrollment&employeeId='+b.employeeId)).json();assert.equal(scoped.kpis.prompts,1);assert.equal(scoped.kpis.medianLength.value,2);assert.equal(scoped.kpis.rework.unknown,1,'the new owner\'s first contribution is still a follow-up');
    assert.deepEqual((await api('/api/prompt-report/export?period=since-enrollment&version='+before.version)).json(),before);
    const full=(await api('/api/prompt-report/recompute',{period:'since-enrollment'},a.readerCredential,'POST')).json();assert.deepEqual(full,report);
  }finally{await app?.close();await db.end();await sandbox.close();}
});
