import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { mcpSandbox } from './mcp-support.js';
import { digest } from '../apps/server/database.js';
import { backupHelper } from './backup-support.js';
import { createSandbox } from './support.js';
import { beijingDate } from '../packages/contracts/reports.js';
test('public archive reception distinguishes single copy from operator backup and restored evidence', {timeout:360000}, async()=>{
  const s=await mcpSandbox();
  try {
    const employee=await s.provision('灾备合成原来源');
    const json=(value:unknown):RequestInit=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
    const api=(path:string,token=employee.readerCredential,init:RequestInit={})=>s.api(path,token,init);
    const enrolled=await(await api('/api/devices/enroll',employee.enrollmentCredential,json({installationId:randomUUID(),name:'synthetic-backup-device'}))).json();
    const sessionId=randomUUID(),timestamp=new Date(Date.now()+1000).toISOString();
    const bytes=Buffer.from([JSON.stringify({type:'session_meta',payload:{id:sessionId}}),JSON.stringify({timestamp,type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'保留灾备原句与原件🛰'}]}})].join('\n')+'\n');
    assert.equal((await api(`/api/chunks/${digest(bytes)}`,enrolled.deviceCredential,{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:new Uint8Array(bytes)})).status,201);
    const manifest={protocolVersion:1,sourceSessionId:sessionId,source:'codex-cli',sourceVersion:'synthetic-backup-1',sourceOs:process.platform,project:'/synthetic/backup',hash:digest(bytes),byteLength:bytes.length,qualifiedAt:timestamp,capability:'unverified'};
    const ack=await(await api('/api/snapshots',enrolled.deviceCredential,json(manifest))).json();
    assert.equal(ack.backup,'single-copy');
    assert.equal((await s.api('/api/server/operations')).status,401);
    const operations=await api('/api/server/operations');assert.equal(operations.status,200,'public operations must truthfully report storage and absent backup');
    const status=await operations.json();assert.equal(status.latestBackup,null);assert.equal(status.storage.committedObjects,1);assert.equal(status.storage.committedBytes,bytes.length);assert.equal(status.storage.automaticDeletion,false);
    assert.equal(status.reception,'single-copy');assert.equal(status.latestRestore,null);assert.equal(status.storage.stagedObjects,0);
    await writeFile(join(s.directory,'server-operations-before-backup.json'),JSON.stringify({snapshotId:ack.snapshotId,status},null,2));
    console.log(`Server operations public evidence: ${s.directory}`);
    const staged=Buffer.from('ACKed fragment without a snapshot\n');
    assert.equal((await api(`/api/chunks/${digest(staged)}`,enrolled.deviceCredential,{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:new Uint8Array(staged)})).status,201);
    const heartbeat=()=>json({nonce:randomUUID(),source:'codex-cli',capture:{checkedAt:new Date().toISOString(),observation:'host-event-observed',locallyPersisted:true,faults:[]}});
    assert.equal((await api('/api/devices/health',enrolled.deviceCredential,heartbeat())).status,200);
    const today=beijingDate(),coveragePath=`/api/team-coverage?date=${today}`;
    const cell=(matrix:any)=>matrix.rows.find((row:any)=>row.employeeId===employee.employeeId).cells.find((cell:any)=>cell.date===today);
    assert.equal(cell(await(await api(coveragePath)).json()).currentConnection,'connected');
    const observationsPath=`/api/team-coverage/${employee.employeeId}/observations?date=${today}`;
    const capturedObservations=await(await api(observationsPath)).json();
    const helper=await backupHelper(s.directory),backupDirectory=join(s.directory,'backups');
    const backed=JSON.parse(await helper.run({action:'backup',rawDirectory:'/raw',backupDirectory:'/backups',failureDomain:'same-host'},s.containerDatabaseUrl,
      [{source:s.env.RAW_DIRECTORY!,target:'/raw',readonly:true},{source:backupDirectory,target:'/backups'}]));
    assert.equal(backed.state,'completed','real operator backup must finish before reporting disaster copy');
    assert.equal(backed.receipt.objects,2);assert.equal(backed.receipt.bytes,bytes.length+staged.length);
    const completed=await(await api('/api/server/operations')).json();assert.equal(completed.latestBackup.id,backed.receipt.id);assert.equal(completed.storage.stagedObjects,1);
    const restored=await createSandbox();
    try{
      const result=JSON.parse(await helper.run({action:'restore',bundleDirectory:'/bundle',rawDirectory:'/raw'},restored.containerDatabaseUrl,
        [{source:join(backupDirectory,backed.receipt.id),target:'/bundle',readonly:true},{source:restored.env.RAW_DIRECTORY!,target:'/raw'}]));
      assert.equal(result.state,'restored');
      const origin=await restored.startServer();
      const read=(path:string,credential=employee.readerCredential,init:RequestInit={})=>fetch(origin+path,{...init,headers:{...init.headers,Authorization:`Bearer ${credential}`}});
      const raw=await read(`/api/snapshots/${ack.snapshotId}/raw`);assert.equal(raw.status,200);assert.deepEqual(Buffer.from(await raw.arrayBuffer()),bytes);
      const operations=await(await read('/api/server/operations')).json();assert.equal(operations.latestBackup.id,backed.receipt.id);assert.equal(operations.latestRestore.verification,'integrity-only');assert.equal(operations.latestAttempt.state,'completed');
      const restoredCell=cell(await(await read(coveragePath)).json());assert.equal(restoredCell.currentConnection,'not-connected','captured pre-loss heartbeat must not imply a live restored-target connection');
      assert.deepEqual(await(await read(observationsPath)).json(),capturedObservations,'historical hourly receipt observations remain exact');
      assert.equal((await read('/api/devices/health',enrolled.deviceCredential,heartbeat())).status,200);
      assert.equal(cell(await(await read(coveragePath)).json()).currentConnection,'connected','genuine restored-target heartbeat makes current connection live');
      const finalized=await read('/api/snapshots',enrolled.deviceCredential,json({...manifest,sourceSessionId:randomUUID(),hash:digest(staged),byteLength:staged.length}));
      assert.equal(finalized.status,200,'ACKed staged raw must be available without reupload after fresh restore');
      const stagedAck=await finalized.json();assert.equal(stagedAck.backup,'single-copy');
      assert.deepEqual(Buffer.from(await(await read(`/api/snapshots/${stagedAck.snapshotId}/raw`)).arrayBuffer()),staged);
      await writeFile(join(s.directory,'backup-restore-public.json'),JSON.stringify({receipt:backed.receipt,restore:result,operations,stagedSubmission:finalized.status},null,2));
    }finally{await restored.close();}
  } finally {await s.close();}
});
