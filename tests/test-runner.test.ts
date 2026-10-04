import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ownedCommand,OwnedCommandError} from './owned-command.js';

test('the ordinary suite completes every file with one isolated resource available by default',{timeout:20000},async()=>{
  const directory=await mkdtemp(join(tmpdir(),'skynet-runner-limit-'));
  try{
    const files:string[]=[];
    for(let n=0;n<3;n++){
      const file=join(directory,`resource-${n}.test.mjs`);files.push(file);
      await writeFile(file,`import test from 'node:test';import{mkdir,rm}from'node:fs/promises';import{setTimeout}from'node:timers/promises';test('resource ${n}',async()=>{const lock=${JSON.stringify(join(directory,'occupied'))};await mkdir(lock);try{await setTimeout(500);}finally{await rm(lock,{recursive:true});}});`);
    }
    const wrapper=join(directory,'run.mjs'),runner=new URL('./run.ts',import.meta.url).href;
    await writeFile(wrapper,`import{runTests}from${JSON.stringify(runner)};await runTests(${JSON.stringify(files)});`);
    const env={...process.env};delete env.NODE_TEST_CONTEXT;delete env.SKYNET_TEST_SHARD;
    const result=await ownedCommand(process.execPath,['--import','tsx',wrapper],env,'',{timeoutMs:15000,maxOutputBytes:128*1024});
    assert.match(result.stdout,/(?:#|ℹ) tests 3/);assert.match(result.stdout,/(?:#|ℹ) pass 3/);assert.match(result.stdout,/(?:#|ℹ) fail 0/);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('two explicit CI shards execute every selected file exactly once',{timeout:15000},async()=>{
  const directory=await mkdtemp(join(tmpdir(),'skynet-runner-shards-'));
  try{
    const files:string[]=[];
    for(let n=0;n<4;n++){const file=join(directory,`part-${n}.test.mjs`);files.push(file);await writeFile(file,`import test from 'node:test';test('part ${n}',()=>console.log('executed-file-${n}'));`);}
    const wrapper=join(directory,'run.mjs');await writeFile(wrapper,`import{runTests}from${JSON.stringify(new URL('./run.ts',import.meta.url).href)};await runTests(${JSON.stringify(files)});`);
    const ran:string[]=[];
    for(const shard of ['1/2','2/2']){const env:NodeJS.ProcessEnv={...process.env,SKYNET_TEST_SHARD:shard};delete env.NODE_TEST_CONTEXT;
      const result=await ownedCommand(process.execPath,['--import','tsx',wrapper],env,'',{timeoutMs:5000,maxOutputBytes:128*1024});
      ran.push(...result.stdout.match(/executed-file-\d/g)??[]);
    }
    assert.deepEqual(ran.sort(),['executed-file-0','executed-file-1','executed-file-2','executed-file-3']);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('four explicit CI shards execute every selected file exactly once',{timeout:20000},async()=>{
  const directory=await mkdtemp(join(tmpdir(),'skynet-runner-four-shards-'));
  try{
    const files:string[]=[];
    for(let n=0;n<9;n++){const file=join(directory,`part-${n}.test.mjs`);files.push(file);await writeFile(file,`import test from 'node:test';test('part ${n}',()=>console.log('executed-file-${n}'));`);}
    const wrapper=join(directory,'run.mjs');await writeFile(wrapper,`import{runTests}from${JSON.stringify(new URL('./run.ts',import.meta.url).href)};await runTests(${JSON.stringify(files)});`);
    const ran:string[]=[];
    for(const shard of ['1/4','2/4','3/4','4/4']){const env:NodeJS.ProcessEnv={...process.env,SKYNET_TEST_SHARD:shard};delete env.NODE_TEST_CONTEXT;
      const result=await ownedCommand(process.execPath,['--import','tsx',wrapper],env,'',{timeoutMs:5000,maxOutputBytes:128*1024});
      assert.match(result.stdout,/(?:#|ℹ) fail 0/);ran.push(...result.stdout.match(/executed-file-\d/g)??[]);
    }
    assert.deepEqual(ran.sort(),Array.from({length:9},(_,n)=>'executed-file-'+n));
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('an unsupported shard fails before silently omitting selected tests',{timeout:10000},async()=>{
  const directory=await mkdtemp(join(tmpdir(),'skynet-runner-invalid-'));
  try{
    const file=join(directory,'must-run.test.mjs'),wrapper=join(directory,'run.mjs');
    await writeFile(file,"import test from 'node:test';test('must run',()=>console.log('unexpected execution'));");
    await writeFile(wrapper,`import{runTests}from${JSON.stringify(new URL('./run.ts',import.meta.url).href)};await runTests([${JSON.stringify(file)}]);`);
    const env:NodeJS.ProcessEnv={...process.env,SKYNET_TEST_SHARD:'1/9'};delete env.NODE_TEST_CONTEXT;
    await assert.rejects(ownedCommand(process.execPath,['--import','tsx',wrapper],env,'',{timeoutMs:5000,maxOutputBytes:128*1024}),error=>{
      assert.ok(error instanceof OwnedCommandError);assert.equal(error.code,1);assert.match(error.stderr,/SKYNET_TEST_SHARD must be 1\/2 or 2\/2/);assert.doesNotMatch(error.stdout,/unexpected execution/);return true;
    });
  }finally{await rm(directory,{recursive:true,force:true});}
});
