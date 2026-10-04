import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {execFileSync} from 'node:child_process';
import {restoreBundle,disposeOwned,appendLate} from './ac32-fixture.js';
import {mcpSandbox} from './mcp-support.js';

// Explicit public performance diagnostic, not the repeated-cold AC32 runner.
// Restore only the unchanged, publicly uploaded source/Analysis fixture; it
// contains no precomputed report results. Never assert private query shape.
assert.ok(process.env.SKYNET_CAPACITY_SOURCE,'SKYNET_CAPACITY_SOURCE is required');
assert.ok(process.env.SKYNET_WAIT_SELECTION_EVIDENCE,'Evidence destination is required');
const {sandbox,owner,bundle}=await restoreBundle(process.env.SKYNET_CAPACITY_SOURCE);
const f=await mcpSandbox({sandbox,reportClock:()=>new Date(bundle.clock)}).catch(async error=>{await disposeOwned(sandbox,owner);throw error;});
const evidence:Record<string,unknown>={kind:'wait-selection-single-cold-not-full-AC32',revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
  dirty:!!execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(),bundleHash:bundle.bundleHash,dataset:bundle.dataset,
  selectedEmployees:1,startedAt:new Date().toISOString(),conditions:'Shared host; unchanged 1000-session source fixture, no report prewarming. One first-read sample is not cold P95.'};
const query=new URLSearchParams({period:'since-enrollment',employeeId:bundle.people[0]!.employeeId});
async function read(path:string,init?:RequestInit){const response=await f.api(path,bundle.people[0]!.readerCredential,init);assert.equal(response.status,200,await response.clone().text());return response.json();}
try{
  const started=performance.now(),first=await read('/api/waits?'+query),firstMs=performance.now()-started;
  evidence.firstMs=firstMs;evidence.version=first.version;
  assert.equal(first.total,1900);assert.equal(first.summary.replyWaitCount,1900);assert.equal(first.summary.replyWaitMs,68_400_000);
  assert.equal(first.summary.unknownReplyWaitCount,0);assert.equal(first.intervals.length,25);
  evidence.correctness='selected first-read totals passed';
  assert.ok(firstMs<=3000,`Single-employee first read ${firstMs.toFixed(1)} ms exceeds unchanged 3000 ms first-read target`);
  assert.deepEqual(await read('/api/waits?'+query+'&version='+first.version),first);
  assert.deepEqual(await read('/api/waits/recompute',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(query))}),first);
  await appendLate(f.api,process.env.SKYNET_CAPACITY_SOURCE,bundle);
  const later=await read('/api/waits?'+query);assert.equal(later.total,1901);assert.notEqual(later.version,first.version);
  assert.deepEqual(await read('/api/waits?'+query+'&version='+first.version),first);
  evidence.correctness='selected current/full/fixed and late input preserve all totals and the immutable old version';evidence.status='passed';
}catch(error){evidence.status='failed';evidence.error=String(error);throw error;}
finally{evidence.finishedAt=new Date().toISOString();await writeFile(process.env.SKYNET_WAIT_SELECTION_EVIDENCE,JSON.stringify(evidence,null,2));await disposeOwned(f,owner);}
