import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout} from 'node:timers/promises';
import {assessmentFixture} from './assessment-fixture.js';

test('profile coaching retries a concurrent real upload and freezes both weeks against the same source and baseline',{timeout:180000},async()=>{
  const f=await assessmentFixture(),held=await f.testDatabase.connect();let locked=false;
  try{
    const owner=await f.owner('辅导交错');await f.session(owner,{prompts:3});await f.session(owner,{prompts:3});
    // This real database lock only schedules the public upload during publication.
    await held.query('SELECT pg_advisory_lock(7402140)');locked=true;const pid=(await held.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const path='/api/capability-profiles/'+owner.employeeId,pending=f.api(owner,path);let reached=false;
    for(let tick=0;tick<500;tick++){reached=(await f.testDatabase.query('SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS reached',[pid])).rows[0].reached;if(reached)break;await setTimeout(20);}
    assert.equal(reached,true);
    const late=await f.session(owner,{prompts:3,elements:4,long:true});await held.query('SELECT pg_advisory_unlock(7402140)');locked=false;
    const response=await pending;assert.equal(response.status,200,await response.clone().text());const profile=await response.json(),coaching=profile.coaching;
    assert.equal(profile.kpis.sessions,3);assert.equal(coaching.communication.firstPrompts.person.count,3);assert.equal(coaching.communication.firstPrompts.person.elements.acceptance.value,1/3);
    assert.equal(coaching.waiting.summary.knownCount,6);assert.equal(coaching.waiting.summary.longFraction.numerator,2);
    assert.equal(coaching.usageVersion,profile.assessment.inputs.usageVersion);assert.equal(coaching.waiting.waitVersion,profile.assessment.inputs.waitsVersion);
    for(const week of [coaching.trend.previous,coaching.trend.current]){assert.equal(week.modelVersion,profile.assessment.modelVersion);assert.equal(week.baselineVersion,profile.assessment.inputs.baselineVersion);assert.equal(week.frontierVersion,profile.assessment.inputs.frontierVersion);}
    const usage=await(await f.api(owner,'/api/usage-output/export?period=since-enrollment&version='+coaching.usageVersion)).json();assert.ok(usage.sessions.some((row:any)=>row.snapshotIds.includes(late.snapshotId)));
    assert.deepEqual(await(await f.api(owner,path+'?version='+profile.version)).json(),profile);
    assert.deepEqual(await(await f.api(owner,path+'/recompute',{})).json(),profile);
  }finally{if(locked)await held.query('SELECT pg_advisory_unlock(7402140)');held.release();await f.close();}
});
