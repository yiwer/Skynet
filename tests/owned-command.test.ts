import test from 'node:test';
import assert from 'node:assert/strict';
import {command} from './support.js';
import {removeOwnedContainer} from './owned-command.js';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('owned command stops an unresponsive child within its explicit deadline',{timeout:5000},async()=>{
  const started=performance.now();
  await assert.rejects((command as any)(process.execPath,['-e','setTimeout(()=>process.exit(0),1500)'],process.env,'',{timeoutMs:80,maxOutputBytes:1024}),/deadline/);
  assert.ok(performance.now()-started<1200,'deadline closes only the child created by this command');
});

test('owned command bounds both streams and preserves decoded chunks without leaking private environment',{timeout:5000},async()=>{
  for(const stream of ['stdout','stderr'])await assert.rejects(command(process.execPath,['-e',`process.${stream}.write('x'.repeat(4096))`],process.env,'',{timeoutMs:1000,maxOutputBytes:512}),new RegExp(`${stream} limit`));
  const bytes='中文😀';assert.equal(await command(process.execPath,['-e',`const b=Buffer.from(${JSON.stringify(bytes)});process.stdout.write(b.subarray(0,2));setTimeout(()=>process.stdout.write(b.subarray(2)),20)`],process.env),bytes);
  await assert.rejects(command(process.execPath,['-e','process.stderr.write(process.env.DATABASE_URL);process.exitCode=1'],{...process.env,DATABASE_URL:'postgresql://private:secret@private-host/db'}),error=>error instanceof Error&&!error.message.includes('secret')&&!error.message.includes('private-host'));
});

test('container cleanup refuses unknown ownership or failed inspection and removes only the exact owned name',{timeout:5000},async()=>{
  const directory=await mkdtemp(join(tmpdir(),'skynet-owned-command-')),script=join(directory,'docker-fixture.mjs'),marker=join(directory,'removed.json');
  await writeFile(script,`import{writeFileSync}from'node:fs';if(process.argv[2]==='inspect'){if(process.env.MODE==='missing'){console.error('No such object');process.exit(1)}if(process.env.MODE==='failed'){console.error('daemon unavailable');process.exit(1)}console.log(process.env.MODE==='mismatch'?'other-owner':'expected-owner')}else writeFileSync(process.env.MARKER,JSON.stringify(process.argv.slice(2)));`);
  const cli=(mode:string)=>({file:process.execPath,prefix:[script],env:{...process.env,MODE:mode,MARKER:marker}});
  await assert.rejects(removeOwnedContainer('exact-owned','expected-owner',cli('failed')),/inspection failed/);
  await assert.rejects(removeOwnedContainer('exact-owned','expected-owner',cli('mismatch')),/owner mismatch/);
  await removeOwnedContainer('exact-owned','expected-owner',cli('missing'));await assert.rejects(readFile(marker),{code:'ENOENT'});
  await removeOwnedContainer('exact-owned','expected-owner',cli('owned'));assert.deepEqual(JSON.parse(await readFile(marker,'utf8')),['rm','--force','exact-owned']);
});
