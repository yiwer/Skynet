import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {unlink,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createSandbox} from './support.js';
import {createApp} from '../apps/server/app.js';
import {connect,digest} from '../apps/server/database.js';
import type {MetricsPage} from '../packages/contracts/metrics.js';

test('many originals retain complete owner results and frozen gaps across current, full, restart and source recovery', {timeout:180000}, async()=>{
  const sandbox=await createSandbox(),db=connect(sandbox.env.DATABASE_URL!);
  let app:Awaited<ReturnType<typeof createApp>>|undefined,restore:{path:string;bytes:Buffer}|undefined;
  try{
    const owners=await Promise.all(['批次甲','批次乙'].map(name=>sandbox.provision(name)));
    const base=Date.now()+60000,clock=()=>new Date(base+2*86400000);
    const open=()=>createApp({db,rawDirectory:sandbox.env.RAW_DIRECTORY!,reportClock:clock});app=await open();
    const api=(url:string,payload?:object|Buffer,credential=owners[0]!.readerCredential,method:'GET'|'POST'|'PUT'='GET')=>app!.inject({url,method,
      headers:{Authorization:`Bearer ${credential}`,...(payload instanceof Buffer?{'Content-Type':'application/octet-stream'}:{})},...(payload===undefined?{}:{payload})});
    const get=async(url:string,payload?:object)=>{const response=await api(url,payload,undefined,payload?'POST':'GET');assert.equal(response.statusCode,200,response.body);return response.json<MetricsPage>();};
    const devices:{deviceId:string;deviceCredential:string}[]=[];
    for(const owner of owners){const response=await api('/api/devices/enroll',{installationId:randomUUID(),name:'合成批次设备'},owner.enrollmentCredential,'POST');assert.equal(response.statusCode,200,response.body);devices.push(response.json());}
    for(let index=0;index<120;index++){
      const owner=Math.floor(index/60),device=devices[owner]!,session=randomUUID(),timestamp=new Date(base+(index%2)*86400000).toISOString();
      const usage=(n:number,time=timestamp)=>({timestamp:time,type:'event_msg',payload:{type:'token_count',info:{total_token_usage:{input_tokens:n*10,cached_input_tokens:n*2,output_tokens:n*5,reasoning_output_tokens:0,total_tokens:n*15}}}});
      const bytes=Buffer.from([
        {timestamp,type:'session_meta',payload:{id:session}},usage(0,new Date(base-3*86400000).toISOString()),
        {timestamp,type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:`合成提交 ${index}`}]}},
        {timestamp,type:'response_item',payload:{type:'function_call',name:'shell',arguments:'{}',call_id:'synthetic-tool'}},usage(1),
      ].map(row=>JSON.stringify(row)).join('\n')+'\n');
      const hash=digest(bytes);assert.equal((await api('/api/chunks/'+hash,bytes,device.deviceCredential,'PUT')).statusCode,201);
      const response=await api('/api/snapshots',{protocolVersion:1,sourceSessionId:session,source:'codex-cli',sourceVersion:'0.157.1',sourceOs:process.platform,
        project:'/synthetic/batches',hash,byteLength:bytes.length,qualifiedAt:timestamp,capability:'unverified'},device.deviceCredential,'POST');assert.equal(response.statusCode,200,response.body);
      if(index===59)restore={path:join(sandbox.env.RAW_DIRECTORY!,device.deviceId,hash),bytes};
    }
    await unlink(restore!.path);
    const path='/api/metrics?period=since-enrollment';
    const [first,ownBad,ownGood]=await Promise.all([get(path),get(path+'&employeeId='+owners[0]!.employeeId),get(path+'&employeeId='+owners[1]!.employeeId)]);
    assert.equal(ownBad.totals.inputTokens,null);assert.equal(ownGood.totals.inputTokens,600);assert.equal(ownGood.sourceInputsComplete,true);
    assert.deepEqual([first.totals.sessions,first.totals.userTurns,first.totals.toolCalls,first.totals.inputTokens,first.totals.knownInputTokens],[120,120,120,null,1190]);
    assert.equal(first.sourceInputsComplete,false);
    const firstExport=await get('/api/metrics/export?period=since-enrollment&version='+first.version);
    assert.equal(firstExport.sessions.length,120);assert.equal(firstExport.version,first.version);
    assert.deepEqual(firstExport.sessions.slice(0,first.sessions.length),first.sessions);assert.deepEqual(firstExport.totals,first.totals);
    const bad=first.employees.find(row=>row.employeeId===owners[0]!.employeeId)!,good=first.employees.find(row=>row.employeeId===owners[1]!.employeeId)!;
    assert.deepEqual([bad.sessions,bad.inputTokens,good.sessions,good.inputTokens],[60,null,60,600]);
    assert.deepEqual(await get('/api/metrics/recompute',{period:'since-enrollment'}),first);
    await app.close();app=await open();assert.deepEqual(await get(path),first);
    await writeFile(restore!.path,restore!.bytes);
    const recovered=await get(path);assert.equal(recovered.sourceInputsComplete,true);assert.notEqual(recovered.version,first.version);
    assert.deepEqual([recovered.totals.sessions,recovered.totals.userTurns,recovered.totals.toolCalls,recovered.totals.inputTokens,recovered.totals.outputTokens],[120,120,120,1200,600]);
    assert.deepEqual(await get('/api/metrics/recompute',{period:'since-enrollment'}),recovered);
    assert.deepEqual(await get('/api/metrics/export?period=since-enrollment&version='+first.version),firstExport);
    await writeFile(restore!.path,'synthetic wrong hash only\n');
    const damaged=await get(path);assert.equal(damaged.sourceInputsComplete,false);assert.equal(damaged.totals.inputTokens,null);
    assert.equal(damaged.employees.find(row=>row.employeeId===owners[1]!.employeeId)!.inputTokens,600);
    assert.deepEqual(await get(path+'&version='+recovered.version),recovered);
    await writeFile(restore!.path,restore!.bytes);assert.deepEqual(await get(path),recovered);
  }finally{if(restore)await writeFile(restore.path,restore.bytes);await app?.close();await db.end();await sandbox.close();}
});
