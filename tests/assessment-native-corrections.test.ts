import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {assessmentFixture} from './assessment-fixture.js';

test('assessment counts corrected native messages and native clarifications once across text blocks',{timeout:180000},async()=>{
  const f=await assessmentFixture();try{
    const owner=await f.owner('原生消息评估');let selected='';
    for(let session=0;session<3;session++){
      const rows=[0,1,2,3].flatMap(turn=>['user','assistant'].map((role,index)=>({type:role,uuid:randomUUID(),timestamp:new Date(f.base.getTime()+turn*1000+index*100).toISOString(),
        message:{role,content:[{type:'text',text:role==='user'?'请求甲 elements=3':'追问甲'},{type:'text',text:role==='user'?'请求乙 elements=3':'追问乙'}]}})));
      const record=await f.upload(owner,rows,randomUUID(),{source:'claude-code-cli',sourceVersion:'2.1.281'});await f.analyze(owner,record.snapshotId,{clarification:true});selected||=record.snapshotId;
    }
    const path='/api/snapshots/'+selected,assessmentPath='/api/assessments/'+owner.employeeId;
    const before=await(await f.api(owner,assessmentPath)).json();let view=await(await f.api(owner,path+'/insights')).json();
    const rework=await f.api(owner,path+'/inference-corrections',{requestId:randomUUID(),expectedVersion:view.version,kind:'rework',promptEvent:view.inferences.prompts[3].event,value:true,reason:'第二原生消息纠正错误'});assert.equal(rework.status,201);
    view=await(await f.api(owner,path+'/insights')).json();
    const elements=await f.api(owner,path+'/inference-corrections',{requestId:randomUUID(),expectedVersion:view.version,kind:'prompt-elements',promptEvent:view.inferences.prompts[1].event,value:{goal:false,constraints:false,context:false,acceptance:false},reason:'首条原生消息要素均不成立'});assert.equal(elements.status,201);
    const current=await(await f.api(owner,assessmentPath)).json(),report=await(await f.api(owner,'/api/prompt-report?period=since-enrollment')).json();
    const metric=(value:any,key:string)=>(Object.values(value.dims) as any[]).flatMap(dim=>dim.metrics).find(m=>m.key===key);
    assert.equal(current.sample.prompts,12);assert.deepEqual(report.kpis.rework,{numerator:1,denominator:9,unknown:0,value:1/9});
    assert.equal(metric(current,'rework').value,1/9);assert.equal(metric(current,'rework').samples,9);
    assert.equal(metric(current,'elem').value,.5);assert.equal(metric(current,'elem').samples,3);
    assert.equal(report.kpis.clarification.value,1);assert.equal(metric(current,'clarify').value,1);assert.equal(metric(current,'clarify').samples,12);
    assert.notEqual(current.version,before.version);assert.deepEqual(await(await f.api(owner,assessmentPath+'?version='+before.version)).json(),before);
    assert.deepEqual(await(await f.api(owner,assessmentPath+'/recompute',{})).json(),current);
  }finally{await f.close();}
});
