import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {execFileSync} from 'node:child_process';
import {restoreBundle,disposeOwned} from './ac32-fixture.js';
import {mcpSandbox} from './mcp-support.js';

// Explicit diagnostic at the HTTP seam. Read a real Usage version first, then
// measure prompt-report construction from that frozen complete dependency.
// This is not a cold end-to-end AC32 sample; no result is seeded into storage.
assert.ok(process.env.SKYNET_CAPACITY_SOURCE,'SKYNET_CAPACITY_SOURCE is required');
assert.ok(process.env.SKYNET_PROMPT_MEMBERSHIP_EVIDENCE,'Evidence destination is required');
const {sandbox,owner,bundle}=await restoreBundle(process.env.SKYNET_CAPACITY_SOURCE);
const f=await mcpSandbox({sandbox,reportClock:()=>new Date(bundle.clock)}).catch(async error=>{await disposeOwned(sandbox,owner);throw error;});
const evidence:Record<string,unknown>={kind:'fixed-usage-prompt-construction-not-cold-AC32',revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
  dirty:!!execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(),bundleHash:bundle.bundleHash,dataset:bundle.dataset,
  startedAt:new Date().toISOString(),conditions:'Shared host; unchanged public source bundle; real HTTP Usage preparation measured separately; no cross-request byte cache or provider calls.'};
async function read(path:string,init?:RequestInit){const response=await f.api(path,bundle.people[0]!.readerCredential,init);assert.equal(response.status,200,await response.clone().text());return response.json();}
try{
  let started=performance.now();const usage=await read('/api/usage-output?period=since-enrollment');
  evidence.usagePreparationMs=performance.now()-started;evidence.usageVersion=usage.version;
  assert.equal(usage.totals.sessions,1000);assert.equal(usage.totals.userTurns,20000);
  started=performance.now();const report=await read('/api/prompt-report?period=since-enrollment&usageVersion='+usage.version),firstMs=performance.now()-started;
  evidence.firstFixedDependencyMs=firstMs;evidence.version=report.version;
  await writeFile(process.env.SKYNET_PROMPT_MEMBERSHIP_EVIDENCE+'.payload.json',JSON.stringify(report,null,2));
  assert.equal(report.usageVersion,usage.version);assert.equal(report.kpis.prompts,20000);assert.equal(report.kpis.sessions,1000);
  assert.deepEqual(report.kpis.context,{numerator:400,denominator:400,unknown:19600,value:1});
  assert.deepEqual(report.kpis.rework,{numerator:0,denominator:380,unknown:18620,value:0});
  assert.deepEqual(report.kpis.cleanSessions,{numerator:20,denominator:20,unknown:980,value:1});
  evidence.correctness='whole report totals and independently specified known/unknown inference denominators passed';
  assert.ok(firstMs<=3000,`Fixed-Usage prompt construction ${firstMs.toFixed(1)} ms exceeds the unchanged 3000 ms first-read target`);
  assert.deepEqual(await read('/api/prompt-report?period=since-enrollment&version='+report.version),report);
  assert.deepEqual(await read('/api/prompt-report?period=since-enrollment'),report);
  assert.deepEqual(await read('/api/prompt-report/recompute',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({period:'since-enrollment'})}),report);
  evidence.correctness='complete current/full/fixed report and all ordered citations agree';evidence.status='passed';
}catch(error){evidence.status='failed';evidence.error=String(error);throw error;}
finally{evidence.finishedAt=new Date().toISOString();await writeFile(process.env.SKYNET_PROMPT_MEMBERSHIP_EVIDENCE,JSON.stringify(evidence,null,2));await disposeOwned(f,owner);}
