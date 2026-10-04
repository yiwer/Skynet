import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {assessmentFixture} from './assessment-fixture.js';

 test('current insights isolate missing or corrupt original bytes while retaining fixed history and scoped team usage', {timeout:180000},async()=>{
  const f=await assessmentFixture();let restore:{path:string;bytes:Buffer}|undefined;
  try{
    const bad=await f.owner('Unavailable owner'),good=await f.owner('Readable owner'),record=await f.session(bad);await f.session(good);
    const get=async(path:string)=>{const response=await f.api(good,path);assert.equal(response.status,200,await response.clone().text());return response.json();};
    const path='/api/snapshots/'+record.snapshotId+'/insights',usage='/api/usage-output/export?period=since-enrollment&employeeId='+good.employeeId;
    const before=await get(path),beforeUsage=await get(usage);assert.equal(before.metrics.verified,1);assert.equal(beforeUsage.totals.inputTokens,1000);
    restore={path:join(f.directory,'raw',bad.deviceId,createHash('sha256').update(record.bytes).digest('hex')),bytes:record.bytes};
    for(const fault of ['hash-mismatch','missing'] as const){
      if(fault==='missing')await unlink(restore.path);else await writeFile(restore.path,'synthetic corruption only\n');
      const broken=await get(path);assert.equal(broken.state,'unavailable');assert.equal(broken.inferences,null);assert.equal(broken.metrics.verified,null);assert.equal(broken.facts.tests.value,null);assert.equal(broken.sourceAvailability.reason,fault);assert.equal(broken.messageFactsVersion,undefined);assert.notEqual(broken.version,before.version);
      assert.deepEqual(await get(path+'?version='+before.version),before);
      const scoped=await get(usage);assert.equal(scoped.totals.inputTokens,1000);assert.equal(scoped.outputs.verified.value,1);assert.equal(scoped.sourceInputsComplete,true);assert.equal(scoped.sessions.length,2);assert.equal(scoped.sessions.find((row:any)=>row.employeeId===bad.employeeId).selected,false);assert.equal(scoped.sessions.find((row:any)=>row.employeeId===bad.employeeId).outputs.verified.value,null);
      assert.deepEqual(await get(usage+'&version='+beforeUsage.version),beforeUsage);
      const owned=await get('/api/usage-output/export?period=since-enrollment&employeeId='+bad.employeeId);assert.equal(owned.sourceInputsComplete,false);assert.equal(owned.outputs.verified.value,null);
      await writeFile(restore.path,restore.bytes);assert.deepEqual(await get(path),before);assert.deepEqual(await get(usage),beforeUsage);
    }
  }finally{if(restore)await writeFile(restore.path,restore.bytes);await f.close();}
});
