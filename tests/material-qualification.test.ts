import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { chromium, expect, type Browser } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { mcpSandbox } from './mcp-support.js';
import { connect, digest } from '../apps/server/database.js';
import { publicConfig, readAnalysisConfig } from '../apps/analysis/config.js';
import { analysisQueue } from '../apps/analysis/queue.js';
import { executeAnalysis } from '../apps/analysis/execute.js';
import { beijingDate } from '../packages/contracts/reports.js';
import {archiveQuery} from '../apps/server/archive-query.js';
import { monday, addDays, type WorkView } from '../packages/contracts/work-views.js';
import type { ClaimedAnalysis } from '../apps/analysis/queue.js';
import { reconcileOriginalQualifications } from '../apps/server/provenance.js';
import { RawStore } from '../apps/server/raw-store.js';
import {readEvidence} from '../apps/server/evidence.js';

const json = (value: unknown): RequestInit => ({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
const encoded = (...rows: unknown[]) => Buffer.from(rows.map(row=>JSON.stringify(row)).join('\n')+'\n');
test('material-first → original normal source qualification versions activity and analysis, preserves original identities and frozen reports', {timeout:120000}, async () => {
  const s = await mcpSandbox(); const db = connect(s.env.DATABASE_URL!); let browser: Browser | undefined; let client: Client | undefined;
  console.log(`Material qualification fixture directory: ${s.directory}`);
  let lease: ReturnType<typeof setInterval> | undefined;
  try {
    (s.env as NodeJS.ProcessEnv).NODE_EXTRA_CA_CERTS=s.ca;
    const A=await s.provision('材料原来源甲');const B=await s.provision('材料先恢复乙');
    const api=(path:string,token=A.readerCredential,init:RequestInit={})=>s.api(path,token,init);
    const homeA=join(s.directory,'A');const rootA=join(homeA,'sessions');await mkdir(rootA,{recursive:true});
    const stateA=join(s.directory,'collector-A');
    await s.collectorCommand('setup',stateA,{source:'codex-cli',server:s.origin,enrollmentCredential:A.enrollmentCredential,nativeRoot:rootA,sourceVersion:'0.157.1',sourceOs:process.platform});
    const settingsA=JSON.parse(await readFile(join(stateA,'settings.json'),'utf8'));
    const before=new Date(Date.parse(settingsA.enrolledAt)-86400000).toISOString();
    const after=new Date(Date.parse(settingsA.enrolledAt)+1).toISOString();const date=beijingDate(new Date(after));
    const parentId=randomUUID();const childId=randomUUID();const parentPath=join(rootA,`${parentId}.jsonl`);const childPath=join(rootA,`${childId}.jsonl`);
    const header=(id:string,extra={})=>({type:'session_meta',payload:{id,cli_version:'0.157.1',source:'cli',...extra}});
    const row=(text:string,timestamp:string)=>({type:'response_item',timestamp,payload:{type:'message',role:'user',content:[{type:'input_text',text}]}});
    const childBytes=encoded(header(childId),row('甲接入前原记录🛰',before),row('甲接入后真正原活动🛰',after));
    await writeFile(childPath,childBytes);await writeFile(parentPath,encoded(header(parentId,{forked_from_id:childId}),row('旧主会话背景',before)));
    const native=new DatabaseSync(join(homeA,'state_5.sqlite'));native.exec('CREATE TABLE threads(id TEXT PRIMARY KEY,rollout_path TEXT)');native.prepare('INSERT INTO threads VALUES(?,?)').run(childId,childPath);native.close();
    async function qualify(state:string,id:string,path:string,project:string) {
      await s.collectorCommand('hook',state,{hook_event_name:'Stop',session_id:id,transcript_path:path,cwd:project});
      const result=JSON.parse(await s.collectorCommand('run',state));assert.deepEqual(result.errors,[]);
      return (await(await api('/api/sessions')).json()).sessions.find((entry:any)=>entry.project===project).id;
    }
    const parentSnapshot=await qualify(stateA,parentId,parentPath,'/original/A');
    const bundle=await(await api(`/api/snapshots/${parentSnapshot}/recovery`)).json();
    const material=bundle.manifest.capture.materials.find((entry:any)=>entry.sourceSessionId===childId);assert.ok(material);
    const rootB=join(s.directory,'B','sessions');await mkdir(rootB,{recursive:true});const bPath=join(rootB,`${childId}.jsonl`);await writeFile(bPath,childBytes);
    await writeFile(join(s.directory,'B','restore-receipt.json'),JSON.stringify({source:'codex-cli',snapshotId:parentSnapshot,sourceSessionId:parentId,rolloutPath:join(rootB,`${parentId}.jsonl`),
      restoredFrom:{snapshotId:parentSnapshot,hash:bundle.manifest.hash,byteLength:bundle.manifest.byteLength},materials:[{...material,path:bPath}]}));
    const stateB=join(s.directory,'collector-B');await s.collectorCommand('setup',stateB,{source:'codex-cli',server:s.origin,enrollmentCredential:B.enrollmentCredential,nativeRoot:rootB,sourceVersion:'0.157.1',sourceOs:process.platform});
    assert.equal(JSON.parse(await s.collectorCommand('run',stateB)).committed,0,'copied material receipt is never normal qualification');
    let bSnapshot=await qualify(stateB,childId,bPath,'/restored/B');const initial=await(await api(`/api/snapshots/${bSnapshot}`)).json();
    assert.equal(initial.manifest.restoredFrom.materialId,material.id);assert.ok(initial.events.every((event:any)=>event.origin.employeeId===A.employeeId));
    assert.deepEqual(initial.events.map((event:any)=>event.context),['historical','historical']);
    const initialIds=initial.events.map((event:any)=>event.origin.eventId);
    const settingsB=JSON.parse(await readFile(join(stateB,'settings.json'),'utf8'));
    const foreignNormal=await api('/api/snapshots',settingsB.deviceCredential,json({...initial.manifest,restoredFrom:undefined,qualifiedAt:new Date().toISOString(),enrolledAt:'1970-01-01T00:00:00.000Z'}));
    assert.equal(foreignNormal.status,200);bSnapshot=(await foreignNormal.json()).snapshotId;
    const foreign=await(await api(`/api/snapshots/${bSnapshot}`)).json();
    assert.notEqual(foreign.manifest.enrolledAt,'1970-01-01T00:00:00.000Z','client cannot move enrollment boundary');
    assert.deepEqual(foreign.events.map((event:any)=>event.origin.eventId),initialIds);
    assert.ok(foreign.events.every((event:any)=>event.context==='historical'&&!event.origin.qualification),'normal B copy cannot independently qualify A event');
    const oldReadable=await(await api(`/api/snapshots/${bSnapshot}/readable`)).text();assert.ok(!oldReadable.includes('after-enrollment'));
    const beforeReport=await(await api(`/api/daily-reports/${A.employeeId}/${date}`,undefined,json({}))).json();
    assert.equal(beforeReport.statistics.records,0);assert.equal(beforeReport.state,'ready');assert.ok(beforeReport.revision>0);
    const frozenReport=await(await api(`/api/daily-reports/${A.employeeId}/${date}?revision=${beforeReport.revision}`)).json();
    const projectPath='/api/work-view?'+new URLSearchParams({kind:'project',subject:'/original/A',from:date,to:date});
    const week=monday(date);const weekPath='/api/work-view?'+new URLSearchParams({kind:'weekly',subject:A.employeeId,from:week,to:addDays(week,6)});
    const beforeProject:WorkView=await(await api(projectPath,undefined,json({}))).json();
    const beforeWeek:WorkView=await(await api(weekPath,undefined,json({}))).json();
    assert.equal(beforeProject.statistics!.records,null,'context-only project has no qualified input, not fabricated zero');
    const frozenProjectText=await(await api(projectPath+`&revision=${beforeProject.revision}`)).text();const frozenProject=JSON.parse(frozenProjectText);
    const frozenWeekText=await(await api(weekPath+`&revision=${beforeWeek.revision}`)).text();const frozenWeek=JSON.parse(frozenWeekText);
    const configPath=join(s.directory,'analysis.json');await writeFile(configPath,JSON.stringify({mode:'fixture',executable:process.execPath,runtimeVersion:'2.1.281',model:'synthetic',workDirectory:join(s.directory,'jobs'),fixtureOrigin:'http://127.0.0.1:12345',budgetId:'qualification-fixture',budgetCny:0,inputCnyPerMillion:0,outputCnyPerMillion:0,maxAttempts:1,leaseSeconds:30,timeoutSeconds:90,autoAnalyzeUpdates:false}));
    const config=await readAnalysisConfig(configPath);await db.query('INSERT INTO analysis_workers(id,config) VALUES($1,$2)',['qualification-test',publicConfig(config)]);
    const queue=analysisQueue(db,config,'qualification-test');
    const oldRequested=await(await api(`/api/snapshots/${bSnapshot}/analysis`,undefined,json({}))).json();const old=await queue.claim();assert.equal(old!.id,oldRequested.id);
    lease=setInterval(()=>{void queue.renew(old!).catch(()=>undefined);},1000);
    const oldResult=await executeAnalysis(config,old!.input,new AbortController().signal,()=>queue.allowForward(old!),async(_config,input,_signal,forward)=>{
      assert.equal(await forward!(),true);return {output:{items:[{category:'activity',assessment:'claimed',text:'原活动，需保留资格边界',citations:[{event:1,textOffset:0,quote:input.events[1]!.text}]}]},usage:{inputTokens:1,outputTokens:1,runtimeCostUsd:null,providerBilledCny:null,requests:1}};
    });
    // Pause the public caller immediately after its exact origin rows were read.
    // The actual A capture then commits a new proof before request creates a job.
    const originalQuery=s.testDatabase.query;let releaseOrigins!:()=>void;let originsRead!:()=>void;let reads=0;
    const readGate=new Promise<void>(resolve=>{originsRead=resolve;});const released=new Promise<void>(resolve=>{releaseOrigins=resolve;});
    s.testDatabase.query=((sql:unknown,values:unknown[])=>{
      const result=(originalQuery as (sql:string,values:unknown[])=>Promise<import('pg').QueryResult>).call(s.testDatabase,sql as string,values);
      if(reads<3&&typeof sql==='string'&&sql.includes('FROM effective_snapshot_events s JOIN effective_event_origins')&&values?.[0]===bSnapshot) {
        reads++;return Promise.resolve(result).then(async value=>{if(reads===3)originsRead();await released;return value;});
      }
      return result;
    }) as typeof originalQuery;
    // Two cold caller caches read the same old origins while the public analysis
    // request is preparing. The trusted public A upload then changes revision.
    const coldArchive=archiveQuery(s.testDatabase,new RawStore(s.env.RAW_DIRECTORY!));
    const racingCaches=Promise.allSettled([coldArchive.detail(bSnapshot),coldArchive.exported(bSnapshot,'readable')]);
    const racingRequest=api(`/api/snapshots/${bSnapshot}/analysis`,undefined,json({}));let aSnapshot:string;
    try {
      await Promise.race([readGate,new Promise((_,reject)=>setTimeout(()=>reject(new Error('public analysis origin-read seam was not reached')),12000))]);
      aSnapshot=await qualify(stateA,childId,childPath,'/later-normal/A');
    } finally {releaseOrigins();s.testDatabase.query=originalQuery;}
    const staleResponse=await racingRequest;assert.equal(staleResponse.status,409,'an input read before the trusted proof cannot be attached to its new generation');
    assert.match((await staleResponse.json()).error,/资格版本已更新/);
    for(const value of await racingCaches){assert.equal(value.status,'rejected','a cold cache must not publish old origins under a changed attribution revision');assert.equal((value as PromiseRejectedResult).reason.statusCode,409);}
    assert.equal((await coldArchive.detail(bSnapshot)).events[1]!.context,'after-enrollment');
    assert.ok((await coldArchive.exported(bSnapshot,'readable')).bytes.toString('utf8').includes('after-enrollment'));
    const qualified=await(await api(`/api/snapshots/${aSnapshot}`)).json();
    await writeFile(join(s.directory,'qualification-after-normal-diagnostic.json'),JSON.stringify({initial,qualified,beforeReport,oldRequested},null,2));
    assert.equal(qualified.events[1].context,'after-enrollment','normal original A proof must qualify the original post-enrollment event once');
    assert.equal(qualified.events[0].context,'historical');
    const currentCopy=await(await api(`/api/snapshots/${bSnapshot}`)).json();assert.equal(currentCopy.events[1].context,'after-enrollment','current cached B carrier reflects trusted A proof immediately');
    assert.equal(currentCopy.events[1].origin.qualification.proofSnapshotId,aSnapshot);
    assert.ok((await(await api(`/api/snapshots/${bSnapshot}/readable`)).text()).includes('after-enrollment'),'readable interpretation cache refreshes, original raw does not change');
    assert.deepEqual(qualified.events.map((event:any)=>event.origin.eventId),initialIds);
    assert.ok(qualified.events.every((event:any)=>event.origin.qualification?.proofSnapshotId===aSnapshot));
    for(const event of qualified.events) {assert.equal(event.origin.employeeId,A.employeeId);assert.equal(event.origin.deviceId,settingsA.deviceId);assert.equal(event.origin.project,'/original/A');assert.equal(event.origin.snapshotId,parentSnapshot);assert.equal(event.origin.materialId,material.id);}
    assert.equal(await queue.allowForward(old!),false,'old input revision cannot forward another provider request');
    assert.equal(await queue.finish(old!,oldResult),true,'old result is preserved only as historical analysis');
    clearInterval(lease);lease=undefined;
    const oldHistory=await(await api(`/api/analysis/${old!.id}`)).json();assert.equal(oldHistory.applicable,false);assert.equal(oldHistory.result.items[0].citations[0].origin.context,'historical');
    const newer=await(await api(`/api/snapshots/${bSnapshot}/analysis`,undefined,json({}))).json();assert.notEqual(newer.id,old!.id);assert.ok(newer.generation>oldRequested.generation);assert.notEqual(newer.input.attributionRevision,oldRequested.input.attributionRevision);
    let pending=await(await api(`/api/daily-reports/${A.employeeId}/${date}`)).json();
    const pollDeadline=Date.now()+12000;
    while(pending.statistics.records!==1&&Date.now()<pollDeadline){await new Promise(resolve=>setTimeout(resolve,200));pending=await(await api(`/api/daily-reports/${A.employeeId}/${date}`)).json();}
    assert.equal(pending.statistics.records,1,'qualification invalidates even a ready period; normal scheduler refreshes without a new report request');
    async function finish(claim:ClaimedAnalysis) {
      const result=await executeAnalysis(config,claim.input,new AbortController().signal,()=>queue.allowForward(claim),async(_config,input,_signal,forward)=>{
        assert.equal(await forward!(),true);const event=input.events.findIndex(item=>item.text==='甲接入后真正原活动🛰');assert.ok(event>=0);
        return {output:{items:[{category:'activity',assessment:'claimed',text:'甲的原活动已独立资格确认',citations:[{event,textOffset:0,quote:input.events[event]!.text}]}]},usage:{inputTokens:1,outputTokens:1,runtimeCostUsd:null,providerBilledCny:null,requests:1}};
      });assert.equal(await queue.finish(claim,result),true);
    }
    for(let i=0;i<4;i++){await db.query("UPDATE analysis_workers SET updated_at=now() WHERE id='qualification-test'");const claim=await queue.claim();if(!claim)break;await finish(claim);}
    let currentReport=await(await api(`/api/daily-reports/${A.employeeId}/${date}`,undefined,json({}))).json();
    // Refresh is a public 202 operation. A competing scheduled refresh may keep
    // the prior revision visible until the newly applicable analysis is consumed.
    const analysisDeadline=Date.now()+12000;
    while(currentReport.refreshPending&&Date.now()<analysisDeadline){await new Promise(resolve=>setTimeout(resolve,200));currentReport=await(await api(`/api/daily-reports/${A.employeeId}/${date}`)).json();}
    assert.equal(currentReport.refreshPending,false);assert.equal(currentReport.statistics.records,1);assert.ok(currentReport.revision>beforeReport.revision);assert.ok(currentReport.items.some((item:any)=>item.activityEventIds.includes(initialIds[1])));
    assert.deepEqual(await(await api(`/api/daily-reports/${A.employeeId}/${date}?revision=${beforeReport.revision}`)).json(),frozenReport);
    let project:WorkView=await(await api(projectPath)).json();let weekly:WorkView=await(await api(weekPath)).json();
    const viewDeadline=Date.now()+15000;
    while((project.statistics?.records!==1||weekly.statistics?.records!==1)&&Date.now()<viewDeadline){await new Promise(resolve=>setTimeout(resolve,200));project=await(await api(projectPath)).json();weekly=await(await api(weekPath)).json();}
    assert.equal(project.statistics!.records,1,'trusted qualification automatically refreshes existing original-project view without another work-view POST');
    assert.equal(weekly.statistics!.records,1,'frozen daily revision change automatically refreshes the containing weekly view');
    assert.ok(project.coverage!.days.every(day=>day.employeeId===A.employeeId&&BigInt(day.qualificationRevision!)>0n));
    assert.ok(project.items.every(item=>item.project==='/original/A'&&item.employeeId===A.employeeId));
    assert.equal(await(await api(projectPath+`&revision=${beforeProject.revision}`)).text(),frozenProjectText,'fixed project revision is byte-for-byte unchanged');
    assert.equal(await(await api(weekPath+`&revision=${beforeWeek.revision}`)).text(),frozenWeekText,'fixed weekly revision is byte-for-byte unchanged');
    const stats=await(await api('/api/activity-statistics')).json();assert.equal(stats.rows.filter((item:any)=>item.employeeId===A.employeeId).reduce((sum:number,item:any)=>sum+item.activityRecords,0),1);
    assert.equal(stats.rows.filter((item:any)=>item.employeeId===B.employeeId).reduce((sum:number,item:any)=>sum+item.activityRecords,0),0);
    assert.equal(JSON.parse(await s.collectorCommand('run',stateA)).committed,0);assert.equal(JSON.parse(await s.collectorCommand('run',stateB)).committed,0);
    assert.deepEqual(await(await api('/api/activity-statistics')).json(),stats);
    assert.deepEqual(Buffer.from(await(await api(`/api/snapshots/${aSnapshot}/raw`)).arrayBuffer()),childBytes);assert.deepEqual(Buffer.from(await(await api(`/api/snapshots/${parentSnapshot}/materials/${material.id}`)).arrayBuffer()),childBytes);
    await s.restart();assert.deepEqual(await(await api(`/api/daily-reports/${A.employeeId}/${date}?revision=${beforeReport.revision}`)).json(),frozenReport);
    const registration=await(await api('/oauth/register',undefined,json({client_name:'qualification test',redirect_uris:['http://127.0.0.1:47123/callback'],token_endpoint_auth_method:'none'}))).json();const verifier=randomBytes(48).toString('base64url');const resource=s.origin+'/mcp';
    const callback=new URL(await s.authorizationPage(s.origin+'/oauth/authorize?'+new URLSearchParams({response_type:'code',client_id:registration.client_id,redirect_uri:registration.redirect_uris[0],scope:'archive:read',resource,state:randomUUID(),code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url')}),B.readerCredential));
    const token=await(await api('/oauth/token',undefined,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:registration.client_id,code:callback.searchParams.get('code')!,redirect_uri:registration.redirect_uris[0],code_verifier:verifier,resource}).toString()})).json();
    client=new Client({name:'qualification',version:'1'});await client.connect(new StreamableHTTPClientTransport(new URL(resource),{fetch:s.fetchTls,requestInit:{headers:{Authorization:`Bearer ${token.access_token}`}}}));
    const mcpReport=await client.callTool({name:'read_daily_report',arguments:{employeeId:A.employeeId,date,revision:currentReport.revision}});assert.notEqual(mcpReport.isError,true);assert.deepEqual(JSON.parse((mcpReport.content as {text:string}[])[0]!.text),await(await api(`/api/daily-reports/${A.employeeId}/${date}?revision=${currentReport.revision}`)).json());
    const mcpSnapshot=await client.callTool({name:'read_snapshot',arguments:{snapshotId:bSnapshot}});assert.ok(JSON.stringify(mcpSnapshot).includes('after-enrollment'));
    browser=await chromium.launch();const page=await browser.newPage({ignoreHTTPSErrors:true});await page.goto(s.origin+`/#${aSnapshot}`);await page.getByLabel('个人读取凭据').fill(B.readerCredential);await page.getByRole('button',{name:'进入存档',exact:true}).click();
    await expect(page.getByText('甲接入后真正原活动🛰',{exact:true}).first()).toBeVisible();
    await page.getByRole('link',{name:'时间线',exact:true}).click();
    await page.getByRole('link',{name:'采集来源',exact:true}).nth(1).click();await expect(page.getByRole('region',{name:'命中证据',exact:true})).toContainText('甲接入后真正原活动🛰');
    await page.goto(s.origin+`/#${aSnapshot}`);
    await page.getByRole('link',{name:'时间线',exact:true}).click();
    await page.getByRole('link',{name:'原始材料第 3 行',exact:true}).first().click();await expect(page.getByRole('region',{name:'命中证据',exact:true})).toContainText('甲接入后真正原活动🛰');
    await writeFile(join(s.directory,'material-qualification-evidence.json'),JSON.stringify({initial,qualified,oldHistory,newer,currentReport,frozenReport,project,weekly,frozenProject,frozenWeek,stats,rawUnchanged:true,provider:'synthetic execution seam; no paid/native model'},null,2));console.log(`Material qualification evidence: ${s.directory}`);
  } finally {clearInterval(lease);await client?.close();await browser?.close();await db.end();await s.close();}
});

test('legacy material qualification reconciles >16MiB committed original primary in background without reupload or widening analysis bounds', {timeout:120000}, async()=>{
  const s=await mcpSandbox();const db=connect(s.env.DATABASE_URL!);
  console.log(`Legacy qualification fixture directory: ${s.directory}`);
  try {
    (s.env as NodeJS.ProcessEnv).NODE_EXTRA_CA_CERTS=s.ca;
    const A=await s.provision('旧材料原来源甲');const B=await s.provision('旧材料恢复乙');
    const api=(path:string,token=A.readerCredential,init:RequestInit={})=>s.api(path,token,init);
    const rootA=join(s.directory,'legacy-A','sessions');await mkdir(rootA,{recursive:true});const stateA=join(s.directory,'legacy-collector-A');
    await s.collectorCommand('setup',stateA,{source:'codex-cli',server:s.origin,enrollmentCredential:A.enrollmentCredential,nativeRoot:rootA,sourceVersion:'0.157.1',sourceOs:process.platform});
    const settingsA=JSON.parse(await readFile(join(stateA,'settings.json'),'utf8'));const after=new Date(Date.parse(settingsA.enrolledAt)+1).toISOString();const date=beijingDate(new Date(after));
    const parentId=randomUUID();const childId=randomUUID();const parentPath=join(rootA,`${parentId}.jsonl`);const childPath=join(rootA,`${childId}.jsonl`);
    const header=(id:string,extra={})=>({type:'session_meta',payload:{id,cli_version:'0.157.1',source:'cli',...extra}});
    const row=(text:string)=>({type:'response_item',timestamp:after,payload:{type:'message',role:'user',content:[{type:'input_text',text}]}});
    // Keep this a complete, legal large primary. Unknown-format padding is
    // correctly incomplete and is covered separately by the public gap test.
    const paddingLength=encoded({type:'unrecognized-padding',data:'x'.repeat(1000)}).length;
    const paddingRow={type:'session_meta',payload:{id:childId},data:''};
    const padding=encoded({...paddingRow,data:'x'.repeat(paddingLength-encoded(paddingRow).length)});assert.equal(padding.length,paddingLength);
    const childBytes=Buffer.concat([encoded(header(childId),row('大型旧件首事件')),Buffer.from(padding.toString().repeat(Math.ceil(17*1024*1024/padding.length))),encoded(row('大型旧件尾事件'))]);
    assert.ok(childBytes.length>16*1024*1024);
    assert.ok(childBytes.length>17*1024*1024);
    const parsed=readEvidence(childBytes,'codex-cli');assert.equal(parsed.events.length,2);assert.equal(parsed.unrecognizedLines,0);assert.equal(parsed.partialLine,false);
    await writeFile(childPath,childBytes);await writeFile(parentPath,encoded(header(parentId,{forked_from_id:childId})));
    const native=new DatabaseSync(join(s.directory,'legacy-A','state_5.sqlite'));native.exec('CREATE TABLE threads(id TEXT PRIMARY KEY,rollout_path TEXT)');native.prepare('INSERT INTO threads VALUES(?,?)').run(childId,childPath);native.close();
    async function capture(state:string,id:string,path:string,project:string) {
      await s.collectorCommand('hook',state,{hook_event_name:'Stop',session_id:id,transcript_path:path,cwd:project});
      assert.deepEqual(JSON.parse(await s.collectorCommand('run',state)).errors,[],JSON.stringify(s.serverErrors));
      return (await(await api('/api/sessions')).json()).sessions.find((item:any)=>item.project===project).id;
    }
    const parentSnapshot=await capture(stateA,parentId,parentPath,'/legacy/original/A');
    const bundle=await(await api(`/api/snapshots/${parentSnapshot}/recovery`)).json();const material=bundle.manifest.capture.materials.find((item:any)=>item.sourceSessionId===childId);assert.ok(material);
    const rootB=join(s.directory,'legacy-B','sessions');await mkdir(rootB,{recursive:true});const bPath=join(rootB,`${childId}.jsonl`);await writeFile(bPath,childBytes);
    await writeFile(join(s.directory,'legacy-B','restore-receipt.json'),JSON.stringify({source:'codex-cli',snapshotId:parentSnapshot,sourceSessionId:parentId,rolloutPath:join(rootB,`${parentId}.jsonl`),
      restoredFrom:{snapshotId:parentSnapshot,hash:bundle.manifest.hash,byteLength:bundle.manifest.byteLength},materials:[{...material,path:bPath}]}));
    const stateB=join(s.directory,'legacy-collector-B');await s.collectorCommand('setup',stateB,{source:'codex-cli',server:s.origin,enrollmentCredential:B.enrollmentCredential,nativeRoot:rootB,sourceVersion:'0.157.1',sourceOs:process.platform});
    const bSnapshot=await capture(stateB,childId,bPath,'/legacy/restored/B');const initial=await(await api(`/api/snapshots/${bSnapshot}`)).json();assert.equal(initial.total,2);
    // Controlled predecessor-schema seam only: the old archive behavior had no
    // proof append. Every raw object/mapping and both host captures remain public.
    await db.query(`CREATE FUNCTION suppress_legacy_qualification() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$;
      CREATE TRIGGER legacy_qualification_before BEFORE INSERT ON event_qualifications FOR EACH ROW EXECUTE FUNCTION suppress_legacy_qualification()`);
    const aSnapshot=await capture(stateA,childId,childPath,'/legacy/later/A');
    const oldDetail=await(await api(`/api/snapshots/${aSnapshot}`)).json();assert.ok(oldDetail.events.every((event:any)=>event.context==='historical'&&!event.origin.qualification));
    const oldReport=await(await api(`/api/daily-reports/${A.employeeId}/${date}`,undefined,json({}))).json();assert.equal(oldReport.state,'ready');assert.equal(oldReport.statistics.records,0);
    const frozen=await(await api(`/api/daily-reports/${A.employeeId}/${date}?revision=${oldReport.revision}`)).json();
    const configPath=join(s.directory,'legacy-analysis.json');await writeFile(configPath,JSON.stringify({mode:'fixture',executable:process.execPath,runtimeVersion:'2.1.281',model:'synthetic',workDirectory:join(s.directory,'legacy-jobs'),fixtureOrigin:'http://127.0.0.1:12345',budgetId:'legacy-qualification',budgetCny:0,inputCnyPerMillion:0,outputCnyPerMillion:0,autoAnalyzeUpdates:false}));
    const config=await readAnalysisConfig(configPath);await db.query('INSERT INTO analysis_workers(id,config) VALUES($1,$2)',['legacy-qualification-test',publicConfig(config)]);
    const oversizedBefore=await api(`/api/snapshots/${aSnapshot}/analysis`,undefined,json({}));
    assert.equal(oversizedBefore.status,413,'>8MiB analysis input stays bounded before upgrade');
    assert.match((await oversizedBefore.json()).error,/字节|原件|输入/);
    await db.query(`DROP TRIGGER legacy_qualification_before ON event_qualifications;DROP FUNCTION suppress_legacy_qualification();
      UPDATE qualification_reconcile SET cutoff=now(),last_committed_at=NULL,last_snapshot_id=NULL,complete=false WHERE id=1`);
    await s.restart();let qualified=await(await api(`/api/snapshots/${aSnapshot}`)).json();const deadline=Date.now()+12000;
    while(!qualified.events.every((event:any)=>event.context==='after-enrollment')&&Date.now()<deadline){await new Promise(resolve=>setTimeout(resolve,200));qualified=await(await api(`/api/snapshots/${aSnapshot}`)).json();}
    if(!qualified.events.every((event:any)=>event.context==='after-enrollment')) {
      await writeFile(join(s.directory,'legacy-qualification-failure.json'),JSON.stringify({qualified,cursor:(await db.query('SELECT * FROM qualification_reconcile')).rows,
        gaps:(await db.query('SELECT * FROM qualification_reconcile_gaps')).rows,proofs:(await db.query('SELECT * FROM event_qualifications')).rows,
        origins:(await db.query('SELECT event_id,device_id,source,source_session_id,timestamp,source_date,material_id FROM archive_event_origins')).rows},null,2));
      // Surface the same failing operation after the normal poll's red timeout.
      // This is diagnostic only and does not turn a missing scheduled run green.
      await reconcileOriginalQualifications(db,new RawStore(s.env.RAW_DIRECTORY!));
      assert.fail('normal background reconciliation did not complete its public qualification');
    }
    assert.ok(qualified.events.every((event:any)=>event.context==='after-enrollment'&&event.origin.qualification?.proofSnapshotId===aSnapshot));
    assert.deepEqual(qualified.events.map((event:any)=>event.origin.eventId),initial.events.map((event:any)=>event.origin.eventId));
    assert.deepEqual(qualified.events.map((event:any)=>[event.origin.employeeId,event.origin.project,event.origin.sourceDate]),initial.events.map((event:any)=>[event.origin.employeeId,event.origin.project,event.origin.sourceDate]));
    assert.deepEqual(Buffer.from(await(await api(`/api/snapshots/${aSnapshot}/raw`)).arrayBuffer()),childBytes);
    assert.equal((await api(`/api/snapshots/${aSnapshot}/analysis`,undefined,json({}))).status,413,'proof does not expand the separate model input bound');
    assert.equal((await db.query('SELECT count(*) FROM analysis_jobs')).rows[0].count,'0');
    const stats=await(await api('/api/activity-statistics')).json();assert.equal(stats.rows.reduce((sum:number,item:any)=>sum+item.activityRecords,0),2);
    const firstProofs=qualified.events.map((event:any)=>event.origin.qualification);
    assert.equal(JSON.parse(await s.collectorCommand('run',stateA)).committed,0);await s.restart();
    const repeated=await(await api(`/api/snapshots/${aSnapshot}`)).json();assert.deepEqual(repeated.events.map((event:any)=>event.origin.qualification),firstProofs);
    assert.deepEqual(await(await api(`/api/activity-statistics`)).json(),stats);
    assert.deepEqual(await(await api(`/api/daily-reports/${A.employeeId}/${date}?revision=${oldReport.revision}`)).json(),frozen);
    const badId=randomUUID(),badParentId=randomUUID(),badPath=join(rootA,`${badId}.jsonl`),badParentPath=join(rootA,`${badParentId}.jsonl`);
    const badJson=encoded(row('BROKEN-UTF8'));const marker=badJson.indexOf('BROKEN-UTF8');
    const badBytes=Buffer.concat([encoded(header(badId)),badJson.subarray(0,marker),Buffer.from([0xff]),badJson.subarray(marker+'BROKEN-UTF8'.length)]);
    await writeFile(badPath,badBytes);await writeFile(badParentPath,encoded(header(badParentId,{forked_from_id:badId})));
    const badNative=new DatabaseSync(join(s.directory,'legacy-A','state_5.sqlite'));badNative.prepare('INSERT INTO threads VALUES(?,?)').run(badId,badPath);badNative.close();
    const badParent=await capture(stateA,badParentId,badParentPath,'/legacy/invalid-context/A');
    const badBundle=await(await api(`/api/snapshots/${badParent}/recovery`)).json();const badMaterial=badBundle.manifest.capture.materials.find((item:any)=>item.sourceSessionId===badId);
    const badBPath=join(rootB,`${badId}.jsonl`);await writeFile(badBPath,badBytes);
    await writeFile(join(s.directory,'legacy-B','restore-receipt.json'),JSON.stringify({source:'codex-cli',snapshotId:badParent,sourceSessionId:badParentId,rolloutPath:join(rootB,`${badParentId}.jsonl`),
      restoredFrom:{snapshotId:badParent,hash:badBundle.manifest.hash,byteLength:badBundle.manifest.byteLength},materials:[{...badMaterial,path:badBPath}]}));
    await capture(stateB,badId,badBPath,'/legacy/invalid-restored/B');const badPrimary=await capture(stateA,badId,badPath,'/legacy/invalid-normal/A');
    assert.equal((await api(`/api/snapshots/${badPrimary}/analysis`,undefined,json({}))).status,422);
    await db.query('UPDATE qualification_reconcile SET cutoff=now(),last_committed_at=NULL,last_snapshot_id=NULL,complete=false WHERE id=1');await s.restart();
    let gaps=await(await api('/api/activity-statistics')).json();const gapDeadline=Date.now()+8000;
    while(!gaps.warnings.qualificationGaps&&Date.now()<gapDeadline){await new Promise(resolve=>setTimeout(resolve,200));gaps=await(await api('/api/activity-statistics')).json();}
    assert.equal(gaps.warnings.qualificationGaps,1);assert.equal(gaps.rows.reduce((sum:number,item:any)=>sum+item.activityRecords,0),2);
    const badDetail=await(await api(`/api/snapshots/${badPrimary}`)).json();assert.equal(badDetail.unrecognizedLines,1);assert.equal(badDetail.total,0,'new corrupt capture has a visible parser gap and no semantic activity or qualification');
    assert.deepEqual(Buffer.from(await(await api(`/api/snapshots/${badPrimary}/raw`)).arrayBuffer()),badBytes);
    await writeFile(join(s.directory,'legacy-material-qualification-evidence.json'),JSON.stringify({byteLength:childBytes.length,hash:digest(childBytes),initial,qualified,repeated,stats,frozen,noReupload:true,analysisRejected413:true},null,2));
  } finally {await db.end();await s.close();}
});
