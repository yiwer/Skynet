import test from 'node:test';
import assert from 'node:assert/strict';
import {ownedCommand,OwnedCommandError} from './owned-command.js';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('the acceptance command exposes every live entry and twenty independent cold and warm observations before starting a load', async()=>{
  const result=await ownedCommand(process.execPath,['--import','tsx','tests/ac32-performance.ts','plan'],process.env,'',{timeoutMs:5000});
  const plan=JSON.parse(result.stdout);
  assert.deepEqual(plan.entries,['metrics','usage','efficiency','prompts','wait-report','waits','team','weekly','people','assessment','profile','activity']);
  assert.deepEqual(plan.dataset,{employees:10,weeks:4,sessions:1000,turnsPerSession:20,businessEvents:80000,waits:19000,analyzedSessions:20});
  assert.deepEqual(plan.minimumSamples,{cold:20,warm:20});
  assert.deepEqual(plan.thresholdMs,{coldP95:3000,warmP95:1000});
  assert.equal(plan.coldBoundary,'fresh-node-fresh-postgres-restored-source-state');
});

test('the command refuses a cold P95 claim from one fast observation and lists the unmeasured live entries',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'skynet-ac32-summary-'));
  try{
    const file=join(directory,'observations.json');
    await writeFile(file,JSON.stringify({kind:'ac32-observations-1',diagnostic:false,sourceRevision:'a'.repeat(40),sourceBundleHash:'b'.repeat(64),
      dataset:{employees:10,weeks:4,sessions:1000,turnsPerSession:20,businessEvents:80000,waits:19000,analyzedSessions:20},
      observations:[{entry:'metrics',environmentId:'one',coldMs:1,warmMs:1,correctness:'passed'}]}));
    await assert.rejects(ownedCommand(process.execPath,['--import','tsx','tests/ac32-performance.ts','summarize',file],process.env,'',{timeoutMs:5000}),error=>{
      assert.ok(error instanceof OwnedCommandError);const report=JSON.parse(error.stdout);
      assert.equal(report.status,'incomplete');assert.equal(report.entries.metrics.cold.samples,1);
      assert.equal(report.entries.metrics.cold.p95Ms,null);assert.ok(report.missingEntries.includes('profile'));return true;
    });
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('distribution reports use nearest rank at the unchanged boundaries, reject reused environments, and never promote a diagnostic to acceptance',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'skynet-ac32-distribution-'));
  try{
    // Synthetic timing records test the reporting protocol only. They are not measured AC32 evidence.
    const entries=['metrics','usage','efficiency','prompts','wait-report','waits','team','weekly','people','assessment','profile','activity'];
    const data={kind:'ac32-observations-1',diagnostic:false,sourceRevision:'a'.repeat(40),sourceBundleHash:'b'.repeat(64),
      dataset:{employees:10,weeks:4,sessions:1000,turnsPerSession:20,businessEvents:80000,waits:19000,analyzedSessions:20},
      observations:entries.flatMap(entry=>Array.from({length:20},(_,i)=>({entry,environmentId:entry+'/'+i,coldMs:i===19?9000:3000,warmMs:i===19?5000:1000,correctness:'passed',checks:i===0})))};
    const path=join(directory,'distribution.json');
    const run=async()=>{await writeFile(path,JSON.stringify(data));try{return JSON.parse((await ownedCommand(process.execPath,['--import','tsx','tests/ac32-performance.ts','summarize',path],process.env,'',{timeoutMs:5000})).stdout);}
      catch(error){assert.ok(error instanceof OwnedCommandError);return JSON.parse(error.stdout);}};
    let result=await run();assert.equal(result.status,'passed');assert.equal(result.entries.metrics.cold.p95Ms,3000);assert.equal(result.entries.metrics.warm.p95Ms,1000);
    data.observations[18]!.coldMs=3000.1;assert.equal((await run()).status,'failed');data.observations[18]!.coldMs=3000;
    data.observations[18]!.environmentId=data.observations[0]!.environmentId;result=await run();assert.equal(result.status,'incomplete');assert.equal(result.independent,false);
    data.observations[18]!.environmentId='metrics/18';data.observations[0]!.checks=false;assert.equal((await run()).status,'incomplete','live latency alone cannot claim the fixed/full/late/history checks');
    data.observations[0]!.checks=true;data.diagnostic=true;assert.equal((await run()).status,'diagnostic-not-acceptance');
  }finally{await rm(directory,{recursive:true,force:true});}
});
