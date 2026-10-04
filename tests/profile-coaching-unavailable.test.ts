import test from 'node:test';
import assert from 'node:assert/strict';
import {unlink,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {assessmentFixture} from './assessment-fixture.js';

test('coaching exposes uncountable source outages only for the owner and identifies incomplete team wait reference',{timeout:180000},async()=>{
  const f=await assessmentFixture();let restore:{path:string;bytes:Buffer}|undefined;
  try{
    const owner=await f.owner('缺失原件'),other=await f.owner('完整来源'),raw=await f.session(owner,{prompts:3});await f.session(other,{prompts:3});
    const path='/api/capability-profiles/',before=await(await f.api(owner,path+owner.employeeId)).json();
    restore={path:join(f.directory,'raw',owner.deviceId,createHash('sha256').update(raw.bytes).digest('hex')),bytes:raw.bytes};await unlink(restore.path);
    const response=await f.api(owner,path+owner.employeeId);assert.equal(response.status,200,await response.clone().text());const missing=await response.json();
    assert.equal(missing.coaching.waiting.unavailableSourceCount,1);assert.equal(missing.coaching.waiting.summary.medianMs,null);assert.equal(missing.coaching.waiting.summary.longFraction.value,null);
    assert.equal(missing.coaching.communication.sourceInputsComplete,false);assert.equal(missing.coaching.communication.medianLength.value,null);assert.equal(missing.coaching.representatives.best,null);
    const healthyResponse=await f.api(other,path+other.employeeId);assert.equal(healthyResponse.status,200,await healthyResponse.clone().text());const healthy=await healthyResponse.json();
    assert.equal(healthy.coaching.waiting.unavailableSourceCount,0);assert.equal(healthy.coaching.waiting.teamUnavailableSourceCount,1);assert.equal(healthy.coaching.waiting.summary.medianMs,1000);assert.equal(healthy.coaching.communication.sourceInputsComplete,true);
    assert.deepEqual(await(await f.api(owner,path+owner.employeeId+'?version='+before.version)).json(),before);
  }finally{if(restore)await writeFile(restore.path,restore.bytes);await f.close();}
});
