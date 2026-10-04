import test from 'node:test';
import assert from 'node:assert/strict';
import {assessmentFixture} from './assessment-fixture.js';
import {beijingDate} from '../packages/contracts/reports.js';
import {monday,addDays} from '../packages/contracts/work-views.js';
import {dimKeys} from '../packages/contracts/assessment.js';

test('profile weekly trend freezes comparable model, preset, baseline and natural-week inputs across late data and week rollover',{timeout:180000},async()=>{
  const f=await assessmentFixture();
  try{
    const owner=await f.owner('固定周趋势'),newcomer=await f.owner('本周开始'),thisWeek=monday(beijingDate(f.now)),lastWeek=addDays(thisWeek,-7);
    async function dated(person:typeof owner,date:string,verified:number){const item=f.rows({prompts:3,verified}),start=Date.parse(date+'T10:00:00+08:00');for(const row of item.rows as any[])if(row.timestamp){const delta=Date.parse(row.timestamp)-f.base.getTime();if(delta>=0)row.timestamp=new Date(start+delta).toISOString();}const record=await f.upload(person,item.rows,item.sessionId);await f.analyze(person,record.snapshotId);}
    for(let n=0;n<3;n++){await dated(owner,addDays(lastWeek,n),1);await dated(owner,addDays(thisWeek,n),2);}await dated(newcomer,thisWeek,1);
    const path='/api/capability-profiles/'+owner.employeeId,response=await f.api(owner,path+'?preset='+encodeURIComponent('重质量'));assert.equal(response.status,200,await response.clone().text());const profile=await response.json(),trend=profile.coaching.trend;
    assert.ok(trend,'profile contains a frozen last-week/this-week comparison');assert.equal(trend.preset,'重质量');
    assert.deepEqual(trend.previous.range,{from:lastWeek,to:addDays(lastWeek,6)});assert.deepEqual(trend.current.range,{from:thisWeek,to:addDays(thisWeek,6)});
    assert.equal(trend.previous.sessions,3);assert.equal(trend.current.sessions,3);assert.equal(trend.previous.modelVersion,profile.assessment.modelVersion);assert.equal(trend.current.modelVersion,trend.previous.modelVersion);
    assert.equal(trend.previous.baselineVersion,trend.current.baselineVersion);assert.equal(trend.current.baselineVersion,profile.assessment.inputs.baselineVersion);assert.equal(trend.previous.frontierVersion,trend.current.frontierVersion);
    for(const point of [trend.previous,trend.current]){
      const fixed=await(await f.api(owner,'/api/assessments/'+owner.employeeId+'/export?version='+point.assessmentVersion)).json();assert.equal(point.index,fixed.index);assert.equal(point.usageVersion,fixed.inputs.usageVersion);assert.equal(point.waitsVersion,fixed.inputs.waitsVersion);
      for(const key of dimKeys)assert.equal(point.dimensions[key],fixed.dims[key].score);
    }
    const fresh=await(await f.api(newcomer,'/api/capability-profiles/'+newcomer.employeeId)).json();assert.equal(fresh.coaching.trend.previous.state,'empty');assert.equal(fresh.coaching.trend.previous.index,null);assert.equal(fresh.coaching.trend.current.sessions,1);
    await dated(newcomer,thisWeek,5);const changed=await(await f.api(owner,path+'?preset='+encodeURIComponent('重质量'))).json();assert.notEqual(changed.coaching.trend.current.baselineVersion,trend.current.baselineVersion);assert.notEqual(changed.version,profile.version);
    f.now.setUTCDate(f.now.getUTCDate()+7);assert.deepEqual(await(await f.api(owner,path+'?version='+profile.version)).json(),profile);
    const next=await(await f.api(owner,path+'?preset='+encodeURIComponent('重质量'))).json();assert.equal(next.coaching.trend.previous.range.from,thisWeek);assert.equal(next.coaching.trend.current.state,'empty');assert.equal(next.coaching.trend.current.index,null);
  }finally{await f.close();}
});
