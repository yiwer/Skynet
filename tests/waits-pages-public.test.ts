import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {writeFile,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {assessmentFixture} from './assessment-fixture.js';

test('wait sections retain complete daily and unavailable counts while each fixed response stays bounded', {timeout:240000},async()=>{
  const f=await assessmentFixture(),restore:{path:string;bytes:Buffer}[]=[];
  try{
    const healthy=await f.owner('完整等待员工'),missing=await f.owner('原件缺失员工');
    const id=randomUUID(),rows:object[]=[{type:'session_meta',payload:{id}}];
    const time=(day:number,second:number)=>new Date(f.base.getTime()+day*86400000+second*1000).toISOString();
    for(let day=0;day<130;day++)rows.push(
      {type:'response_item',timestamp:time(day,0),payload:{type:'message',role:'user',content:[{type:'input_text',text:'开始 '+day}]}},
      {type:'event_msg',timestamp:time(day,0),payload:{type:'task_started',turn_id:id+'/'+day}},
      {type:'response_item',timestamp:time(day,1),payload:{type:'message',role:'assistant',content:[{type:'output_text',text:'完成 '+day}]}},
      {type:'event_msg',timestamp:time(day,2),payload:{type:'task_complete',turn_id:id+'/'+day}},
      {type:'response_item',timestamp:time(day,3),payload:{type:'message',role:'user',content:[{type:'input_text',text:'下一步 '+day}]}});
    f.now.setTime(f.base.getTime()+131*86400000);
    const good=await f.upload(healthy,rows,id);
    for(let index=0;index<40;index++){
      const source=f.rows({prompts:1,verified:0,claimed:0}),record=await f.upload(missing,source.rows,source.sessionId,{project:'/synthetic/'+String(index)+'/'+'项目'.repeat(470)});
      const path=join(f.directory,'raw',missing.deviceId,createHash('sha256').update(record.bytes).digest('hex'));restore.push({path,bytes:record.bytes});await unlink(path);
    }
    const query='period=since-enrollment';
    const get=async(extra='')=>{const response=await f.api(healthy,'/api/waits?'+query+extra),bytes=Buffer.from(await response.arrayBuffer());assert.equal(response.status,200,bytes.toString().slice(0,1000));assert.ok(bytes.length<=32*1024);return JSON.parse(bytes.toString());};
    const first=await get();assert.equal(first.total,130);assert.equal(first.summary.knownReplyWaitMs,130000);assert.equal(first.summary.replyWaitMs,null);
    assert.deepEqual(Object.fromEntries(Object.entries(first.pages).map(([key,value]:[string,any])=>[key,value.total])),{intervals:130,daily:130,unavailableSources:40,employees:2});
    const all:any={...first};
    for(const section of ['intervals','daily','unavailableSources','employees']){
      const values:any[]=[];let offset=0;
      do{
        const page=await get('&version='+first.version+'&section='+section+'&offset='+offset);
        assert.equal(page.version,first.version);assert.equal(page.pages[section].offset,offset);values.push(...page[section]);
        if(page.pages[section].nextOffset===null)break;
        assert.ok(page.pages[section].nextOffset>offset);offset=page.pages[section].nextOffset;
      }while(true);
      assert.equal(values.length,first.pages[section].total);all[section]=values;
    }
    assert.deepEqual(all.employees.map((value:any)=>value.employeeId).sort(),[healthy.employeeId,missing.employeeId].sort());
    assert.ok(all.daily.every((day:any)=>day.knownReplyWaitMs===1000&&day.unknownReplyWaitCount===0));
    assert.ok(all.unavailableSources.every((value:any)=>value.employeeId===missing.employeeId&&value.reason==='missing'&&value.evidence.webPath));
    const exported=await f.api(healthy,'/api/waits/export?'+query+'&version='+first.version);assert.equal(exported.status,200);
    const complete=await exported.json();for(const section of ['intervals','daily','unavailableSources'])assert.deepEqual(all[section],complete[section]);
    for(const suffix of ['&section=daily&offset=0','&section=employees&offset=0','&version='+first.version+'&section=daily&offset=131','&version='+first.version+'&section=daily&contextSnapshotId='+good.snapshotId+'&lines=1'])
      assert.equal((await f.api(healthy,'/api/waits?'+query+suffix)).status,400);
    assert.equal((await f.api(healthy,'/api/waits/recompute',{period:'since-enrollment',section:'daily'})).status,400);
    assert.equal((await f.api(healthy,'/api/waits/export?'+query+'&version='+first.version+'&section=daily')).status,400);
    for(const source of restore)await writeFile(source.path,source.bytes);
    const recovered=await get();assert.equal(recovered.pages.unavailableSources.total,0);assert.notEqual(recovered.version,first.version);
    assert.deepEqual(await get('&version='+first.version),first);
  }finally{for(const source of restore)await writeFile(source.path,source.bytes);await f.close();}
});
