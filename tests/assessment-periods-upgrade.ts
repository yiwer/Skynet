import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {assessmentFixture} from './assessment-fixture.js';
import {createApp} from '../apps/server/app.js';
import {digest} from '../apps/server/database.js';
import {monday,addDays} from '../packages/contracts/work-views.js';
import {beijingDate} from '../packages/contracts/reports.js';

assert.ok(process.env.SKYNET_PERIODS_PREVIOUS_SOURCE);assert.ok(process.env.SKYNET_PERIODS_EVIDENCE);
const previous=process.env.SKYNET_PERIODS_PREVIOUS_SOURCE;
const {createApp:previousApp}=await import(pathToFileURL(join(previous,'apps/server/app.ts')).href) as {createApp:typeof createApp};
const f=await assessmentFixture(),schedule=await f.testDatabase.connect();let held=false,old:Awaited<ReturnType<typeof createApp>>|undefined,restore:{path:string;bytes:Buffer}|undefined;
const evidence:Record<string,unknown>={kind:'same-database-three-period-assessment-upgrade',previousRevision:execFileSync('git',['-C',previous,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),
  revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),startedAt:new Date().toISOString(),comparisons:[]};
try{
  const owner=await f.owner('Period upgrade owner'),peer=await f.owner('Period upgrade peer'),week=monday(beijingDate(f.now));
  f.now.setTime(Date.parse(addDays(week,4)+'T18:00:00+08:00'));
  async function recorded(person:typeof owner,date:string,tokens:number){
    const input=f.rows({prompts:4,tokens}),shift=Date.parse(date+'T12:00:00+08:00')-f.base.getTime();
    for(const row of input.rows.slice(2) as {timestamp?:string}[])if(row.timestamp)row.timestamp=new Date(Date.parse(row.timestamp)+shift).toISOString();
    const result=await f.upload(person,input.rows,input.sessionId);await f.analyze(person,result.snapshotId);return result;
  }
  const current=await recorded(owner,week,2400);await recorded(owner,addDays(week,-7),600);const baseline=await recorded(peer,addDays(week,-14),8000);
  // Keep unrelated derived work refreshes from publishing between the two
  // binaries. Values are still read and compared through the complete API.
  await schedule.query('SELECT pg_advisory_lock(7402128),pg_advisory_lock(7402131),pg_advisory_lock(7402129)');held=true;
  old=await previousApp({db:f.testDatabase,rawDirectory:join(f.directory,'raw'),reportClock:()=>f.now});
  async function before(path:string){const response=await old!.inject({url:path,headers:{Authorization:'Bearer '+owner.readerCredential}});assert.equal(response.statusCode,200,response.body);return response.json();}
  async function after(path:string,body?:object){const response=await f.api(owner,path,body);assert.equal(response.status,200,await response.clone().text());return response.json();}
  const path='/api/capability-profiles/'+owner.employeeId,fixed:{query:string;value:any}[]=[];
  async function compare(stage:string,allPresets=false){
    for(const period of ['since-enrollment','this-week','last-week'])for(const preset of allPresets?['默认','重产出','重质量']:['默认']){
      const query=new URLSearchParams({period,preset}).toString(),value=await before(path+'/export?'+query);
      assert.deepEqual(await after(path+'/export?'+query),value,'complete current profile '+stage+' '+query);
      const page=await before(path+'?'+query);assert.deepEqual(await after(path+'?'+query),page);
      assert.deepEqual(await after(path+'/recompute',{period,preset}),page,'full continues to produce the same public profile');
      assert.deepEqual(await after(path+'/export?'+query+'&version='+value.version),value);
      for(const item of [value.assessment,...[value.coaching.trend.previous,value.coaching.trend.current].map((row:any)=>({version:row.assessmentVersion}))]){
        const assessmentPath='/api/assessments/'+owner.employeeId+'?version='+item.version;
        assert.deepEqual(await after(assessmentPath),await before(assessmentPath));
      }
      fixed.push({query,value});(evidence.comparisons as object[]).push({stage,period,preset,version:value.version,hash:digest(JSON.stringify(value))});
    }
  }
  await compare('stable',true);
  const insight=await after('/api/snapshots/'+current.snapshotId+'/insights');
  const correction=await f.api(owner,'/api/snapshots/'+current.snapshotId+'/inference-corrections',{requestId:randomUUID(),expectedVersion:insight.version,kind:'prompt-elements',
    promptEvent:insight.inferences.prompts[0].event,value:{goal:null,constraints:true,context:false,acceptance:null},reason:'Synthetic three-period baseline differential'});
  assert.equal(correction.status,201,await correction.clone().text());await compare('corrected');
  restore={path:join(f.directory,'raw',peer.deviceId,digest(baseline.bytes)),bytes:baseline.bytes};await writeFile(restore.path,'synthetic unavailable baseline\n');await compare('outage');
  await writeFile(restore.path,restore.bytes);await compare('recovered');
  await recorded(owner,addDays(week,1),1000);await compare('late');
  await old.close();old=undefined;await f.restart();
  for(const {query,value}of fixed)assert.deepEqual(await after(path+'/export?'+query+'&version='+value.version),value);
  evidence.status='passed';
}catch(error){evidence.status='failed';evidence.error=String(error);throw error;}
finally{if(restore)await writeFile(restore.path,restore.bytes);await old?.close();if(held)await schedule.query('SELECT pg_advisory_unlock(7402128),pg_advisory_unlock(7402131),pg_advisory_unlock(7402129)');schedule.release();await f.close();evidence.finishedAt=new Date().toISOString();await writeFile(process.env.SKYNET_PERIODS_EVIDENCE,JSON.stringify(evidence,null,2));}
