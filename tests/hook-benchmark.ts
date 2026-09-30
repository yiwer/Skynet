import {readFile,readdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {arch,cpus,freemem,platform,release,totalmem,version} from 'node:os';
import {ownedCommand,OwnedCommandError} from './owned-command.js';

export async function benchmarkEnvironment(files:string[]){
  const hashes=await Promise.all(files.map(async file=>({file,sha256:createHash('sha256').update(await readFile(file)).digest('hex')})));
  return {node:process.version,platform:platform(),arch:arch(),osRelease:release(),osVersion:version(),
    cpuModels:[...new Set(cpus().map(cpu=>cpu.model))],logicalCPUs:cpus().length,memoryBytes:totalmem(),freeMemoryBytes:freemem(),
    uid:process.getuid?.()??null,gid:process.getgid?.()??null,hashes};
}
type Sample={index:number;nonce:string;elapsedMs:number;code:number|null;passed:boolean;failure:string|null;stdout:string;stderr:string};

/** Opt-in sequential process measurement. Full ordered rows and partial failed
 * progress survive; percentages are never derived from an incomplete run. */
export async function measureHooks(options:{launcher:string;state:string;output:string;event:Record<string,unknown>;
  profile:string;environment:unknown;expectedStderr?:string;durability:'persisted'|'unavailable-enospc';
  thresholdMs:number|null;deadlineMs?:number;sampleTimeoutMs?:number;env?:NodeJS.ProcessEnv}){
  const started=performance.now(),nonce=randomUUID(),samples:Sample[]=[];
  const deadlineMs=options.deadlineMs??60000,sampleTimeoutMs=options.sampleTimeoutMs??3000;
  if(!Number.isSafeInteger(deadlineMs)||deadlineMs<1||!Number.isSafeInteger(sampleTimeoutMs)||sampleTimeoutMs<1
    ||options.thresholdMs!==null&&(!Number.isFinite(options.thresholdMs)||options.thresholdMs<0))throw new Error('Invalid hook benchmark bounds');
  const metadata={at:new Date().toISOString(),profile:options.profile,launcher:options.launcher,state:options.state,
    environment:options.environment,nonce,deadlineMs,sampleTimeoutMs,thresholdMs:options.thresholdMs,expectedSamples:200,concurrentMeasuredChildren:1,hostLoadControlled:false,
    boundary:'Sequential owned children; includes process creation and hook handling. No uncontrolled-host CI latency gate is implied. Different profiles never replace historical parallel pressure results.'};
  let failure:string|null=null;
  try{
    for(let index=0;index<200;index++){
      const remaining=deadlineMs-(performance.now()-started);if(remaining<=0)throw new Error('Overall hook benchmark deadline exceeded');
      const start=performance.now();let row:Sample;
      try{const value=await ownedCommand(process.execPath,[options.launcher,'hook','--state',options.state],options.env??process.env,
        JSON.stringify({...options.event,synthetic_nonce:nonce,synthetic_sample:index}),{timeoutMs:Math.max(1,Math.min(sampleTimeoutMs,Math.floor(remaining))),maxOutputBytes:8192});
        const passed=value.stdout===''&&value.stderr===(options.expectedStderr??'');
        row={index,nonce,elapsedMs:performance.now()-start,code:0,passed,failure:passed?null:'Unexpected hook output',...value};
      }catch(error){row={index,nonce,elapsedMs:performance.now()-start,code:error instanceof OwnedCommandError?error.code:null,passed:false,
        failure:error instanceof OwnedCommandError?error.reason:(error as Error).message,stdout:'',stderr:error instanceof OwnedCommandError?error.stderr:''};}
      samples.push(row);
      if(samples.length%20===0||!row.passed)await writeFile(join(options.output,'progress.json'),JSON.stringify({metadata,samples},null,2));
      if(!row.passed)throw new Error(`Hook measurement failed at sample${index}: ${row.failure}`);
    }
  }catch(error){failure=(error as Error).message;}
  let inventory:{file:string;index:number;nonce:string;sha256:string}[]=[];let inventoryError:string|null=null;
  try{const names=await readdir(join(options.state,'spool')).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
    if(names.length>10000)throw new Error('Benchmark spool inventory exceeded bounded10000 files');
    for(const name of names.sort())if(name.endsWith('.json')){const bytes=await readFile(join(options.state,'spool',name));if(bytes.length>65536)throw new Error('Benchmark spool row exceeded64KiB');
      const value=JSON.parse(bytes.toString('utf8'));if(value.event?.synthetic_nonce===nonce)inventory.push({file:name,index:value.event.synthetic_sample,nonce,sha256:createHash('sha256').update(bytes).digest('hex')});}
  }catch(error){inventoryError=(error as Error).message;}
  const indexes=inventory.map(row=>row.index).sort((a,b)=>a-b);
  const inventoryPassed=!inventoryError&&(options.durability==='persisted'?indexes.length===200&&indexes.every((value,index)=>value===index):indexes.length===0);
  const complete=!failure&&samples.length===200&&samples.every(row=>row.passed)&&inventoryPassed;
  const times=samples.map(row=>row.elapsedMs).sort((a,b)=>a-b);
  const p95Ms=complete?times[189]!:null;
  const thresholdPassed=options.thresholdMs===null?null:complete&&p95Ms!<=options.thresholdMs;
  const result={metadata,completedAt:new Date().toISOString(),elapsedMs:performance.now()-started,count:samples.length,complete,
    passed:complete&&thresholdPassed!==false,measurementFailure:failure,inventoryError,inventoryPassed,
    durableInventoryVerified:options.durability==='persisted'&&inventoryPassed,durability:options.durability,inventory,
    p50Ms:complete?times[99]:null,p95Ms,maxMs:complete?times[199]:null,thresholdPassed,samples};
  await writeFile(join(options.output,'result.json'),JSON.stringify(result,null,2));return result;
}
