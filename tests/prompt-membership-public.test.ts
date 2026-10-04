import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {assessmentFixture} from './assessment-fixture.js';

test('restored prompt memberships preserve complete-session context and an unknown scoped predecessor without merging an unrelated native ID',{timeout:150000},async()=>{
  const f=await assessmentFixture();
  try{
    const author=await f.owner('原提示词归属'),continuing=await f.owner('恢复后归属'),unrelated=await f.owner('独立原生会话');
    const originalRows=f.rows({prompts:3,elements:4});
    const original=await f.upload(author,originalRows.rows,originalRows.sessionId,{project:'/synthetic/原,["😀"]'});
    await f.analyze(author,original.snapshotId);
    const time=(n:number)=>new Date(f.base.getTime()+10000+n).toISOString(),project='/synthetic/恢复,["😀"]';
    const restored=await f.upload(continuing,[...original.rows,
      {type:'response_item',timestamp:time(0),payload:{type:'message',role:'user',content:[{type:'input_text',text:'返工 接续 elements=0'}]}},
      {type:'event_msg',timestamp:time(1),payload:{type:'task_started',turn_id:'continued'}},
      {type:'response_item',timestamp:time(2),payload:{type:'message',role:'assistant',content:[{type:'output_text',text:'已调整'}]}},
      {type:'event_msg',timestamp:time(3),payload:{type:'task_complete',turn_id:'continued'}}
    ],original.sessionId,{project,restoredFrom:{snapshotId:original.snapshotId,hash:createHash('sha256').update(original.bytes).digest('hex'),byteLength:original.bytes.length}});
    await f.analyze(continuing,restored.snapshotId,{clarification:true});
    const other=f.rows({id:original.sessionId,prompts:1,elements:0}),independent=await f.upload(unrelated,other.rows,original.sessionId,{project});
    await f.analyze(unrelated,independent.snapshotId);
    const path='/api/prompt-report?'+new URLSearchParams({period:'since-enrollment',employeeId:continuing.employeeId,project});
    const response=await f.api(continuing,path);assert.equal(response.status,200,await response.clone().text());const before=await response.json();
    assert.equal(before.kpis.prompts,1);assert.equal(before.kpis.sessions,1);
    assert.deepEqual(before.kpis.rework,{numerator:1,denominator:1,unknown:0,value:1});
    // This scope excludes the original-owner snapshot membership. Its prior
    // context remains unknown rather than borrowing an unrelated native ID.
    assert.equal(before.contextComparison.withContext.denominator,0);
    assert.equal(before.contextComparison.withoutContext.denominator,0);assert.equal(before.contextComparison.unknownPairs,1);
    assert.equal(before.kpis.clarification.numerator,1,'reply retains its original prompt membership');
    const all=await(await f.api(author,'/api/prompt-report?period=since-enrollment')).json();
    assert.equal(all.kpis.prompts,5);assert.equal(all.kpis.sessions,2);assert.equal(all.kpis.rework.denominator,3);
    assert.deepEqual(all.contextComparison.withContext,{numerator:1,denominator:3,unknown:0,value:1/3});
    const snapshot='/api/snapshots/'+restored.snapshotId,view=await(await f.api(continuing,snapshot+'/insights')).json();
    const previous=view.inferences.prompts.find((prompt:any)=>prompt.citations.some((citation:any)=>citation.quote.startsWith('请求 2 ')));
    assert.ok(previous,'the previous owner prompt remains cited by the restored complete analysis');
    const corrected=await f.api(continuing,snapshot+'/inference-corrections',{requestId:randomUUID(),expectedVersion:view.version,kind:'prompt-elements',promptEvent:previous.event,
      value:{goal:true,constraints:true,context:false,acceptance:true},reason:'核对原句后确认未提供上下文'});
    assert.equal(corrected.status,201,await corrected.clone().text());
    const current=await(await f.api(continuing,path)).json();assert.notEqual(current.version,before.version);
    assert.deepEqual(current.contextComparison,before.contextComparison);
    const changedAll=await(await f.api(author,'/api/prompt-report?period=since-enrollment')).json();
    assert.deepEqual(changedAll.contextComparison.withContext,{numerator:0,denominator:2,unknown:0,value:0});
    assert.deepEqual(changedAll.contextComparison.withoutContext,{numerator:1,denominator:1,unknown:0,value:1});
    assert.deepEqual(await(await f.api(continuing,path+'&version='+before.version)).json(),before);
    assert.deepEqual(await(await f.api(continuing,'/api/prompt-report/recompute',{period:'since-enrollment',employeeId:continuing.employeeId,project})).json(),current);
  }finally{await f.close();}
});

test('a weekly prompt slice keeps its prior-week context from the same immutable source',{timeout:120000},async()=>{
  const f=await assessmentFixture();
  try{
    const owner=await f.owner('跨周前序');
    const monday=new Date(f.base.getTime()+14*86400000);while(monday.getUTCDay()!==1)monday.setUTCDate(monday.getUTCDate()+1);
    monday.setUTCHours(2,0,0,0);f.now.setTime(monday.getTime()+86400000);
    const rows=[
      {at:new Date(monday.getTime()-86400000),role:'user',text:'请求 0 elements=4'},
      {at:new Date(monday.getTime()-86400000+100),role:'assistant',text:'已处理'},
      {at:monday,role:'user',text:'返工 1 elements=0'},
      {at:new Date(monday.getTime()+100),role:'assistant',text:'已调整'}
    ].map(row=>({type:'response_item',timestamp:row.at.toISOString(),payload:{type:'message',role:row.role,content:[{type:row.role==='user'?'input_text':'output_text',text:row.text}]}}));
    const record=await f.upload(owner,rows,randomUUID());await f.analyze(owner,record.snapshotId);
    const response=await f.api(owner,'/api/prompt-report?period=this-week');assert.equal(response.status,200,await response.clone().text());const report=await response.json();
    assert.equal(report.kpis.prompts,1);assert.deepEqual(report.kpis.rework,{numerator:1,denominator:1,unknown:0,value:1});
    assert.deepEqual(report.contextComparison.withContext,{numerator:1,denominator:1,unknown:0,value:1});assert.equal(report.contextComparison.unknownPairs,0);
    assert.deepEqual(await(await f.api(owner,'/api/prompt-report/recompute',{period:'this-week'})).json(),report);
  }finally{await f.close();}
});
