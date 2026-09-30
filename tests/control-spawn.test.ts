import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { askRuntime, initializeControl } from '../apps/collector/runtime-control.js';

async function until<T>(read: () => Promise<T | null | false>, message: string, limit = 15_000): Promise<T> {
  const started = Date.now();
  while (Date.now() - started < limit) { const value = await read(); if (value) return value; await setTimeout(10); }
  throw new Error(message);
}
async function text(path: string) { return readFile(path, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; }); }
async function fixture(mode: 'block' | 'crash') {
  const state = await mkdtemp(join(tmpdir(), 'skynet-control-spawn-'));
  await initializeControl(state);
  const controlBefore = await readFile(join(state, 'runtime-control.json'));
  const root = resolve('.'); const cli = join(root, 'dist', 'apps', 'collector', 'cli.js');
  await writeFile(join(state, 'installation.json'), JSON.stringify({ version: 1, deploymentId: 'synthetic-control-only',
    node: process.execPath, launcher: cli, runtime: root, installedAt: new Date().toISOString(), clients: [], configurations: [] }));
  // Trusted, isolated test preload patches the actual child_process.spawn call.
  // No production environment switch or worker-entry injection is introduced.
  const trace = join(state, 'spawn-events.jsonl'); const shim = join(state, 'spawn-shim.cjs');
  await writeFile(shim, `const cp=require('node:child_process'),fs=require('node:fs'),threads=require('node:worker_threads');
const original=cp.spawn; let calls=0; const record=row=>fs.appendFileSync(${JSON.stringify(trace)},JSON.stringify({wall:Date.now(),threadId:threads.threadId,...row})+'\\n');
cp.spawn=function(file,args,options){if(!Array.isArray(args)||!args.includes('background-worker'))return original.call(this,file,args,options);
calls=fs.existsSync(${JSON.stringify(trace)})?fs.readFileSync(${JSON.stringify(trace)},'utf8').split('\\n').filter(row=>row.includes('spawn-enter')).length+1:1;record({event:'spawn-enter',call:calls});
${mode === 'block' ? "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,2200);" : "if(calls===1)args=['--eval',\"process.stderr.write('synthetic worker crash');process.exit(17)\"]"}
const child=original.call(this,file,args,options);record({event:'spawn-return',call:calls});child.once('exit',(code)=>record({event:'owned-child-exit',call:calls,code}));return child;};
require('node:module').syncBuiltinESMExports();`);
  const env: NodeJS.ProcessEnv = { ...Object.fromEntries(['SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'PATH'].map(key => [key, process.env[key]])),
    HOME: state, USERPROFILE: state, LOCALAPPDATA: join(state, 'local'), APPDATA: join(state, 'roaming'),
    CODEX_HOME: join(state, 'codex'), CLAUDE_CONFIG_DIR: join(state, 'claude'), NODE_OPTIONS: `--require ${JSON.stringify(shim)}` };
  const child = spawn(process.execPath, [cli, 'background', '--state', state], { env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let diagnostic = ''; child.stderr.on('data', value => { diagnostic = (diagnostic + value).slice(-2048); });
  const exited = new Promise<number | null>((resolveExit, reject) => { child.once('exit', resolveExit); child.once('error', reject); });
  return { state, trace, child, exited, controlBefore, diagnostic: () => diagnostic };
}
async function cleanup(f: { state: string; child: ChildProcess; exited: Promise<number | null> }) {
  try { if (f.child.exitCode === null) await askRuntime(f.state, 'supervisor', 'stop'); }
  finally {
    if (f.child.exitCode === null) {
      // Timeout cleanup refers only to the exact ChildProcess started above.
      const timer = globalThis.setTimeout(() => f.child.kill(), 15_000);
      try { await f.exited; } finally { clearTimeout(timer); }
    }
  }
}

test('authenticated status and stop respond while worker spawn synchronously blocks', { timeout: 20_000 }, async () => {
  const f = await fixture('block');
  console.log(JSON.stringify({ fixture: f.state, synchronousSpawnMs: 2200 }));
  try {
    await until(async () => (await text(f.trace)).includes('spawn-enter'), 'Actual worker spawn did not enter');
    const statusStarted = performance.now();
    const status = await askRuntime(f.state, 'supervisor');
    const statusMs = performance.now() - statusStarted;
    assert.equal(status.state, 'running');
    assert.ok(!(await text(f.trace)).includes('spawn-return'), 'status must respond during synchronous spawn, not after it');
    const stopStarted = performance.now(); const stop = await askRuntime(f.state, 'supervisor', 'stop');
    const stopMs = performance.now() - stopStarted;
    assert.equal(stop.instance, status.instance);
    assert.ok(!(await text(f.trace)).includes('spawn-return'), 'stop must respond before worker exists');
    assert.equal(await f.exited, 0, f.diagnostic());
    await until(async () => (await text(f.trace)).includes('owned-child-exit'), 'Owned pending-stop child was not reaped');
    assert.equal(await askRuntime(f.state, 'supervisor'), null); assert.equal(await askRuntime(f.state, 'worker'), null);
    assert.deepEqual(await readFile(join(f.state, 'runtime-control.json')), f.controlBefore);
    const rows = (await text(f.trace)).trim().split('\n').map(row => JSON.parse(row));
    assert.equal(rows.filter(row => row.event === 'spawn-enter').length, 1, 'abort before spawn completion must not restart');
    assert.ok(rows.find(row => row.event === 'spawn-enter').threadId > 0, 'actual spawn block belongs to a worker thread');
    const evidence = { fixture: f.state, synchronousSpawnMs: 2200, acknowledgedBeforeSpawnReturned: true,
      statusMs, stopMs, actualOwnedChildExitCode: rows.at(-1).code, controlRegistrationRetained: true };
    await writeFile(join(f.state, 'control-spawn-evidence.json'), JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(evidence));
  } finally { await cleanup(f); }
});

test('a worker crash restarts the actual selected payload and normal stop reaps the owned child', { timeout: 20_000 }, async () => {
  const f = await fixture('crash');
  try {
    const status = await until(async () => { const value = await askRuntime(f.state, 'supervisor'); return value?.worker ? value : null; }, 'Worker did not restart');
    assert.equal(status.restarts, 1); assert.equal(status.lastExit.code, 17);
    const worker = await askRuntime(f.state, 'worker'); assert.equal(worker.supervisorInstance, status.instance);
    await askRuntime(f.state, 'supervisor', 'stop'); assert.equal(await f.exited, 0, f.diagnostic());
    const rows = (await text(f.trace)).trim().split('\n').map(row => JSON.parse(row));
    assert.equal(rows.filter(row => row.event === 'owned-child-exit').length, 2);
    assert.equal(rows.at(-1).code, 0); assert.equal(await askRuntime(f.state, 'supervisor'), null); assert.equal(await askRuntime(f.state, 'worker'), null);
    console.log(JSON.stringify({ fixture: f.state, crashedExitCode: 17, restartedSelectedPayload: true,
      actualOwnedChildExits: 2, normalExitCode: rows.at(-1).code }));
  } finally { await cleanup(f); }
});
