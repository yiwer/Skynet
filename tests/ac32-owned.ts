import assert from 'node:assert/strict';
import {readFile,writeFile,rm,access} from 'node:fs/promises';
import {dirname,join,resolve,relative} from 'node:path';
import {tmpdir} from 'node:os';
import {ownedCommand,removeOwnedContainer} from './owned-command.js';
import type {createSandbox} from './support.js';

export async function recordSampleOwner(path:string,sandbox:Awaited<ReturnType<typeof createSandbox>>,owner:string){
  await writeFile(path,JSON.stringify({directory:sandbox.directory,owner,name:sandbox.name,testOwner:sandbox.testOwner,
    ...(process.env.SKYNET_TEST_POSTGRES_BIN?{nativeBinaries:process.env.SKYNET_TEST_POSTGRES_BIN,postgresOwner:await readFile(join(sandbox.directory,'postgres-owner'),'utf8')}:{})}),{flag:'wx',mode:0o600});
}
// The outer command knows its child has terminated before invoking this fallback.
// Normal child cleanup is still first. Never enumerate or stop unrelated fixtures.
export async function cleanAbandonedSample(path:string){
  let record:any;try{record=JSON.parse(await readFile(path,'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}
  const directory=resolve(record.directory);assert.equal(dirname(directory),resolve(tmpdir()));assert.match(relative(tmpdir(),directory),/^skynet-test-[^\\/]+$/);
  let marker:string;try{marker=await readFile(join(directory,'ac32-owner'),'utf8');}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT'){
    try{await access(directory);}catch(missing){if((missing as NodeJS.ErrnoException).code==='ENOENT'){await rm(path);return;}throw missing;}
    throw new Error('Owned fixture exists but its marker is missing; refusing cleanup');
  }throw error;}
  assert.equal(marker,record.owner);assert.match(record.owner,/^[a-f0-9-]{36}$/);
  if(record.nativeBinaries){
    assert.equal(resolve(record.nativeBinaries),resolve(process.env.SKYNET_TEST_POSTGRES_BIN!));
    assert.equal(await readFile(join(directory,'postgres-owner'),'utf8'),record.postgresOwner);
    try{await readFile(join(directory,'postgres','postmaster.pid'));
      await ownedCommand(join(record.nativeBinaries,'pg_ctl'+(process.platform==='win32'?'.exe':'')),['-D',join(directory,'postgres'),'-m','fast','-w','stop'],process.env,'',{timeoutMs:60000});
    }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  }else await removeOwnedContainer(record.name,record.testOwner);
  await rm(directory,{recursive:true});await rm(path);
}
