import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,resolve,basename} from 'node:path';
import {restoreBundle,seedBundle,disposeOwned,appendLate} from './ac32-fixture.js';
import {mcpSandbox} from './mcp-support.js';

test('the complete fixed wait download retains all 19,000 intervals beyond the old transport ceiling', {timeout:600000}, async t=>{
  const directory=process.env.SKYNET_CAPACITY_SOURCE??await mkdtemp(join(tmpdir(),'skynet-waits-capacity-'));
  const source=process.env.SKYNET_CAPACITY_SOURCE??join(directory,'source');
  if(!process.env.SKYNET_CAPACITY_SOURCE)await seedBundle(source,'waits-download-functional',false,true);
  const {sandbox,owner,bundle}=await restoreBundle(source);
  const f=await mcpSandbox({sandbox,reportClock:()=>new Date(bundle.clock)}).catch(async error=>{await disposeOwned(sandbox,owner);throw error;});
  const api=(path:string,body?:object)=>f.api(path,bundle.people[0]!.readerCredential,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});
  const read=async(path:string,body?:object)=>{const response=await api(path,body),text=await response.text();assert.equal(response.status,200,path+': '+text.slice(0,1000));return JSON.parse(text);};
  try{
    assert.deepEqual([bundle.dataset.sessions,bundle.dataset.businessEvents,bundle.dataset.waits],[1000,80000,19000]);
    const query='period=since-enrollment',first=await read('/api/waits?'+query);
    assert.equal(first.total,19000);assert.equal(first.intervals.length,25);
    const response=await api('/api/waits/export?'+query+'&version='+first.version);
    assert.equal(response.status,200,await response.clone().text());
    const bytes=Buffer.from(await response.arrayBuffer()),complete=JSON.parse(bytes.toString('utf8'));
    assert.ok(bytes.length>16*1024*1024,'the unchanged full fixture exceeds the previous export ceiling');
    assert.equal(Number(response.headers.get('content-length')),bytes.length);
    assert.equal(response.headers.get('x-skynet-content-sha256'),createHash('sha256').update(bytes).digest('hex'));
    assert.equal(response.headers.get('etag'),'"'+first.version+'"');
    assert.match(response.headers.get('content-disposition')??'',new RegExp(first.version+'\\.json'));
    assert.equal(complete.version,first.version);assert.equal(complete.intervals.length,19000);
    assert.equal(new Set(complete.intervals.map((item:any)=>item.id)).size,19000);
    assert.deepEqual(complete.summary,first.summary);assert.equal(complete.summary.knownReplyWaitMs,684000000);
    assert.equal(complete.summary.permissionWaitMs,null);assert.equal(complete.summary.permissionWaitCount,null);
    assert.ok(complete.intervals.every((item:any)=>item.durationMs===36000&&item.start?.snapshotId&&item.start.webPath&&item.end.snapshotId&&item.end.conversationPath));
    assert.deepEqual(complete.intervals.slice(0,25),first.intervals);
    const tail=await read('/api/waits?'+query+'&version='+first.version+'&offset=18975');
    assert.deepEqual(complete.intervals.slice(-25),tail.intervals);assert.equal(tail.nextOffset,null);
    for(const extra of ['employeeId='+bundle.people[0]!.employeeId,'source=claude-code-cli','project=/different','week=2026-01-05'])
      assert.equal((await api('/api/waits/export?'+query+'&version='+first.version+'&'+extra)).status,400);
    await appendLate(f.api,source,bundle);
    const next=await read('/api/waits?'+query);assert.equal(next.total,19001);assert.notEqual(next.version,first.version);
    assert.deepEqual(await read('/api/waits/recompute',{period:'since-enrollment'}),next);
    await f.restart();
    assert.deepEqual(Buffer.from(await(await api('/api/waits/export?'+query+'&version='+first.version)).arrayBuffer()),bytes);
    t.diagnostic(JSON.stringify({kind:'waits-download-capacity-not-ac32',sourceBundleHash:bundle.bundleHash,intervals:19000,bytes:bytes.length,fixedVersion:first.version}));
  }finally{await disposeOwned(f,owner);if(!process.env.SKYNET_CAPACITY_SOURCE){assert.equal(dirname(resolve(directory)),resolve(tmpdir()));assert.match(basename(directory),/^skynet-waits-capacity-/);await rm(directory,{recursive:true,force:true});}}
});
