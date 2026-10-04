import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {assessmentFixture} from './assessment-fixture.js';

test('complete efficiency downloads declare their fixed identity and byte integrity across late input and restart', {timeout:120000}, async()=>{
  const f=await assessmentFixture();
  try{
    const owner=await f.owner('固定产效下载');await f.session(owner,{prompts:13,tokens:2000});
    const query='period=since-enrollment',head=await(await f.api(owner,'/api/session-efficiency?'+query)).json();
    const url='/api/session-efficiency/export?'+query+'&version='+head.version;
    const response=await f.api(owner,url);assert.equal(response.status,200,await response.clone().text());
    assert.equal(response.headers.get('etag'),'"'+head.version+'"');
    const bytes=Buffer.from(await response.arrayBuffer()),value=JSON.parse(bytes.toString('utf8'));
    assert.equal(response.headers.get('x-skynet-content-sha256'),createHash('sha256').update(bytes).digest('hex'));
    assert.equal(Number(response.headers.get('content-length')),bytes.length);
    assert.match(response.headers.get('content-disposition')??'',new RegExp(head.version));
    assert.equal(value.total,1);assert.equal(value.sessions[0].timing.segments.length,25);
    const parts:any[]=[];let offset:number|null=0;
    while(offset!==null){const page=await(await f.api(owner,'/api/session-efficiency?'+query+'&version='+head.version+'&sessionId='+value.sessions[0].sessionId+'&segmentOffset='+offset)).json();parts.push(...page.sessions[0].timing.segments);offset=page.sessions[0].timing.nextSegmentOffset;}
    assert.deepEqual(parts,value.sessions[0].timing.segments);
    await f.session(owner,{prompts:3,tokens:1000});assert.notEqual((await(await f.api(owner,'/api/session-efficiency?'+query)).json()).version,head.version);
    await f.restart();const old=await f.api(owner,url);assert.equal(old.status,200);assert.deepEqual(Buffer.from(await old.arrayBuffer()),bytes);
    assert.equal((await f.api(owner,url+'&source=claude-code-cli')).status,409);
  }finally{await f.close();}
});
