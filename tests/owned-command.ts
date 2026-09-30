import {spawn,type ChildProcess} from 'node:child_process';

export type CommandOptions={timeoutMs?:number;maxOutputBytes?:number;cwd?:string};
export class OwnedCommandError extends Error {
  constructor(public readonly reason:string,public readonly code:number|null,public readonly stderr:string){super(`Owned command ${reason}${code===null?'':` (${code})`}${stderr?`: ${stderr}`:''}`);}
}
function safe(text:string,env:NodeJS.ProcessEnv,input:string){
  const secrets=Object.entries(env).filter(([key,value])=>value&&/credential|password|secret|token|key|database_url/i.test(key)).map(([,value])=>value!);
  try{const value=JSON.parse(input);for(const [key,item]of Object.entries(value))if(typeof item==='string'&&/credential|password|secret|token|key/i.test(key))secrets.push(item);}catch{}
  for(const secret of secrets)if(secret)text=text.replaceAll(secret,'[private]');
  return text.replace(/postgres(?:ql)?:\/\/[^\s"']+/gi,'[private database]').replace(/Bearer\s+[^\s"']+/gi,'Bearer [private]');
}
/** Real process boundary: independent stream caps, close (not exit), exact child only. */
export async function ownedCommand(file:string,args:string[],env:NodeJS.ProcessEnv=process.env,input='',options:CommandOptions={}){
  const timeoutMs=options.timeoutMs??120000,limit=options.maxOutputBytes??1024*1024;
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||!Number.isSafeInteger(limit)||limit<1)throw new Error('Invalid owned command bounds');
  return new Promise<{stdout:string;stderr:string}>((resolve,reject)=>{
    const child=spawn(file,args,{env,cwd:options.cwd,windowsHide:true,stdio:['pipe','pipe','pipe']});
    const stdout:Buffer[]=[],stderr:Buffer[]=[];let outBytes=0,errBytes=0,reason:string|undefined,killTimer:NodeJS.Timeout|undefined;
    const finish=(code:number|null)=>{clearTimeout(timer);clearTimeout(killTimer);const error=safe(Buffer.concat(stderr).toString('utf8'),env,input);
      if(reason||code!==0)reject(new OwnedCommandError(reason??'exited',code,error));else resolve({stdout:Buffer.concat(stdout).toString('utf8'),stderr:error});};
    const cancel=(why:string)=>{if(reason)return;reason=why;child.kill('SIGKILL');killTimer=setTimeout(()=>finish(null),2000);};
    const timer=setTimeout(()=>cancel('deadline exceeded'),timeoutMs);
    child.stdout.on('data',(bytes:Buffer)=>{outBytes+=bytes.length;if(outBytes>limit)cancel('stdout limit exceeded');else stdout.push(bytes);});
    child.stderr.on('data',(bytes:Buffer)=>{errBytes+=bytes.length;if(errBytes>limit)cancel('stderr limit exceeded');else stderr.push(bytes);});
    child.once('error',()=>{reason='could not start';});child.once('close',finish);
    child.stdin.on('error',()=>undefined);child.stdin.end(input);
  });
}
export async function stopOwnedChild(child?:ChildProcess,force=false){
  if(!child||child.exitCode!==null||child.signalCode!==null)return;
  await new Promise<void>((resolve,reject)=>{
    const timer=setTimeout(()=>child.kill('SIGKILL'),3000);
    const deadline=setTimeout(()=>{cleanup();reject(new Error('Owned child did not close within5s'));},5000);
    const cleanup=()=>{clearTimeout(timer);clearTimeout(deadline);child.removeListener('close',closed);};
    const closed=()=>{cleanup();resolve();};child.once('close',closed);child.kill(force?'SIGKILL':'SIGTERM');
  });
}
export async function removeOwnedContainer(name:string,owner:string,cli:{file?:string;prefix?:string[];env?:NodeJS.ProcessEnv}={}){
  const run=(args:string[],timeoutMs=5000)=>ownedCommand(cli.file??'docker',[...(cli.prefix??[]),...args],cli.env??process.env,'',{timeoutMs});
  let info:string;
  try{info=(await run(['inspect','--format','{{index .Config.Labels "org.skynet.test-owner"}}',name])).stdout.trim();}
  catch(error){if(error instanceof OwnedCommandError&&error.code===1&&/No such (object|container)/i.test(error.stderr))return;throw new Error(`Owned container inspection failed; retained exact name ${name}`,{cause:error});}
  if(info!==owner)throw new Error(`Container owner mismatch; retained exact name ${name}`);
  await run(['rm','--force',name],10000);
}
