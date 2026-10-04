import test from 'node:test';
import assert from 'node:assert/strict';
import {assessmentFixture} from './assessment-fixture.js';

test('efficiency charts read fixed summaries and distribution points without downloading timing evidence', {timeout:120000}, async()=>{
  const f=await assessmentFixture();
  try{
    const owner=await f.owner('固定产效摘要');await f.session(owner,{prompts:3,tokens:1000});await f.session(owner,{prompts:4,tokens:2000});
    const scope='period=since-enrollment';const current=await f.api(owner,'/api/session-efficiency?'+scope);assert.equal(current.status,200,await current.clone().text());
    const page=await current.json(),fixed=scope+'&version='+page.version;
    const response=await f.api(owner,'/api/session-efficiency?'+fixed+'&section=summaries');assert.equal(response.status,200,await response.clone().text());
    const summary=await response.json();assert.equal(summary.total,2);assert.equal(summary.nextOffset,null);
    assert.deepEqual(summary.sessions.map((row:any)=>row.sessionId),page.sessions.map((row:any)=>row.sessionId));
    assert.ok(summary.sessions.every((row:any)=>row.timing.segments.length===0&&row.timing.segmentTotal>0&&row.timing.nextSegmentOffset===0));
    assert.equal((await f.api(owner,'/api/session-efficiency?'+scope+'&section=summaries&offset=0')).status,400);
    assert.equal((await f.api(owner,'/api/session-efficiency/recompute',{period:'since-enrollment',section:'summaries'})).status,400);
    const pointsResponse=await f.api(owner,'/api/session-efficiency?'+fixed+'&section=distributionPoints');assert.equal(pointsResponse.status,200,await pointsResponse.clone().text());
    const points=await pointsResponse.json();assert.equal(points.sessions.length,0);assert.equal(points.distributionPage.total,2);assert.equal(points.distributionPage.nextOffset,null);
    assert.deepEqual(points.distributions,page.distributions);
    const selected=summary.sessions[0];const detailResponse=await f.api(owner,'/api/session-efficiency?'+fixed+'&sessionId='+selected.sessionId);assert.equal(detailResponse.status,200);
    assert.equal((await detailResponse.json()).sessions[0].timing.segments.length,selected.timing.segmentTotal);
    const beyond=await f.api(owner,'/api/session-efficiency?'+fixed+'&sessionId='+selected.sessionId+'&segmentOffset=100001');
    assert.equal(beyond.status,200,await beyond.clone().text());const tail=await beyond.json();assert.equal(tail.version,page.version);
    assert.deepEqual(tail.sessions[0].timing.segments,[]);assert.equal(tail.sessions[0].timing.segmentTotal,selected.timing.segmentTotal);assert.equal(tail.sessions[0].timing.nextSegmentOffset,null);
    assert.equal((await f.api(owner,'/api/session-efficiency?'+scope+'&sessionId='+selected.sessionId+'&segmentOffset=100001')).status,400);
    assert.equal((await f.api(owner,'/api/session-efficiency?'+fixed+'&sessionId='+selected.sessionId+'&segmentOffset=9007199254740992')).status,400);
  }finally{await f.close();}
});
