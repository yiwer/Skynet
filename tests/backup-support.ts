import {ownedCommand,removeOwnedContainer} from './owned-command.js';
import { randomUUID } from 'node:crypto';
import { mkdir,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const execute=(args:string[],timeoutMs=5000,maxOutputBytes=1024*1024)=>ownedCommand('docker',args,process.env,'',{timeoutMs,maxOutputBytes});

/** Actual deployed operator helper, private per-fixture credentials only. */
export async function backupHelper(evidenceDirectory:string){
  const owner=randomUUID(),image=`skynet-backup-test:${owner}`;
  const built=await execute(['build','--label',`org.skynet.backup-test=${owner}`,'--file','Dockerfile.backup','--tag',image,'.'],240000,8*1024*1024);
  await writeFile(join(evidenceDirectory,'backup-helper-build.log'),built.stdout+built.stderr);
  const inspected=JSON.parse((await execute(['image','inspect',image])).stdout)[0];
  if(inspected.Config.Labels['org.skynet.backup-test']!==owner)throw new Error('Unexpected helper image ownership');
  await writeFile(join(evidenceDirectory,'backup-helper-image.json'),JSON.stringify({image,id:inspected.Id,owner},null,2));
  async function run(command:unknown,databaseUrl:string,mounts:{source:string;target:string;readonly?:boolean;type?:'bind'|'volume'}[],script?:string,user?:string){
    const name=`skynet-backup-test-${randomUUID()}`;
    const args=['run','--rm','--interactive','--name',name,'--label',`org.skynet.backup-test=${owner}`,'--label',`org.skynet.test-owner=${owner}`,
      '--memory','512m','--cpus','1','--pids-limit','128','--read-only','--tmpfs','/tmp:rw,nosuid,nodev,size=64m',
      '--cap-drop','ALL','--security-opt','no-new-privileges','--env','DATABASE_URL'];
    // Linux fixtures retain their caller's 0700/0600 ownership. Deployment uses
    // image UID1000 and volumes with the same owner; never widen private modes.
    if(user)args.push('--user',user);else if(process.getuid&&process.getgid)args.push('--user',`${process.getuid()}:${process.getgid()}`);
    for(const mount of mounts){if(mount.type!=='volume')await mkdir(mount.source,{recursive:true});args.push('--mount',`type=${mount.type??'bind'},source=${mount.source},target=${mount.target}${mount.readonly?',readonly':''}`);}
    if(script)args.push('--entrypoint','node');args.push(image);if(script)args.push('--input-type=module','--eval',script);
    let primary:unknown;
    try{return(await ownedCommand('docker',args,{...process.env,DATABASE_URL:databaseUrl},JSON.stringify(command),{timeoutMs:60000})).stdout;}
    catch(error){primary=error;throw error;}
    finally{try{await removeOwnedContainer(name,owner);}catch(error){if(primary)throw new AggregateError([primary,error],'Operator failed and owned cleanup requires inspection');throw error;}}
  }
  return {image,run};
}
