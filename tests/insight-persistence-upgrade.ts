import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {assessmentFixture} from './assessment-fixture.js';
import {createApp} from '../apps/server/app.js';
import {digest} from '../apps/server/database.js';

// Explicit same-database public-interface differential. The previous module
// supplies the baseline; no expected report or revision is inserted by a test.
assert.ok(process.env.SKYNET_INSIGHT_PREVIOUS_SOURCE);
assert.ok(process.env.SKYNET_INSIGHT_PERSISTENCE_EVIDENCE);
const previous=process.env.SKYNET_INSIGHT_PREVIOUS_SOURCE;
const {createApp:previousApp}=await import(pathToFileURL(join(previous,'apps/server/app.ts')).href) as {createApp:typeof createApp};
const f=await assessmentFixture();let old:Awaited<ReturnType<typeof createApp>>|undefined,restore:{path:string;bytes:Buffer}|undefined;
const evidence:Record<string,unknown>={kind:'same-database-insight-persistence-upgrade',
  previousRevision:execFileSync('git',['-C',previous,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),
  revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),startedAt:new Date().toISOString(),stages:[]};
try{
  const owner=await f.owner('Persistence upgrade owner'),input=f.rows({prompts:4}),record=await f.upload(owner,input.rows,input.sessionId);
  const path='/api/snapshots/'+record.snapshotId+'/insights',usagePath='/api/usage-output/export?period=since-enrollment';
  old=await previousApp({db:f.testDatabase,rawDirectory:join(f.directory,'raw'),reportClock:()=>f.now});
  async function before(path:string){const response=await old!.inject({url:path,headers:{Authorization:'Bearer '+owner.readerCredential}});
    assert.equal(response.statusCode,200,response.body);return response.json();}
  async function after(path:string,body?:object){const response=await f.api(owner,path,body);assert.equal(response.status,200,await response.clone().text());return response.json();}
  const fixed:any[]=[];
  async function compare(stage:string){
    const view=await before(path),report=await before(usagePath);assert.deepEqual(await after(path),view);assert.deepEqual(await after(usagePath),report);
    assert.deepEqual(await after(path+'?version='+view.version),view);assert.deepEqual(await after(usagePath+'&version='+report.version),report);
    const full=await after('/api/usage-output/recompute',{period:'since-enrollment'});assert.equal(full.version,report.version);
    assert.deepEqual(await after('/api/usage-output?period=since-enrollment&version='+report.version),full);
    assert.deepEqual(await after(usagePath+'&version='+full.version),report);assert.deepEqual(await after(path),view);
    fixed.push({view,report});(evidence.stages as object[]).push({stage,viewVersion:view.version,viewHash:digest(JSON.stringify(view)),usageVersion:report.version,usageHash:digest(JSON.stringify(report))});
    return view;
  }
  const unknown=await compare('before-analysis');assert.equal(unknown.inferences,null);assert.equal(unknown.facts.tests.value,1);
  await f.analyze(owner,record.snapshotId,{verifyPreparedJob:{prompts:4,replies:4,outcomes:2}});
  const complete=await compare('complete-analysis');assert.equal(complete.metrics.verified,1);assert.notEqual(complete.version,unknown.version);
  const correction=await f.api(owner,'/api/snapshots/'+record.snapshotId+'/inference-corrections',{
    requestId:randomUUID(),expectedVersion:complete.version,kind:'rework',promptEvent:complete.inferences.prompts[1].event,value:true,reason:'合成版本差分',
  });assert.equal(correction.status,201,await correction.clone().text());
  const corrected=await compare('corrected');assert.equal(corrected.metrics.rework,1);assert.notEqual(corrected.version,complete.version);
  restore={path:join(f.directory,'raw',owner.deviceId,digest(record.bytes)),bytes:record.bytes};await writeFile(restore.path,'synthetic unavailable source\n');
  const unavailable=await compare('outage');assert.equal(unavailable.sourceAvailability.reason,'hash-mismatch');assert.equal(unavailable.metrics.verified,null);
  await writeFile(restore.path,restore.bytes);assert.deepEqual(await compare('recovered'),corrected);
  await old.close();old=undefined;await f.restart();
  for(const {view,report}of fixed){assert.deepEqual(await after(path+'?version='+view.version),view);assert.deepEqual(await after(usagePath+'&version='+report.version),report);}
  assert.deepEqual(await after(path),corrected);evidence.status='passed';
}catch(error){evidence.status='failed';evidence.error=String(error);throw error;}
finally{if(restore)await writeFile(restore.path,restore.bytes);await old?.close();await f.close();evidence.finishedAt=new Date().toISOString();await writeFile(process.env.SKYNET_INSIGHT_PERSISTENCE_EVIDENCE,JSON.stringify(evidence,null,2));}
