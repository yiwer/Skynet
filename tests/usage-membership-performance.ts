import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {execFileSync} from 'node:child_process';
import {restoreBundle,disposeOwned} from './ac32-fixture.js';
import {mcpSandbox} from './mcp-support.js';

// Explicit HTTP diagnostic, outside ordinary test discovery. The original
// source bundle contains no reporting projections. Keep AC32's 3s/1s limits;
// one shared-host pair cannot establish P95, even if both eventually pass.
assert.ok(process.env.SKYNET_CAPACITY_SOURCE,'SKYNET_CAPACITY_SOURCE is required');
assert.ok(process.env.SKYNET_USAGE_MEMBERSHIP_EVIDENCE,'Evidence destination is required');
const {sandbox,owner,bundle}=await restoreBundle(process.env.SKYNET_CAPACITY_SOURCE);
const f=await mcpSandbox({sandbox,reportClock:()=>new Date(bundle.clock)}).catch(async error=>{await disposeOwned(sandbox,owner);throw error;});
const evidence:Record<string,unknown>={kind:'public-usage-construction-not-P95',revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
  dirty:!!execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(),bundleHash:bundle.bundleHash,dataset:bundle.dataset,
  startedAt:new Date().toISOString(),conditions:'Shared host; unchanged public source bundle; complete public read, full recomputation and fixed history. No provider calls.'};
async function read(path:string,init?:RequestInit){const response=await f.api(path,bundle.people[0]!.readerCredential,init);assert.equal(response.status,200,await response.clone().text());return response.json();}
try{
  let started=performance.now();const first=await read('/api/usage-output?period=since-enrollment'),firstMs=performance.now()-started;
  started=performance.now();const second=await read('/api/usage-output?period=since-enrollment'),warmMs=performance.now()-started;
  evidence.firstMs=firstMs;evidence.warmMs=warmMs;evidence.version=first.version;
  assert.deepEqual(second,first);assert.equal(first.totals.sessions,1000);assert.equal(first.totals.userTurns,20000);
  const complete=await read('/api/usage-output/export?period=since-enrollment&version='+first.version);
  assert.equal(complete.sessions.length,1000);assert.equal(complete.outputs.tests.known,60000);
  assert.equal(complete.outputs.tests.passed,60000);assert.equal(complete.outputs.tests.failed,0);
  assert.deepEqual(await read('/api/usage-output/recompute',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({period:'since-enrollment'})}),first);
  assert.deepEqual(await read('/api/usage-output/export?period=since-enrollment'),complete);
  assert.deepEqual(await read('/api/usage-output/export?period=since-enrollment&version='+first.version),complete);
  await writeFile(process.env.SKYNET_USAGE_MEMBERSHIP_EVIDENCE+'.payload.json',JSON.stringify(complete,null,2));
  evidence.correctness='complete current/full/fixed results, ordered insight references and known totals agree';
  evidence.latencyGate={coldLimitMs:3000,warmLimitMs:1000,coldPassed:firstMs<=3000,warmPassed:warmMs<=1000};
  assert.ok(firstMs<=3000&&warmMs<=1000,`Usage first ${firstMs.toFixed(1)} ms / warm ${warmMs.toFixed(1)} ms exceed unchanged 3000 / 1000 ms limits`);
  evidence.status='single-pair-passed-not-P95';
}catch(error){evidence.status='failed';evidence.error=String(error);throw error;}
finally{evidence.finishedAt=new Date().toISOString();await writeFile(process.env.SKYNET_USAGE_MEMBERSHIP_EVIDENCE,JSON.stringify(evidence,null,2));await disposeOwned(f,owner);}
