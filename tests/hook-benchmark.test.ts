import test from 'node:test';
import assert from 'node:assert/strict';
import {copyFile,mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {ownedCommand,OwnedCommandError} from './owned-command.js';
import {measureHooks} from './hook-benchmark.js';

test('benchmark retains200 durable indexed rows and fails its declared threshold with nonzero CLI exit',{timeout:210000},async()=>{
  const directory=await mkdtemp(join(tmpdir(),'skynet-benchmark-contract-'));const payload=join(directory,'payload');
  for(const file of ['dist/apps/collector/cli.js','dist/apps/collector/hook.js','dist/packages/filesystem.js']){
    const target=join(payload,file);await mkdir(dirname(target),{recursive:true});await copyFile(resolve(file),target);
  }
  await writeFile(join(payload,'package.json'),JSON.stringify({type:'module'}));
  const {launcherText}=await import(pathToFileURL(resolve('dist/apps/collector/release.js')).href);
  const launcher=join(directory,'skynet-launcher.mjs');await writeFile(launcher,launcherText(payload));
  const output=join(directory,'evidence');
  await assert.rejects(ownedCommand(process.execPath,[resolve('dist/tests/measure-installed-hook.js'),launcher,output],
    {...process.env,SKYNET_HOOK_THRESHOLD_MS:'0',SKYNET_HOOK_DEADLINE_MS:'180000'},'',{timeoutMs:200000}),(error:unknown)=>error instanceof OwnedCommandError&&error.code===1);
  const result=JSON.parse(await readFile(join(output,'result.json'),'utf8'));
  assert.equal(result.count,200);assert.equal(result.complete,true);assert.equal(result.passed,false);assert.equal(result.thresholdPassed,false);
  assert.equal(result.durableInventoryVerified,true);assert.equal(result.inventory.length,200);
  assert.ok(result.samples.every((row:any,index:number)=>row.index===index&&row.nonce===result.metadata.nonce&&row.code===0&&row.passed));
  assert.ok(result.metadata.environment.hashes.every((file:any)=>/^[a-f0-9]{64}$/.test(file.sha256)));
  assert.deepEqual([...result.inventory.map((row:any)=>row.index)].sort((a,b)=>a-b),Array.from({length:200},(_,index)=>index));
  console.log(`Benchmark contract only; threshold0 is deliberately impossible, not a100ms performance acceptance. Evidence: ${output}`);
});

test('measurement deadline retains a failed row and never reports a percentile',{timeout:5000},async()=>{
  const directory=await mkdtemp(join(tmpdir(),'skynet-benchmark-deadline-'));const launcher=join(directory,'owned-hang.mjs');
  await writeFile(launcher,'setInterval(()=>{},1000);');
  const result=await measureHooks({launcher,state:join(directory,'state'),output:directory,event:{},profile:'synthetic nonresponding child contract',
    environment:{synthetic:true},durability:'persisted',thresholdMs:null,sampleTimeoutMs:80,deadlineMs:200});
  assert.equal(result.complete,false);assert.equal(result.passed,false);assert.equal(result.count,1);assert.equal(result.p95Ms,null);
  assert.equal(result.samples[0]!.failure,'deadline exceeded');assert.equal(result.durableInventoryVerified,false);
  assert.deepEqual(JSON.parse(await readFile(join(directory,'result.json'),'utf8')).samples,result.samples);
});
