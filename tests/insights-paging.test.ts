import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {insightPagingFixture,pageRows} from './insights-paging-fixture.js';

test('a verified 20-turn session exposes every insight and fact through bounded immutable HTTP pages', {timeout:120000},async()=>{
  const f=await insightPagingFixture();
  try{
    assert.equal((await f.nativeApi(f.path)).status,401);
    async function read(query=''){
      const response=await f.api(f.owner,f.path+query),text=await response.text();assert.equal(response.status,200,text);
      assert.ok(Buffer.byteLength(text)<=32*1024,'bounded JSON page');
      assert.ok(Buffer.byteLength(JSON.stringify({content:[{type:'text',text}]}))<=48*1024,'bounded MCP text envelope');
      return JSON.parse(text);
    }
    const first=await read();assert.equal(first.state,'complete');assert.equal(first.analysisVersion.id,f.analysisId);
    assert.deepEqual(first.metrics,{verified:1,claimed:1,rework:0,clarifications:0});assert.equal(first.facts.tests.value,60);
    assert.equal(first.pages.prompts.total,20);assert.equal(first.pages.replies.total,20);assert.equal(first.pages.outcomes.total,2);assert.equal(first.pages.testsContributions.total,20);
    assert.ok(first.pages.prompts.nextOffset!==null,'the initial response explicitly exposes incomplete arrays');
    const collected:Record<string,any[]>={};
    for(const [section,position] of Object.entries(first.pages) as [string,any][]){
      let page=first;collected[section]=[...pageRows(page,section)];
      while(page.pages[section].nextOffset!==null){
        const offset=page.pages[section].nextOffset;page=await read('?'+new URLSearchParams({version:first.version,section,offset:String(offset)}));
        assert.equal(page.version,first.version);assert.equal(page.pages[section].offset,offset);assert.ok(pageRows(page,section).length>0,'a continuation must make progress');
        assert.deepEqual(page.metrics,first.metrics);assert.equal(page.facts.tests.value,60);collected[section]!.push(...pageRows(page,section));
      }
      assert.equal(collected[section]!.length,position.total,section);
    }
    assert.ok(Buffer.byteLength(JSON.stringify(collected))>80*1024-3000,'the complete valid data still exceeds the former single-response limit');
    assert.deepEqual(collected.prompts!.map(row=>row.citations[0].quote),Array.from({length:20},(_,i)=>`请求 ${i} elements=3：核查合成接口`));
    assert.equal(collected.replies!.length,20);assert.equal(collected.outcomes!.length,2);assert.equal(collected.testsEvidence!.length,24);
    assert.equal(new Set(collected.testsContributions!.map(row=>row.eventId)).size,20);assert.equal(collected.testsContributions!.reduce((sum,row)=>sum+row.value,0),60);
    for(const prompt of collected.prompts!){const cite=prompt.citations[0];assert.equal(cite.inputSnapshotId,f.record.snapshotId);assert.equal(cite.inputLocation.kind,'event');assert.ok(cite.origin.eventId);}
    assert.deepEqual(await read('?version='+first.version),first);assert.deepEqual(await read('?analysisId='+f.analysisId),first);
    for(const query of ['?offset=1','?section=prompts','?section=prompts&offset=0','?section=prompts&offset=1','?version='+first.version+'&offset=1','?version='+first.version+'&section=prompts&offset=21','?version='+first.version+'&section=invalid'])assert.equal((await f.api(f.owner,f.path+query)).status,400,query);
    assert.equal((await f.api(f.owner,f.path+'?version='+first.version+'&analysisId='+randomUUID())).status,409);
    const last=collected.prompts!.at(-1)!;
    const corrected=await f.api(f.owner,`/api/snapshots/${f.record.snapshotId}/inference-corrections`,{requestId:randomUUID(),expectedVersion:first.version,kind:'rework',promptEvent:last.event,value:true,reason:'核对最后一轮'});
    assert.equal(corrected.status,201,await corrected.clone().text());const current=await read();assert.notEqual(current.version,first.version);assert.equal(current.metrics.rework,1);
    const oldTail=await read('?'+new URLSearchParams({version:first.version,section:'prompts',offset:'19'}));assert.deepEqual(oldTail.inferences.prompts,[last]);
    const promptReport=await(await f.api(f.owner,'/api/prompt-report?period=since-enrollment')).json();assert.equal(promptReport.kpis.prompts,20);assert.deepEqual(promptReport.kpis.rework,{numerator:1,denominator:19,unknown:0,value:1/19});
    const usage=await(await f.api(f.owner,'/api/usage-output/export?period=since-enrollment')).json();assert.equal(usage.totals.userTurns,20);assert.equal(usage.outputs.tests.known,60);
    const newer=await f.upload(f.owner,[...f.record.rows,{timestamp:new Date(f.base.getTime()+900000).toISOString(),type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'迟到的第21轮'}]}}],f.record.sessionId);
    assert.notEqual(newer.snapshotId,f.record.snapshotId);await f.restart();assert.deepEqual(await read('?version='+first.version),first);
    assert.deepEqual((await read('?'+new URLSearchParams({version:first.version,section:'prompts',offset:'19'}))).inferences.prompts,[last]);
    assert.deepEqual(Buffer.from(await(await f.api(f.owner,`/api/snapshots/${f.record.snapshotId}/raw`)).arrayBuffer()),f.record.bytes);
  }finally{await f.close();}
});
