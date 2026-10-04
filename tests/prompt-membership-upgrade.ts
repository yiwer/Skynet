import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {restoreBundle,disposeOwned,appendLate} from './ac32-fixture.js';
import {createApp} from '../apps/server/app.js';
import {connect,digest} from '../apps/server/database.js';

// Compare old/new public reports over the same database so wall-clock creation
// metadata is also fixed. No reporting rows are manually seeded or rewritten.
assert.ok(process.env.SKYNET_CAPACITY_SOURCE,'SKYNET_CAPACITY_SOURCE is required');
assert.ok(process.env.SKYNET_PROMPT_PREVIOUS_SOURCE,'Previous fixed checkout is required');
assert.ok(process.env.SKYNET_PROMPT_MEMBERSHIP_EVIDENCE,'Evidence destination is required');
const previous=process.env.SKYNET_PROMPT_PREVIOUS_SOURCE;
const {createApp:previousApp}=await import(pathToFileURL(join(previous,'apps/server/app.ts')).href) as {createApp:typeof createApp};
const {sandbox,owner,bundle}=await restoreBundle(process.env.SKYNET_CAPACITY_SOURCE);
const db=connect(sandbox.env.DATABASE_URL!);let app:Awaited<ReturnType<typeof createApp>>|undefined;
const evidence:Record<string,unknown>={kind:'same-database-public-upgrade',bundleHash:bundle.bundleHash,dataset:bundle.dataset,
  previousRevision:execFileSync('git',['-C',previous,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),
  revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),startedAt:new Date().toISOString()};
async function api(path:string,credential=bundle.people[0]!.readerCredential,init:RequestInit={}){
  const headers:Record<string,string>={};new Headers(init.headers).forEach((value,key)=>{headers[key]=value;});
  const response=await app!.inject({url:path,method:(init.method??'GET') as 'GET'|'POST'|'PUT',headers:{...headers,Authorization:'Bearer '+credential},
    ...(init.body===undefined?{}:{payload:Buffer.isBuffer(init.body)?init.body:String(init.body)})});
  return new Response(response.body,{status:response.statusCode,headers:{'Content-Type':'application/json'}});
}
async function read(path:string,full=false){const response=await api(path,undefined,full?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({period:'since-enrollment'})}:{});
  assert.equal(response.status,200,await response.clone().text());return response.json();}
try{
  const options={db,rawDirectory:sandbox.env.RAW_DIRECTORY!,reportClock:()=>new Date(bundle.clock)};
  app=await previousApp(options);
  const before=await read('/api/prompt-report?period=since-enrollment');
  assert.equal(before.kpis.prompts,20000);assert.equal(before.kpis.sessions,1000);
  await app.close();app=undefined;app=await createApp(options);
  const fixed='/api/prompt-report?period=since-enrollment&version='+before.version;
  assert.deepEqual(await read(fixed),before);
  assert.deepEqual(await read('/api/prompt-report?period=since-enrollment&usageVersion='+before.usageVersion),before);
  assert.deepEqual(await read('/api/prompt-report?period=since-enrollment'),before);
  assert.deepEqual(await read('/api/prompt-report/recompute',true),before);
  evidence.version=before.version;evidence.payloadHash=digest(JSON.stringify(before));
  await appendLate(api,process.env.SKYNET_CAPACITY_SOURCE,bundle);
  const late=await read('/api/prompt-report?period=since-enrollment');assert.equal(late.kpis.prompts,20001);assert.notEqual(late.version,before.version);
  assert.deepEqual(await read(fixed),before);assert.deepEqual(await read('/api/prompt-report/recompute',true),late);
  evidence.lateVersion=late.version;evidence.status='passed';
}catch(error){evidence.status='failed';evidence.error=String(error);throw error;}
finally{evidence.finishedAt=new Date().toISOString();await writeFile(process.env.SKYNET_PROMPT_MEMBERSHIP_EVIDENCE,JSON.stringify(evidence,null,2));await app?.close();await db.end();await disposeOwned(sandbox,owner);}
