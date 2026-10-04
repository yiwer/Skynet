import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {writeFile,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {assessmentFixture} from './assessment-fixture.js';
import {collectUsage} from './usage-pages-support.js';

test('fixed usage pages retain corrected references and owner-specific unknown source states across recovery', {timeout:180000},async()=>{
  const f=await assessmentFixture();let restore:{path:string;bytes:Buffer}|undefined;
  try{
    const a=await f.owner('固定分页作者'),b=await f.owner('完整参照作者'),record=await f.session(a,{prompts:3});await f.session(b,{prompts:1});
    const get=async(path:string)=>{const response=await f.api(a,path);assert.equal(response.status,200,await response.clone().text());return response.json();};
    const route='/api/usage-output?period=since-enrollment',before=await get(route);
    const collect=(head:any,extra='')=>collectUsage(head,(section,offset)=>get(route+extra+'&version='+head.version+'&section='+section+'&offset='+offset));
    const beforeFull=await collect(before),view=await get('/api/snapshots/'+record.snapshotId+'/insights');
    const corrected=await f.api(a,'/api/snapshots/'+record.snapshotId+'/inference-corrections',{requestId:randomUUID(),expectedVersion:view.version,kind:'task-type',value:'investigation',reason:'合成复核为排查任务'});
    assert.equal(corrected.status,201,await corrected.clone().text());
    const after=await get(route);assert.notEqual(after.version,before.version);assert.deepEqual(after.totals,before.totals);
    const afterFull=await collect(after);assert.notDeepEqual(afterFull.sessions.find((row:any)=>row.employeeId===a.employeeId).insightVersions,beforeFull.sessions.find((row:any)=>row.employeeId===a.employeeId).insightVersions);
    assert.deepEqual(await collect(before),beforeFull);
    const sourcePath=join(f.directory,'raw',a.deviceId,createHash('sha256').update(record.bytes).digest('hex'));restore={path:sourcePath,bytes:record.bytes};
    for(const fault of ['missing','hash-mismatch']){
      if(fault==='missing')await unlink(sourcePath);else await writeFile(sourcePath,'synthetic corrupt usage source');
      const broken=await get(route+'&employeeId='+a.employeeId);assert.equal(broken.sourceInputsComplete,false);assert.equal(broken.outputs.verified.value,null);assert.ok(broken.pages.unknownReasons.total>0);
      const full=await collect(broken,'&employeeId='+a.employeeId);assert.ok(full.unknownReasons.some((reason:string)=>reason.includes('不可读取')));assert.ok(full.employees[0].unknownReasons.length);
      const healthy=await get(route+'&employeeId='+b.employeeId);assert.equal(healthy.sourceInputsComplete,true);assert.equal(healthy.totals.inputTokens,1000);assert.equal(healthy.outputs.verified.value,1);
      assert.equal(healthy.pages.sessions.total,2);assert.ok(healthy.sessions.some((row:any)=>!row.selected&&row.outputs.verified.value===null));
      assert.deepEqual(await collect(after),afterFull);
      await writeFile(sourcePath,record.bytes);assert.deepEqual(await get(route),after);
    }
    assert.deepEqual(await(await f.api(a,'/api/usage-output/recompute',{period:'since-enrollment'})).json(),after);
  }finally{if(restore)await writeFile(restore.path,restore.bytes);await f.close();}
});

test('an oversized session fails with a fixed location instead of dropping source references or looping a page', {timeout:240000},async()=>{
  const f=await assessmentFixture();
  try{
    const owner=await f.owner('Large native history'),input=f.rows({prompts:1,verified:0});
    const original=await f.upload(owner,input.rows,input.sessionId);
    for(let index=1;index<300;index++){
      // Independent verified copies of one original: a bounded depth-one
      // history, rather than exceeding the separate 128-ancestor safeguard.
      const copy=await f.enroll(owner);
      await f.upload(copy,input.rows,input.sessionId,{restoredFrom:{snapshotId:original.snapshotId,hash:createHash('sha256').update(original.bytes).digest('hex'),byteLength:original.bytes.length}});
    }
    const exported=await f.api(owner,'/api/usage-output/export?period=since-enrollment');assert.equal(exported.status,200,await exported.clone().text());
    const complete=await exported.json();assert.equal(complete.totals.sessions,1);assert.equal(complete.sessions[0].insightVersions.length,300);
    const response=await f.api(owner,'/api/usage-output?period=since-enrollment&version='+complete.version+'&section=sessions&offset=0');
    assert.equal(response.status,413);const failure=await response.json();assert.match(failure.error,new RegExp(complete.version));assert.match(failure.error,/sessions 第 0 项/);
    const summaries=await f.api(owner,'/api/usage-output?period=since-enrollment&version='+complete.version+'&section=employees&offset=0');
    assert.equal(summaries.status,200);const page=await summaries.json();assert.equal(page.pages.sessions.total,1);assert.equal(page.sessions.length,0);assert.equal(page.pages.sessions.nextOffset,0);assert.equal(page.employees[0].sessions,1);
    assert.deepEqual(await(await f.api(owner,'/api/usage-output/export?period=since-enrollment&version='+complete.version)).json(),complete);
  }finally{await f.close();}
});
