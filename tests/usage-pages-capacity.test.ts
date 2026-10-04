import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,resolve,basename} from 'node:path';
import {restoreBundle,seedBundle,disposeOwned} from './ac32-fixture.js';
import {mcpSandbox} from './mcp-support.js';

test('a 1,000-session usage report has a bounded first page and complete fixed sections', {timeout:600000}, async t=>{
  const directory=process.env.SKYNET_CAPACITY_SOURCE??await mkdtemp(join(tmpdir(),'skynet-usage-pages-'));
  const source=process.env.SKYNET_CAPACITY_SOURCE??join(directory,'source');
  if(!process.env.SKYNET_CAPACITY_SOURCE)await seedBundle(source,'usage-pages-functional',false,true);
  const {sandbox,owner,bundle}=await restoreBundle(source);
  const f=await mcpSandbox({sandbox,reportClock:()=>new Date(bundle.clock)}).catch(async error=>{await disposeOwned(sandbox,owner);throw error;});
  try{
    assert.deepEqual([bundle.dataset.sessions,bundle.dataset.businessEvents,bundle.dataset.waits],[1000,80000,19000]);
    const response=await f.api('/api/usage-output?period=since-enrollment',bundle.people[0]!.readerCredential);
    const text=await response.text();assert.equal(response.status,200,text);
    const head=JSON.parse(text);
    assert.deepEqual([head.totals.sessions,head.totals.userTurns,head.totals.toolCalls,head.totals.inputTokens,head.totals.outputTokens],[1000,20000,20000,2000000,500000]);
    assert.deepEqual([head.outputs.verified.known,head.outputs.verified.value,head.outputs.verified.unknownSessions],[20,null,980]);
    assert.equal(head.pages.sessions.total,1000);assert.equal(head.pages.employees.total,10);
    assert.ok(Buffer.byteLength(text)<=32*1024);
    t.diagnostic(JSON.stringify({kind:'capacity-functional-not-ac32',sourceBundleHash:bundle.bundleHash,dataset:bundle.dataset}));
  }finally{await disposeOwned(f,owner);if(!process.env.SKYNET_CAPACITY_SOURCE){assert.equal(dirname(resolve(directory)),resolve(tmpdir()));assert.match(basename(directory),/^skynet-usage-pages-/);await rm(directory,{recursive:true,force:true});}}
});
