import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,resolve,basename} from 'node:path';
import {restoreBundle,seedBundle,disposeOwned} from './ac32-fixture.js';
import {mcpSandbox} from './mcp-support.js';

test('a thousand-session efficiency report preserves complete timing behind bounded public pages', {timeout:600000}, async()=>{
  const directory=process.env.SKYNET_CAPACITY_SOURCE??await mkdtemp(join(tmpdir(),'skynet-eff-capacity-'));
  const source=process.env.SKYNET_CAPACITY_SOURCE??join(directory,'source');
  if(!process.env.SKYNET_CAPACITY_SOURCE)await seedBundle(source,'efficiency-capacity',false,true);
  const {sandbox,owner,bundle}=await restoreBundle(source);
  const f=await mcpSandbox({sandbox,reportClock:()=>new Date(bundle.clock)}).catch(async error=>{await disposeOwned(sandbox,owner);throw error;});
  try{
    assert.deepEqual([bundle.dataset.sessions,bundle.dataset.businessEvents,bundle.dataset.waits],[1000,80000,19000]);
    const response=await f.api('/api/session-efficiency?period=since-enrollment',bundle.people[0]!.readerCredential);
    const bytes=await response.text();assert.equal(response.status,200,bytes);
    const page=JSON.parse(bytes);assert.equal(page.total,1000);assert.equal(page.tokenP75,2500);
    assert.ok(page.sessions.length>0&&page.sessions.length<=20);assert.ok(Buffer.byteLength(bytes)<=80*1024);
    assert.ok(page.sessions.every((row:any)=>row.userTurns===20&&row.tokens===2500&&row.timing.segmentTotal===39));
    assert.ok(page.sessions.every((row:any)=>row.timing.segments.length<=5&&row.timing.nextSegmentOffset===row.timing.segments.length));
  }finally{await disposeOwned(f,owner);if(!process.env.SKYNET_CAPACITY_SOURCE){assert.equal(dirname(resolve(directory)),resolve(tmpdir()));assert.match(basename(directory),/^skynet-eff-capacity-/);await rm(directory,{recursive:true,force:true});}}
});
