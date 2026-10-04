import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { assessmentFixture } from './assessment-fixture.js';
import { readAnalysisConfig, publicConfig } from '../apps/analysis/config.js';
import { analysisQueue } from '../apps/analysis/queue.js';

test('Qoder request reservations survive failure and server restart and cap later attempts without exposing its PAT', {timeout:120000}, async()=>{
  const f=await assessmentFixture();
  try{
    const owner=await f.owner('Qoder synthetic reservation'),source=f.rows({prompts:1}),record=await f.upload(owner,source.rows,source.sessionId);
    const credential='pt-SYNTHETIC_LOCAL_ONLY',credentialFile=join(f.directory,'qoder-pat'),configFile=join(f.directory,'qoder.json');
    await writeFile(credentialFile,credential);
    await writeFile(configFile,JSON.stringify({mode:'qoder-cn',executable:process.execPath,runtimeVersion:'1.1.64',sdkVersion:'1.0.50',model:'synthetic-no-provider',
      workDirectory:join(f.directory,'qoder-jobs'),credentialFile,budgetId:'qoder-public-budget',budgetCny:0,inputCnyPerMillion:0,outputCnyPerMillion:0,
      requestBudget:2,maxRequests:2,maxAttempts:2,autoAnalyzeUpdates:false}));
    const config=await readAnalysisConfig(configFile);
    await f.testDatabase.query('DELETE FROM analysis_workers');
    const heartbeat=()=>f.testDatabase.query('INSERT INTO analysis_workers(id,config) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET config=EXCLUDED.config,updated_at=now()',['qoder-public',publicConfig(config)]);
    await heartbeat();
    const response=await f.api(owner,`/api/snapshots/${record.snapshotId}/analysis`,{});assert.equal(response.status,202,await response.clone().text());
    const initial=await response.json();assert.equal(initial.config.mode,'qoder-cn');assert.equal(initial.config.sdkVersion,'1.0.50');
    assert.equal(initial.config.requireFreeModel,true);assert.equal(initial.config.requestBudget,2);assert.equal(initial.config.reservationRequests,2);
    assert.ok(!JSON.stringify(initial).includes(credential));assert.ok(!JSON.stringify(initial).includes(credentialFile));
    const queue=analysisQueue(f.testDatabase,config,'qoder-public'),claim=await queue.claim();assert.equal(claim?.id,initial.id);
    assert.equal(await queue.allowForward(claim!),true);assert.equal(await queue.allowForward(claim!),true);assert.equal(await queue.allowForward(claim!),false);
    assert.equal(await queue.finish(claim!,null,'synthetic interrupted request; credits unavailable'),true);
    await f.restart();await heartbeat();
    let run=await(await f.api(owner,'/api/analysis/'+initial.id)).json();assert.equal(run.attemptHistory[0].reservedRequests,2);assert.equal(run.attemptHistory[0].requests,2);
    assert.equal(run.attemptHistory[0].usage,null);
    assert.equal((await f.api(owner,'/api/analysis/'+initial.id+'/retry',{})).status,200);
    assert.equal(await analysisQueue(f.testDatabase,config,'qoder-public').claim(),null);
    run=await(await f.api(owner,'/api/analysis/'+initial.id)).json();assert.equal(run.state,'failed');assert.equal(run.attempts,1);assert.match(run.error,/请求额度/);
    const ops=await(await f.api(owner,'/api/analysis/operations')).json(),budget=ops.budgets.find((row:any)=>row.id==='qoder-public-budget');
    assert.equal(budget.reservedRequests,'2');assert.equal(budget.reservedCny,'0');assert.equal(ops.providerBilledCny,null);
    assert.ok(!JSON.stringify(ops).includes(credential));assert.ok(!JSON.stringify(ops).includes(credentialFile));
  }finally{await f.close();}
});
