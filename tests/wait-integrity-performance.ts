import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {execFileSync} from 'node:child_process';
import {restoreBundle,disposeOwned,appendLate} from './ac32-fixture.js';
import {mcpSandbox} from './mcp-support.js';

// The accepted public report seam, using the unchanged public-upload bundle.
// One first read diagnoses the 3s target; it does not establish a cold P95.
assert.ok(process.env.SKYNET_CAPACITY_SOURCE);
assert.ok(process.env.SKYNET_WAIT_INTEGRITY_EVIDENCE);
const {sandbox,owner,bundle}=await restoreBundle(process.env.SKYNET_CAPACITY_SOURCE);
const f=await mcpSandbox({sandbox,reportClock:()=>new Date(bundle.clock)}).catch(async error=>{await disposeOwned(sandbox,owner);throw error;});
const evidence:Record<string,unknown>={kind:'all-employee-waits-single-cold-not-AC32',revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
  dirty:!!execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(),bundleHash:bundle.bundleHash,dataset:bundle.dataset,
  startedAt:new Date().toISOString(),conditions:'Shared host; unchanged public source fixture, no report prewarming. No P95 or controlled speedup claim.'};
async function read(path:string,init?:RequestInit){const response=await f.api(path,bundle.people[0]!.readerCredential,init);assert.equal(response.status,200,await response.clone().text());return response.json();}
try{
  const started=performance.now(),first=await read('/api/waits?period=since-enrollment'),firstMs=performance.now()-started;
  evidence.firstMs=firstMs;evidence.version=first.version;
  assert.equal(first.total,19000);assert.equal(first.summary.replyWaitCount,19000);assert.equal(first.summary.replyWaitMs,684_000_000);
  assert.equal(first.summary.unknownReplyWaitCount,0);assert.equal(first.intervals.length,25);
  evidence.correctness='all original 19000 waits and duration preserved';
  assert.deepEqual(await read('/api/waits?period=since-enrollment&version='+first.version),first);
  assert.deepEqual(await read('/api/waits/recompute',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({period:'since-enrollment'})}),first);
  await appendLate(f.api,process.env.SKYNET_CAPACITY_SOURCE,bundle);
  const late=await read('/api/waits?period=since-enrollment');assert.equal(late.total,19001);assert.notEqual(late.version,first.version);
  assert.deepEqual(await read('/api/waits?period=since-enrollment&version='+first.version),first);
  evidence.correctness='current/full/fixed match; late input changes current and preserves fixed history';
  assert.ok(firstMs<=3000,`First all-employee waits read ${firstMs.toFixed(1)}ms exceeds the unchanged 3000ms target`);
  evidence.status='passed';
}catch(error){evidence.status='failed';evidence.error=String(error);throw error;}
finally{evidence.finishedAt=new Date().toISOString();await writeFile(process.env.SKYNET_WAIT_INTEGRITY_EVIDENCE,JSON.stringify(evidence,null,2));await disposeOwned(f,owner);}
