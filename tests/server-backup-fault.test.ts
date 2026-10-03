import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdir,writeFile,readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { mcpSandbox } from './mcp-support.js';
import { backupHelper } from './backup-support.js';
import { createSandbox } from './support.js';
import { connect,digest } from '../apps/server/database.js';
import { createApp } from '../apps/server/app.js';
import { analysisQueue } from '../apps/analysis/queue.js';
import { readAnalysisConfig,publicConfig } from '../apps/analysis/config.js';
import {OwnedCommandError} from './owned-command.js';

test('operator reconciles only published verified backups and never reports stale running state',{timeout:360000},async()=>{
  const s=await mcpSandbox();
  try{
    const helper=await backupHelper(s.directory),backupDirectory=join(s.directory,'backups');await mkdir(backupDirectory);
    const result=JSON.parse(await helper.run({action:'reconcile',backupDirectory:'/backups'},s.containerDatabaseUrl,[{source:backupDirectory,target:'/backups',readonly:true}]));
    assert.equal(result.state,'reconciled');assert.equal(result.imported,0);
    const employee=await s.provision('灾备故障合成来源');
    const json=(body:unknown):RequestInit=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const api=(path:string,token=employee.readerCredential,init:RequestInit={})=>s.api(path,token,init);
    const enrolled=await(await api('/api/devices/enroll',employee.enrollmentCredential,json({installationId:randomUUID(),name:'backup-fault'}))).json();
    const bytes=Buffer.from(JSON.stringify({type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'灾备故障原始句'}]}})+'\n');
    assert.equal((await api(`/api/chunks/${digest(bytes)}`,enrolled.deviceCredential,{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:bytes})).status,201);
    const ack=await(await api('/api/snapshots',enrolled.deviceCredential,json({protocolVersion:1,sourceSessionId:randomUUID(),source:'codex-cli',sourceVersion:'synthetic-fault',sourceOs:'win32',project:'/synthetic/backup-fault',hash:digest(bytes),byteLength:bytes.length,qualifiedAt:new Date().toISOString(),capability:'unverified'}))).json();
    // Arithmetic only: no runtime, transport, provider or real credential is used.
    const key=join(s.directory,'synthetic-arithmetic-key'),configuration=join(s.directory,'queue-policy.json');await writeFile(key,'sk-ws-SYNTHETIC_BACKUP_ARITHMETIC_ONLY');
    await writeFile(configuration,JSON.stringify({mode:'qwen-payg',executable:process.execPath,runtimeVersion:'2.1.281',model:'synthetic-no-network',workDirectory:join(s.directory,'no-native'),credentialFile:key,budgetId:'backup-synthetic',budgetCny:1,inputCnyPerMillion:1,outputCnyPerMillion:1,pricingEvidence:'synthetic arithmetic, NOT pricing',pricingVerifiedAt:new Date().toISOString(),maxRequests:2,maxRequestBytes:32768,maxOutputTokens:512,maxAttempts:2,autoAnalyzeUpdates:false,leaseSeconds:30,timeoutSeconds:300}));
    const config=await readAnalysisConfig(configuration);await s.testDatabase.query('INSERT INTO analysis_workers(id,config) VALUES($1,$2)',['captured-worker',publicConfig(config)]);
    const request=await api(`/api/snapshots/${ack.snapshotId}/analysis`,undefined,json({}));assert.equal(request.status,202);
    const sourceQueue=analysisQueue(s.testDatabase,config,'captured-worker'),claim=await sourceQueue.claim();assert.ok(claim);assert.equal(await sourceQueue.allowForward(claim),true);
    // Keep the captured claim provably future-dated throughout both crash drills.
    await s.testDatabase.query("UPDATE analysis_jobs SET lease_until=now()+interval '10 minutes',deadline=now()+interval '10 minutes' WHERE id=$1",[claim.id]);
    const reserved=(await s.testDatabase.query('SELECT reserved_cny FROM analysis_budgets WHERE id=$1',[config.budgetId])).rows[0].reserved_cny;assert.ok(Number(reserved)>0);
    const sourceMounts=[{source:s.env.RAW_DIRECTORY!,target:'/raw',readonly:true},{source:backupDirectory,target:'/backups'}];
    const backupCommand={action:'backup',rawDirectory:'/raw',backupDirectory:'/backups',failureDomain:'same-host'};
    const initial=JSON.parse(await helper.run(backupCommand,s.containerDatabaseUrl,sourceMounts));
    const crashes:unknown[]=[];
    const crashScript=`import {backupArchive,restoreArchive} from './dist/apps/server/server-backup.js';let text='';process.stdin.setEncoding('utf8');for await(const part of process.stdin)text+=part;const {phase,...options}=JSON.parse(text);const observer={stage:stage=>{if(stage===phase)process.exit(86)}};await(options.action==='backup'?backupArchive(process.env.DATABASE_URL,options,observer):restoreArchive(process.env.DATABASE_URL,options,observer));`;
    let published=initial.receipt.id;
    for(const phase of ['before-publication','after-publication']){
      await assert.rejects(helper.run({...backupCommand,phase},s.containerDatabaseUrl,sourceMounts,crashScript),error=>error instanceof OwnedCommandError&&error.reason==='exited'&&error.code===86);
      const before=await(await api('/api/server/operations')).json();assert.equal(before.latestAttempt.state,'in-progress');assert.equal(before.latestBackup.id,published);
      const crashedId=before.latestAttempt.id;
      if(phase==='before-publication')await assert.rejects(helper.run({action:'verify',bundleDirectory:'/bundle'},s.containerDatabaseUrl,[{source:join(backupDirectory,`.pending-${crashedId}`),target:'/bundle',readonly:true}]),/backup-operation-failed/,'pending bundle stays unusable even under a bind-mount alias');
      const reconciled=JSON.parse(await helper.run({action:'reconcile',backupDirectory:'/backups'},s.containerDatabaseUrl,[{source:backupDirectory,target:'/backups',readonly:true}]));
      const twice=JSON.parse(await helper.run({action:'reconcile',backupDirectory:'/backups'},s.containerDatabaseUrl,[{source:backupDirectory,target:'/backups',readonly:true}]));assert.equal(twice.imported,0);
      const after=await(await api('/api/server/operations')).json();assert.notEqual(after.latestAttempt.state,'in-progress');
      if(phase==='after-publication'){assert.equal(reconciled.imported,1);published=crashedId;}else assert.equal(reconciled.imported,0);
      assert.equal(after.latestBackup.id,published);crashes.push({phase,id:crashedId,reconciled,twice,after});
    }
    const restored=await createSandbox(),targetDb=connect(restored.env.DATABASE_URL!);
    try{
      const mounts=[{source:join(backupDirectory,published),target:'/bundle',readonly:true},{source:restored.env.RAW_DIRECTORY!,target:'/raw'}];
      await assert.rejects(helper.run({action:'restore',bundleDirectory:'/bundle',rawDirectory:'/raw',phase:'restore-dump-loaded'},restored.containerDatabaseUrl,mounts,crashScript),error=>error instanceof OwnedCommandError&&error.reason==='exited'&&error.code===86);
      assert.equal((await targetDb.query('SELECT state,lease_until>now() AS future FROM analysis_jobs WHERE id=$1',[claim.id])).rows[0].future,true);
      await assert.rejects(createApp({db:targetDb,rawDirectory:restored.env.RAW_DIRECTORY!}),/服务器恢复尚未完成/,'dump-loaded target cannot serve before captured claims are fenced');
      assert.equal(JSON.parse(await readFile(join(restored.env.RAW_DIRECTORY!,'.skynet-restore-pending.json'),'utf8')).backupId,published);
    }finally{await targetDb.end();await restored.close();}
    const healthy=await createSandbox(),healthyDb=connect(healthy.env.DATABASE_URL!);
    try{
      const command={action:'restore',bundleDirectory:'/bundle',rawDirectory:'/raw'},mounts=[{source:join(backupDirectory,published),target:'/bundle',readonly:true},{source:healthy.env.RAW_DIRECTORY!,target:'/raw'}];
      await healthyDb.query("CREATE TYPE public.synthetic_owned_backup_enum AS ENUM('owned')");
      await assert.rejects(helper.run(command,healthy.containerDatabaseUrl,mounts),/backup-operation-failed/,'nonempty enum-only target is rejected before modification');
      assert.equal((await healthyDb.query("SELECT count(*)::int AS count FROM pg_type WHERE typname='synthetic_owned_backup_enum'")).rows[0].count,1);
      await healthyDb.query('DROP TYPE public.synthetic_owned_backup_enum');
      await writeFile(join(healthy.env.RAW_DIRECTORY!,'owned-existing.txt'),'keep owned target');
      await assert.rejects(helper.run(command,healthy.containerDatabaseUrl,mounts),/backup-operation-failed/,'nonempty raw target is rejected and preserved');
      assert.equal(await readFile(join(healthy.env.RAW_DIRECTORY!,'owned-existing.txt'),'utf8'),'keep owned target');
      // Only this known synthetic fixture file is moved; no user paths are used.
      const {rename}=await import('node:fs/promises');await rename(join(healthy.env.RAW_DIRECTORY!,'owned-existing.txt'),join(healthy.directory,'retained-existing.txt'));
      await helper.run(command,healthy.containerDatabaseUrl,mounts);
      const restoredQueue=analysisQueue(healthyDb,config,'captured-worker');assert.equal(await restoredQueue.renew(claim),false);assert.equal(await restoredQueue.allowForward(claim),false);assert.equal(await restoredQueue.finish(claim,{items:[],fixture:true,usage:{inputTokens:null,outputTokens:null,runtimeCostUsd:null,providerBilledCny:null,requests:1}}),false);
      const attempt=(await healthyDb.query('SELECT state,requests,usage FROM analysis_attempts WHERE job_id=$1',[claim.id])).rows[0];assert.equal(attempt.state,'lost');assert.equal(attempt.requests,1);assert.equal(attempt.usage,null);
      assert.equal((await healthyDb.query('SELECT reserved_cny FROM analysis_budgets WHERE id=$1',[config.budgetId])).rows[0].reserved_cny,reserved);
      assert.equal((await healthyDb.query("SELECT count(*)::int AS count FROM analysis_workers WHERE updated_at>now()-interval '15 seconds'")).rows[0].count,0);
      assert.equal((await healthyDb.query('SELECT attempts FROM analysis_jobs WHERE id=$1',[claim.id])).rows[0].attempts,1);
      const origin=await healthy.startServer();assert.equal((await fetch(origin+'/api/server/operations',{headers:{Authorization:`Bearer ${employee.readerCredential}`}})).status,200);
      const imported=await helper.run({action:'reconcile',backupDirectory:'/backups'},healthy.containerDatabaseUrl,[{source:backupDirectory,target:'/backups',readonly:true}]);assert.equal(JSON.parse(imported).imported,0);
    }finally{await healthyDb.end();await healthy.close();}
    await assert.rejects(helper.run({...backupCommand,phase:'after-publication'},s.containerDatabaseUrl,sourceMounts,crashScript),error=>error instanceof OwnedCommandError&&error.reason==='exited'&&error.code===86);
    const damagedId=(await(await api('/api/server/operations')).json()).latestAttempt.id;
    await writeFile(join(backupDirectory,damagedId,'database.dump'),Buffer.from('synthetic corruption'));
    const damaged=JSON.parse(await helper.run({action:'reconcile',backupDirectory:'/backups'},s.containerDatabaseUrl,[{source:backupDirectory,target:'/backups',readonly:true}]));assert.equal(damaged.rejected,1);assert.equal((await(await api('/api/server/operations')).json()).latestBackup.id,published,'damaged bundle never overwrites successful receipt metadata');
    await writeFile(join(s.directory,'backup-reconciliation-public.json'),JSON.stringify({result,initial:initial.receipt,crashes,damaged,reserved,oldClaimRejected:true,unfinishedTargetRefused:true},null,2));
    console.log(`Server backup reconciliation evidence: ${s.directory}`);
  }finally{await s.close();}
});
