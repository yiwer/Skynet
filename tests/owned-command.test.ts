import test from 'node:test';
import assert from 'node:assert/strict';
import {command} from './support.js';
import {removeOwnedContainer,ownedReady,stopOwnedChild,cleanupOwned,OwnedCommandError,ownedCommand} from './owned-command.js';
import {spawn} from 'node:child_process';
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

test('failed owned child retains its bounded stdout footer and redacts both failure streams',{timeout:5000},async()=>{
  const credential='controlled-private-child-credential',inputSecret='controlled-private-input-secret';
  const script="let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',part=>input+=part);process.stdin.on('end',()=>{const secret=JSON.parse(input).credential;for(const stream of [process.stdout,process.stderr])stream.write('synthetic failure '+process.env.PROBE_CREDENTIAL+' '+secret+' postgresql://private:password@private-host/db Bearer opaque-private-value\\n');process.stdout.write('# tests 1\\n# fail 1\\n');process.exitCode=1});";
  await assert.rejects(ownedCommand(process.execPath,['-e',script],{...process.env,PROBE_CREDENTIAL:credential},JSON.stringify({credential:inputSecret}),{timeoutMs:1000,maxOutputBytes:1024}),error=>{
    assert.ok(error instanceof OwnedCommandError);assert.equal(error.reason,'exited');assert.equal(error.code,1);
    const stdout=Reflect.get(error,'stdout');assert.equal(typeof stdout,'string');assert.match(stdout,/# tests 1\n# fail 1/);
    for(const output of [stdout,error.stderr,error.message]){assert.match(output,/synthetic failure/);assert.match(output,/\[private\]/);for(const secret of [credential,inputSecret,'private-host','opaque-private-value'])assert.ok(!output.includes(secret));}
    assert.ok(Buffer.byteLength(stdout)<=1024);assert.ok(Buffer.byteLength(error.stderr)<=1024);return true;
  });
});

test('suite runner prints a real failing test footer and exits nonzero without leaking child credentials',{timeout:5000},async()=>{
  const directory=await mkdtemp(join(tmpdir(),'skynet-suite-output-')),failing=join(directory,'synthetic-failure.test.mjs'),wrapper=join(directory,'wrapper.mjs');
  const secret='controlled-runner-private-credential';
  await writeFile(failing,"import test from 'node:test';import assert from 'node:assert/strict';test('synthetic reporter failure',()=>assert.fail(process.env.PROBE_CREDENTIAL));");
  const runner=new URL('./run.ts',import.meta.url).href;
  // The outer observer does not know the inner secret, so it cannot mask a
  // missing runner redaction and turn a leak into a false positive.
  await writeFile(wrapper,`import{runTests}from${JSON.stringify(runner)};await runTests([${JSON.stringify(failing)}],{...process.env,PROBE_CREDENTIAL:${JSON.stringify(secret)}});`);
  // Standalone CI has no inherited nested-node:test context. Preserve that
  // entry condition rather than asking Node to run a suite inside its worker.
  const observerEnv={...process.env};delete observerEnv.NODE_TEST_CONTEXT;
  await assert.rejects(ownedCommand(process.execPath,['--import','tsx',wrapper],observerEnv,'',{timeoutMs:3000,maxOutputBytes:64*1024}),error=>{
    assert.ok(error instanceof OwnedCommandError);assert.equal(error.code,1);assert.equal(error.reason,'exited');
    assert.match(error.stdout,/synthetic reporter failure/,error.stderr);assert.match(error.stdout,/(?:#|ℹ) tests 1/);assert.match(error.stdout,/(?:#|ℹ) fail 1/);assert.match(error.stdout,/\[private\]/);
    assert.match(error.stderr,/Owned command exited \(1\)/);assert.ok(!error.stdout.includes(secret));assert.ok(!error.stderr.includes(secret));return true;
  });
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

test('startup observation strictly bounds either stream and force closes only its unresponsive child',{timeout:5000},async()=>{
  for(const stream of ['stdout','stderr']){const child=spawn(process.execPath,['-e',`process.on('SIGTERM',()=>{});process.${stream}.write('x'.repeat(4096));setInterval(()=>{},1000)`],{windowsHide:true,stdio:['ignore','pipe','pipe']});let closed=false;child.once('close',()=>{closed=true;});
    try{await assert.rejects(ownedReady(child,/ready (.+)/,{timeoutMs:1000,maxOutputBytes:512}),new RegExp(`${stream} limit`));assert.equal(closed,true,'rejection waits for the exact child to close');}finally{await stopOwnedChild(child,true);}}
  const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  try{await assert.rejects(ownedReady(child,/ready (.+)/,{timeoutMs:80,maxOutputBytes:512}),/deadline/);}finally{await stopOwnedChild(child,true);}
});

test('ready server streams keep draining without growing retained startup output or killing a healthy server',{timeout:5000},async()=>{
  const child=spawn(process.execPath,['-e',"process.stdout.write('ready http://127.0.0.1;');setTimeout(()=>{process.stdout.write('x'.repeat(5*1024*1024));process.stderr.write('y'.repeat(5*1024*1024));},50)"],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  const close=new Promise<number|null>(resolve=>child.once('close',resolve));
  try{assert.equal(await ownedReady(child,/ready ([^;]+)/,{timeoutMs:1000,maxOutputBytes:512}),'http://127.0.0.1');assert.equal(await close,0,'post-ready log size does not retain or kill the server');}finally{await stopOwnedChild(child,true);}
});

test('body failure stays first and every independent owned cleanup is attempted',{timeout:5000},async()=>{
  const body=new Error('primary synthetic assertion'),cleanup=new Error('owned synthetic cleanup');let second=false;
  await assert.rejects(cleanupOwned([async()=>{throw cleanup;},async()=>{second=true;}],body),error=>error instanceof AggregateError&&error.errors[0]===body&&error.errors[1]===cleanup&&error.cause===body);
  assert.equal(second,true);await cleanupOwned([async()=>undefined],body);
});
