import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { assessmentFixture } from './assessment-fixture.js';
import { readAnalysisConfig, publicConfig } from '../apps/analysis/config.js';
import { analysisQueue } from '../apps/analysis/queue.js';
import { setTimeout } from 'node:timers/promises';
import { chromium, expect } from '@playwright/test';

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

test('Qoder operations keep lost leases reserved and render reported Credits separately from request limits', {timeout:120000},async()=>{
  const f=await assessmentFixture();let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
  try{
    const owner=await f.owner('Qoder synthetic operations'),credentialFile=join(f.directory,'operations-pat'),configFile=join(f.directory,'operations-config.json');
    await writeFile(credentialFile,'pt-SYNTHETIC_OPERATIONS_ONLY');
    await writeFile(configFile,JSON.stringify({mode:'qoder-cn',executable:process.execPath,runtimeVersion:'1.1.64',sdkVersion:'1.0.50',model:'synthetic-no-provider',
      workDirectory:join(f.directory,'qoder-jobs'),credentialFile,budgetId:'qoder-operations',budgetCny:0,inputCnyPerMillion:0,outputCnyPerMillion:0,
      requestBudget:6,maxRequests:2,maxAttempts:2,leaseSeconds:5,autoAnalyzeUpdates:false}));
    const config=await readAnalysisConfig(configFile);await f.testDatabase.query('DELETE FROM analysis_workers');
    const heartbeat=()=>f.testDatabase.query('INSERT INTO analysis_workers(id,config) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET updated_at=now()',['qoder-operations',publicConfig(config)]);await heartbeat();
    const queue=analysisQueue(f.testDatabase,config,'qoder-operations');
    async function request(){const source=f.rows({prompts:1}),record=await f.upload(owner,source.rows,source.sessionId);const response=await f.api(owner,`/api/snapshots/${record.snapshotId}/analysis`,{});assert.equal(response.status,202);return response.json();}
    const known=await request(),first=await queue.claim();assert.equal(first?.id,known.id);assert.equal(await queue.allowForward(first!),true);
    assert.equal(await queue.finish(first!,{items:[],fixture:false,usage:{inputTokens:100,outputTokens:20,runtimeCostUsd:null,providerBilledCny:null,providerCredits:2.25,requests:1}}),true);
    const unknown=await request(),lost=await queue.claim();assert.equal(lost?.id,unknown.id);await setTimeout(5300);await f.restart();await heartbeat();
    const history=await(await f.api(owner,'/api/analysis/'+unknown.id)).json();assert.equal(history.attemptHistory[0].state,'lost');assert.equal(history.attemptHistory[0].reservedRequests,2);
    assert.equal(await queue.allowForward(lost!),false);assert.equal((await f.api(owner,'/api/analysis/'+unknown.id+'/retry',{})).status,200);
    const again=await queue.claim();assert.equal(again?.attempts,2);assert.equal(await queue.allowForward(again!),true);
    assert.equal(await queue.finish(again!,{items:[],fixture:false,usage:{inputTokens:null,outputTokens:null,runtimeCostUsd:null,providerBilledCny:null,providerCredits:null,requests:1}}),true);
    const ops=await(await f.api(owner,'/api/analysis/operations')).json();assert.equal(ops.budgets[0].reservedRequests,'6');
    assert.equal(ops.runs.find((row:any)=>row.id===known.id).attemptHistory[0].usage.providerCredits,2.25);
    assert.equal(ops.runs.find((row:any)=>row.id===unknown.id).attemptHistory[1].usage.providerCredits,null);
    browser=await chromium.launch();const page=await browser.newPage({ignoreHTTPSErrors:true});await page.goto(f.origin+'/#analysis');
    await page.getByLabel('个人读取凭据').fill(owner.readerCredential);await page.getByRole('button',{name:'进入存档',exact:true}).click();
    const panel=page.getByRole('region',{name:'分析队列与资源',exact:true});await expect(panel).toContainText('Credits 2.25');await expect(panel).toContainText('Credits 未知');
    await panel.getByText('运行配置',{exact:true}).click();await expect(panel).toContainText('请求额度 6');await expect(panel).toContainText('已预留 6 次请求');await expect(panel).not.toContainText('¥');
    const output=process.env.SKYNET_QODER_EVIDENCE_DIR;if(output)await mkdir(output,{recursive:true});
    for(const width of [320,1280])for(const colorScheme of ['light','dark'] as const){await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme});
      await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight)).toBe(true);
      if(output)await page.screenshot({path:join(output,`operations-${width}-${colorScheme}.png`),animations:'disabled'});
    }
  }finally{await browser?.close();await f.close();}
});
