import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {mcpSandbox} from './mcp-support.js';
import {digest} from '../apps/server/database.js';
import {readAnalysisConfig,publicConfig} from '../apps/analysis/config.js';
import {analysisQueue} from '../apps/analysis/queue.js';
import {executeAnalysis} from '../apps/analysis/execute.js';

test('activity rework and clarification come only from applicable versioned analysis with exact original citations',{timeout:120000},async()=>{
  const base=new Date();base.setUTCDate(base.getUTCDate()+1);base.setUTCHours(2,0,0,0);const date=base.toISOString().slice(0,10),time=(n:number)=>new Date(+base+n*60000).toISOString();
  const sandbox=await mcpSandbox({reportClock:()=>new Date(+base+3600000)});
  try{
    const employee=await sandbox.provision('活动推断'),json=(body:object)=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),api=(path:string,init:RequestInit={})=>sandbox.api(path,employee.readerCredential,init);
    const device=await(await sandbox.api('/api/devices/enroll',employee.enrollmentCredential,json({installationId:randomUUID(),name:'推断原件'}))).json(),sessionId=randomUUID();
    const message=(role:string,text:string,n:number)=>({type:'response_item',timestamp:time(n),payload:{type:'message',id:randomUUID(),role,content:[{type:role==='user'?'input_text':'output_text',text}]}});
    const rows=[{type:'session_meta',timestamp:time(0),payload:{id:sessionId}},message('user','请保留原接口并修复缓存。',0),message('assistant','需要保留缓存键吗？',1),message('user','不对😀，旧缓存键也需要兼容。',2),message('assistant','我会兼容旧缓存键。',3)];
    async function upload(records:unknown[]){const bytes=Buffer.from(records.map(row=>JSON.stringify(row)).join('\n')+'\n');await sandbox.api('/api/chunks/'+digest(bytes),device.deviceCredential,{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:bytes});const response=await sandbox.api('/api/snapshots',device.deviceCredential,json({protocolVersion:1,sourceSessionId:sessionId,source:'codex-cli',sourceVersion:'0.160.0',sourceOs:process.platform,project:'/activity/inferences',hash:digest(bytes),byteLength:bytes.length,qualifiedAt:time(0),capability:'unverified'}));assert.equal(response.status,200);return(await response.json()).snapshotId as string;}
    const snapshotId=await upload(rows),before=await(await api('/api/activity?date='+date)).json();
    assert.equal(before.events.some((event:any)=>['rework','clarification'].includes(event.type)),false);
    const path=join(sandbox.directory,'analysis.json');await writeFile(path,JSON.stringify({mode:'fixture',executable:process.execPath,runtimeVersion:'2.1.281',model:'deterministic',workDirectory:join(sandbox.directory,'jobs'),fixtureOrigin:'http://127.0.0.1:12345',budgetId:'activity',budgetCny:0,inputCnyPerMillion:0,outputCnyPerMillion:0,maxInputBytes:8192,maxSessionBytes:131072,maxSegments:16,maxRequests:32,maxAttempts:1,timeoutSeconds:90}));
    const config=await readAnalysisConfig(path);await sandbox.testDatabase.query('INSERT INTO analysis_workers(id,config) VALUES($1,$2)',['activity-boundary',publicConfig(config)]);
    const job=await(await api(`/api/snapshots/${snapshotId}/analysis`,json({}))).json(),queue=analysisQueue(sandbox.testDatabase,config,'activity-boundary'),claim=await queue.claim();assert.equal(claim!.id,job.id);
    const result=await executeAnalysis(config,claim!.input,new AbortController().signal,()=>queue.allowForward(claim!),async(_config,input,_signal,forward)=>{
      assert.equal(await forward!(),true);const cite=(event:number)=>({event,textOffset:0,quote:input.events[event]!.text});
      return {usage:{inputTokens:100,outputTokens:20,runtimeCostUsd:null,providerBilledCny:null,requests:1},output:{items:[{category:'goal',assessment:'inferred',text:'兼容缓存',citations:[cite(0)]}],insights:{version:'session-insights-1',taskType:{value:'fix',citations:[cite(0)]},
        prompts:[{event:0,elements:{goal:true,constraints:true,context:false,acceptance:false},rework:true,citations:[cite(0)]},{event:2,elements:{goal:true,constraints:true,context:true,acceptance:false},rework:true,citations:[cite(2)]}],replies:[{event:1,clarification:true,citations:[cite(1)]},{event:3,clarification:false,citations:[cite(3)]}],outcomes:[],suggestions:[]}}};
    });assert.equal(await queue.finish(claim!,result),true);
    const response=await api('/api/activity?date='+date);assert.equal(response.status,200);const after=await response.json();
    assert.notEqual(after.version,before.version);assert.deepEqual(after.events.filter((event:any)=>['prompt','rework','reply','clarification'].includes(event.type)).map((event:any)=>event.type),['prompt','clarification','rework','reply']);
    const rework=after.events.find((event:any)=>event.type==='rework');assert.equal(rework.analysisVersion,job.id);assert.equal(rework.inference.quote,'不对😀，旧缓存键也需要兼容。');assert.equal(rework.inference.location.line,4);assert.equal(rework.basis,'inferred');
    assert.equal(after.lanes[0].points.find((point:any)=>point.type==='rework').id,rework.id);
    const filtered=await(await api('/api/activity?date='+date+'&type=rework')).json();assert.equal(filtered.total,1);assert.equal(filtered.events[0].id,rework.id);
    const newer=await upload([...rows,message('user','新增一条含“返工”字样的材料',4)]),latest=await(await api('/api/activity?date='+date)).json();
    assert.equal(latest.events.some((event:any)=>['rework','clarification'].includes(event.type)),false,'a prior analysis must not classify the new input');assert.equal(latest.analyses.find((view:any)=>view.snapshotId===newer).state,'unavailable');
    assert.deepEqual(await(await api(`/api/activity?date=${date}&version=${after.version}`)).json(),after);
  }finally{await sandbox.close();}
});
