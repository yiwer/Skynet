import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {beijingDate} from '../packages/contracts/reports.js';
import {assessmentFixture} from './assessment-fixture.js';

test('current insights isolate missing or corrupt original bytes while retaining fixed history and scoped team usage', {timeout:180000},async()=>{
  const f=await assessmentFixture();let restore:{path:string;bytes:Buffer}|undefined;
  try{
    const bad=await f.owner('Unavailable owner'),good=await f.owner('Readable owner'),record=await f.session(bad);await f.session(good);
    const get=async(path:string)=>{const response=await f.api(good,path);assert.equal(response.status,200,await response.clone().text());return response.json();};
    const path='/api/snapshots/'+record.snapshotId+'/insights',usage='/api/usage-output/export?period=since-enrollment&employeeId='+good.employeeId;
    const before=await get(path),beforeUsage=await get(usage);assert.equal(before.metrics.verified,1);assert.equal(beforeUsage.totals.inputTokens,1000);
    for(const suffix of ['','/raw','/readable','/recovery'])assert.equal((await f.api(good,'/api/snapshots/'+record.snapshotId+suffix)).status,200);
    restore={path:join(f.directory,'raw',bad.deviceId,createHash('sha256').update(record.bytes).digest('hex')),bytes:record.bytes};
    for(const fault of ['hash-mismatch','missing'] as const){
      if(fault==='missing')await unlink(restore.path);else await writeFile(restore.path,'synthetic corruption only\n');
      for(const suffix of ['','/raw','/readable','/recovery']){const response=await f.api(good,'/api/snapshots/'+record.snapshotId+suffix);assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'原件不可读取',code:'source_unavailable',reason:fault});}
      const broken=await get(path);assert.equal(broken.state,'unavailable');assert.equal(broken.inferences,null);assert.equal(broken.metrics.verified,null);assert.equal(broken.facts.tests.value,null);assert.equal(broken.sourceAvailability.reason,fault);assert.equal(broken.messageFactsVersion,undefined);assert.notEqual(broken.version,before.version);
      assert.deepEqual(await get(path+'?version='+before.version),before);
      const scoped=await get(usage);assert.equal(scoped.totals.inputTokens,1000);assert.equal(scoped.outputs.verified.value,1);assert.equal(scoped.sourceInputsComplete,true);assert.equal(scoped.sessions.length,2);assert.equal(scoped.sessions.find((row:any)=>row.employeeId===bad.employeeId).selected,false);assert.equal(scoped.sessions.find((row:any)=>row.employeeId===bad.employeeId).outputs.verified.value,null);
      assert.deepEqual(await get(usage+'&version='+beforeUsage.version),beforeUsage);
      const owned=await get('/api/usage-output/export?period=since-enrollment&employeeId='+bad.employeeId);assert.equal(owned.sourceInputsComplete,false);assert.equal(owned.outputs.verified.value,null);
      await writeFile(restore.path,restore.bytes);assert.deepEqual(await get(path),before);assert.deepEqual(await get(usage),beforeUsage);
    }
  }finally{if(restore)await writeFile(restore.path,restore.bytes);await f.close();}
});

test('a first read during a source outage does not replace normal facts after restoration', {timeout:120000},async()=>{
  const f=await assessmentFixture();let restore:{path:string;bytes:Buffer}|undefined;
  try{
    const owner=await f.owner('Cold source recovery'),input=f.rows({prompts:3}),record=await f.upload(owner,input.rows,input.sessionId);
    const get=async(path:string)=>{const response=await f.api(owner,path);assert.equal(response.status,200,await response.clone().text());return response.json();};
    restore={path:join(f.directory,'raw',owner.deviceId,createHash('sha256').update(record.bytes).digest('hex')),bytes:record.bytes};await unlink(restore.path);
    const insightPath='/api/snapshots/'+record.snapshotId+'/insights',waitPath='/api/waits/export?snapshotId='+record.snapshotId;
    const unavailable=await get(insightPath);assert.equal(unavailable.sourceAvailability.reason,'missing');assert.equal(unavailable.facts.tests.value,null);
    assert.equal((await get(waitPath)).summary.replyWaitMs,null);
    await writeFile(restore.path,restore.bytes);
    const recovered=await get(insightPath);assert.equal(recovered.sourceAvailability,undefined);assert.equal(recovered.facts.tests.value,1);assert.ok(recovered.messageFactsVersion);assert.notEqual(recovered.version,unavailable.version);
    assert.equal((await get(waitPath)).summary.replyWaitMs,2000);assert.deepEqual(await get(insightPath+'?version='+unavailable.version),unavailable);
  }finally{if(restore)await writeFile(restore.path,restore.bytes);await f.close();}
});

test('warm material downloads and complete exports verify their current source while the readable parent remains independent', {timeout:120000},async()=>{
  const f=await assessmentFixture();let restore:{path:string;bytes:Buffer}|undefined;
  try{
    const owner=await f.owner('Material recovery'),child=f.rows({prompts:1}),bytes=Buffer.from(child.rows.map(row=>JSON.stringify(row)).join('\n')+'\n'),hash=createHash('sha256').update(bytes).digest('hex');
    const staged=await f.nativeApi('/api/chunks/'+hash,owner.deviceCredential,{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:bytes});assert.ok([200,201].includes(staged.status));
    const material={id:createHash('sha256').update('synthetic-child-material').digest('hex'),role:'child-transcript',name:'child.jsonl',placement:'codex-rollout',sourceSessionId:child.sessionId,hash,byteLength:bytes.length,mediaType:'jsonl'};
    const parent=f.rows({prompts:1}),record=await f.upload(owner,parent.rows,parent.sessionId,{capture:{generation:createHash('sha256').update('synthetic-material-generation').digest('hex'),revision:1,change:'initial',materials:[material],gaps:[],lineage:[{relation:'child',sessionId:child.sessionId,materialId:material.id}],compacted:false,partialLine:false}});
    const path='/api/snapshots/'+record.snapshotId,paths=['/materials/'+material.id,'/materials/'+material.id+'/view','/readable','/recovery'];
    const before=[];for(const suffix of paths){const response=await f.api(owner,path+suffix);assert.equal(response.status,200);before.push(Buffer.from(await response.arrayBuffer()));}
    restore={path:join(f.directory,'raw',owner.deviceId,hash),bytes};
    for(const reason of ['hash-mismatch','missing'] as const){
      if(reason==='missing')await unlink(restore.path);else await writeFile(restore.path,'synthetic material damaged\n');
      for(const suffix of paths){const response=await f.api(owner,path+suffix);assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'原件不可读取',code:'source_unavailable',reason});}
      assert.equal((await f.api(owner,path)).status,200);assert.deepEqual(Buffer.from(await(await f.api(owner,path+'/raw')).arrayBuffer()),record.bytes);
      await writeFile(restore.path,restore.bytes);for(const [index,suffix]of paths.entries()){const response=await f.api(owner,path+suffix);assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),before[index]);}
    }
  }finally{if(restore)await writeFile(restore.path,restore.bytes);await f.close();}
});


test('waits activity and composed profiles isolate source outages without inventing zero intervals or dated messages', {timeout:240000},async()=>{
  const f=await assessmentFixture();let restore:{path:string;bytes:Buffer}|undefined;
  try{
    const bad=await f.owner('Wait unavailable'),good=await f.owner('Wait readable'),record=await f.session(bad,{prompts:3,long:true});await f.session(good,{prompts:3});
    const get=async(path:string)=>{const response=await f.api(good,path);assert.equal(response.status,200,await response.clone().text());return response.json();};
    const date=beijingDate(f.base),waitBad='/api/waits/export?period=since-enrollment&employeeId='+bad.employeeId,waitGood='/api/waits/export?period=since-enrollment&employeeId='+good.employeeId;
    const activityBad='/api/activity/export?date='+date+'&employeeId='+bad.employeeId,activityGood='/api/activity/export?date='+date+'&employeeId='+good.employeeId;
    const beforeWait=await get(waitBad),beforeActivity=await get(activityBad),beforeGood=await get(waitGood),beforeProfile=await get('/api/capability-profiles/'+good.employeeId);
    assert.equal(beforeWait.summary.replyWaitMs,1202000);assert.equal(beforeGood.summary.replyWaitMs,2000);assert.equal(beforeActivity.events.filter((event:any)=>event.type==='prompt').length,3);
    restore={path:join(f.directory,'raw',bad.deviceId,createHash('sha256').update(record.bytes).digest('hex')),bytes:record.bytes};
    for(const fault of ['hash-mismatch','missing'] as const){
      if(fault==='missing')await unlink(restore.path);else await writeFile(restore.path,'synthetic wait corruption\n');
      const broken=await get(waitBad);assert.equal(broken.summary.replyWaitMs,null);assert.equal(broken.intervals.length,0);assert.equal(broken.unavailableSources.length,1);assert.equal(broken.unavailableSources[0].employeeId,bad.employeeId);assert.equal(broken.unavailableSources[0].reason,fault);assert.ok(broken.unknownReasons.some((reason:string)=>reason.includes('不可读取')));
      assert.deepEqual(await get(waitGood),beforeGood);assert.deepEqual(await get(waitBad+'&version='+beforeWait.version),beforeWait);
      const activity=await get(activityBad);assert.equal(activity.coverage.unavailableSources,1);assert.equal(activity.events.filter((event:any)=>['prompt','reply','long-wait'].includes(event.type)).length,0);assert.equal(activity.events.length,1);assert.equal(activity.events[0].type,'gap');assert.equal(activity.events[0].employeeId,bad.employeeId);assert.equal(activity.events[0].timestamp,null);assert.equal(activity.events[0].sourceDate,null);
      assert.equal((await get(activityGood)).events.filter((event:any)=>event.type==='prompt').length,3);assert.deepEqual(await get(activityBad+'&version='+beforeActivity.version),beforeActivity);
      const timing=await get('/api/session-efficiency/export?period=since-enrollment&employeeId='+bad.employeeId);assert.equal(timing.sessions[0].timing.activeMs,null);assert.ok(timing.sessions[0].timing.segments.some((segment:any)=>segment.kind==='gap'&&segment.durationMs===null));
      const profile=await get('/api/capability-profiles/'+good.employeeId);assert.equal(profile.kpis.inputTokens,1000);assert.equal(profile.usage.sourceInputsComplete,true);assert.equal(profile.kpis.outputs.verified.value,1);assert.deepEqual(await get('/api/capability-profiles/'+good.employeeId+'?version='+beforeProfile.version),beforeProfile);
      await writeFile(restore.path,restore.bytes);assert.deepEqual(await get(waitBad),beforeWait);assert.deepEqual(await get(activityBad),beforeActivity);
    }
  }finally{if(restore)await writeFile(restore.path,restore.bytes);await f.close();}
});


test('unavailable restored carriers keep original owners and distinguish same-session loss from unknown parallel activity', {timeout:180000},async()=>{
  const f=await assessmentFixture(),restore:{path:string;bytes:Buffer}[]=[];
  try{
    const a=await f.owner('Original employee'),b=await f.owner('Restore employee'),record=await f.session(a,{prompts:3,long:true});
    const copy=await f.upload(b,record.rows,record.sessionId,{restoredFrom:{snapshotId:record.snapshotId,hash:createHash('sha256').update(record.bytes).digest('hex'),byteLength:record.bytes.length}});
    const get=async(path:string)=>{const response=await f.api(a,path);assert.equal(response.status,200,await response.clone().text());return response.json();};
    const query='/api/waits/export?period=since-enrollment&employeeId='+a.employeeId,before=await get(query);assert.equal(before.intervals.length,2);assert.ok(before.intervals.every((row:any)=>row.parallel==='not-observed'));
    const target={path:join(f.directory,'raw',b.deviceId,createHash('sha256').update(copy.bytes).digest('hex')),bytes:copy.bytes};restore.push(target);await writeFile(target.path,'only synthetic restored carrier damaged\n');
    const broken=await get(query);assert.equal(broken.unavailableSources.length,1);assert.equal(broken.unavailableSources[0].employeeId,a.employeeId);assert.ok(broken.intervals.every((row:any)=>row.parallel==='not-observed'),'a lost copy of the same logical session is not an unknown other session');assert.equal(broken.summary.replyWaitMs,null);
    const other=await get('/api/waits/export?period=since-enrollment&employeeId='+b.employeeId);assert.deepEqual(other.unavailableSources,[]);
    const activity=await get('/api/activity/export?date='+beijingDate(f.base));assert.ok(activity.events.filter((event:any)=>event.type==='gap').every((event:any)=>event.employeeId===a.employeeId));
    await writeFile(target.path,target.bytes);assert.deepEqual(await get(query),before);const full=await f.api(a,'/api/waits/recompute',{period:'since-enrollment',employeeId:a.employeeId});assert.equal(full.status,200);assert.deepEqual(await full.json(),before);
    const second=await f.session(a,{prompts:1}),parallel={path:join(f.directory,'raw',a.deviceId,createHash('sha256').update(second.bytes).digest('hex')),bytes:second.bytes};restore.push(parallel);await writeFile(parallel.path,'synthetic other session damaged\n');
    const selected=await get('/api/waits/export?snapshotId='+record.snapshotId);assert.ok(selected.intervals.length);assert.ok(selected.intervals.every((row:any)=>row.parallel==='unknown'));
    assert.equal((await f.api(a,'/api/waits?employeeId='+b.employeeId+'&version='+before.version+'&period=since-enrollment')).status,400);
  }finally{for(const item of restore)await writeFile(item.path,item.bytes);await f.close();}
});
