import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {assessmentFixture} from './assessment-fixture.js';

// Explicit diagnostic, excluded from the default *.test.ts run. This small
// public-upload fixture locates repeated preparation; it is not AC-32's cohort.
const f=await assessmentFixture(),readMs:number[]=[];
const destination=process.env.SKYNET_PROFILE_PREPARATION_EVIDENCE??join(f.directory,'profile-preparation-performance.json');
const report:Record<string,unknown>={kind:'profile-preparation-small-diagnostic-not-AC32',commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
  workingTreeStatus:execFileSync('git',['status','--short'],{encoding:'utf8'}).trim(),
  trackedDiffSha256:createHash('sha256').update(execFileSync('git',['diff','HEAD'])).digest('hex'),
  measuredAt:new Date().toISOString(),node:process.version,platform:process.platform,employees:3,sessions:36,userTurns:2880,
  limits:'Shared development host; one initial sample and three subsequent current reads. No first-read P95 or 1000-session acceptance claim.'};
try{
  const people:Awaited<ReturnType<typeof f.owner>>[]=[];for(let i=0;i<3;i++)people.push(await f.owner('画像准备合成'+i));
  const jobs=Array.from({length:36},(_,index)=>index);
  await Promise.all(Array.from({length:3},async()=>{while(jobs.length){const index=jobs.shift()!,owner=people[index%people.length]!;
    const original=f.rows({prompts:80,tokens:1000,verified:0,claimed:0});await f.upload(owner,original.rows,original.sessionId);
  }}));
  const owner=people[0]!,path='/api/capability-profiles/'+owner.employeeId;
  let first:any;
  for(let i=0;i<4;i++){
    const started=performance.now(),response=await f.api(owner,path);assert.equal(response.status,200,await response.clone().text());
    const value=await response.json();readMs.push(performance.now()-started);
    assert.equal(value.kpis.sessions,12);assert.equal(value.kpis.userTurns,960);assert.equal(value.kpis.inputTokens,12000);
    assert.equal(value.kpis.outputs.verified.value,null,'unrun model inference remains unknown');
    if(first)assert.deepEqual(value,first,'unchanged current reads retain the complete profile version');else first=value;
    console.log(JSON.stringify({read:i,ms:Math.round(readMs.at(-1)!),sessions:value.kpis.sessions}));
  }
  const fixed=await(await f.api(owner,path+'?version='+first.version)).json();assert.deepEqual(fixed,first);
  const fullResponse=await f.api(owner,path+'/recompute',{});assert.equal(fullResponse.status,200);assert.deepEqual(await fullResponse.json(),first);
  report.correctness='known employee scope, totals, unknown inference, repeated current, fixed history and full recomputation agree';
  const warm=readMs.slice(1).sort((a,b)=>a-b);report.firstReadMs=readMs[0];report.warmP50Ms=warm[1];report.warmP95Ms=warm[2];
  assert.ok(warm[2]!<=1000,`Small-fixture warm P95 ${Math.round(warm[2]!)}ms exceeds 1000ms; full AC32 remains separate`);
  report.status='passed-small-diagnostic';
}catch(error){report.status='failed';report.error=String(error);throw error;}
finally{report.readsMs=readMs;await writeFile(destination,JSON.stringify(report,null,2));await f.close();}
