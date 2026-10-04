import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {assessmentFixture} from './assessment-fixture.js';
import {setTimeout} from 'node:timers/promises';
import {beijingDate} from '../packages/contracts/reports.js';

test('an authenticated correction preserves the original analysis and bytes while publishing an audited current inference', {timeout:120_000}, async()=>{
  const f=await assessmentFixture();
  try{
    const owner=await f.owner('推断更正员工'), reviewer=await f.owner('复核操作者');
    const record=await f.session(owner,{prompts:3}), path=`/api/snapshots/${record.snapshotId}`;
    const before=await(await f.api(owner,path+'/insights')).json();
    const input={requestId:randomUUID(),expectedVersion:before.version,kind:'task-type',value:'investigation',reason:'本次目标为排查，未实施修复'};
    assert.equal((await f.nativeApi(path+'/inference-corrections',owner.deviceCredential,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)})).status,401);
    const response=await f.api(reviewer,path+'/inference-corrections',input);
    assert.equal(response.status,201,await response.clone().text());
    const saved=await response.json(), current=await(await f.api(owner,path+'/insights')).json();
    assert.equal(current.inferences.taskType.value,'investigation'); assert.notEqual(current.version,before.version);
    assert.equal(current.inferences.taskType.correctionId,saved.correction.id);
    assert.equal(current.analysisVersion.id,before.analysisVersion.id); assert.deepEqual(current.facts,before.facts);
    assert.equal(saved.correction.actorId,reviewer.employeeId); assert.equal(saved.correction.actor,'复核操作者');
    assert.equal(saved.correction.previous,'implementation'); assert.equal(saved.correction.value,'investigation');
    assert.equal(saved.correction.analysisId,before.analysisVersion.id); assert.equal(saved.correction.insightVersion,before.version);
    assert.ok(saved.correction.evidence.length); assert.ok(Number.isFinite(Date.parse(saved.correction.createdAt)));
    assert.deepEqual(current.corrections.appliedIds,[saved.correction.id]);
    assert.deepEqual(await(await f.api(owner,path+'/insights?version='+before.version)).json(),before);
    const analyses=await(await f.api(owner,path+'/analysis')).json(); assert.equal(analyses.runs[0].result.insights.taskType.value,'implementation');
    assert.deepEqual(Buffer.from(await(await f.api(owner,path+'/raw')).arrayBuffer()),record.bytes);
    const history=await(await f.api(owner,path+'/inference-corrections')).json(); assert.deepEqual(history.corrections,[saved.correction]);
    assert.equal((await f.api(reviewer,path+'/inference-corrections',input)).status,200,'same actor and request is idempotent');
    assert.equal((await f.api(owner,path+'/inference-corrections',input)).status,409,'request identity cannot be borrowed by a different actor');
  }finally{await f.close();}
});

test('corrections follow a native multi-block prompt and never turn its first message into counted rework', {timeout:120_000},async()=>{
  const f=await assessmentFixture();
  try{
    const owner=await f.owner('原生多块更正'),id=randomUUID();
    const rows=[0,1].map(n=>({type:'user',uuid:randomUUID(),timestamp:new Date(f.base.getTime()+n*1000).toISOString(),message:{role:'user',content:[{type:'text',text:'请求甲 elements=3'},{type:'text',text:'请求乙 elements=3'}]}}));
    const record=await f.upload(owner,rows,id,{source:'claude-code-cli',sourceVersion:'2.1.281'});await f.analyze(owner,record.snapshotId);const path=`/api/snapshots/${record.snapshotId}`;
    let view=await(await f.api(owner,path+'/insights')).json();assert.equal(view.inferences.prompts.length,4);
    const first=await f.api(owner,path+'/inference-corrections',{requestId:randomUUID(),expectedVersion:view.version,kind:'rework',promptEvent:view.inferences.prompts[1].event,value:true,reason:'更正整条原生提示词'});assert.equal(first.status,201);
    view=await(await f.api(owner,path+'/insights')).json();assert.equal(view.inferences.prompts[0].rework,true);assert.equal(view.inferences.prompts[1].rework,true);
    assert.equal(view.metrics.rework,0,'all text blocks of the first native message are excluded');
    const next=await f.api(owner,path+'/inference-corrections',{requestId:randomUUID(),expectedVersion:view.version,kind:'rework',promptEvent:view.inferences.prompts[3].event,value:true,reason:'后续原生提示词返工'});assert.equal(next.status,201);
    view=await(await f.api(owner,path+'/insights')).json();assert.equal(view.metrics.rework,1,'two text blocks remain one follow-up');
    const report=await(await f.api(owner,'/api/prompt-report?period=since-enrollment')).json();assert.equal(report.kpis.prompts,2);assert.deepEqual(report.kpis.rework,{numerator:1,denominator:1,unknown:0,value:1});
    const unknown=await f.api(owner,path+'/inference-corrections',{requestId:randomUUID(),expectedVersion:view.version,kind:'rework',promptEvent:view.inferences.prompts[2].event,value:null,reason:'缺少判断依据'});assert.equal(unknown.status,201);
    const current=await(await f.api(owner,path+'/insights')).json();assert.equal(current.metrics.rework,null);
    const unknownReport=await(await f.api(owner,'/api/prompt-report?period=since-enrollment')).json();assert.deepEqual(unknownReport.kpis.rework,{numerator:0,denominator:0,unknown:1,value:null});
    const independent=await f.session(owner,{prompts:3});assert.equal((await(await f.api(owner,`/api/snapshots/${independent.snapshotId}/insights`)).json()).corrections,undefined);
  }finally{await f.close();}
});

test('large correction audits use bounded frozen pages without losing or duplicating decisions', {timeout:180_000},async()=>{
  const f=await assessmentFixture();
  try{
    const owner=await f.owner('有界审计'),native=f.rows({prompts:3});
    for(const row of native.rows as any[])if(row.payload?.role==='user')row.payload.content[0].text='完整的原始要求。'.repeat(70)+' elements=3';
    const record=await f.upload(owner,native.rows,native.sessionId);await f.analyze(owner,record.snapshotId,{taskCitations:3});
    const path=`/api/snapshots/${record.snapshotId}`,ids:string[]=[];
    async function correct(){const view=await(await f.api(owner,path+'/insights')).json();const response=await f.api(owner,path+'/inference-corrections',{requestId:randomUUID(),expectedVersion:view.version,kind:'task-type',value:ids.length%2?'implementation':'fix',reason:'核对'.repeat(500)});assert.equal(response.status,201,await response.clone().text());ids.push((await response.json()).correction.id);}
    for(let n=0;n<22;n++)await correct();
    const response=await f.api(owner,path+'/inference-corrections'),body=await response.text();assert.ok(Buffer.byteLength(body)<=64*1024,'one audit page must stay inside the public metadata budget');
    let page=JSON.parse(body),all=page.corrections.map((row:any)=>row.id);const version=page.version;
    assert.ok(page.nextOffset);await correct();
    while(page.nextOffset!==null){const next=await f.api(owner,path+'/inference-corrections?version='+version+'&offset='+page.nextOffset);const text=await next.text();assert.ok(Buffer.byteLength(text)<=64*1024);page=JSON.parse(text);all.push(...page.corrections.map((row:any)=>row.id));}
    assert.deepEqual(all,ids.slice(0,22).reverse());assert.equal(new Set(all).size,22);
    assert.equal((await f.api(owner,path+'/inference-corrections?offset=1')).status,400);
  }finally{await f.close();}
});

test('a corrected event survives a late continuation, a superseded analysis and a verified restore without touching historical bytes', {timeout:180_000},async()=>{
  const f=await assessmentFixture();
  try{
    const owner=await f.owner('续聊更正'),restorer=await f.owner('恢复更正'),record=await f.session(owner,{prompts:3}),path=`/api/snapshots/${record.snapshotId}`;
    let view=await(await f.api(owner,path+'/insights')).json();
    const correction=await f.api(owner,path+'/inference-corrections',{requestId:randomUUID(),expectedVersion:view.version,kind:'task-type',value:'fix',reason:'已核对为修复'});assert.equal(correction.status,201);
    view=await(await f.api(owner,path+'/insights')).json();
    const promptEvent=view.inferences.prompts[1].event;
    assert.equal((await f.api(owner,path+'/inference-corrections',{requestId:randomUUID(),expectedVersion:view.version,kind:'rework',promptEvent,value:true,reason:'回退错误实现'})).status,201);
    const frozen=await(await f.api(owner,path+'/insights')).json();
    const dailyPath=`/api/daily-reports/${owner.employeeId}/${beijingDate(f.base)}`;
    const daily=await(await f.api(owner,dailyPath,{})).json();assert.ok(daily.revision>0);
    const reanalyze=await f.api(owner,dailyPath+'/corrections',{requestId:randomUUID(),expectedRevision:daily.revision,kind:'reanalyze',reason:'核对同一原件的新分析'});assert.equal(reanalyze.status,202,await reanalyze.clone().text());
    const newAnalysis=await f.analyze(owner,record.snapshotId);assert.notEqual(newAnalysis,frozen.analysisVersion.id);
    const reanalyzed=await(await f.api(owner,path+'/insights')).json();assert.equal(reanalyzed.input.hash,frozen.input.hash);assert.equal(reanalyzed.inferences.taskType.value,'fix');assert.equal(reanalyzed.metrics.rework,1);
    const continuation=(turn:number)=>[{type:'response_item',timestamp:new Date(f.base.getTime()+turn*10000).toISOString(),payload:{type:'message',role:'user',content:[{type:'input_text',text:'追加请求 elements=3'}]}},
      {type:'event_msg',timestamp:new Date(f.base.getTime()+turn*10000+1).toISOString(),payload:{type:'task_started',turn_id:'continued-'+turn}},
      {type:'response_item',timestamp:new Date(f.base.getTime()+turn*10000+50).toISOString(),payload:{type:'message',role:'assistant',content:[{type:'output_text',text:'追加回复'}]}},
      {type:'event_msg',timestamp:new Date(f.base.getTime()+turn*10000+100).toISOString(),payload:{type:'task_complete',turn_id:'continued-'+turn}}];
    const late=await f.upload(owner,[...record.rows,...continuation(1)],record.sessionId);
    const unavailable=await(await f.api(owner,`/api/snapshots/${late.snapshotId}/insights`)).json();assert.equal(unavailable.inferences,null);assert.equal(unavailable.corrections.pendingIds.length,2);
    let newest:typeof late|undefined;
    await f.analyze(owner,late.snapshotId,{expectedState:'stale',beforeFinish:async()=>{newest=await f.upload(owner,[...late.rows,...continuation(2)],record.sessionId);}});
    await f.analyze(owner,newest!.snapshotId);
    let current=await(await f.api(owner,`/api/snapshots/${newest!.snapshotId}/insights`)).json();
    assert.equal(current.inferences.taskType.value,'fix');assert.equal(current.metrics.rework,1);assert.equal(current.inferences.prompts.length,5);
    assert.equal(current.corrections.appliedIds.length,2);assert.deepEqual(current.corrections.pendingIds,[]);
    const restoredFrom={snapshotId:newest!.snapshotId,hash:current.input.hash,byteLength:newest!.bytes.length};
    const restored=await f.upload(restorer,[...newest!.rows,...continuation(3)],record.sessionId,{restoredFrom});
    await f.analyze(restorer,restored.snapshotId);
    current=await(await f.api(restorer,`/api/snapshots/${restored.snapshotId}/insights`)).json();assert.equal(current.inferences.taskType.value,'fix');assert.equal(current.metrics.rework,1);
    const unchanged=await f.upload(restorer,restored.rows,record.sessionId,{restoredFrom});assert.equal(unchanged.snapshotId,restored.snapshotId);
    assert.deepEqual(await(await f.api(owner,path+'/insights?version='+frozen.version)).json(),frozen);
    assert.deepEqual(Buffer.from(await(await f.api(owner,path+'/raw')).arrayBuffer()),record.bytes);
  }finally{await f.close();}
});

test('a correction arriving between usage and waits is included in one consistent assessment frontier', {timeout:180_000},async()=>{
  const f=await assessmentFixture(),gate=await f.testDatabase.connect();let locked=false;
  try{
    const owner=await f.owner('更正交错'),record=await f.session(owner,{prompts:3});for(let n=0;n<2;n++)await f.session(owner,{prompts:3});
    const path=`/api/snapshots/${record.snapshotId}`,view=await(await f.api(owner,path+'/insights')).json();
    await gate.query('SELECT pg_advisory_lock(7402140)');locked=true;const pid=(await gate.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const pending=f.api(owner,'/api/assessments/'+owner.employeeId);let reached=false;
    for(let n=0;n<500;n++){reached=(await f.testDatabase.query('SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS reached',[pid])).rows[0].reached;if(reached)break;await setTimeout(20);}
    assert.equal(reached,true);
    const corrected=await f.api(owner,path+'/inference-corrections',{requestId:randomUUID(),expectedVersion:view.version,kind:'prompt-elements',promptEvent:view.inferences.prompts[0].event,value:{goal:false,constraints:false,context:false,acceptance:false},reason:'读取期间完成的更正'});assert.equal(corrected.status,201);
    await gate.query('SELECT pg_advisory_unlock(7402140)');locked=false;
    const response=await pending;assert.equal(response.status,200,await response.clone().text());const assessment=await response.json();
    assert.equal(assessment.dims.prompt.metrics.find((m:any)=>m.key==='elem').value,.5);
    assert.deepEqual(await(await f.api(owner,'/api/assessments/'+owner.employeeId+'/recompute',{})).json(),assessment);
  }finally{if(locked)await gate.query('SELECT pg_advisory_unlock(7402140)');gate.release();await f.close();}
});

test('concurrent corrections use the displayed version and frozen audit pages retain superseded decisions', {timeout:120_000},async()=>{
  const f=await assessmentFixture();
  try{
    const a=await f.owner('并发更正甲'),b=await f.owner('并发更正乙'),record=await f.session(a,{prompts:3}),path=`/api/snapshots/${record.snapshotId}`;
    const before=await(await f.api(a,path+'/insights')).json();
    const request=(value:string)=>({requestId:randomUUID(),expectedVersion:before.version,kind:'task-type',value,reason:'独立复核任务类型'});
    const results=await Promise.all([f.api(a,path+'/inference-corrections',request('fix')),f.api(b,path+'/inference-corrections',request('test'))]);
    assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
    const first=await(await f.api(a,path+'/insights')).json(),accepted=await results.find(r=>r.status===201)!.json();
    const next=await f.api(a,path+'/inference-corrections',{requestId:randomUUID(),expectedVersion:first.version,kind:'task-type',value:'operations',reason:'补充核实为运维'});assert.equal(next.status,201);
    const second=await(await f.api(a,path+'/insights')).json(),secondAudit=await(await f.api(a,path+'/inference-corrections?version='+second.version)).json();
    assert.equal(secondAudit.corrections.length,2,'a frozen audit includes earlier decisions, not just the active override');
    assert.equal(secondAudit.corrections[0].previous,accepted.correction.value);
    assert.equal((await f.api(a,path+'/inference-corrections',{requestId:randomUUID(),expectedVersion:second.version,kind:'rework',promptEvent:99999,value:true,reason:'伪造目标'})).status,422);
    assert.equal((await f.api(a,path+'/inference-corrections',{requestId:randomUUID(),expectedVersion:second.version,kind:'task-type',value:'test',reason:'伪造作者',actorId:b.employeeId})).status,400);
    await f.api(a,path+'/inference-corrections',{requestId:randomUUID(),expectedVersion:second.version,kind:'task-type',value:'documentation',reason:'第三次复核'});
    assert.deepEqual(await(await f.api(a,path+'/inference-corrections?version='+second.version)).json(),secondAudit);
    assert.deepEqual(await(await f.api(a,path+'/insights?version='+first.version)).json(),first);
    await f.restart();assert.deepEqual(await(await f.api(a,path+'/inference-corrections?version='+second.version)).json(),secondAudit);
  }finally{await f.close();}
});

test('corrected prompt elements, rework and task type generate report and team baseline versions with equal full recomputation', {timeout:240_000},async()=>{
  const f=await assessmentFixture();
  try{
    const a=await f.owner('甲更正样本'),b=await f.owner('乙基线样本');
    const records=[];for(let n=0;n<3;n++){records.push(await f.session(a,{prompts:3,verified:1}));await f.session(b,{prompts:3,verified:3});}
    const path=`/api/snapshots/${records[0]!.snapshotId}`,apath='/api/assessments/'+a.employeeId,bpath='/api/assessments/'+b.employeeId;
    const promptPath='/api/prompt-report?period=since-enrollment&employeeId='+a.employeeId;
    const before=await(await f.api(a,path+'/insights')).json(),oldA=await(await f.api(a,apath)).json(),oldB=await(await f.api(b,bpath)).json(),oldPrompt=await(await f.api(a,promptPath)).json();
    const metric=(v:any,key:string)=>(Object.values(v.dims) as any[]).flatMap(dim=>dim.metrics).find(m=>m.key===key);
    assert.equal(metric(oldB,'outIdx').value,1.5);
    const elements={goal:false,constraints:false,context:false,acceptance:false};
    const elementInput={requestId:randomUUID(),expectedVersion:before.version,kind:'prompt-elements',promptEvent:before.inferences.prompts[0].event,value:elements,reason:'首条未给出四项要素'};
    const response=await f.api(a,path+'/inference-corrections',elementInput);
    assert.equal(response.status,201,await response.clone().text());
    assert.equal((await f.api(a,path+'/inference-corrections',elementInput)).status,200,'structured correction retries ignore JSON object key ordering');
    let current=await(await f.api(a,path+'/insights')).json();
    const rework=await f.api(a,path+'/inference-corrections',{requestId:randomUUID(),expectedVersion:current.version,kind:'rework',promptEvent:current.inferences.prompts[1].event,value:true,reason:'第二条要求纠正错误实现'});
    assert.equal(rework.status,201,await rework.clone().text());
    for(const record of records){current=await(await f.api(a,`/api/snapshots/${record.snapshotId}/insights`)).json();const saved=await f.api(a,`/api/snapshots/${record.snapshotId}/inference-corrections`,{requestId:randomUUID(),expectedVersion:current.version,kind:'task-type',value:'investigation',reason:'工作范围为排查'});assert.equal(saved.status,201,await saved.clone().text());}
    const report=await(await f.api(a,promptPath)).json(),newA=await(await f.api(a,apath)).json(),newB=await(await f.api(b,bpath)).json();
    assert.deepEqual(report.kpis.rework,{numerator:1,denominator:6,unknown:0,value:1/6});
    assert.equal(report.examples.negative[0].correctionIds.length,2);
    assert.deepEqual(report.kpis.context,{numerator:8,denominator:9,unknown:0,value:8/9});
    assert.equal(metric(newA,'elem').value,.5);assert.equal(metric(newA,'rework').value,1/6);
    assert.equal(metric(newB,'outIdx').value,1);assert.notEqual(newB.version,oldB.version);assert.notEqual(newB.inputs.baselineVersion,oldB.inputs.baselineVersion);
    const baseline=await(await f.api(a,'/api/assessment-baselines/'+newB.inputs.baselineVersion)).json();
    assert.equal(baseline.tasks.implementation.verifiedMean,3);assert.equal(baseline.tasks.investigation.verifiedMean,1);
    assert.deepEqual(await(await f.api(a,promptPath+'&version='+oldPrompt.version)).json(),oldPrompt);
    assert.deepEqual(await(await f.api(a,apath+'?version='+oldA.version)).json(),oldA);
    assert.deepEqual(await(await f.api(b,bpath+'?version='+oldB.version)).json(),oldB);
    assert.deepEqual(await(await f.api(a,'/api/prompt-report/recompute',{period:'since-enrollment',employeeId:a.employeeId})).json(),report);
    assert.deepEqual(await(await f.api(a,apath+'/recompute',{})).json(),newA);
    assert.deepEqual(await(await f.api(b,bpath+'/recompute',{})).json(),newB);
    const original=await(await f.api(a,path+'/insights?analysisId='+before.analysisVersion.id)).json();assert.equal(original.inferences.taskType.value,'implementation');
    const efficiency=await(await f.api(a,'/api/session-efficiency?period=since-enrollment&employeeId='+a.employeeId)).json();
    assert.equal(efficiency.sessions.length,3);assert.ok(efficiency.sessions.every((row:any)=>row.taskType==='investigation'&&row.correctionIds.length));assert.equal(efficiency.sessions.reduce((sum:number,row:any)=>sum+row.rework,0),1);
  }finally{await f.close();}
});
