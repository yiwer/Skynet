import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { mcpSandbox } from './mcp-support.js';
import { digest } from '../apps/server/database.js';

test('public operations exposes persisted reception storage without claiming a server backup', {timeout:120000}, async()=>{
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
  } finally {await s.close();}
});
