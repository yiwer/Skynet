import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ownedCommand, OwnedCommandError } from './owned-command.js';

test('the worker rejects invalid Qoder PAT, runtime, request limits and monetary conversion before connecting or forwarding', {timeout:45000},async()=>{
  const directory=await mkdtemp(join(tmpdir(),'skynet-qoder-config-'));
  try{
    const credentialFile=join(directory,'dedicated-pat'),path=join(directory,'analysis.json'),pat='pt-SYNTHETIC_VALIDATION_ONLY';
    const base={mode:'qoder-cn',executable:process.execPath,runtimeVersion:'1.1.64',sdkVersion:'1.0.50',model:'synthetic-no-provider',workDirectory:join(directory,'jobs'),credentialFile,
      budgetId:'qoder-validation',budgetCny:0,inputCnyPerMillion:0,outputCnyPerMillion:0,requestBudget:2,maxRequests:2,autoAnalyzeUpdates:false};
    const cases:[object,string,RegExp][]=[
      [{requestBudget:0},pat,/requestBudget/],[{requestBudget:undefined},pat,/request budget/],[{requestBudget:1.5},pat,/requestBudget/],
      [{maxRequests:3},pat,/cannot reserve/],[{runtimeVersion:'2.1.281'},pat,/fixed CLI\/SDK/],[{sdkVersion:undefined},pat,/fixed CLI\/SDK/],
      [{fixtureOrigin:'http://127.0.0.1:1'},pat,/Qoder CN requires/],[{budgetCny:1},pat,/monetary conversion/],
      [{inputCnyPerMillion:1},pat,/monetary conversion/],[{outputCnyPerMillion:1},pat,/monetary conversion/],
      [{},'sk-SYNTHETIC_OTHER_PROVIDER',/Credential changed or invalid/],[{},'pt-',/Credential changed or invalid/],
      [{mode:'fixture',runtimeVersion:'2.1.281'},pat,/Qoder settings require/],
    ];
    for(const [override,credential,message] of cases){
      await writeFile(credentialFile,credential);await writeFile(path,JSON.stringify({...base,...override}));
      await assert.rejects(ownedCommand(process.execPath,['--import','tsx','apps/analysis/worker.ts'],
        {...process.env,DATABASE_URL:'postgresql://synthetic:synthetic@127.0.0.1:1/unused',SKYNET_ANALYSIS_CONFIG:path},'',{timeoutMs:5000,maxOutputBytes:64*1024}),error=>{
        assert.ok(error instanceof OwnedCommandError);assert.equal(error.code,1);assert.match(error.stderr,message);
        assert.doesNotMatch(error.stdout,/worker ready/);
        // A three-character public prefix is also present in the validation
        // source frame; secrecy applies to complete synthetic credentials.
        if(credential.length>3)assert.ok(!error.stderr.includes(credential));return true;
      });
    }
  }finally{await rm(directory,{recursive:true,force:true});}
});
