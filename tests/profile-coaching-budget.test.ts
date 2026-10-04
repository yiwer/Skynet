import test from 'node:test';
import assert from 'node:assert/strict';
import {assessmentFixture} from './assessment-fixture.js';

test('escaped original sentences retain readable profile evidence within the HTTP and MCP page budgets',{timeout:120000},async()=>{
  const f=await assessmentFixture();try{
    const owner=await f.owner('长原句'),record=f.rows({prompts:4});
    for(const row of record.rows as any[])if(row.payload?.role==='user')row.payload.content[0].text+=' 引号 " \\ 换行\n'.repeat(60);
    const raw=await f.upload(owner,record.rows,record.sessionId);await f.analyze(owner,raw.snapshotId);
    const path='/api/capability-profiles/'+owner.employeeId,response=await f.api(owner,path);assert.equal(response.status,200,await response.clone().text());const page=await response.json();
    assert.ok(Buffer.byteLength(JSON.stringify(page))<=32*1024);assert.ok(Buffer.byteLength(JSON.stringify({content:[{type:'text',text:JSON.stringify(page)}]}))<=48*1024);
    assert.ok(page.coaching.representatives.best.citation.quote.includes('引号'));assert.match(page.coaching.representatives.best.citation.webPath,/line=/);
    const full=await(await f.api(owner,path+'/export?version='+page.version)).json();assert.deepEqual(page.coaching,full.coaching);assert.deepEqual(page.assessment,full.assessment);
  }finally{await f.close();}
});
