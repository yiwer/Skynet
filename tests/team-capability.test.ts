import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { assessmentFixture } from './assessment-fixture.js';

test('weekly team capability pins since-enrollment assessments and preserves pending coverage across later uploads',{timeout:180000},async()=>{
  const sandbox=await assessmentFixture();
  try{
    const person=await sandbox.owner('Alpha'),empty=await sandbox.owner('Beta');
    await sandbox.session(person,{prompts:3,verified:1});
    const health=await sandbox.nativeApi('/api/devices/health',person.deviceCredential,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nonce:randomUUID(),source:'codex-cli',capture:{checkedAt:new Date().toISOString(),observation:'host-event-observed',locallyPersisted:true,faults:[{id:randomUUID(),code:'source-missing',scope:'source',firstObservedAt:new Date().toISOString(),lastObservedAt:new Date().toISOString(),recoveredAt:null,coverage:'unverified-range'}]}})});assert.equal(health.status,200);
    const response=await sandbox.api(person,'/api/team-report?period=this-week');assert.equal(response.status,200,await response.clone().text());const team=await response.json();
    assert.equal(team.totals.sessions,0,'activity remains in its selected week');assert.equal(team.capability.selection.period,'since-enrollment');assert.equal(team.capability.selection.preset,'默认');
    const directory=await(await sandbox.api(person,'/api/capability-people?version='+team.capability.version)).json();
    assert.deepEqual(team.people.map((row:any)=>row.employee),['Alpha','Beta']);
    for(const row of team.people){const card=directory.employees.find((card:any)=>card.employeeId===row.employeeId),assessment=await(await sandbox.api(person,'/api/assessments/'+row.employeeId+'?version='+row.capability.assessmentVersion)).json();
      assert.equal(row.capability.assessmentVersion,card.assessmentVersion);for(const key of ['level','index','confidence','reason'])assert.equal(row.capability[key],assessment[key]);assert.deepEqual(row.capability.coverageIssues,assessment.coverageIssues);assert.equal(assessment.selection.period,'since-enrollment');assert.equal(assessment.preset,'默认');
      const link=new URLSearchParams(row.capability.profilePath.split('?')[1]);assert.equal(link.get('employeeId'),row.employeeId);assert.equal(link.get('period'),'since-enrollment');assert.equal(link.get('preset'),'默认');assert.equal(link.get('version'),assessment.version);
    }
    const first=team.people.find((row:any)=>row.employeeId===person.employeeId).capability;
    assert.equal(first.level,'待定');assert.ok(first.coverageIssues.length>0);assert.match(first.reason,/样本不足|采集覆盖不完整/);
    const historical=await(await sandbox.api(person,'/api/assessments/'+person.employeeId+'?version='+first.assessmentVersion)).json();assert.equal(historical.sample.sessions,1);assert.equal(historical.sample.prompts,3);
    assert.equal(team.people.find((row:any)=>row.employeeId===empty.employeeId).capability.index,null);
    const fixed='/api/team-report?period=this-week&version='+team.version;assert.deepEqual(await(await sandbox.api(person,fixed)).json(),team);
    assert.deepEqual(await(await sandbox.api(person,'/api/team-report/export?period=this-week&version='+team.version)).json(),team);
    await sandbox.session(person,{prompts:3,verified:1});const newer=await(await sandbox.api(person,'/api/team-report?period=this-week')).json();assert.notEqual(newer.version,team.version);assert.equal(newer.totals.sessions,0);
    await sandbox.restart();assert.deepEqual(await(await sandbox.api(person,fixed)).json(),team);
  }finally{await sandbox.close();}
});
