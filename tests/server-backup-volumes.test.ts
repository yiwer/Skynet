import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import { createSandbox } from './support.js';
import { backupHelper } from './backup-support.js';
import { digest } from '../apps/server/database.js';
const execute=promisify(execFile);

test('deployment UID1000 copies up private fresh volumes before migrations and restores full server raw',{timeout:360000},async()=>{
  const source=await createSandbox(),target=await createSandbox(),owner=randomUUID();
  const names:string[]=[],volumes:string[]=[];
  const docker=(args:string[],env=process.env)=>execute('docker',args,{env,windowsHide:true,timeout:15000,maxBuffer:1024*1024});
  try{
    const helper=await backupHelper(source.directory);
    async function volume(suffix:string){const name=`skynet-backup-${owner}-${suffix}`;await docker(['volume','create','--label',`org.skynet.backup-test=${owner}`,name]);volumes.push(name);return name;}
    const originals=await volume('originals'),backups=await volume('backups'),restored=await volume('restored');
    async function server(databaseUrl:string,rawVolume:string,suffix:string){
      const name=`skynet-backup-${owner}-${suffix}`;names.push(name);
      await docker(['run','--detach','--name',name,'--label',`org.skynet.backup-test=${owner}`,'--memory','512m','--cpus','1','--pids-limit','128','--read-only','--tmpfs','/tmp:rw,nosuid,nodev,size=16m','--cap-drop','ALL','--security-opt','no-new-privileges','--publish','127.0.0.1::3000','--env','DATABASE_URL','--env','RAW_DIRECTORY=/data/raw','--env','HOST=0.0.0.0','--env','PORT=3000','--mount',`type=volume,source=${rawVolume},target=/data/raw`,'--entrypoint','node',helper.image,'dist/apps/server/main.js'],{...process.env,DATABASE_URL:databaseUrl});
      const port=(await docker(['port',name,'3000/tcp'])).stdout.trim().split(':').at(-1)!,origin=`http://127.0.0.1:${port}`;
      for(let tick=0;tick<80;tick++){try{if((await fetch(origin+'/health',{signal:AbortSignal.timeout(500)})).status===200)return origin;}catch{}await setTimeout(100);}
      throw new Error('Owned deployment server did not become healthy');
    }
    const origin=await server(source.containerDatabaseUrl,originals,'source');const employee=await source.provision('Linux私有卷灾备来源');
    const json=(body:unknown):RequestInit=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const api=(base:string,path:string,token=employee.readerCredential,init:RequestInit={})=>fetch(base+path,{...init,headers:{...init.headers,Authorization:`Bearer ${token}`}});
    const enrolled=await(await api(origin,'/api/devices/enroll',employee.enrollmentCredential,json({installationId:randomUUID(),name:'linux-private-volume'}))).json();
    const bytes=Buffer.from(JSON.stringify({type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'Linux原件不放宽权限🔒'}]}})+'\n');
    assert.equal((await api(origin,`/api/chunks/${digest(bytes)}`,enrolled.deviceCredential,{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:bytes})).status,201);
    const ack=await(await api(origin,'/api/snapshots',enrolled.deviceCredential,json({protocolVersion:1,sourceSessionId:randomUUID(),source:'codex-cli',sourceVersion:'synthetic-linux-backup',sourceOs:'linux',project:'/synthetic/linux-volume',hash:digest(bytes),byteLength:bytes.length,qualifiedAt:new Date().toISOString(),capability:'unverified'}))).json();
    const backup=JSON.parse(await helper.run({action:'backup',rawDirectory:'/data/raw',backupDirectory:'/backups',failureDomain:'same-host'},source.containerDatabaseUrl,[{type:'volume',source:originals,target:'/data/raw',readonly:true},{type:'volume',source:backups,target:'/backups'}],undefined,'1000:1000'));assert.equal(backup.state,'completed');
    const modeScript=`import {stat} from 'node:fs/promises';const mode=async p=>(await stat(p)).mode&511;console.log(JSON.stringify({uid:process.getuid(),gid:process.getgid(),raw:await mode('/data/raw'),device:await mode('/data/raw/${enrolled.deviceId}'),file:await mode('/data/raw/${enrolled.deviceId}/${digest(bytes)}'),backups:await mode('/backups')}));`;
    const modes=JSON.parse(await helper.run({},source.containerDatabaseUrl,[{type:'volume',source:originals,target:'/data/raw',readonly:true},{type:'volume',source:backups,target:'/backups',readonly:true}],modeScript,'1000:1000'));
    assert.deepEqual(modes,{uid:1000,gid:1000,raw:448,device:448,file:384,backups:448});
    const restoration=JSON.parse(await helper.run({action:'restore',bundleDirectory:`/backups/${backup.receipt.id}`,rawDirectory:'/data/raw'},target.containerDatabaseUrl,[{type:'volume',source:backups,target:'/backups',readonly:true},{type:'volume',source:restored,target:'/data/raw'}],undefined,'1000:1000'));assert.equal(restoration.state,'restored');
    const fresh=await server(target.containerDatabaseUrl,restored,'restored');const raw=await api(fresh,`/api/snapshots/${ack.snapshotId}/raw`);assert.equal(raw.status,200);assert.deepEqual(Buffer.from(await raw.arrayBuffer()),bytes);
    const ops=await(await api(fresh,'/api/server/operations')).json();assert.equal(ops.latestBackup.id,backup.receipt.id);assert.equal(ops.latestRestore.verification,'integrity-only');assert.equal(ops.storage.committedObjects,1);
    await writeFile(join(source.directory,'backup-linux-volumes-public.json'),JSON.stringify({receipt:backup.receipt,restoration,modes,ops},null,2));console.log(`Server backup Linux private volume evidence: ${source.directory}`);
  }finally{
    for(const name of names){const inspect=await docker(['inspect','--format','{{index .Config.Labels "org.skynet.backup-test"}}',name]).catch(()=>null);if(inspect?.stdout.trim()===owner)await docker(['rm','--force',name]);}
    for(const name of volumes){const inspect=await docker(['volume','inspect','--format','{{index .Labels "org.skynet.backup-test"}}',name]).catch(()=>null);if(inspect?.stdout.trim()===owner)await docker(['volume','rm',name]);}
    await source.close();await target.close();
  }
});
