import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {cp,mkdir,readFile,readdir,writeFile,rm} from 'node:fs/promises';
import {dirname,join,resolve,relative,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {createSandbox} from './support.js';
import {ownedCommand} from './owned-command.js';
import {assessmentFixture} from './assessment-fixture.js';
import {plan} from './ac32-results.js';
import {recordSampleOwner} from './ac32-owned.js';

type Sandbox=Awaited<ReturnType<typeof createSandbox>>;
type Person={employeeId:string;readerCredential:string;deviceCredential:string;deviceId:string};
type RecordPointer={sessionId:string;snapshotId:string;hash:string;deviceId:string;qualifiedAt:string;project:string};
export type Bundle={kind:'ac32-source-bundle-1';sourceRevision:string;dataset:typeof plan.dataset;clock:string;start:string;activityDate:string;week:string;
  diagnostic:boolean;people:Person[];first:RecordPointer;weekly:RecordPointer;files:{path:string;sha256:string;bytes:number}[];
  preparation:{reportRequests:number;analysisJobsVerified:number;analysisVerification:'public-job-succeeded-applicable-complete';reportedOutcomesPerAnalyzedSession:2};
  database:{format:'pg-custom'|'pg-stopped-cluster';hash:string;files?:Bundle['files'];password?:string;stopped?:true;major?:string};bundleHash:string};
const hash=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
const json=(body:unknown)=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const fileHash=async(path:string)=>hash(await readFile(path));
async function inventory(directory:string,prefix=''):Promise<Bundle['files']>{
  const result:Bundle['files']=[];
  for(const item of await readdir(join(directory,prefix),{withFileTypes:true})){
    if(item.isSymbolicLink())throw new Error('Owned raw inventory refuses links');
    const path=join(prefix,item.name);if(item.isDirectory())result.push(...await inventory(directory,path));
    else {const bytes=await readFile(join(directory,path));result.push({path:path.split(sep).join('/'),sha256:hash(bytes),bytes:bytes.length});}
  }
  return result.sort((a,b)=>a.path.localeCompare(b.path));
}
async function pgCommand(sandbox:Sandbox,action:'dump'|'restore',file:string){
  const url=new URL(sandbox.env.DATABASE_URL!);
  assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/skynet_test');
  const environment={...process.env,PGHOST:url.hostname,PGPORT:url.port,PGUSER:'postgres',PGDATABASE:'skynet_test',PGPASSWORD:decodeURIComponent(url.password)};
  const executable=action==='dump'?'pg_dump':'pg_restore',inside='/tmp/ac32-source.dump';
  if(process.env.SKYNET_TEST_POSTGRES_BIN){
    const binary=join(process.env.SKYNET_TEST_POSTGRES_BIN,executable+(process.platform==='win32'?'.exe':''));
    await ownedCommand(binary,action==='dump'?['--format=custom','--file',file]:['--exit-on-error','--no-owner','--no-privileges','--dbname','skynet_test',file],environment,'',{timeoutMs:120000});
  }else{
    assert.match(sandbox.name,/^skynet-test-[a-f0-9-]+$/);
    const inspect=JSON.parse((await ownedCommand('docker',['inspect',sandbox.name],process.env,'',{timeoutMs:10000})).stdout)[0];
    assert.ok(inspect.Config.Labels['org.skynet.test-owner'],'Only the freshly created fixture container is eligible');
    if(action==='restore')await ownedCommand('docker',['cp',file,sandbox.name+':'+inside],process.env,'',{timeoutMs:120000});
    await ownedCommand('docker',['exec','--env','PGPASSWORD',sandbox.name,executable,...(action==='dump'?['--username','postgres','--dbname','skynet_test','--format=custom','--file',inside]:['--username','postgres','--dbname','skynet_test','--exit-on-error','--no-owner','--no-privileges',inside])],environment,'',{timeoutMs:120000});
    if(action==='dump')await ownedCommand('docker',['cp',sandbox.name+':'+inside,file],process.env,'',{timeoutMs:120000});
  }
}
export async function markOwned(sandbox:Sandbox){const owner=randomUUID();await writeFile(join(sandbox.directory,'ac32-owner'),owner,{flag:'wx'});return owner;}
export async function disposeOwned(sandbox:Sandbox,owner:string,alreadyClosed=false){
  if(!alreadyClosed)await sandbox.close();const target=resolve(sandbox.directory);
  assert.equal(dirname(target),resolve(tmpdir()));assert.match(relative(tmpdir(),target),/^skynet-test-[^\\/]+$/);
  assert.equal(await readFile(join(target,'ac32-owner'),'utf8'),owner);
  await rm(target,{recursive:true});
}
export async function seedBundle(destination:string,revision:string,mini=false,diagnostic=mini){
  await mkdir(destination,{recursive:false});
  const f=await assessmentFixture(),owner=await markOwned(f);let closed=false;
  await recordSampleOwner(join(destination,'seed.owner.json'),f,owner);
  try{
    const start=new Date(Date.now()+86400000);start.setUTCHours(1,0,0,0);while(start.getUTCDay()!==1)start.setUTCDate(start.getUTCDate()+1);
    f.base.setTime(start.getTime());f.now.setTime(start.getTime()+27*86400000+10*3600000);
    const people:Person[]=[];for(let index=0;index<10;index++)people.push(await f.owner('AC32 合成 '+String(index).padStart(2,'0')));
    const count=mini?10:1000,known=mini?2:20,queue=Array.from({length:count},(_,i)=>i),analysis:{person:Person;snapshotId:string}[]=[];
    let first:RecordPointer|undefined,weekly:RecordPointer|undefined;
    await Promise.all(Array.from({length:4},async()=>{while(queue.length){
      const index=queue.shift()!,person=people[index%10]!,sequence=Math.floor(index/10),day=Math.floor(sequence/5),slot=sequence%5;
      const time=(seconds:number)=>new Date(start.getTime()+(Math.floor(day/5)*7+day%5)*86400000+slot*2*3600000+seconds*1000).toISOString();
      const id=randomUUID(),counter=(n:number,timestamp:string)=>({timestamp,type:'event_msg',payload:{type:'token_count',info:{total_token_usage:{input_tokens:n*100,cached_input_tokens:n*20,output_tokens:n*25,reasoning_output_tokens:0,total_tokens:n*125}}}});
      const rows:object[]=[{timestamp:time(0),type:'session_meta',payload:{id}},counter(0,new Date(Date.now()-86400000).toISOString())];
      for(let turn=0;turn<20;turn++)rows.push(
        {timestamp:time(turn*40+1),type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:`请求 ${turn} elements=3：核查合成接口`}]}},
        {timestamp:time(turn*40+1),type:'event_msg',payload:{type:'task_started',turn_id:id+'/'+turn}},
        {timestamp:time(turn*40+2),type:'response_item',payload:{type:'function_call',name:'exec_command',call_id:id+'/'+turn,arguments:JSON.stringify({cmd:'node --test synthetic.test.js'})}},
        {timestamp:time(turn*40+3),type:'response_item',payload:{type:'function_call_output',call_id:id+'/'+turn,output:'# tests 3\n# pass 3\n# fail 0\n'}},
        {timestamp:time(turn*40+4),type:'response_item',payload:{type:'message',role:'assistant',content:[{type:'output_text',text:turn===0?'声称 1 项结果':'继续完成本轮'}]}},
        {timestamp:time(turn*40+5),type:'event_msg',payload:{type:'task_complete',turn_id:id+'/'+turn}},counter(turn+1,time(turn*40+6)));
      const project='/synthetic/ac32/project-'+index%3,record=await f.upload(person as Parameters<typeof f.upload>[0],rows,id,{qualifiedAt:time(0),project});
      const pointer={sessionId:id,snapshotId:record.snapshotId,hash:hash(record.bytes),deviceId:person.deviceId,qualifiedAt:time(0),project};
      if(index===0)first=pointer;if(index===(mini?0:750))weekly=pointer;
      if(index<known)analysis.push({person,snapshotId:record.snapshotId});
    }}));
    for(const record of analysis)await f.analyze(record.person as Parameters<typeof f.analyze>[0],record.snapshotId,{representativeOutcomes:true,verifyPreparedJob:{prompts:20,replies:20,outcomes:2}});
    const reportRequests=f.traffic.filter(request=>/^\/api\/(?:metrics|usage-output|session-efficiency|prompt-report|wait-report|waits|team-report|capability-people|assessments|capability-profiles|activity)(?:\/|$)/.test(request.path)).length;
    assert.equal(reportRequests,0,'Source preparation cannot warm reporting projections');
    // No reporting endpoint has run. Preserve exactly this quiescent source/Analysis state.
    let database:Bundle['database'];
    if(process.env.SKYNET_TEST_POSTGRES_BIN){
      await f.close();closed=true;
      await assert.rejects(readFile(join(f.directory,'postgres','postmaster.pid')),{code:'ENOENT'});
      await cp(join(f.directory,'postgres'),join(destination,'postgres'),{recursive:true,errorOnExist:true,force:false});
      const files=await inventory(join(destination,'postgres'));
      database={format:'pg-stopped-cluster',hash:hash(JSON.stringify(files)),files,password:decodeURIComponent(new URL(f.env.DATABASE_URL!).password),stopped:true,major:(await readFile(join(destination,'postgres','PG_VERSION'),'utf8')).trim()};
    }else{
      await pgCommand(f,'dump',join(destination,'source.dump'));database={format:'pg-custom',hash:await fileHash(join(destination,'source.dump'))};
    }
    await cp(f.env.RAW_DIRECTORY!,join(destination,'raw'),{recursive:true,errorOnExist:true,force:false});
    const content={kind:'ac32-source-bundle-1' as const,sourceRevision:revision,dataset:{...plan.dataset,sessions:count,businessEvents:count*80,waits:count*19,analyzedSessions:known},
      clock:f.now.toISOString(),start:start.toISOString(),activityDate:start.toISOString().slice(0,10),week:new Date(start.getTime()+(mini?0:21)*86400000).toISOString().slice(0,10),
      diagnostic,people,first:first!,weekly:weekly!,files:await inventory(join(destination,'raw')),database,
      preparation:{reportRequests,analysisJobsVerified:known,analysisVerification:'public-job-succeeded-applicable-complete' as const,reportedOutcomesPerAnalyzedSession:2 as const}};
    const bundle:Bundle={...content,bundleHash:hash(JSON.stringify(content))};
    await writeFile(join(destination,'bundle.json'),JSON.stringify(bundle),{flag:'wx',mode:0o600});return bundle;
  }finally{await disposeOwned(f,owner,closed);}
}
export async function restoreBundle(directory:string){
  const bundle:Bundle=JSON.parse(await readFile(join(directory,'bundle.json'),'utf8'));
  assert.equal(bundle.kind,'ac32-source-bundle-1');const {bundleHash,...content}=bundle;assert.equal(hash(JSON.stringify(content)),bundleHash);
  assert.deepEqual(await inventory(join(directory,'raw')),bundle.files);
  if(bundle.database.format==='pg-custom')assert.equal(await fileHash(join(directory,'source.dump')),bundle.database.hash);
  else {assert.equal(bundle.database.format,'pg-stopped-cluster');const files=await inventory(join(directory,'postgres'));assert.deepEqual(files,bundle.database.files);assert.equal(hash(JSON.stringify(files)),bundle.database.hash);}
  const sandbox=await createSandbox(bundle.database.format==='pg-stopped-cluster'?{stoppedNativeSnapshot:{directory:join(directory,'postgres'),password:bundle.database.password!}}:{}),owner=await markOwned(sandbox);
  try{if(bundle.database.format==='pg-custom')await pgCommand(sandbox,'restore',join(directory,'source.dump'));await cp(join(directory,'raw'),sandbox.env.RAW_DIRECTORY!,{recursive:true,errorOnExist:true,force:false});
    assert.deepEqual(await inventory(sandbox.env.RAW_DIRECTORY!),bundle.files);return {sandbox,owner,bundle};
  }catch(error){await disposeOwned(sandbox,owner);throw error;}
}
export async function appendLate(api:(path:string,token?:string,init?:RequestInit)=>Promise<Response>,directory:string,bundle:Bundle,weekly=false){
  const pointer=weekly?bundle.weekly:bundle.first,person=bundle.people[0]!,timestamp=new Date(Date.parse(pointer.qualifiedAt)+900000).toISOString();
  const old=await readFile(join(directory,'raw',pointer.deviceId,pointer.hash));
  const bytes=Buffer.concat([old,Buffer.from([
    {timestamp,type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'补充一条原生用户消息'}]}},
    {timestamp,type:'event_msg',payload:{type:'token_count',info:{total_token_usage:{input_tokens:2100,cached_input_tokens:420,output_tokens:525,reasoning_output_tokens:0,total_tokens:2625}}}},
  ].map(row=>JSON.stringify(row)).join('\n')+'\n')]);
  const staged=await api('/api/chunks/'+hash(bytes),person.deviceCredential,{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:bytes});assert.equal(staged.status,201);
  const response=await api('/api/snapshots',person.deviceCredential,json({protocolVersion:1,sourceSessionId:pointer.sessionId,source:'codex-cli',sourceVersion:'0.157.1',sourceOs:process.platform,
    project:pointer.project,hash:hash(bytes),byteLength:bytes.length,qualifiedAt:pointer.qualifiedAt,capability:'unverified'}));assert.equal(response.status,200,await response.clone().text());
}
