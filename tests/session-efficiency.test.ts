import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createApp} from '../apps/server/app.js';
import {connect,digest} from '../apps/server/database.js';
import {createSandbox} from './support.js';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {readAnalysisConfig,publicConfig} from '../apps/analysis/config.js';
import {analysisQueue} from '../apps/analysis/queue.js';
import {executeAnalysis} from '../apps/analysis/execute.js';

test('session efficiency keeps missing analysis and zero or unknown token denominators out of ratios and review selection', {timeout:120000},async()=>{
  const sandbox=await createSandbox(),db=connect(sandbox.env.DATABASE_URL!);
  let app:Awaited<ReturnType<typeof createApp>>|undefined;
  try{
    const person=await sandbox.provision('产效合成员工'),now=new Date(Date.now()+60000),timestamp=now.toISOString();
    app=await createApp({db,rawDirectory:sandbox.env.RAW_DIRECTORY!,reportClock:()=>now});
    const api=(url:string,payload?:unknown,credential=person.readerCredential,method:'GET'|'POST'|'PUT'='GET')=>app!.inject({url,method,headers:{Authorization:`Bearer ${credential}`,...(Buffer.isBuffer(payload)?{'Content-Type':'application/octet-stream'}:{})},...(payload===undefined?{}:{payload:payload as object})});
    const device=(await api('/api/devices/enroll',{installationId:randomUUID(),name:'产效设备'},person.enrollmentCredential,'POST')).json();
    async function upload(cost:number|null){
      const id=randomUUID(),rows=[{type:'user',uuid:randomUUID(),sessionId:id,timestamp,message:{role:'user',content:'检查接口并保留原有行为'}},
        {type:'assistant',uuid:randomUUID(),sessionId:id,timestamp,message:{id:randomUUID(),role:'assistant',content:[{type:'text',text:'记录本轮观察'}],...(cost===null?{}:{usage:{input_tokens:cost,output_tokens:0,cache_read_input_tokens:0,cache_creation_input_tokens:0}})}}];
      const bytes=Buffer.from(rows.map(row=>JSON.stringify(row)).join('\n')+'\n');
      await api('/api/chunks/'+digest(bytes),bytes,device.deviceCredential,'PUT');
      const result=await api('/api/snapshots',{protocolVersion:1,sourceSessionId:id,source:'claude-code-cli',sourceVersion:'2.1.281',sourceOs:process.platform,project:'/synthetic/efficiency',hash:digest(bytes),byteLength:bytes.length,qualifiedAt:timestamp,capability:'unverified'},device.deviceCredential,'POST');
      assert.equal(result.statusCode,200,result.body);return result.json().snapshotId;
    }
    const ids:string[]=[];for(const cost of [0,10,20,1000,null])ids.push(await upload(cost));
    const query='period=since-enrollment';
    assert.equal((await api('/api/session-efficiency?'+query,undefined,device.deviceCredential)).statusCode,401);
    const response=await api('/api/session-efficiency?'+query);assert.equal(response.statusCode,200,response.body);
    const report=response.json();
    assert.equal(report.total,5);assert.equal(report.tokenP75,265);
    assert.equal(report.reviewCount,0,'unavailable verification is not a known zero even when tokens exceed P75');
    assert.ok(report.sessions.every((row:any)=>row.efficiency.value===null&&row.efficiency.numerator===null&&row.rework===null&&row.reviewReasons.length===0));
    const zero=report.sessions.find((row:any)=>row.snapshotId===ids[0]),unknown=report.sessions.find((row:any)=>row.snapshotId===ids[4]);
    assert.equal(zero.efficiency.denominator,0);assert.equal(zero.codeOutput.value,null);
    assert.equal(unknown.efficiency.denominator,null);assert.equal(unknown.codeOutput.value,null);
    assert.ok(report.sessions.every((row:any)=>row.taskType==='unknown'));
    const frozen='/api/session-efficiency?'+query+'&version='+report.version;
    assert.deepEqual((await api('/api/session-efficiency/export?'+query+'&version='+report.version)).json(),report);
    await upload(30);assert.equal((await api('/api/session-efficiency?'+query)).json().total,6);
    for(let n=1;n<=15;n++)await upload(40+n);
    const firstPage=(await api('/api/session-efficiency?'+query+'&sort=tokens&direction=asc')).json();
    assert.equal(firstPage.total,21);assert.equal(firstPage.sessions.length,20);assert.equal(firstPage.nextOffset,20);
    const secondPage=(await api('/api/session-efficiency?'+query+'&version='+firstPage.version+'&offset=20&sort=tokens&direction=asc')).json();
    assert.equal(secondPage.sessions.length,1);assert.equal(secondPage.sessions[0].tokens,null,'unknown costs remain at the end across pages');
    assert.equal((await api('/api/session-efficiency/export?'+query+'&version='+firstPage.version)).json().sessions.length,21);
    assert.deepEqual((await api(frozen)).json(),report);
    await app.close();app=await createApp({db,rawDirectory:sandbox.env.RAW_DIRECTORY!,reportClock:()=>now});
    assert.deepEqual((await api(frozen)).json(),report);
    assert.equal((await api('/api/session-efficiency?period=this-week&version='+report.version)).statusCode,409);
  }finally{await app?.close();await db.end();await sandbox.close();}
});

test('session timing clips cross-week intervals and preserves an unrecognized source gap instead of inventing complete activity', {timeout:120000},async()=>{
  const sandbox=await createSandbox(),db=connect(sandbox.env.DATABASE_URL!);let app:Awaited<ReturnType<typeof createApp>>|undefined;
  try{
    const person=await sandbox.provision('边界合成员工');
    const day=new Date(Date.now()+8*3600000),daysUntilMonday=(8-day.getUTCDay())%7||7;
    const monday=Date.UTC(day.getUTCFullYear(),day.getUTCMonth(),day.getUTCDate()+daysUntilMonday)-8*3600000;
    const stamp=(seconds:number)=>new Date(monday+seconds*1000).toISOString();
    app=await createApp({db,rawDirectory:sandbox.env.RAW_DIRECTORY!,reportClock:()=>new Date(monday+3600000)});
    const api=(url:string,payload?:unknown,credential=person.readerCredential,method:'GET'|'POST'|'PUT'='GET')=>app!.inject({url,method,headers:{Authorization:`Bearer ${credential}`,...(Buffer.isBuffer(payload)?{'Content-Type':'application/octet-stream'}:{})},...(payload===undefined?{}:{payload:payload as object})});
    const device=(await api('/api/devices/enroll',{installationId:randomUUID(),name:'跨日设备'},person.enrollmentCredential,'POST')).json(),id=randomUUID();
    const rows=[{type:'session_meta',timestamp:stamp(-62),payload:{id}},
      {type:'response_item',timestamp:stamp(-61),payload:{type:'message',role:'user',content:[{type:'input_text',text:'开始跨日检查'}]}},
      {type:'event_msg',timestamp:stamp(-60),payload:{type:'task_started',turn_id:'one'}},
      {type:'response_item',timestamp:stamp(0),payload:{type:'message',role:'assistant',content:[{type:'output_text',text:'检查完毕'}]}},
      {type:'event_msg',timestamp:stamp(60),payload:{type:'task_complete',turn_id:'one'}},
      {type:'response_item',timestamp:stamp(180),payload:{type:'message',role:'user',content:[{type:'input_text',text:'核对结果'}]}}];
    async function upload(items:unknown[]){const bytes=Buffer.from(items.map(row=>JSON.stringify(row)).join('\n')+'\n');await api('/api/chunks/'+digest(bytes),bytes,device.deviceCredential,'PUT');
      const result=await api('/api/snapshots',{protocolVersion:1,sourceSessionId:id,source:'codex-cli',sourceVersion:'0.160.0',sourceOs:process.platform,project:'/synthetic/cross-week',hash:digest(bytes),byteLength:bytes.length,qualifiedAt:stamp(-62),capability:'unverified'},device.deviceCredential,'POST');assert.equal(result.statusCode,200,result.body);return result.json().snapshotId;}
    await upload(rows);const first=(await api('/api/session-efficiency?period=this-week')).json(),timing=first.sessions[0].timing;
    assert.equal(timing.knownAgentMs,60000);assert.equal(timing.knownReplyMs,120000);assert.equal(timing.activeMs,180000);
    assert.equal(timing.segments.find((s:any)=>s.kind==='agent').startedAt,stamp(0));
    await upload([...rows,{type:'future_business_event',timestamp:stamp(181),payload:{kind:'unknown'}}]);
    const second=(await api('/api/session-efficiency?period=this-week')).json(),changed=second.sessions[0].timing;
    assert.equal(changed.knownAgentMs,60000);assert.equal(changed.activeMs,null);
    assert.ok(changed.segments.some((s:any)=>s.kind==='gap'&&s.durationMs===null));
    assert.deepEqual((await api('/api/session-efficiency/export?period=this-week&version='+first.version)).json(),first);
  }finally{await app?.close();await db.end();await sandbox.close();}
});

test('a long recorded conversation remains readable with fixed-version segment pagination', {timeout:120000},async()=>{
  const sandbox=await createSandbox(),db=connect(sandbox.env.DATABASE_URL!);let app:Awaited<ReturnType<typeof createApp>>|undefined;
  try{
    const person=await sandbox.provision('长会话合成员工'),base=Date.now()+60000,stamp=(n:number)=>new Date(base+n*1000).toISOString();
    app=await createApp({db,rawDirectory:sandbox.env.RAW_DIRECTORY!,reportClock:()=>new Date(base+2000000)});
    const api=(url:string,payload?:unknown,credential=person.readerCredential,method:'GET'|'POST'|'PUT'='GET')=>app!.inject({url,method,headers:{Authorization:`Bearer ${credential}`,...(Buffer.isBuffer(payload)?{'Content-Type':'application/octet-stream'}:{})},...(payload===undefined?{}:{payload:payload as object})});
    const device=(await api('/api/devices/enroll',{installationId:randomUUID(),name:'长会话设备'},person.enrollmentCredential,'POST')).json(),id=randomUUID(),rows:unknown[]=[{type:'session_meta',timestamp:stamp(0),payload:{id}}];
    for(let i=0;i<100;i++)rows.push({type:'response_item',timestamp:stamp(i*10),payload:{type:'message',role:'user',content:[{type:'input_text',text:'检查第'+i+'轮'}]}},
      {type:'event_msg',timestamp:stamp(i*10+1),payload:{type:'task_started',turn_id:'turn-'+i}},
      {type:'response_item',timestamp:stamp(i*10+2),payload:{type:'message',role:'assistant',content:[{type:'output_text',text:'完成第'+i+'轮'}]}},
      {type:'event_msg',timestamp:stamp(i*10+4),payload:{type:'task_complete',turn_id:'turn-'+i}});
    const bytes=Buffer.from(rows.map(row=>JSON.stringify(row)).join('\n')+'\n');await api('/api/chunks/'+digest(bytes),bytes,device.deviceCredential,'PUT');
    const upload=await api('/api/snapshots',{protocolVersion:1,sourceSessionId:id,source:'codex-cli',sourceVersion:'0.160.0',sourceOs:process.platform,project:'/synthetic/long-efficiency',hash:digest(bytes),byteLength:bytes.length,qualifiedAt:stamp(0),capability:'unverified'},device.deviceCredential,'POST');assert.equal(upload.statusCode,200,upload.body);
    const response=await api('/api/session-efficiency?period=since-enrollment');assert.equal(response.statusCode,200,response.body);const report=response.json(),row=report.sessions[0];
    assert.equal(row.timing.segmentTotal,199);assert.equal(row.timing.segments.length,5);assert.equal(row.timing.nextSegmentOffset,5);
    const segments=[...row.timing.segments];let offset=row.timing.nextSegmentOffset;
    while(offset!==null){const response=await api('/api/session-efficiency?period=since-enrollment&version='+report.version+'&sessionId='+row.sessionId+'&segmentOffset='+offset);assert.equal(response.statusCode,200,response.body);const detail=response.json();assert.equal(detail.sessions.length,1);segments.push(...detail.sessions[0].timing.segments);offset=detail.sessions[0].timing.nextSegmentOffset;}
    assert.equal(segments.length,199);assert.equal(new Set(segments.map((s:any)=>s.kind+'/'+s.startedAt)).size,199);
    const all=(await api('/api/session-efficiency/export?period=since-enrollment&version='+report.version)).json();assert.deepEqual(all.sessions[0].timing.segments,segments);
    assert.equal((await api('/api/session-efficiency?period=since-enrollment&sessionId='+row.sessionId+'&segmentOffset=5')).statusCode,400);
  }finally{await app?.close();await db.end();await sandbox.close();}
});

test('review selection uses scoped strict P75, evidenced claims and original nonfirst rework with task-type medians', {timeout:120000},async()=>{
  const sandbox=await createSandbox(),db=connect(sandbox.env.DATABASE_URL!);let app:Awaited<ReturnType<typeof createApp>>|undefined;
  try{
    const person=await sandbox.provision('复盘合成员工'),base=Date.now()+60000,stamp=(n:number)=>new Date(base+n*1000).toISOString();
    app=await createApp({db,rawDirectory:sandbox.env.RAW_DIRECTORY!,reportClock:()=>new Date(base+3600000)});
    const api=(url:string,payload?:unknown,credential=person.readerCredential,method:'GET'|'POST'|'PUT'='GET')=>app!.inject({url,method,headers:{Authorization:`Bearer ${credential}`,...(Buffer.isBuffer(payload)?{'Content-Type':'application/octet-stream'}:{})},...(payload===undefined?{}:{payload:payload as object})});
    const device=(await api('/api/devices/enroll',{installationId:randomUUID(),name:'复盘设备'},person.enrollmentCredential,'POST')).json();
    const configPath=join(sandbox.directory,'efficiency-analysis.json');
    await writeFile(configPath,JSON.stringify({mode:'fixture',executable:process.execPath,runtimeVersion:'2.1.281',model:'deterministic',workDirectory:join(sandbox.directory,'jobs'),fixtureOrigin:'http://127.0.0.1:12345',budgetId:'efficiency-synthetic',budgetCny:0,inputCnyPerMillion:0,outputCnyPerMillion:0,maxInputBytes:32768,maxSessionBytes:131072,maxRequests:4,maxAttempts:1,timeoutSeconds:60}));
    const config=await readAnalysisConfig(configPath),queue=analysisQueue(db,config,'efficiency-synthetic');
    await db.query('INSERT INTO analysis_workers(id,config) VALUES($1,$2)',['efficiency-synthetic',publicConfig(config)]);
    async function analyze(key:string,cost:number,verified:boolean,claims:boolean,rework:boolean,task:'implementation'|'fix',truncated=false){
      const id=randomUUID(),counter=(n:number,at:number)=>({type:'event_msg',timestamp:stamp(at),payload:{type:'token_count',info:{total_token_usage:{input_tokens:n,cached_input_tokens:0,output_tokens:0,reasoning_output_tokens:0,total_tokens:n}}}});
      const message=(role:string,text:string,n:number)=>({type:'response_item',timestamp:stamp(n),payload:{type:'message',role,content:[{type:role==='user'?'input_text':'output_text',text}]}});
      const rows=[{type:'session_meta',timestamp:stamp(-86400),payload:{id}},counter(0,-86400),message('user',key+'：检查接口',1),
        {type:'response_item',timestamp:stamp(2),payload:{type:'function_call',name:'exec_command',call_id:'tests',arguments:'{"cmd":"node --test"}'}},
        {type:'response_item',timestamp:stamp(3),payload:{type:'function_call_output',call_id:'tests',output:'# tests 1\n# pass 1\n# fail 0'}},
        message('assistant','已完成改动',4),message('user','请保留旧接口',5),message('assistant','已部署服务',6),message('user','请补充检查',7),message('assistant','记录检查过程',8),counter(cost,9)];
      const bytes=Buffer.from(rows.map(row=>JSON.stringify(row)).join('\n')+'\n');await api('/api/chunks/'+digest(bytes),bytes,device.deviceCredential,'PUT');
      const upload=await api('/api/snapshots',{protocolVersion:1,sourceSessionId:id,source:'codex-cli',sourceVersion:'0.157.1',sourceOs:process.platform,project:'/synthetic/efficiency-review',hash:digest(bytes),byteLength:bytes.length,qualifiedAt:stamp(0),capability:'unverified',...(truncated?{capture:{generation:digest('efficiency-truncate'),revision:2,change:'truncate',materials:[],lineage:[],gaps:[],compacted:false,partialLine:false}}:{})},device.deviceCredential,'POST');assert.equal(upload.statusCode,200,upload.body);
      const snapshotId=upload.json().snapshotId;
      const job=await api('/api/snapshots/'+snapshotId+'/analysis',{},person.readerCredential,'POST');assert.equal(job.statusCode,202,job.body);
      const claim=await queue.claim();assert.equal(claim?.id,job.json().id);
      const result=await executeAnalysis(config,claim!.input,new AbortController().signal,()=>queue.allowForward(claim!),async(_config,input,_signal,forward)=>{
        assert.equal(await forward!(),true);const cite=(event:number)=>({event,textOffset:0,quote:input.events[event]!.text});
        const users=input.events.map((event,index)=>({event,index})).filter(({event})=>event.role==='user'),assistants=input.events.map((event,index)=>({event,index})).filter(({event})=>event.role==='assistant');
        const tool=input.events.findIndex(event=>event.role==='tool result');
        return{usage:{inputTokens:10,outputTokens:10,runtimeCostUsd:null,providerBilledCny:null,requests:1},output:{items:[{category:'topic',assessment:'inferred',text:key,citations:[cite(0)]}],insights:{version:'session-insights-1',taskType:{value:task,citations:[cite(0)]},
          prompts:users.map(({index},position)=>({event:index,elements:{goal:true,constraints:true,context:false,acceptance:false},rework:position===0?true:rework,citations:[cite(index)]})),
          replies:assistants.map(({index})=>({event:index,clarification:false,citations:[cite(index)]})),
          outcomes:[...(verified?[{status:'verified',text:input.events[tool]!.text,citations:[cite(tool)]}]:[]),...(claims?assistants.slice(0,2).map(({event,index})=>({status:'claimed',text:event.text,citations:[cite(index)]})):[])],suggestions:[]}}};
      });assert.equal(await queue.finish(claim!,result),true);return snapshotId;
    }
    const a=await analyze('a',100,true,false,false,'implementation'),b=await analyze('b',200,false,true,false,'implementation'),c=await analyze('c',400,false,false,true,'fix'),d=await analyze('d',1000,false,false,false,'fix');
    const response=await api('/api/session-efficiency?period=since-enrollment');assert.equal(response.statusCode,200,response.body);const report=response.json();
    assert.equal(report.tokenP75,550);assert.equal(report.reviewCount,3);
    const byId=(id:string)=>report.sessions.find((row:any)=>row.snapshotId===id);
    assert.deepEqual(byId(a).efficiency,{numerator:1,denominator:100,value:10000});assert.deepEqual(byId(a).reviewReasons,[]);
    assert.deepEqual(byId(b).reviewReasons,['声称多于已验证']);assert.deepEqual(byId(c).reviewReasons,['返工 2 次']);assert.deepEqual(byId(d).reviewReasons,['Token 高于 P75 且没有已验证结果']);
    assert.equal(byId(d).rework,0,'a first prompt never enters rework count');
    assert.equal(report.distributions.find((row:any)=>row.taskType==='implementation').median,5000);
    assert.equal(report.distributions.find((row:any)=>row.taskType==='fix').median,0);
    assert.ok(byId(c).reworkEvidence.length>=2);assert.ok(byId(c).taskEvidence[0].webPath);
    const sorted=(await api('/api/session-efficiency?period=since-enrollment&version='+report.version+'&sort=tokens&direction=asc')).json();
    assert.deepEqual(sorted.sessions.map((row:any)=>row.tokens),[100,200,400,1000]);
    const only=(await api('/api/session-efficiency?period=since-enrollment&version='+report.version+'&reviewOnly=true')).json();assert.equal(only.filteredTotal,3);
    await analyze('equal threshold',1000,false,false,false,'fix');
    const newer=(await api('/api/session-efficiency?period=since-enrollment')).json();assert.equal(newer.tokenP75,1000);
    assert.ok(newer.sessions.filter((row:any)=>row.tokens===1000).every((row:any)=>row.reviewReasons.length===0),'equal P75 does not pass the strictly-higher rule');
    assert.deepEqual((await api('/api/session-efficiency/export?period=since-enrollment&version='+report.version)).json(),report);
    const truncated=await analyze('truncated prefix',100,true,false,false,'fix',true);
    const incomplete=(await api('/api/session-efficiency?period=since-enrollment')).json().sessions.find((row:any)=>row.snapshotId===truncated);
    assert.equal(incomplete.rework,null,'a model cannot establish the first prompt after a truncated native prefix');
  }finally{await app?.close();await db.end();await sandbox.close();}
});

for(const truncated of [false,true])test('session segments use native turn boundaries and fixed waits without filling tail idle or an unfinished turn'+(truncated?' after truncate and append':''), {timeout:120000},async()=>{
  const sandbox=await createSandbox(),db=connect(sandbox.env.DATABASE_URL!);let app:Awaited<ReturnType<typeof createApp>>|undefined;
  try{
    const person=await sandbox.provision('分段合成员工'),base=Date.now()+60000,stamp=(seconds:number)=>new Date(base+seconds*1000).toISOString();
    app=await createApp({db,rawDirectory:sandbox.env.RAW_DIRECTORY!,reportClock:()=>new Date(base+3600000)});
    const api=(url:string,payload?:unknown,credential=person.readerCredential,method:'GET'|'POST'|'PUT'='GET')=>app!.inject({url,method,headers:{Authorization:`Bearer ${credential}`,...(Buffer.isBuffer(payload)?{'Content-Type':'application/octet-stream'}:{})},...(payload===undefined?{}:{payload:payload as object})});
    const device=(await api('/api/devices/enroll',{installationId:randomUUID(),name:'分段设备'},person.enrollmentCredential,'POST')).json(),id=randomUUID();
    const message=(role:string,text:string,seconds:number)=>({type:'response_item',timestamp:stamp(seconds),payload:{type:'message',role,content:[{type:role==='user'?'input_text':'output_text',text}]}});
    const boundary=(type:string,turn:string,seconds:number)=>({type:'event_msg',timestamp:stamp(seconds),payload:{type,turn_id:turn}});
    const rows=[{type:'session_meta',timestamp:stamp(0),payload:{id}},message('user','开始检查',0),boundary('task_started','one',1),message('assistant','第一轮检查',10),boundary('task_complete','one',21),
      message('user','继续检查',81),boundary('task_started','two',82),message('assistant','第二轮检查',90),boundary('task_complete','two',102),
      message('user','核对最终结果',150),boundary('task_started','three',152),message('assistant','正在核对',160)];
    let previousId:string|undefined;
    async function upload(items:unknown[]){const bytes=Buffer.from(items.map(row=>JSON.stringify(row)).join('\n')+'\n');await api('/api/chunks/'+digest(bytes),bytes,device.deviceCredential,'PUT');
      const result=await api('/api/snapshots',{protocolVersion:1,sourceSessionId:id,source:'codex-cli',sourceVersion:'0.160.0',sourceOs:process.platform,project:'/synthetic/efficiency-timing',hash:digest(bytes),byteLength:bytes.length,qualifiedAt:stamp(0),capability:'unverified',...(truncated?{capture:{generation:digest('timing-truncated'),revision:previousId?3:2,change:previousId?'append':'truncate',...(previousId?{previousSnapshotId:previousId}:{}),materials:[],lineage:[],gaps:[],compacted:false,partialLine:false}}:{})},device.deviceCredential,'POST');assert.equal(result.statusCode,200,result.body);return previousId=result.json().snapshotId;}
    const original=await upload(rows),response=await api('/api/session-efficiency?period=since-enrollment');assert.equal(response.statusCode,200,response.body);
    const first=(await api('/api/session-efficiency/export?period=since-enrollment&version='+response.json().version)).json(),timing=first.sessions[0].timing;
    assert.equal(timing.knownAgentMs,40000);assert.equal(timing.knownReplyMs,108000);assert.equal(timing.activeMs,null);assert.equal(timing.permissionMs,null);
    assert.deepEqual(timing.waitFraction,{numerator:null,denominator:null,value:null});
    assert.deepEqual(timing.segments.filter((segment:any)=>segment.kind==='agent').map((segment:any)=>segment.durationMs),[20000,20000,null]);
    assert.deepEqual(timing.segments.filter((segment:any)=>segment.kind==='reply').map((segment:any)=>segment.durationMs),[60000,48000]);
    assert.ok(timing.segments.every((segment:any)=>segment.evidence.every((cite:any)=>cite.snapshotId===original)));
    assert.ok(first.sessions[0].webPath.includes('waitVersion='+timing.waitVersion));
    const waits=(await api('/api/waits?period=since-enrollment&version='+timing.waitVersion)).json();assert.equal(waits.summary.knownReplyWaitMs,108000);
    await upload([...rows,boundary('task_complete','three',172)]);
    const secondHead=(await api('/api/session-efficiency?period=since-enrollment')).json(),second=(await api('/api/session-efficiency/export?period=since-enrollment&version='+secondHead.version)).json(),newTiming=second.sessions[0].timing;
    assert.equal(newTiming.knownAgentMs,60000);assert.equal(newTiming.activeMs,truncated?null:168000);assert.equal(newTiming.knownReplyMs,108000);
    assert.deepEqual(newTiming.waitFraction,{numerator:null,denominator:truncated?null:168000,value:null},'missing native permissions never become zero waiting');
    if(truncated)assert.ok(newTiming.segments.some((segment:any)=>segment.kind==='gap'&&segment.durationMs===null&&/历史起点/.test(segment.reason)));
    assert.equal(newTiming.segments.filter((segment:any)=>segment.kind==='agent').length,3,'append snapshots do not duplicate native turns');
    assert.ok(newTiming.segments.every((segment:any)=>segment.endedAt===null||Date.parse(segment.endedAt)<=base+172000),'no interval extends to report time');
    assert.deepEqual((await api('/api/session-efficiency/export?period=since-enrollment&version='+first.version)).json(),first);
  }finally{await app?.close();await db.end();await sandbox.close();}
});
