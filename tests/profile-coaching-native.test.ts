import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {assessmentFixture} from './assessment-fixture.js';

test('coaching counts native text-block messages once and preserves fixed values after manual inference corrections',{timeout:180000},async()=>{
  const f=await assessmentFixture();
  try{
    const owner=await f.owner('原生辅导');let selected='';
    for(let session=0;session<3;session++){
      const rows=[0,1,2,3].flatMap(turn=>['user','assistant'].map((role,index)=>({type:role,uuid:randomUUID(),timestamp:new Date(f.base.getTime()+turn*1000+index*100).toISOString(),message:{role,content:[{type:'text',text:role==='user'?'请求甲 elements=3':'追问甲'},{type:'text',text:role==='user'?'请求乙 elements=3':'追问乙'}]}})));
      const record=await f.upload(owner,rows,randomUUID(),{source:'claude-code-cli',sourceVersion:'2.1.281'});await f.analyze(owner,record.snapshotId,{clarification:true});selected||=record.snapshotId;
    }
    const path='/api/capability-profiles/'+owner.employeeId,before=await(await f.api(owner,path)).json(),snapshot='/api/snapshots/'+selected;let view=await(await f.api(owner,snapshot+'/insights')).json();
    assert.equal((await f.api(owner,snapshot+'/inference-corrections',{requestId:randomUUID(),expectedVersion:view.version,kind:'rework',promptEvent:view.inferences.prompts[3].event,value:true,reason:'第二条原生消息返工'})).status,201);
    view=await(await f.api(owner,snapshot+'/insights')).json();assert.equal((await f.api(owner,snapshot+'/inference-corrections',{requestId:randomUUID(),expectedVersion:view.version,kind:'prompt-elements',promptEvent:view.inferences.prompts[1].event,value:{goal:false,constraints:false,context:false,acceptance:false},reason:'首条要素不成立'})).status,201);
    const response=await f.api(owner,path);assert.equal(response.status,200,await response.clone().text());const profile=await response.json(),communication=profile.coaching.communication;
    assert.equal(communication.firstPrompts.person.count,3);assert.deepEqual(communication.firstPrompts.person.elements.goal,{numerator:2,denominator:3,unknown:0,value:2/3});assert.equal(communication.firstPrompts.person.elements.acceptance.value,0);
    assert.deepEqual(communication.rework,{numerator:1,denominator:9,unknown:0,value:1/9});assert.deepEqual(communication.cleanSessions,{numerator:2,denominator:3,unknown:0,value:2/3});assert.deepEqual(communication.clarification,{numerator:12,denominator:12,unknown:0,value:1});
    assert.equal(communication.medianLength.value,29);assert.equal(communication.medianLength.knownCount,12);assert.equal(communication.correctionIds.length,2);assert.equal(communication.correctionCount,2);
    assert.notEqual(profile.version,before.version);assert.deepEqual(await(await f.api(owner,path+'?version='+before.version)).json(),before);assert.deepEqual((await(await f.api(owner,path+'/recompute',{})).json()).coaching,profile.coaching);
  }finally{await f.close();}
});

test('restored collaboration retains the original employee first prompt and attributes only new messages to the continuing employee',{timeout:120000},async()=>{
  const f=await assessmentFixture();try{
    const originalOwner=await f.owner('首条原作者'),continuing=await f.owner('接续作者'),original=await f.session(originalOwner,{prompts:3,elements:4});
    const path='/api/capability-profiles/',before=await(await f.api(originalOwner,path+originalOwner.employeeId)).json();
    const time=(n:number)=>new Date(f.base.getTime()+10000+n).toISOString();
    const restored=await f.upload(continuing,[...original.rows,
      {type:'response_item',timestamp:time(0),payload:{type:'message',role:'user',content:[{type:'input_text',text:'返工 接续作者 elements=0'}]}},
      {type:'event_msg',timestamp:time(1),payload:{type:'task_started',turn_id:'continued'}},
      {type:'response_item',timestamp:time(2),payload:{type:'message',role:'assistant',content:[{type:'output_text',text:'已调整'}]}},
      {type:'event_msg',timestamp:time(3),payload:{type:'task_complete',turn_id:'continued'}}
    ],original.sessionId,{restoredFrom:{snapshotId:original.snapshotId,hash:createHash('sha256').update(original.bytes).digest('hex'),byteLength:original.bytes.length}});await f.analyze(continuing,restored.snapshotId);
    const a=await(await f.api(originalOwner,path+originalOwner.employeeId)).json(),b=await(await f.api(continuing,path+continuing.employeeId)).json();
    assert.equal(a.coaching.communication.firstPrompts.person.count,1);assert.equal(a.coaching.communication.firstPrompts.person.elements.acceptance.value,1);assert.equal(a.coaching.communication.rework.denominator,2);assert.equal(a.coaching.communication.rework.value,0);
    assert.equal(b.coaching.communication.firstPrompts.person.count,0);assert.equal(b.coaching.communication.firstPrompts.person.unknownFirst,0);assert.equal(b.coaching.communication.firstPrompts.person.elements.goal.value,null);assert.deepEqual(b.coaching.communication.rework,{numerator:1,denominator:1,unknown:0,value:1});
    assert.equal(b.coaching.communication.firstPrompts.team.count,1);assert.equal(b.coaching.communication.firstPrompts.team.elements.acceptance.value,1);assert.equal(b.coaching.communication.medianLength.knownCount,1);assert.equal(b.coaching.representatives.best,null);
    assert.deepEqual(await(await f.api(originalOwner,path+originalOwner.employeeId+'?version='+before.version)).json(),before);
  }finally{await f.close();}
});

test('truncated source history remains unknown after append in profile first prompts and length distribution',{timeout:120000},async()=>{
  const f=await assessmentFixture();
  try{
    const owner=await f.owner('前史缺失'),item=f.rows({prompts:3}),generation=createHash('sha256').update(randomUUID()).digest('hex');
    const capture={generation,revision:2,change:'truncate',materials:[],lineage:[],gaps:[],compacted:false,partialLine:false};
    const first=await f.upload(owner,item.rows,item.sessionId,{sourceVersion:'0.160.0',capture});
    const path='/api/capability-profiles/'+owner.employeeId,old=await(await f.api(owner,path)).json();assert.equal(old.coaching.communication.firstPrompts.person.count,0);assert.equal(old.coaching.communication.firstPrompts.person.unknownFirst,3);assert.equal(old.coaching.communication.medianLength.value,null);assert.equal(old.coaching.communication.medianLength.knownCount,3);assert.equal(old.coaching.communication.sourceInputsComplete,false);
    const rows=[...item.rows,{type:'response_item',timestamp:new Date(f.base.getTime()+5000).toISOString(),payload:{type:'message',role:'user',content:[{type:'input_text',text:'迟到追加的提示词'}]}}];
    await f.upload(owner,rows,item.sessionId,{sourceVersion:'0.160.0',capture:{...capture,revision:3,change:'append',previousSnapshotId:first.snapshotId}});
    const response=await f.api(owner,path);assert.equal(response.status,200,await response.clone().text());const profile=await response.json(),communication=profile.coaching.communication;
    assert.equal(communication.firstPrompts.person.count,0);assert.equal(communication.firstPrompts.person.unknownFirst,4);assert.equal(communication.firstPrompts.person.elements.goal.value,null);assert.equal(communication.rework.value,null);assert.equal(communication.rework.unknown,4);assert.equal(communication.cleanSessions.value,null);assert.equal(communication.medianLength.value,null);assert.equal(communication.medianLength.knownCount,4);
    assert.equal(profile.coaching.representatives.best,null);assert.equal(profile.coaching.representatives.rework,null);assert.deepEqual(await(await f.api(owner,path+'?version='+old.version)).json(),old);
  }finally{await f.close();}
});
