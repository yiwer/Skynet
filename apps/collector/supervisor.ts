import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { askRuntime, ownRuntime, releaseRuntime } from './runtime-control.js';
import { installationSchema, jsonFile } from './install-state.js';
import { markAutostartDelayed, startAutostart } from './autostart.js';
import { atomicJson } from '../../packages/filesystem.js';
import { payloadRoot } from './release.js';
import { assertCaptureFences } from './capture-fence.js';

export async function runSupervisor(state: string) {
  const installation = installationSchema.parse(await jsonFile(join(state, 'installation.json')));
  if (resolve(payloadRoot) !== resolve(installation.maintenanceRuntime ?? installation.runtime)) throw new Error('This supervisor is no longer the registered maintenance release; use the stable launcher');
  await assertCaptureRuntime(state, installation);
  const instance = randomUUID(); const startedAt = new Date().toISOString();
  let child: ChildProcess | undefined; let worker: any = null; let restarts = 0; let failures = 0; let lastExit: unknown = null;
  const stop = new AbortController();
  const snapshot = () => ({ pid: process.pid, instance, runtime: installation.runtime, toolingRuntime: payloadRoot, startedAt, checkedAt: new Date().toISOString(), worker, restarts, lastExit, state: stop.signal.aborted ? 'stopping' : 'running' });
  let lease;
  try { lease = await ownRuntime(state, 'supervisor', snapshot, () => stop.abort()); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE' && await askRuntime(state, 'supervisor')) return;
    throw error;
  }
  process.once('SIGINT', () => stop.abort()); process.once('SIGTERM', () => stop.abort());
  const finishChild = async () => {
    if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
    if (child.connected) child.send({ type: 'stop' });
    // This is our still-owned ChildProcess, never a PID recovered from a file.
    const current = child;
    const exited = new Promise<void>(resolve => current.once('exit', () => resolve()));
    const timer = globalThis.setTimeout(() => current.kill(), 10_000);
    try { await exited; } finally { clearTimeout(timer); }
  };
  stop.signal.addEventListener('abort', () => { if (child?.connected) child.send({ type: 'stop' }); }, { once: true });
  try {
    // A previous supervisor may have died while its worker finishes a durable
    // operation. Ask that authenticated worker to stop, then wait for its lease.
    const orphan = await askRuntime(state, 'worker');
    if (orphan) await askRuntime(state, 'worker', 'stop');
    while (!stop.signal.aborted && await askRuntime(state, 'worker')) await setTimeout(200);
    while (!stop.signal.aborted) {
      const launchedAt = Date.now();
      // The current maintenance supervisor enforces capture fences, then runs
      // the selected actual worker payload. A rollback genuinely executes the
      // earlier worker; stable background entrypoints cannot bypass the fence.
      child = spawn(installation.node, [join(installation.runtime, 'dist', 'apps', 'collector', 'cli.js'), 'background-worker', '--state', state], {
        windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'], env: { ...process.env, SKYNET_KEY: undefined } });
      const current = child;
      let diagnostic = ''; current.stderr?.on('data', part => { diagnostic = (diagnostic + part).slice(-4096); });
      const result = new Promise<{ code: number | null; signal: string | null; error?: string }>(resolve => {
        current.once('error', () => resolve({ code: null, signal: null, error: 'Worker process could not be started; verify the registered Node/runtime paths' }));
        current.once('exit', (code, signal) => resolve({ code, signal, ...(code ? { error: diagnostic } : {}) }));
      });
      current.on('message', message => {
        if (typeof message === 'object' && message !== null && (message as any).type === 'initializing') current.send({ type: 'start', supervisorInstance: instance });
        if (typeof message === 'object' && message !== null && (message as any).type === 'ready') {
          worker = { pid: current.pid, instance: (message as any).instance, startedAt: new Date().toISOString() };
        }
      });
      current.on('error', () => undefined);
      const abort = () => { void finishChild(); }; stop.signal.addEventListener('abort', abort, { once: true });
      lastExit = await result; worker = null; stop.signal.removeEventListener('abort', abort);
      await atomicJson(join(state, 'supervisor.json'), snapshot());
      if (!stop.signal.aborted) {
        restarts++; failures = Date.now() - launchedAt > 30_000 ? 0 : failures + 1;
        await setTimeout(Math.min(30_000, 500 * 2 ** Math.min(failures, 6)), undefined, { signal: stop.signal }).catch(() => undefined);
      }
    }
  } finally { await finishChild(); await releaseRuntime(lease); }
}
export async function ensureRunning(state: string, node: string, launcher: string) {
  const installation = installationSchema.parse(await jsonFile(join(state, 'installation.json')));
  await assertCaptureRuntime(state, installation); const expected = installation.runtime;
  let current = await askRuntime(state, 'supervisor');
  let scheduled = false;
  const launch = () => {
    const child = spawn(node, [launcher, 'background', '--state', state], { detached: true, windowsHide: true, stdio: 'ignore', env: { ...process.env, SKYNET_KEY: undefined } });
    child.on('error', () => undefined); child.unref();
  };
  if (!current) {
    scheduled = await startAutostart(state);
    if (!scheduled) launch();
  }
  for (let attempt = 0; attempt < 160; attempt++) {
    current = await askRuntime(state, 'supervisor');
    const worker = await askRuntime(state, 'worker');
    if (current?.worker && worker?.supervisorInstance === current.instance && worker.instance === current.worker.instance && worker.state === 'running') {
      if (current.runtime && resolve(current.runtime) !== resolve(expected)) throw new Error('An authenticated previous release is still running; stop it before activating a newer runtime');
      return current;
    }
    if (attempt === 60 && scheduled && !current) { await markAutostartDelayed(state); launch(); }
    await setTimeout(100);
  }
  throw new Error('Background ownership could not be established. State and pending evidence were retained; inspect skynet status, Node/runtime paths and user task policy.');
}
async function assertCaptureRuntime(state: string, installation: ReturnType<typeof installationSchema.parse>) {
  if (installation.lifecycle === 'uninstalled') throw new Error('Capture is uninstalled; use current maintenance drain for frozen delivery, or explicitly setup to reconnect');
  await assertCaptureFences(state, installation);
}
export async function stopRuntime(state: string) {
  const current = await askRuntime(state, 'supervisor', 'stop');
  if (!current) await askRuntime(state, 'worker', 'stop');
  for (let attempt = 0; attempt < 200; attempt++) {
    if (!await askRuntime(state, 'supervisor') && !await askRuntime(state, 'worker')) return { background: 'stopped', pendingEvidence: 'retained', autostart: 'unchanged; runs at next login' };
    await setTimeout(100);
  }
  throw new Error('Owned worker is still stopping; no unrelated process was terminated and its writer lease remains held');
}
