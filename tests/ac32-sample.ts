import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import {mcpSandbox} from './mcp-support.js';
import {appendLate,disposeOwned,restoreBundle,type Bundle} from './ac32-fixture.js';
import type {Entry,Observation} from './ac32-results.js';
import {recordSampleOwner} from './ac32-owned.js';

function endpoint(entry:Entry,b:Bundle){
  const person=b.people[0]!,period={period:'since-enrollment'},paths:Record<string,string>={metrics:'metrics',usage:'usage-output',efficiency:'session-efficiency',prompts:'prompt-report','wait-report':'wait-report',waits:'waits',team:'team-report',people:'capability-people'};
  if(entry==='weekly')return {path:'/api/team-report/weekly',query:{week:b.week,employeeId:person.employeeId},recompute:'/api/team-report/weekly/recompute'};
  if(entry==='activity')return {path:'/api/activity',query:{date:b.activityDate},recompute:'/api/activity/recompute'};
  const path=entry==='profile'?'/api/capability-profiles/'+person.employeeId:entry==='assessment'?'/api/assessments/'+person.employeeId:'/api/'+paths[entry];
  return {path,query:period,recompute:entry==='wait-report'?'/api/waits/recompute':path+'/recompute'};
}
function verify(entry:Entry,value:any,b:Bundle,late=false){
  assert.match(value.version,/^[a-f0-9]{64}$/);
  const count=b.dataset.sessions,personal=count/10,delta=late?1:0;
  const totals=(row:any,n:number)=>assert.deepEqual([row.sessions,row.userTurns,row.toolCalls,row.inputTokens,row.outputTokens],[n,n*20+delta,n*20,n*2000+delta*100,n*500+delta*25]);
  if(['metrics','usage','team'].includes(entry))totals(value.totals,count);
  if(entry==='metrics'){assert.equal(value.sourceInputsComplete,true);assert.equal(value.totals.unknownTokenSessions,0);assert.equal(value.daily.filter((day:any)=>day.sessions>0).length,count===10?1:20);}
  if(entry==='usage'&&!late){assert.equal(value.outputs.verified.known,b.dataset.analyzedSessions);assert.equal(value.outputs.verified.value,null);assert.equal(value.outputs.verified.unknownSessions,count-b.dataset.analyzedSessions);assert.equal(value.outputs.tests.known,count*60);}
  if(entry==='team')assert.deepEqual(value.activeEmployees,{active:10,total:10});
  if(entry==='weekly')totals(value.totals,count===10?1:25);
  if(entry==='efficiency'){assert.equal(value.total,count);assert.ok(value.sessions.length>0);assert.ok(value.sessions.every((s:any)=>s.tokens!==null));}
  if(entry==='prompts'){
    assert.equal(value.kpis.sessions,count);assert.equal(value.kpis.prompts,count*20+delta);
    if(!late){assert.equal(value.kpis.context.denominator,b.dataset.analyzedSessions*20);assert.equal(value.kpis.context.unknown,(count-b.dataset.analyzedSessions)*20);}
  }
  if(entry==='wait-report'){assert.equal(value.summary.knownCount,count*19+delta);assert.equal(value.summary.medianMs,36000);assert.equal(value.summary.permissionMedianMs,null);}
  if(entry==='waits'){assert.equal(value.total,count*19+delta);assert.equal(value.summary.replyWaitCount,count*19+delta);assert.equal(value.permissionSupport,'unknown');}
  if(entry==='people'){assert.equal(value.total,10);assert.equal(value.employees.length,10);assert.ok(value.employees.every((p:any)=>p.sample.sessions===personal));}
  if(entry==='assessment'){assert.equal(value.sample.sessions,personal);assert.equal(value.sample.prompts,personal*20+delta);assert.equal(value.sample.activeDays,count===10?1:20);assert.equal(value.dims.flow.metrics.find((m:any)=>m.key==='permMed').value,null);}
  if(entry==='profile'){
    totals(value.kpis,personal);assert.equal(value.kpis.activeDays,count===10?1:20);assert.equal(value.coaching.waiting.summary.knownCount,personal*19+delta);assert.equal(value.coaching.waiting.summary.medianMs,36000);
    assert.equal(value.coaching.communication.firstPrompts.person.count,personal);
    if(!late){assert.equal(value.coaching.communication.firstPrompts.person.elements.goal.numerator,count===10?1:2);assert.equal(value.coaching.communication.firstPrompts.person.elements.goal.unknown,count===10?0:98);}
  }
  if(entry==='activity'){
    assert.equal(value.scope.date,b.activityDate);assert.equal(value.total,(count===10?810:4050)+delta);
    assert.ok(value.events.length>0);assert.ok(value.events.every((event:any)=>event.sourceDate===b.activityDate));
  }
}
export async function sample(directory:string,entry:Entry,destination:string,checks=false){
  const restored=await restoreBundle(directory),{sandbox,owner,bundle}=restored;
  await recordSampleOwner(destination+'.owner.json',sandbox,owner);
  const f=await mcpSandbox({sandbox,reportClock:()=>new Date(bundle.clock)}).catch(async error=>{await disposeOwned(sandbox,owner);throw error;}),route=endpoint(entry,bundle),reader=bundle.people[0]!.readerCredential;
  const observation:Observation={entry,environmentId:randomUUID(),coldMs:null,warmMs:null,correctness:'failed'};
  const evidence:any={kind:'ac32-public-sample-1',sourceRevision:bundle.sourceRevision,sourceBundleHash:bundle.bundleHash,sourceDatabaseHash:bundle.database.hash,
    testedRevision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceClean:execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim()==='',
    databaseMode:bundle.database.format,postgresMajor:bundle.database.major??null,pid:process.pid,clock:bundle.clock,dataset:bundle.dataset,conditions:'Fresh owned PostgreSQL cluster restored before a fresh Node application; no report read before the measured entry. OS file cache is uncontrolled. HTTP round trip includes full body and JSON decode; setup and assertions excluded.',checks:{},observation};
  const query=(extra:Record<string,string>={})=>new URLSearchParams({...route.query,...extra} as Record<string,string>).toString();
  const read=async(path:string,body?:object)=>{
    const started=performance.now(),response=await f.api(path,reader,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});
    const text=await response.text();let value:any;try{value=JSON.parse(text);}catch{throw new Error(path+' returned invalid JSON, HTTP '+response.status);}
    const elapsed=performance.now()-started;
    if(response.status!==200)evidence.failedHttp={path,status:response.status,bytes:Buffer.byteLength(text),elapsedMs:elapsed,error:value};
    assert.equal(response.status,200,path+': '+text.slice(0,2000));return {value,elapsed,bytes:Buffer.byteLength(text)};
  };
  try{
    assert.equal(evidence.testedRevision,bundle.sourceRevision,'Every sample must execute the same fixed source revision');
    if(!bundle.diagnostic)assert.equal(evidence.sourceClean,true,'Acceptance cannot measure a dirty checkout');
    const cold=await read(route.path+'?'+query());observation.coldMs=cold.elapsed;observation.responseBytes=cold.bytes;observation.version=cold.value.version;verify(entry,cold.value,bundle);
    const warm=await read(route.path+'?'+query());observation.warmMs=warm.elapsed;assert.deepEqual(warm.value,cold.value,'unchanged live result must retain its fixed payload');
    evidence.checks.coldAndWarm='passed';
    if(checks){
      const fixed=await read(route.path+'?'+query({version:cold.value.version}));assert.deepEqual(fixed.value,cold.value);evidence.checks.fixed='passed';
      const full=await read(route.recompute,route.query);
      const recomputed=entry==='wait-report'?(await read(route.path+'?'+query())).value:full.value;
      assert.deepEqual(recomputed,cold.value,'full reconstruction equals first public result');evidence.checks.full='passed';
      const exportPath=entry==='weekly'?'/api/team-report/export':route.path+'/export';
      const exportQuery=entry==='weekly'?new URLSearchParams({...route.query,period:'this-week',version:cold.value.version} as Record<string,string>).toString():query({version:cold.value.version});
      const exported=await read(exportPath+'?'+exportQuery);assert.equal(exported.value.version,cold.value.version);
      evidence.checks.export={status:200,bytes:exported.bytes};
      if(entry==='waits')assert.equal(exported.value.intervals.length,bundle.dataset.waits,'full 19,000 waits must remain available');
      if(entry==='usage'||entry==='metrics'||entry==='efficiency')assert.equal(exported.value.sessions.length,bundle.dataset.sessions);
      if(entry==='profile')assert.equal(exported.value.sessions.length,bundle.dataset.sessions/10);
      await appendLate(f.api,directory,bundle,entry==='weekly');
      const next=await read(route.path+'?'+query());verify(entry,next.value,bundle,true);assert.notEqual(next.value.version,cold.value.version);evidence.checks.late='passed';
      const history=await read(route.path+'?'+query({version:cold.value.version}));assert.deepEqual(history.value,cold.value);evidence.checks.history='passed';
      const fullNext=await read(route.recompute,route.query);assert.deepEqual(entry==='wait-report'?(await read(route.path+'?'+query())).value:fullNext.value,next.value);evidence.checks.lateFull='passed';
    }
    observation.checks=checks;observation.correctness='passed';return evidence;
  }catch(error){observation.error=String(error);throw error;}
  finally{try{await writeFile(destination,JSON.stringify(evidence,null,2));}finally{await disposeOwned(f,owner);}}
}
