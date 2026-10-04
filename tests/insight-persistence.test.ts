import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {digest} from '../apps/server/database.js';
import {assessmentFixture} from './assessment-fixture.js';

test('concurrent current insight reads keep new, corrected and unavailable versions readable after restart',{timeout:180000},async()=>{
  const f=await assessmentFixture();let restore:{path:string;bytes:Buffer}|undefined;
  try{
    const owner=await f.owner('Insight persistence owner'),input=f.rows({prompts:4}),record=await f.upload(owner,input.rows,input.sessionId);
    const path='/api/snapshots/'+record.snapshotId+'/insights';
    async function get(query=path){const response=await f.api(owner,query);assert.equal(response.status,200,await response.clone().text());return response.json();}
    const [unknown,simultaneous]=await Promise.all([get(),get()]);assert.deepEqual(simultaneous,unknown);
    assert.equal(unknown.state,'unavailable');assert.equal(unknown.inferences,null);assert.equal(unknown.facts.tests.value,1);
    const saved=[unknown];
    await f.analyze(owner,record.snapshotId,{verifyPreparedJob:{prompts:4,replies:4,outcomes:2}});
    const [complete,second]=await Promise.all([get(),get()]);assert.deepEqual(second,complete);
    assert.equal(complete.state,'complete');assert.equal(complete.metrics.verified,1);assert.notEqual(complete.version,unknown.version);saved.push(complete);
    const correction=await f.api(owner,'/api/snapshots/'+record.snapshotId+'/inference-corrections',{
      requestId:randomUUID(),expectedVersion:complete.version,kind:'rework',promptEvent:complete.inferences.prompts[1].event,value:true,reason:'合成公开持久版本校验',
    });
    assert.equal(correction.status,201,await correction.clone().text());const corrected=await get();
    assert.equal(corrected.metrics.rework,1);assert.notEqual(corrected.version,complete.version);saved.push(corrected);
    const full=await f.api(owner,'/api/usage-output/recompute',{period:'since-enrollment'});assert.equal(full.status,200,await full.clone().text());
    assert.deepEqual(await get(),corrected,'full fact recomputation retains the same corrected current view');
    restore={path:join(f.directory,'raw',owner.deviceId,digest(record.bytes)),bytes:record.bytes};
    await writeFile(restore.path,'synthetic changed original bytes\n');const unavailable=await get();
    assert.equal(unavailable.sourceAvailability.reason,'hash-mismatch');assert.equal(unavailable.metrics.verified,null);assert.equal(unavailable.inferences,null);
    assert.notEqual(unavailable.version,corrected.version);saved.push(unavailable);
    await writeFile(restore.path,restore.bytes);assert.deepEqual(await get(),corrected);
    await f.restart();
    for(const value of saved)assert.deepEqual(await get(path+'?version='+value.version),value,'every published version remains fixed-readable');
    assert.deepEqual(await get(),corrected);assert.deepEqual(await get(),corrected);
  }finally{if(restore)await writeFile(restore.path,restore.bytes);await f.close();}
});
