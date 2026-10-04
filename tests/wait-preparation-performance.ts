import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {Session} from 'node:inspector';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import pg from 'pg';
import {RawStore} from '../apps/server/raw-store.js';
import {assessmentFixture} from './assessment-fixture.js';

// Explicit public-load diagnostic, not default tests. Timed decorators delegate
// to real PostgreSQL and SHA-verified raw reads; no SQL/call-count assertions.
const f=await assessmentFixture(),destination=process.env.SKYNET_WAIT_PREPARATION_EVIDENCE??join(f.directory,'wait-preparation.json');
const count=Number(process.env.SKYNET_WAIT_SESSIONS??36),turns=80,samples:number[]=[];
const sql=new Map<string,{count:number;ms:number;rows:number}>(),raw={count:0,ms:0,bytes:0};let active=false;
const query=pg.Client.prototype.query,read=RawStore.prototype.read;
(pg.Client.prototype as any).query=function(...args:any[]){
  if(!active)return (query as any).apply(this,args);const start=performance.now(),statement=String(typeof args[0]==='string'?args[0]:args[0]?.text??'').replace(/\s+/g,' ').trim();
  const record=(result:any)=>{const row=sql.get(statement)??{count:0,ms:0,rows:0};row.count++;row.ms+=performance.now()-start;row.rows+=result?.rowCount??0;sql.set(statement,row);};
  if(typeof args.at(-1)==='function'){const callback=args.at(-1);args[args.length-1]=(error:any,result:any)=>{record(result);callback(error,result);};return(query as any).apply(this,args);}
  const result=(query as any).apply(this,args);return result.then((value:any)=>{record(value);return value;},(error:any)=>{record(null);throw error;});
};
RawStore.prototype.read=async function(...args:Parameters<typeof read>){const start=performance.now();const value=await read.apply(this,args);if(active){raw.count++;raw.ms+=performance.now()-start;raw.bytes+=value.length;}return value;};
const report:any={kind:'wait-preparation-small-public-diagnostic-not-AC32',commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
  dirty:execFileSync('git',['status','--short'],{encoding:'utf8'}).trim(),measuredAt:new Date().toISOString(),node:process.version,platform:process.platform,
  dataset:{employees:3,sessions:count,userTurns:count*turns,replyWaits:count*(turns-1)},limits:'Three warm samples on shared host; not full 1000-session or first-read P95 acceptance.'};
const inspector=process.env.SKYNET_WAIT_CPU==='1'?new Session():null;
const post=(method:string)=>new Promise<any>((resolve,reject)=>inspector!.post(method as any,(error,result)=>error?reject(error):resolve(result)));
try{
  const people:Awaited<ReturnType<typeof f.owner>>[]=[];for(let n=0;n<3;n++)people.push(await f.owner('等待负载'+n));
  const jobs=Array.from({length:count},(_,n)=>n);await Promise.all(Array.from({length:3},async()=>{while(jobs.length){const index=jobs.shift()!,owner=people[index%3]!,record=f.rows({prompts:turns,verified:0,claimed:0});await f.upload(owner,record.rows,record.sessionId);}}));
  const path='/api/waits?period=since-enrollment',owner=people[0]!;let first:any;
  for(let n=0;n<4;n++){
    if(n===1){active=true;if(inspector){inspector.connect();await post('Profiler.enable');await post('Profiler.start');}}
    const start=performance.now(),response=await f.api(owner,path);assert.equal(response.status,200,await response.clone().text());const value=await response.json();samples.push(performance.now()-start);
    assert.equal(value.summary.replyWaitCount,count*79);assert.equal(value.summary.unknownReplyWaitCount,0);assert.equal(value.summary.knownReplyWaitMs,count*79000);assert.equal(value.total,count*79);assert.equal(value.intervals.length,25);
    assert.equal(value.scope.period,'since-enrollment');if(first)assert.deepEqual(value,first);else first=value;
    console.log(JSON.stringify({read:n,ms:samples.at(-1),waits:value.total}));
  }
  active=false;if(inspector){const profile=await post('Profiler.stop');await writeFile(destination+'.cpuprofile',JSON.stringify(profile.profile));inspector.disconnect();}
  const scoped=await(await f.api(owner,path+'&employeeId='+owner.employeeId)).json();assert.equal(scoped.total,Math.ceil(count/3)*79);assert.ok(scoped.intervals.every((row:any)=>row.employeeId===owner.employeeId));
  assert.deepEqual(await(await f.api(owner,path+'&version='+first.version)).json(),first);
  const full=await f.api(owner,'/api/waits/recompute',{period:'since-enrollment'});assert.equal(full.status,200,await full.clone().text());assert.deepEqual(await full.json(),first);
  report.correctness='exact wait counts/duration, employee scope, repeated version, fixed history and full recompute';
  const warm=samples.slice(1).sort((a,b)=>a-b);report.warmP95Ms=warm.at(-1);report.firstMs=samples[0];
  assert.ok(warm.at(-1)!<=1000,`Wait warm P95 ${Math.round(warm.at(-1)!)}ms exceeds unchanged 1000ms threshold`);report.status='passed-small-diagnostic';
}catch(error){report.status='failed';report.error=String(error);throw error;}
finally{active=false;pg.Client.prototype.query=query;RawStore.prototype.read=read;Object.assign(report,{samplesMs:samples,raw,sql:[...sql].map(([statement,row])=>({statement,...row})).sort((a,b)=>b.ms-a.ms)});await writeFile(destination,JSON.stringify(report,null,2));await f.close();}
