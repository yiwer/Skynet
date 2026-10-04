import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {cpus,totalmem} from 'node:os';
import {plan,summarize,type Measurements,type Observation} from './ac32-results.js';
import {ownedCommand} from './owned-command.js';
const argv=process.argv.slice(2),flag=(name:string)=>argv.includes(name),arg=(name:string)=>{const index=argv.indexOf(name);return index<0?undefined:argv[index+1];};
const revision=()=>execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const clean=()=>execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim()==='';
const child=(args:string[])=>ownedCommand(process.execPath,['--import','tsx',fileURLToPath(import.meta.url),...args],{...process.env,NODE_TEST_CONTEXT:undefined},'',{timeoutMs:20*60*1000,maxOutputBytes:128*1024});
// Explicit load command; ordinary tests only exercise this command's small seams.
if(argv[0]==='plan')console.log(JSON.stringify(plan));
else if(argv[0]==='summarize'){
  const report=summarize(JSON.parse(await readFile(process.argv[3]!,'utf8')));console.log(JSON.stringify(report));
  if(report.status!=='passed'&&report.status!=='diagnostic-not-acceptance')process.exitCode=1;
}
else if(argv[0]==='seed'){
  if(!flag('--mini')&&!flag('--diagnostic'))assert.equal(clean(),true,'Formal seeding requires clean fixed source');
  const {seedBundle}=await import('./ac32-fixture.js'),bundle=await seedBundle(resolve(argv[1]!),revision(),flag('--mini'),flag('--mini')||flag('--diagnostic'));
  console.log(JSON.stringify({bundleHash:bundle.bundleHash,dataset:bundle.dataset,diagnostic:bundle.diagnostic}));
}
else if(argv[0]==='sample'){
  assert.ok(plan.entries.includes(argv[2]!),'Unknown measurement entry');
  const {sample}=await import('./ac32-sample.js');await sample(resolve(argv[1]!),argv[2]!,resolve(argv[3]!),flag('--checks'));
}
else if(argv[0]==='run'){
  const destination=resolve(argv[1]!),samples=Number(arg('--samples')??20),selected=arg('--entry')?[arg('--entry')!]:plan.entries;
  assert.ok(Number.isInteger(samples)&&samples>=1&&samples<=100,'Samples must be 1..100');assert.ok(selected.every(entry=>plan.entries.includes(entry)),'Unknown entry');
  const diagnostic=flag('--diagnostic')||flag('--mini')||samples<20||selected.length!==plan.entries.length;
  if(!diagnostic)assert.equal(clean(),true,'Formal measurement requires clean fixed source');
  await mkdir(destination,{recursive:false});const bundlePath=join(destination,'source');
  try{await child(['seed',bundlePath,...(flag('--mini')?['--mini']:diagnostic?['--diagnostic']:[])]);}
  finally{const {cleanAbandonedSample}=await import('./ac32-owned.js');await cleanAbandonedSample(join(bundlePath,'seed.owner.json'));}
  const bundle=JSON.parse(await readFile(join(bundlePath,'bundle.json'),'utf8'));
  const postgresRuntime=process.env.SKYNET_TEST_POSTGRES_BIN?
    (await ownedCommand(join(process.env.SKYNET_TEST_POSTGRES_BIN,'postgres'+(process.platform==='win32'?'.exe':'')),['--version'],process.env,'',{timeoutMs:10000})).stdout.trim():
    JSON.parse((await ownedCommand('docker',['image','inspect','postgres:17-alpine','--format','{{json .}}'],process.env,'',{timeoutMs:10000})).stdout).Id;
  const measurements:Measurements={kind:'ac32-observations-1',diagnostic,sourceRevision:revision(),sourceBundleHash:bundle.bundleHash,dataset:bundle.dataset,observations:[]};
  const environment={node:process.version,platform:process.platform,cpu:cpus()[0]?.model,logicalCpu:cpus().length,memoryBytes:totalmem(),
    postgresMode:process.env.SKYNET_TEST_POSTGRES_BIN?'owned-native':'owned-docker',postgresRuntime,startedAt:new Date().toISOString(),sourceClean:clean(),
    conditions:'Serial independent restored fixtures. No cache flushing of host OS, no concurrent-load control inferred. Endpoint order is recorded. Source bundle contains synthetic local credentials and is not a public artifact.'};
  const errors:{entry:string;sample:number;error:string}[]=[];
  const deadline=Date.now()+4*60*60*1000;
  load:for(const entry of selected)for(let index=0;index<samples;index++){
    if(Date.now()>deadline){errors.push({entry,sample:index,error:'Four-hour orchestration bound reached; remaining observations are missing, not passed'});break load;}
    const path=join(destination,`${entry}-${String(index).padStart(3,'0')}.json`);
    try{await child(['sample',bundlePath,entry,path,...(index===0?['--checks']:[])]);}
    catch(error){errors.push({entry,sample:index,error:String(error)});}
    try{const {cleanAbandonedSample}=await import('./ac32-owned.js');await cleanAbandonedSample(path+'.owner.json');}
    catch(error){errors.push({entry,sample:index,error:'Owned cleanup incomplete: '+String(error)});break load;}
    try{const result=JSON.parse(await readFile(path,'utf8'));assert.equal(result.sourceBundleHash,bundle.bundleHash);assert.equal(result.sourceRevision,measurements.sourceRevision);measurements.observations.push(result.observation as Observation);}
    catch(error){errors.push({entry,sample:index,error:'Missing/invalid sample: '+String(error)});}
    await writeFile(join(destination,'observations.json'),JSON.stringify(measurements,null,2));
    console.log(JSON.stringify({entry,sample:index,recorded:measurements.observations.length,errors:errors.length}));
  }
  const report={...summarize(measurements),environment,errors,finishedAt:new Date().toISOString()};
  if(errors.length)report.status='failed';await writeFile(join(destination,'summary.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({status:report.status,summary:join(destination,'summary.json')}));
  if(report.status!=='passed'&&report.status!=='diagnostic-not-acceptance')process.exitCode=1;
}
else throw new Error('Expected plan, seed <new-directory> [--mini], sample <bundle> <entry> <result> [--checks], run <new-directory> [--samples N] [--entry NAME] [--diagnostic] [--mini], or summarize <observations.json>');
