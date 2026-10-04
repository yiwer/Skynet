import test from 'node:test';
import assert from 'node:assert/strict';
import {assessmentFixture} from './assessment-fixture.js';
import {beijingDate} from '../packages/contracts/reports.js';
import {addDays} from '../packages/contracts/work-views.js';

test('profile communication compares original first prompts with pooled team messages at its frozen usage version',{timeout:120000},async()=>{
  const f=await assessmentFixture();
  try{
    const owner=await f.owner('首条核查'),other=await f.owner('团队参照');
    async function session(person:typeof owner,first:number,later:number,prompts:number){const item=f.rows({prompts,elements:later});const user=(item.rows as any[]).find(row=>row.payload?.role==='user');user.payload.content[0].text='首条原句 elements='+first;const record=await f.upload(person,item.rows,item.sessionId);await f.analyze(person,record.snapshotId);return record;}
    await session(owner,4,0,3);await session(owner,0,4,5);await session(other,4,0,1);
    const path='/api/capability-profiles/'+owner.employeeId,response=await f.api(owner,path);assert.equal(response.status,200,await response.clone().text());
    const profile=await response.json();assert.ok(profile.coaching,'profile includes its fixed communication observations');
    assert.equal(profile.coaching.usageVersion,profile.assessment.inputs.usageVersion);
    assert.equal(profile.coaching.communication.firstPrompts.person.count,2);assert.equal(profile.coaching.communication.firstPrompts.team.count,3);
    for(const key of ['goal','constraints','context','acceptance']){
      assert.deepEqual(profile.coaching.communication.firstPrompts.person.elements[key],{value:.5,numerator:1,denominator:2,unknown:0});
      assert.deepEqual(profile.coaching.communication.firstPrompts.team.elements[key],{value:2/3,numerator:2,denominator:3,unknown:0});
    }
    const communication=profile.coaching.communication;
    assert.deepEqual(communication.rework,{value:0,numerator:0,denominator:6,unknown:0});assert.deepEqual(communication.cleanSessions,{value:1,numerator:2,denominator:2,unknown:0});
    assert.deepEqual(communication.clarification,{value:0,numerator:0,denominator:8,unknown:0});assert.equal(communication.medianLength.knownCount,8);assert.equal(communication.medianLength.unknownCount,0);
    const saved=await(await f.api(owner,path+'/export?version='+profile.version)).json();await session(other,0,0,1);
    const next=await(await f.api(owner,path)).json();assert.notEqual(next.version,profile.version);assert.equal(next.coaching.communication.firstPrompts.team.elements.goal.value,.5);
    assert.deepEqual(await(await f.api(owner,path+'?version='+profile.version)).json(),profile);
    assert.deepEqual(await(await f.api(owner,path+'/export?version='+profile.version)).json(),saved);
  }finally{await f.close();}
});

test('representative sessions use verified-result and Token ties, with exact original first and rework sentences',{timeout:180000},async()=>{
  const f=await assessmentFixture();
  try{
    const owner=await f.owner('代表原句');await f.session(owner,{prompts:3,verified:2,tokens:900});
    const best=await f.session(owner,{prompts:3,verified:2,tokens:500}),tied=await f.session(owner,{prompts:3,verified:2,tokens:500}),worst=await f.session(owner,{prompts:3,verified:0,rework:true});
    await f.session(owner,{prompts:2,verified:0,rework:true});await f.session(owner,{prompts:3,verified:5,active:true});
    const unknown=f.rows({prompts:3,verified:2});unknown.rows=unknown.rows.filter((row:any)=>row.payload?.type!=='token_count');const unknownRecord=await f.upload(owner,unknown.rows,unknown.sessionId);await f.analyze(owner,unknownRecord.snapshotId);
    const path='/api/capability-profiles/'+owner.employeeId,response=await f.api(owner,path);assert.equal(response.status,200,await response.clone().text());const profile=await response.json(),examples=profile.coaching.representatives;
    assert.ok(examples,'selected examples retain the original sentence, not just a general session link');
    const full=await(await f.api(owner,path+'/export?version='+profile.version)).json(),expected=full.sessions.filter((row:any)=>[best.snapshotId,tied.snapshotId].includes(row.snapshotId)).sort((a:any,b:any)=>a.sessionId.localeCompare(b.sessionId))[0];
    assert.equal(examples.best.snapshotId,expected.snapshotId);assert.equal(examples.best.snapshotId,profile.assessment.representatives.best.snapshotId);assert.equal(examples.best.verified,2);assert.equal(examples.best.tokens,500);assert.equal(examples.best.rework,0);
    assert.equal(examples.rework.snapshotId,worst.snapshotId);assert.equal(examples.rework.rework,2);assert.equal(examples.rework.claimed,1);assert.equal(examples.rework.verified,0);
    assert.equal(examples.best.citation.quote,'请求 0 elements=3');assert.equal(examples.rework.citation.quote,'返工 1 elements=3');
    for(const [example,raw] of [[examples.best,best.bytes],[examples.rework,worst.bytes]] as const){
      assert.ok(raw.toString().includes(example.citation.quote));assert.match(example.citation.webPath,/line=/);
      const fixed=await(await f.api(owner,'/api/snapshots/'+example.insight.snapshotId+'/insights?version='+example.insight.version)).json();
      assert.ok(fixed.inferences.prompts.some((prompt:any)=>prompt.citations.some((cite:any)=>cite.origin.eventId===example.citation.origin.eventId&&cite.quote===example.citation.quote)));
    }
    const recomputed=await(await f.api(owner,path+'/recompute',{})).json();assert.deepEqual(recomputed.coaching.representatives,examples);
  }finally{await f.close();}
});

test('profile waits pool original intervals by Beijing hour and bind the same frozen assessment source',{timeout:120000},async()=>{
  const f=await assessmentFixture();
  try{
    const owner=await f.owner('等待核查'),day=beijingDate(f.base);
    for(const [date,minute,seconds] of [[day,0,599],[day,12,600],[day,24,601],[addDays(day,1),0,10]] as const){
      const item=f.rows({prompts:2}),start=Date.parse(date+'T08:00:00+08:00')+minute*60000;
      for(const row of item.rows as any[])if(row.timestamp){const delta=Date.parse(row.timestamp)-f.base.getTime();if(delta>=0)row.timestamp=new Date(delta>=1100?start+seconds*1000+delta-1100:start+delta-100).toISOString();}
      const record=await f.upload(owner,item.rows,item.sessionId);await f.analyze(owner,record.snapshotId);
    }
    const response=await f.api(owner,'/api/capability-profiles/'+owner.employeeId);assert.equal(response.status,200,await response.clone().text());const profile=await response.json(),waiting=profile.coaching.waiting;
    assert.ok(waiting,'response observations belong in the same fixed profile');assert.equal(waiting.waitVersion,profile.assessment.inputs.waitsVersion);
    assert.equal(waiting.summary.medianMs,599500);assert.equal(waiting.summary.p90Ms,601000);assert.equal(waiting.summary.knownCount,4);assert.equal(waiting.summary.unknownCount,0);
    assert.deepEqual(waiting.summary.longFraction,{numerator:2,denominator:4,value:.5});
    assert.deepEqual(waiting.hours.find((hour:any)=>hour.hour===8),{hour:8,count:4,medianMs:599500});assert.equal(waiting.hours.find((hour:any)=>hour.hour===3).medianMs,null);
    assert.equal(waiting.permissions.state,'unknown');assert.equal(waiting.summary.permissionMedianMs,null);assert.deepEqual(waiting.permissions.requests,[]);
    const waits=await(await f.api(owner,'/api/waits/export?period=since-enrollment&version='+waiting.waitVersion)).json();
    for(const evidence of waiting.evidence){assert.ok(waits.intervals.some((interval:any)=>interval.id===evidence.id&&interval.employeeId===owner.employeeId));assert.match(evidence.end.webPath,/line=/);}
  }finally{await f.close();}
});
