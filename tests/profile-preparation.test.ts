import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {assessmentFixture} from './assessment-fixture.js';
import {monday,addDays} from '../packages/contracts/work-views.js';
import {beijingDate} from '../packages/contracts/reports.js';

test('current employee profiles retain standalone usage and efficiency versions across periods, full recomputation and late input',{timeout:180000},async()=>{
  const f=await assessmentFixture();
  try{
    const owner=await f.owner('固定准备甲'),peer=await f.owner('固定准备乙');
    const week=monday(beijingDate(f.now));
    async function recorded(person:typeof owner,date:string,tokens:number){
      const original=f.rows({prompts:3,tokens,verified:1,claimed:0});
      const shift=Date.parse(date+'T12:00:00+08:00')-f.base.getTime();
      for(const row of original.rows.slice(2) as {timestamp?:string}[])if(row.timestamp)row.timestamp=new Date(Date.parse(row.timestamp)+shift).toISOString();
      const saved=await f.upload(person,original.rows,original.sessionId);await f.analyze(person,saved.snapshotId);return saved;
    }
    await recorded(owner,week,1000);await recorded(owner,addDays(week,-7),2000);await recorded(peer,week,9000);
    const path='/api/capability-profiles/'+owner.employeeId;
    async function get(path:string,body?:object){const r=await f.api(owner,path,body);assert.equal(r.status,200,await r.clone().text());return r.json();}
    const originals=[];
    for(const [period,sessions,tokens]of[['since-enrollment',2,3000],['this-week',1,1000],['last-week',1,2000]] as const){
      const query=new URLSearchParams({period,employeeId:owner.employeeId});
      const usage=await get('/api/usage-output/export?'+query),efficiency=await get('/api/session-efficiency/export?'+query);
      const profile=await get(path+'?period='+period);originals.push(profile);
      assert.equal(profile.kpis.sessions,sessions);assert.equal(profile.kpis.inputTokens,tokens);assert.equal(profile.kpis.outputs.verified.value,sessions);
      assert.deepEqual(profile.kpis.outputs,usage.outputs);assert.equal(profile.references.efficiency.version,efficiency.version);
      assert.equal(efficiency.usageVersion,usage.version);assert.equal(profile.usage.metricVersion,usage.metricVersion);
      assert.deepEqual(profile.sessions.map((s:any)=>s.sessionId).sort(),efficiency.sessions.map((s:any)=>s.sessionId).sort());
      assert.ok(efficiency.sessions.every((s:any)=>s.employees.every((employee:any)=>employee.employeeId===owner.employeeId)));
      assert.deepEqual(await get(path+'/recompute',{period}),profile,'full upstream metric and projection recomputation preserves the same result');
      assert.deepEqual(await get('/api/session-efficiency/export?'+query+'&version='+profile.references.efficiency.version),efficiency);
    }
    await recorded(owner,addDays(week,1),4000);
    const latest=await get(path);assert.equal(latest.kpis.sessions,3);assert.equal(latest.kpis.inputTokens,7000);
    assert.notEqual(latest.version,originals[0].version);assert.equal(latest.references.efficiency.version,(await get('/api/session-efficiency/export?period=since-enrollment&employeeId='+owner.employeeId)).version);
    for(const original of originals)assert.deepEqual(await get(path+'?version='+original.version),original);
  }finally{await f.close();}
});

test('a corrected prompt updates prepared employee efficiency without replacing the fixed profile history',{timeout:120000},async()=>{
  const f=await assessmentFixture();
  try{
    const owner=await f.owner('准备后更正'),record=await f.session(owner,{prompts:4});
    const path='/api/capability-profiles/'+owner.employeeId;
    async function get(path:string){const r=await f.api(owner,path);assert.equal(r.status,200,await r.clone().text());return r.json();}
    const first=await get(path),insight=await get('/api/snapshots/'+record.snapshotId+'/insights');
    const correction=await f.api(owner,'/api/snapshots/'+record.snapshotId+'/inference-corrections',{
      requestId:randomUUID(),expectedVersion:insight.version,kind:'rework',promptEvent:insight.inferences.prompts[1].event,value:true,reason:'核对原文后将第二轮标记为返工',
    });
    assert.equal(correction.status,201,await correction.clone().text());
    const after=await get(path),efficiency=await get('/api/session-efficiency/export?period=since-enrollment&employeeId='+owner.employeeId);
    assert.notEqual(after.version,first.version);assert.notEqual(after.frontierVersion,first.frontierVersion);
    assert.equal(after.references.efficiency.version,efficiency.version);assert.equal(after.sessions[0].rework,1);
    assert.equal(after.assessment.dims.iter.metrics.find((metric:any)=>metric.key==='rework').value,1/3);
    assert.equal(efficiency.sessions[0].rework,after.sessions[0].rework);assert.equal(efficiency.metricVersion,after.assessment.inputs.metricsVersion);
    assert.deepEqual(await get(path+'?version='+first.version),first);assert.deepEqual(await get(path+'?assessmentVersion='+first.assessment.version),first);
    const full=await f.api(owner,path+'/recompute',{});assert.equal(full.status,200);assert.deepEqual(await full.json(),after);
  }finally{await f.close();}
});
