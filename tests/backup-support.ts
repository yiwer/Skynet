import { execFile,spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { mkdir,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const execute=promisify(execFile);

/** Actual deployed operator helper, private per-fixture credentials only. */
export async function backupHelper(evidenceDirectory:string){
  const owner=randomUUID(),image=`skynet-backup-test:${owner}`;
  const built=await execute('docker',['build','--label',`org.skynet.backup-test=${owner}`,'--file','Dockerfile.backup','--tag',image,'.'],
    {windowsHide:true,timeout:240000,maxBuffer:8*1024*1024});
  await writeFile(join(evidenceDirectory,'backup-helper-build.log'),built.stdout+built.stderr);
  const inspected=JSON.parse((await execute('docker',['image','inspect',image],{windowsHide:true,timeout:5000})).stdout)[0];
  if(inspected.Config.Labels['org.skynet.backup-test']!==owner)throw new Error('Unexpected helper image ownership');
  await writeFile(join(evidenceDirectory,'backup-helper-image.json'),JSON.stringify({image,id:inspected.Id,owner},null,2));
  async function run(command:unknown,databaseUrl:string,mounts:{source:string;target:string;readonly?:boolean}[]){
    const name=`skynet-backup-test-${randomUUID()}`;
    const args=['run','--rm','--interactive','--name',name,'--label',`org.skynet.backup-test=${owner}`,
      '--memory','512m','--cpus','1','--pids-limit','128','--read-only','--tmpfs','/tmp:rw,nosuid,nodev,size=64m',
      '--cap-drop','ALL','--security-opt','no-new-privileges','--env','DATABASE_URL'];
    for(const mount of mounts){await mkdir(mount.source,{recursive:true});args.push('--mount',`type=bind,source=${mount.source},target=${mount.target}${mount.readonly?',readonly':''}`);}
    args.push(image);
    try{return await new Promise<string>((resolve,reject)=>{
      const child=spawn('docker',args,{env:{...process.env,DATABASE_URL:databaseUrl},windowsHide:true,stdio:['pipe','pipe','pipe']});
      let output='',errors='';const timer=setTimeout(()=>{child.kill();reject(new Error('Owned backup helper exceeded60s'));},60000);
      child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
      child.stdout.on('data',part=>{output+=part;if(output.length>1024*1024)child.kill();});child.stderr.on('data',part=>{errors+=part;});
      child.on('error',error=>{clearTimeout(timer);reject(error);});child.on('exit',code=>{clearTimeout(timer);code===0?resolve(output):reject(new Error(`Private operator failed(${code}): ${errors}`));});
      child.stdin.end(JSON.stringify(command));
    });}finally{
      const info=await execute('docker',['inspect','--format','{{index .Config.Labels "org.skynet.backup-test"}}',name],{windowsHide:true,timeout:5000}).catch(()=>null);
      if(info?.stdout.trim()===owner)await execute('docker',['rm','--force',name],{windowsHide:true,timeout:5000});
    }
  }
  return {image,run};
}
