import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createSandbox} from './support.js';
import {connect,digest} from '../apps/server/database.js';
import {manifestSchema} from '../packages/contracts/archive.js';
import {join} from 'node:path';
import {writeFile} from 'node:fs/promises';
import {readAnalysisConfig,publicConfig} from '../apps/analysis/config.js';
import {analysisQueue} from '../apps/analysis/queue.js';
import {executeAnalysis} from '../apps/analysis/execute.js';

test('public archive keeps corrupt bytes as gaps and distinguishes both native legal rewrites',{timeout:45000},async()=>{
  const s=await createSandbox();
  try{
    const employee=await s.provision('UTF8公开合成来源'),origin=await s.startServer();
    const api=(path:string,token=employee.readerCredential,body?:unknown)=>fetch(origin+path,{headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{method:'POST',body:JSON.stringify(body)}:{})});
    const device=await(await api('/api/devices/enroll',employee.enrollmentCredential,{installationId:randomUUID(),name:'strict synthetic source'})).json();
    const timestamp=new Date(Date.now()+1000).toISOString();
    for(const source of ['codex-cli','claude-code-cli']as const){
      const id=randomUUID();
      const rows=source==='codex-cli'?[
        {type:'session_meta',payload:{id}},
        {timestamp,type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'有效前句😀'}]}},
        {timestamp,type:'response_item',payload:{type:'function_call',name:'Read',arguments:'{"file_path":"损坏TOKEN"}',call_id:'same-native-call'}},
        {timestamp,type:'response_item',payload:{type:'function_call_output',call_id:'valid-stable-output',output:'合法�后句'}}]:[
        {timestamp,type:'user',sessionId:id,uuid:'before',version:'2.1.281',message:{role:'user',content:'有效前句😀'}},
        {timestamp,type:'assistant',sessionId:id,uuid:'same-native-uuid',version:'2.1.281',message:{role:'assistant',content:[{type:'tool_use',id:'tool-call',name:'Read',input:{file_path:'损坏TOKEN'}}]}},
        {timestamp,type:'user',sessionId:id,uuid:'after',version:'2.1.281',message:{role:'user',content:'合法�后句'}}];
      const text=rows.map(value=>JSON.stringify(value)).join('\n')+'\n';const [left,right]=text.split('TOKEN');assert.ok(left&&right);
      const corrupt=Buffer.concat([Buffer.from(left),Buffer.from([255]),Buffer.from(right)]),legal=Buffer.from(left+'�'+right);
      const upload=async(bytes:Buffer)=>{assert.equal((await fetch(origin+'/api/chunks/'+digest(bytes),{method:'PUT',headers:{Authorization:`Bearer ${device.deviceCredential}`,'Content-Type':'application/octet-stream'},body:new Uint8Array(bytes)})).status,201);
        const response=await api('/api/snapshots',device.deviceCredential,{protocolVersion:1,sourceSessionId:id,source,sourceVersion:source==='codex-cli'?'0.157.1':'2.1.281',sourceOs:'win32',project:'/synthetic/UTF8',hash:digest(bytes),byteLength:bytes.length,qualifiedAt:timestamp,capability:'unverified'});assert.equal(response.status,200);return(await response.json()).snapshotId;};
      const bad=await upload(corrupt),badDetail=await(await api('/api/snapshots/'+bad)).json();
      assert.equal(badDetail.unrecognizedLines,1,'rawFF is an explicit complete-line gap');assert.equal(badDetail.total,2);assert.deepEqual(badDetail.events.map((event:any)=>event.text),['有效前句😀','合法�后句']);
      assert.deepEqual(Buffer.from(await(await api('/api/snapshots/'+bad+'/raw')).arrayBuffer()),corrupt);
      const good=await upload(legal),goodDetail=await(await api('/api/snapshots/'+good)).json();assert.equal(goodDetail.unrecognizedLines,0);assert.equal(goodDetail.total,3);
      const inserted=goodDetail.events.find((event:any)=>event.role==='tool request');assert.equal(inserted.origin.snapshotId,good,'new legal record must never inherit the corrupt original anchor');
      assert.equal(goodDetail.events[0].origin.eventId,badDetail.events[0].origin.eventId,'valid unchanged prefix keeps its original identity');
      assert.equal(goodDetail.events[2].origin.eventId,badDetail.events[1].origin.eventId,'legal stable record keeps its identity across rewrite');
      assert.deepEqual(Buffer.from(await(await api('/api/snapshots/'+good+'/raw')).arrayBuffer()),legal);
    }
    const stats=await(await api('/api/activity-statistics')).json();assert.equal(stats.rows.reduce((n:number,row:any)=>n+row.activityRecords,0),6,'two sources each have three valid unique records');
  }finally{await s.close();}
});

test('legacy corrupt origins stay immutable while current counts and legal native anchors are fenced',{timeout:45000},async()=>{
  const s=await createSandbox(),db=connect(s.env.DATABASE_URL!);
  try{
    const employee=await s.provision('既存UTF8账本兼容'),origin=await s.startServer();let activeOrigin=origin;
    const api=(path:string,token=employee.readerCredential,body?:unknown)=>fetch(activeOrigin+path,{headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{method:'POST',body:JSON.stringify(body)}:{})});
    const device=await(await api('/api/devices/enroll',employee.enrollmentCredential,{installationId:randomUUID(),name:'old ledger fixture'})).json(),timestamp=new Date(Date.now()+1000).toISOString();
    const fixtures:any[]=[];
    for(const source of ['codex-cli','claude-code-cli']as const){const session=randomUUID(),line=source==='codex-cli'?3:2;
      const rows=source==='codex-cli'?[
        {type:'session_meta',payload:{id:session}},
        {timestamp,type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'旧合法前句😀'}]}},
        {timestamp,type:'response_item',payload:{type:'function_call',name:'Read',arguments:'{"file_path":"TOKEN"}',call_id:'legacy-collision'}},
        {timestamp,type:'response_item',payload:{type:'function_call_output',call_id:'legacy-valid-output',output:'旧合法�后句'}}]:[
        {timestamp,type:'user',sessionId:session,uuid:'legacy-before',version:'2.1.281',message:{role:'user',content:'旧合法前句😀'}},
        {timestamp,type:'assistant',sessionId:session,uuid:'legacy-collision',version:'2.1.281',message:{role:'assistant',content:[{type:'tool_use',id:'legacy-tool',name:'Read',input:{file_path:'TOKEN'}}]}},
        {timestamp,type:'user',sessionId:session,uuid:'legacy-after',version:'2.1.281',message:{role:'user',content:'旧合法�后句'}}];
      const [left,right]= (rows.map(row=>JSON.stringify(row)).join('\n')+'\n').split('TOKEN');assert.ok(left&&right);
      const bad=Buffer.concat([Buffer.from(left),Buffer.from([255]),Buffer.from(right)]),good=Buffer.from(left+'�'+right);
      const upload=async(bytes:Buffer)=>{assert.equal((await fetch(activeOrigin+'/api/chunks/'+digest(bytes),{method:'PUT',headers:{Authorization:`Bearer ${device.deviceCredential}`,'Content-Type':'application/octet-stream'},body:new Uint8Array(bytes)})).status,201);
        const response=await api('/api/snapshots',device.deviceCredential,{protocolVersion:1,sourceSessionId:session,source,sourceVersion:source==='codex-cli'?'0.157.1':'2.1.281',sourceOs:'win32',project:'/legacy/integrity',hash:digest(bytes),byteLength:bytes.length,qualifiedAt:timestamp,capability:'unverified'});assert.equal(response.status,200);return(await response.json()).snapshotId;};
      const badId=await upload(bad),detail=await(await api('/api/snapshots/'+badId)).json();
      // Necessary migration-format fixture: seed the exact old tolerant-native
      // occurrence protocol that normal strict uploads intentionally cannot make.
      const key=source==='codex-cli'?'call:function_call:legacy-collision':'uuid:legacy-collision';
      const occurrence=digest(JSON.stringify([key,digest(bad.toString('utf8').split('\n')[line-1]!),0]));
      const legacyId=digest(JSON.stringify([device.deviceId,source,session,occurrence]));
      const date=new Date(new Date(timestamp).getTime()+8*3600000).toISOString().slice(0,10);
      await db.query(`INSERT INTO archive_event_origins(event_id,snapshot_id,line,block,employee_id,device_id,project,source,source_session_id,role,timestamp,source_date,context)
        VALUES($1,$2,$3,0,$4,$5,'/legacy/integrity',$6,$7,'tool request',$8,$9,'after-enrollment')`,[legacyId,badId,line,employee.employeeId,device.deviceId,source,session,timestamp,date]);
      await db.query('INSERT INTO snapshot_events(snapshot_id,line,block,event_id) VALUES($1,$2,0,$3)',[badId,line,legacyId]);
      await db.query('INSERT INTO native_event_occurrences(device_id,source,source_session_id,occurrence_hash,event_id) VALUES($1,$2,$3,$4,$5)',[device.deviceId,source,session,occurrence,legacyId]);
      const base=(await db.query('SELECT * FROM archive_event_origins WHERE event_id=$1',[legacyId])).rows[0];fixtures.push({source,bad,good,badId,legacyId,base,detail,upload});
    }
    await s.stopServer();activeOrigin=await s.startServer();
    const current=await(await api('/api/activity-statistics')).json();assert.equal(current.rows.reduce((sum:number,row:any)=>sum+row.activityRecords,0),4,'corrupt persisted originals cannot count after restart');
    for(const fixture of fixtures){
      assert.equal((await fetch(activeOrigin+'/api/chunks/'+digest(fixture.good),{method:'PUT',headers:{Authorization:`Bearer ${device.deviceCredential}`,'Content-Type':'application/octet-stream'},body:new Uint8Array(fixture.good)})).status,201);
      const previous=(await db.query('SELECT * FROM snapshots WHERE id=$1',[fixture.badId])).rows[0],manifest=manifestSchema.parse({...previous.manifest,hash:digest(fixture.good),byteLength:fixture.good.length});fixture.legalId=randomUUID();
      // Seed the confirmed pre-upgrade protocol: the already legal carrier maps
      // its stable record to the corrupt original. This immutable old mapping
      // cannot be produced by the newly corrected public writer.
      await db.query(`INSERT INTO snapshots(id,device_id,source_session_id,hash,manifest_hash,manifest,provenance) VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [fixture.legalId,device.deviceId,manifest.sourceSessionId,manifest.hash,digest(JSON.stringify(manifest)),manifest,{version:1,relation:'same-device-continuation',sourceSnapshotId:fixture.badId,warning:'legacy exact-byte collision fixture'}]);
      await db.query('INSERT INTO snapshot_events(snapshot_id,line,block,event_id) SELECT $1,line,block,event_id FROM snapshot_events WHERE snapshot_id=$2',[fixture.legalId,fixture.badId]);
      fixture.mapping=(await db.query('SELECT line,block,event_id FROM snapshot_events WHERE snapshot_id=$1 ORDER BY line,block',[fixture.legalId])).rows;
    }
    await s.stopServer();activeOrigin=await s.startServer();
    for(const fixture of fixtures){const repaired=await(await api('/api/snapshots/'+fixture.legalId)).json(),tool=repaired.events.find((event:any)=>event.role==='tool request');
      assert.ok(tool.origin,'already stored legal collision needs a trusted current anchor');assert.notEqual(tool.origin.eventId,fixture.legacyId);assert.equal(tool.origin.snapshotId,fixture.legalId);
      assert.deepEqual((await db.query('SELECT line,block,event_id FROM snapshot_events WHERE snapshot_id=$1 ORDER BY line,block',[fixture.legalId])).rows,fixture.mapping,'original carrier mapping stays immutable');}
    for(const fixture of fixtures){const goodId=await fixture.upload(fixture.good),detail=await(await api('/api/snapshots/'+goodId)).json(),tool=detail.events.find((event:any)=>event.role==='tool request');
      assert.notEqual(tool.origin.eventId,fixture.legacyId,'legal rewrite receives an independent exact-byte identity');assert.equal(tool.origin.snapshotId,goodId);
      assert.equal(detail.events[0].origin.eventId,fixture.detail.events[0].origin.eventId,'unchanged valid legacy prefix reuses the same event');
      assert.equal(detail.events[2].origin.eventId,fixture.detail.events[1].origin.eventId,'valid stable native legacy suffix reuses the same event');
      // Immutable stored origin is a necessary migration contract; activity and
      // new source anchors above are asserted at the public interface.
      assert.deepEqual((await db.query('SELECT * FROM archive_event_origins WHERE event_id=$1',[fixture.legacyId])).rows[0],fixture.base);
      assert.deepEqual(Buffer.from(await(await api('/api/snapshots/'+fixture.badId+'/raw')).arrayBuffer()),fixture.bad);
    }
    const final=await(await api('/api/activity-statistics')).json();assert.equal(final.rows.reduce((sum:number,row:any)=>sum+row.activityRecords,0),6);assert.equal(final.warnings.invalidIntegrityOrigins,2);
    const date=new Date(new Date(timestamp).getTime()+8*3600000).toISOString().slice(0,10),stats=await(await api(`/api/work-statistics/${employee.employeeId}?date=${date}`)).json();
    assert.equal(stats.records,6);assert.equal(stats.sourceInputsComplete,false,'retained corrupt original gaps cannot be declared complete');assert.equal(stats.files.complete,false);
    const configPath=join(s.directory,'integrity-analysis.json');await writeFile(configPath,JSON.stringify({mode:'fixture',executable:process.execPath,runtimeVersion:'2.1.281',model:'synthetic',workDirectory:join(s.directory,'jobs'),fixtureOrigin:'http://127.0.0.1:12345',budgetId:'integrity-only',budgetCny:0,inputCnyPerMillion:0,outputCnyPerMillion:0,autoAnalyzeUpdates:false}));
    const config=await readAnalysisConfig(configPath);await db.query('INSERT INTO analysis_workers(id,config) VALUES($1,$2)',['integrity-test',publicConfig(config)]);
    const queue=analysisQueue(db,config,'integrity-test');
    for(const fixture of fixtures){const requested=await api(`/api/snapshots/${fixture.legalId}/analysis`,undefined,{});assert.equal(requested.status,202);const requestedRun=await requested.json(),claimed=await queue.claim();assert.equal(claimed!.id,requestedRun.id);
      const result=await executeAnalysis(config,claimed!.input,new AbortController().signal,()=>queue.allowForward(claimed!),async(_config,input,_signal,forward)=>{
        assert.equal(await forward!(),true);const index=input.events.findIndex(event=>event.role==='tool request');assert.ok(index>=0);assert.equal(input.events[index]!.origin!.snapshotId,fixture.legalId);assert.notEqual(input.events[index]!.origin!.eventId,fixture.legacyId);
        return {output:{items:[{category:'activity',assessment:'inferred',text:'仅合成原件精确引用',citations:[{event:index,textOffset:0,quote:input.events[index]!.text}]}]},usage:{inputTokens:1,outputTokens:1,runtimeCostUsd:null,providerBilledCny:null,requests:1}};});
      assert.equal(await queue.finish(claimed!,result),true);const published=await(await api(`/api/analysis/${claimed!.id}`)).json();assert.equal(published.applicable,true);assert.equal(published.result.items[0].citations[0].origin.snapshotId,fixture.legalId);
      // Necessary pre-proof job fixture: its frozen successful result is retained,
      // while the old input revision cannot be applicable after migration.
      await db.query(`UPDATE analysis_jobs SET input=jsonb_set(input,'{attributionRevision}','"0"') WHERE id=$1`,[claimed!.id]);
      await db.query('UPDATE analysis_targets SET attribution_revision=0 WHERE id=$1',[(await db.query('SELECT target_id FROM analysis_jobs WHERE id=$1',[claimed!.id])).rows[0].target_id]);
      const historical=await(await api(`/api/analysis/${claimed!.id}`)).json();assert.equal(historical.applicable,false);assert.deepEqual(historical.result,published.result);
      const replacement=await(await api(`/api/snapshots/${fixture.legalId}/analysis`,undefined,{})).json();assert.notEqual(replacement.id,claimed!.id);assert.ok(replacement.generation>published.generation);
      const pending=await queue.claim();assert.equal(pending!.id,replacement.id);await queue.finish(pending!,null,'synthetic no additional model execution');
    }
    for(const fixture of fixtures){const previous=(await db.query('SELECT * FROM snapshots WHERE id=$1',[fixture.legalId])).rows[0],id=randomUUID();
      const manifest=manifestSchema.parse({...previous.manifest,restoredFrom:{snapshotId:fixture.badId,hash:digest(fixture.bad),byteLength:fixture.bad.length}});
      // Necessary legacy-negative fixture: exact legal bytes with a copied claim
      // and the old bad mapping are not independent normal-source qualification.
      await db.query(`INSERT INTO snapshots(id,device_id,source_session_id,hash,manifest_hash,manifest,provenance) VALUES($1,$2,$3,$4,$5,$6,$7)`,[id,device.deviceId,manifest.sourceSessionId,manifest.hash,digest(JSON.stringify(manifest)),manifest,{version:1,relation:'unconfirmed',sourceSnapshotId:null,warning:'synthetic unverified legacy claim'}]);
      await db.query('INSERT INTO snapshot_events(snapshot_id,line,block,event_id) SELECT $1,line,block,event_id FROM snapshot_events WHERE snapshot_id=$2',[id,fixture.badId]);
      const detail=await(await api(`/api/snapshots/${id}`)).json(),tool=detail.events.find((event:any)=>event.role==='tool request');assert.equal(tool.origin,undefined);assert.equal(tool.context,'unknown-enrollment','an unsupported copied carrier must not fall back to its uploader enrollment');
      const rejected=await api(`/api/snapshots/${id}/analysis`,undefined,{});assert.equal(rejected.status,422);assert.deepEqual((await(await api(`/api/snapshots/${id}/analysis`)).json()).runs,[]);
    }
    await s.stopServer();activeOrigin=await s.startServer();assert.equal((await(await api('/api/activity-statistics')).json()).rows.reduce((sum:number,row:any)=>sum+row.activityRecords,0),6,'restart is idempotent');
  }finally{await db.end();await s.close();}
});
