import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {dirname,join,isAbsolute,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {benchmarkEnvironment,measureHooks} from './hook-benchmark.js';
import {ownedCommand} from './owned-command.js';

const launcher=process.argv[2];
if(!launcher||!isAbsolute(launcher))throw new Error('Pass an explicitly owned installed absolute skynet-launcher.mjs path');
const explicitOutput=process.argv[3];if(explicitOutput&&!isAbsolute(explicitOutput))throw new Error('Optional evidence directory must be absolute and new');
const output=explicitOutput??await mkdtemp(join(tmpdir(),'skynet-installed-hook-latency-'));
if(explicitOutput)await mkdir(output);
const state=join(output,'state');
try{
  const text=await readFile(launcher,'utf8');
  const entries=[...text.matchAll(/file:\/\/[^\s"']+\/dist\/apps\/collector\/cli\.js/g)].map(match=>fileURLToPath(match[0]!));
  if(!entries.length)throw new Error('Launcher must identify its frozen collector CLI to fingerprint measured bytes');
  const cli=entries[0]!;const payloadRoot=resolve(dirname(cli),'../../..');
  const extension=import.meta.url.endsWith('.ts')?'ts':'js';
  const files=[launcher,cli,join(dirname(cli),'hook.js'),join(payloadRoot,'dist/packages/filesystem.js'),process.execPath,fileURLToPath(import.meta.url),
    fileURLToPath(new URL(`./hook-benchmark.${extension}`,import.meta.url)),fileURLToPath(new URL(`./owned-command.${extension}`,import.meta.url))];
  const environment=await benchmarkEnvironment(files);
  const source=await ownedCommand('git',['rev-parse','HEAD'],process.env,'',{timeoutMs:10000}).then(value=>value.stdout.trim(),()=>null);
  const thresholdMs=Number(process.env.SKYNET_HOOK_THRESHOLD_MS??100);
  const result=await measureHooks({launcher,state,output,event:{hook_event_name:'UserPromptSubmit',session_id:'explicit-synthetic-installed-latency',transcript_path:join(state,'unread-native.jsonl'),cwd:state},
    profile:'installed stable launcher; sequential synthetic hook on local storage; no daemon/network/transcript read',
    environment:{...environment,invocationCheckoutHead:source,sourceIdentity:'Exact measured payload/script byte hashes; invocation checkout does not assert the installed build generation'},durability:'persisted',thresholdMs,
    deadlineMs:Number(process.env.SKYNET_HOOK_DEADLINE_MS??60000)});
  await writeFile(join(output,'latency.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify({output,state,count:result.count,p95Ms:result.p95Ms,passed:result.passed,durableInventoryVerified:result.durableInventoryVerified,thresholdMs}));
  if(!result.passed)process.exitCode=1;
}catch(error){await writeFile(join(output,'measurement-failure.json'),JSON.stringify({complete:false,passed:false,error:(error as Error).message},null,2));console.error(`Hook measurement failed; retained evidence ${output}`);process.exitCode=1;}
