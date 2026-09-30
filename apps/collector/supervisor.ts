import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { askRuntime, ownRuntime, releaseRuntime } from './runtime-control.js';
import { installationSchema, jsonFile } from './install-state.js';
import { launchCurrentSession, markAutostartDelayed, startAutostart } from './autostart.js';
import { atomicJson } from '../../packages/filesystem.js';
import { payloadRoot } from './release.js';
import { assertCaptureFences } from './capture-fence.js';
import { startWorkerProcess, type OwnedWorkerProcess, type WorkerExit, type WorkerReady } from './worker-process.js';

export async function runGuardian(state: string) {
  const installation = installationSchema.parse(await jsonFile(join(state, 'installation.json')));
  if (resolve(payloadRoot) !== resolve(installation.maintenanceRuntime ?? installation.runtime)) throw new Error('This guardian is no longer the registered maintenance release; use the stable launcher');
  await assertCaptureRuntime(state, installation);
  let delay = 500;
  for (;;) {
    const started = Date.now();
    const child = spawn(installation.node, [installation.launcher, 'background', '--state', state],
      { windowsHide: true, stdio: 'ignore', env: { ...process.env, SKYNET_KEY: undefined } });
    const code = await new Promise<number | null>(resolve => {
      child.once('error', () => resolve(null)); child.once('exit', resolve);
    });
    // Duplicate authenticated owner and normal stop both return zero. Failure
    // restarts our real child, never a PID recovered from a diagnostic file.
    if (code === 0) return;
    if (Date.now() - started >= 30_000) delay = 500;
    await setTimeout(delay); delay = Math.min(30_000, delay * 2);
  }
}

export async function runSupervisor(state: string) {
  const installation = installationSchema.parse(await jsonFile(join(state, 'installation.json')));
  if (resolve(payloadRoot) !== resolve(installation.maintenanceRuntime ?? installation.runtime)) throw new Error('This supervisor is no longer the registered maintenance release; use the stable launcher');
  await assertCaptureRuntime(state, installation);
  const instance = randomUUID(); const startedAt = new Date().toISOString();
  let child: OwnedWorkerProcess | undefined; let worker: (WorkerReady & { startedAt: string }) | null = null;
  let restarts = 0; let failures = 0; let lastExit: WorkerExit | null = null;
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
    await child?.stop();
    if ((await child?.result)?.fault === 'launch-thread') await releaseFaultedWorker(state, instance);
  };
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
      child = startWorkerProcess({ node: installation.node,
        cli: join(installation.runtime, 'dist', 'apps', 'collector', 'cli.js'), state, supervisorInstance: instance }, ready => {
        worker = { ...ready, startedAt: new Date().toISOString() };
      });
      const abort = () => { void child?.stop(); }; stop.signal.addEventListener('abort', abort, { once: true });
      lastExit = await child.result;
      if (lastExit.fault === 'launch-thread') {
        await atomicJson(join(state, 'supervisor.json'), snapshot());
        await finishChild();
      }
      worker = null; stop.signal.removeEventListener('abort', abort);
      await atomicJson(join(state, 'supervisor.json'), snapshot());
      if (!stop.signal.aborted) {
        restarts++; failures = Date.now() - launchedAt > 30_000 ? 0 : failures + 1;
        await setTimeout(Math.min(30_000, 500 * 2 ** Math.min(failures, 6)), undefined, { signal: stop.signal }).catch(() => undefined);
      }
    }
  } finally { try { await finishChild(); } finally { await releaseRuntime(lease); } }
}
async function releaseFaultedWorker(state: string, instance: string) {
  const check = async () => {
    const current = await askRuntime(state, 'worker');
    if (current && current.supervisorInstance !== instance) throw new Error('Authenticated worker belongs to a different supervisor; its lease and state retained');
    return current;
  };
  if (await check()) await askRuntime(state, 'worker', 'stop');
  // Thread failure can disconnect a real worker before its async drain has
  // released the OS lease. Never substitute thread exit or a recorded PID for
  // authenticated endpoint absence, and never start a competing replacement.
  while (await check()) await setTimeout(200);
}
export async function ensureRunning(state: string, node: string, launcher: string) {
  const installation = installationSchema.parse(await jsonFile(join(state, 'installation.json')));
  await assertCaptureRuntime(state, installation); const expected = installation.runtime;
  let current = await askRuntime(state, 'supervisor');
  let scheduled = false;
  if (!current) {
    scheduled = await startAutostart(state);
    if (!scheduled) await launchCurrentSession(state, installation);
  }
  for (let attempt = 0; attempt < 160; attempt++) {
    current = await askRuntime(state, 'supervisor');
    const worker = await askRuntime(state, 'worker');
    if (current?.worker && worker?.supervisorInstance === current.instance && worker.instance === current.worker.instance && worker.state === 'running') {
      if (current.runtime && resolve(current.runtime) !== resolve(expected)) throw new Error('An authenticated previous release is still running; stop it before activating a newer runtime');
      return current;
    }
    if (attempt === 60 && scheduled && !current) { await markAutostartDelayed(state); await launchCurrentSession(state, installation); }
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
