import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createSandbox} from './support.js';
import {digest} from '../apps/server/database.js';

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
