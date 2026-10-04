import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {digest} from '../apps/server/database.js';
import {assessmentFixture} from './assessment-fixture.js';

test('valid uppercase snapshot UUIDs preserve original, evidence and conversation readers',{timeout:120000},async()=>{
  const f=await assessmentFixture();
  try{
    const owner=await f.owner('UUID identity owner'),source=f.rows({prompts:2}),record=await f.upload(owner,source.rows,source.sessionId);
    const lower=record.snapshotId,upper=lower.toUpperCase();assert.notEqual(upper,lower);
    for(const suffix of ['','/evidence','/conversation']){
      const original=await f.api(owner,'/api/snapshots/'+lower+suffix);assert.equal(original.status,200,await original.clone().text());
      const response=await f.api(owner,'/api/snapshots/'+upper+suffix);assert.equal(response.status,200,await response.clone().text());
      // Existing links retain the caller's UUID spelling; compare the same
      // canonical identity without changing any evidence content or version.
      const canonical=(value:unknown)=>JSON.parse(JSON.stringify(value).replaceAll(upper,lower));
      assert.deepEqual(canonical(await response.json()),await original.json(),'UUID case must not change the original evidence or fixed conversation');
    }
  }finally{await f.close();}
});

test('waiting preparation preserves full batches, pending legacy proofs, affected carriers and fixed history',{timeout:180000},async()=>{
  const f=await assessmentFixture();let restore:{path:string;bytes:Buffer}|undefined;
  try{
    const owner=await f.owner('Batch original owner'),copyOwner=await f.owner('Batch restore owner');
    const records:Awaited<ReturnType<typeof f.upload>>[]=[];
    for(let n=0;n<101;n++){const record=f.rows({prompts:2,verified:0,claimed:0});records.push(await f.upload(owner,record.rows,record.sessionId));}
    const first=records[0]!,copy=await f.upload(copyOwner,first.rows,first.sessionId,{restoredFrom:{snapshotId:first.snapshotId,hash:digest(first.bytes),byteLength:first.bytes.length}});
    const path='/api/waits/export?period=since-enrollment';
    const get=async(query=path)=>{const response=await f.api(owner,query);assert.equal(response.status,200,await response.clone().text());return response.json();};
    const before=await get();assert.equal(before.total,101);assert.equal(before.summary.replyWaitMs,101000);assert.equal(before.unavailableSources.length,0);
    const full=await f.api(owner,'/api/waits/recompute',{period:'since-enrollment'});assert.equal(full.status,200);
    const page=await full.json();assert.equal(page.version,before.version);assert.deepEqual(page.summary,before.summary);assert.equal(page.total,101);
    assert.deepEqual(await get(),before);
    restore={path:join(f.directory,'raw',owner.deviceId,digest(first.bytes)),bytes:first.bytes};await unlink(restore.path);
    // A pre-proof upgrade has immutable origins but no current proof rows. A
    // public upload cannot create that old protocol, so arrange only its ledger
    // shape; all fault, ownership, history and recovery assertions use HTTP.
    await f.testDatabase.query('DELETE FROM event_integrity WHERE event_id IN(SELECT event_id FROM snapshot_events WHERE snapshot_id=$1)',[first.snapshotId]);
    const unavailable=await get();assert.equal(unavailable.summary.replyWaitMs,null);assert.equal(unavailable.summary.knownReplyWaitMs,100000);
    assert.equal(unavailable.total,100);assert.deepEqual(unavailable.unavailableSources.map((row:any)=>row.snapshotId).sort(),[first.snapshotId,copy.snapshotId].sort());
    assert.ok(unavailable.unavailableSources.every((row:any)=>row.employeeId===owner.employeeId&&row.reason==='missing'));
    assert.deepEqual(await get(path+'&version='+before.version),before);
    assert.deepEqual((await get('/api/waits/export?period=since-enrollment&employeeId='+copyOwner.employeeId)).unavailableSources,[]);
    await writeFile(restore.path,restore.bytes);const recovered=await get();assert.deepEqual(recovered.summary,before.summary);assert.deepEqual(recovered.intervals,before.intervals);assert.deepEqual(recovered.unavailableSources,[]);
    const incremental=f.rows({prompts:2,verified:0,claimed:0});await f.upload(owner,incremental.rows,incremental.sessionId);
    const late=await get();assert.equal(late.total,102);assert.equal(late.summary.replyWaitMs,102000);assert.notEqual(late.version,before.version);
    assert.deepEqual(await get(path+'&version='+before.version),before);
  }finally{if(restore)await writeFile(restore.path,restore.bytes);await f.close();}
});
