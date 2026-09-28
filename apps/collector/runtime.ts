import { open, readdir, realpath, unlink, mkdir } from 'node:fs/promises';
import { join, relative, isAbsolute, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { collectOnce } from './local.js';
import { atomicJson } from '../../packages/filesystem.js';
import { hostEventSchema } from '../../packages/contracts/archive.js';
import { identitySchema, installationSchema, jsonFile, optionalJson } from './install-state.js';
import { askRuntime, ownRuntime, releaseRuntime } from './runtime-control.js';
import { autostartStatus } from './autostart.js';
export { ensureRunning } from './supervisor.js';

async function routeCodex(state: string, installation: ReturnType<typeof installationSchema.parse>) {
  const spool = join(state, 'inbox', 'codex', 'spool'); await mkdir(spool, { recursive: true, mode: 0o700 });
  const errors: string[] = [];
  for (const file of await readdir(spool)) {
    if (!file.endsWith('.json')) continue;
    try {
      const queued = await jsonFile(join(spool, file)); const event = hostEventSchema.parse(queued.event);
      const root = installation.clients.find(client => client.source === 'codex-cli')!.nativeRoot;
      const actual = await realpath(event.transcript_path); const remainder = relative(await realpath(root), actual);
      if (!remainder || remainder === '..' || remainder.startsWith(`..${sep}`) || isAbsolute(remainder) || !actual.endsWith('.jsonl')) throw new Error('Codex activity points outside its native root');
      // Only inspect a bounded metadata prefix after resolving the trusted root.
      const handle = await open(actual, 'r'); const buffer = Buffer.alloc(1024 * 1024); let count: number;
      try { count = (await handle.read(buffer, 0, buffer.length, 0)).bytesRead; } finally { await handle.close(); }
      const end = buffer.indexOf(10, 0); if (end < 0 || end >= count!) throw new Error('Native metadata is incomplete or exceeds the routing limit');
      const metadata = JSON.parse(buffer.subarray(0, end).toString('utf8'));
      if (metadata.type !== 'session_meta' || metadata.payload?.id !== event.session_id) throw new Error('Native session identity mismatch');
      // These values were measured in the real installed CLI. Do not classify
      // every other app-server origin as Desktop: that would misattribute IDEs.
      const source = (metadata.payload.source === 'exec' && metadata.payload.originator === 'codex_exec')
        || (metadata.payload.source === 'cli' && metadata.payload.originator === 'codex-tui') ? 'codex-cli' : null;
      if (!source) throw new Error('Codex origin is not yet verified; activity is queued without guessing CLI or Desktop');
      if (!installation.clients.some(client => client.source === source && client.configured)) throw new Error('The observed Codex source has not been configured');
      const destination = join(state, 'sources', source, 'spool', file);
      await atomicJson(destination, queued); await unlink(join(spool, file));
    } catch (error) { errors.push((error as Error).message); }
  }
  return errors;
}
export async function runInstalled(state: string) {
  if (!process.send || !process.connected) throw new Error('Installed workers must be started by the owning supervisor; use skynet start');
  const supervisorInstance = await new Promise<string>((resolve, reject) => {
    const timer = globalThis.setTimeout(() => reject(new Error('Supervisor handshake timed out')), 5000);
    process.once('message', message => {
      clearTimeout(timer);
      if (typeof message === 'object' && message !== null && (message as any).type === 'start' && typeof (message as any).supervisorInstance === 'string') resolve((message as any).supervisorInstance);
      else reject(new Error('Invalid supervisor handshake'));
    });
    process.send!({ type: 'initializing' });
  });
  const lockPath = join(state, 'runtime.lock');
  const instance = randomUUID(); const startedAt = new Date().toISOString();
  const stop = new AbortController(); process.once('SIGINT', () => stop.abort()); process.once('SIGTERM', () => stop.abort());
  process.once('disconnect', () => stop.abort());
  process.on('message', message => { if (typeof message === 'object' && message !== null && (message as any).type === 'stop') stop.abort(); });
  const lease = await ownRuntime(state, 'worker', () => ({ pid: process.pid, instance, supervisorInstance, startedAt, state: stop.signal.aborted ? 'stopping' : 'running' }), () => stop.abort());
  const legacy = await optionalJson(lockPath);
  if (legacy && legacy.version !== 2) {
    try { process.kill(legacy.pid, 0); throw new Error('Legacy worker may still be active; stop it using its original installation before migrating'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') { await releaseRuntime(lease); throw error; } }
  }
  await atomicJson(lockPath, { version: 2, pid: process.pid, instance, supervisorInstance });
  await atomicJson(join(state, 'runtime.json'), { pid: process.pid, instance, startedAt, checkedAt: null, errors: [] });
  process.send({ type: 'ready', instance });
  const previousHealth = await optionalJson(join(state, 'health.json'));
  let nextHealth = Date.parse(previousHealth?.nextAttemptAt ?? '') || 0;
  let healthAttempts = previousHealth?.attempts ?? 0;
  try {
    do {
      const errors: string[] = [];
      try {
        const installation = installationSchema.parse(await jsonFile(join(state, 'installation.json')));
        errors.push(...await routeCodex(state, installation));
        for (const client of installation.clients.filter(item => item.configured)) {
          try { await collectOnce(join(state, 'sources', client.source)); } catch { errors.push(`Collector unavailable: ${client.source}; state retained`); }
        }
        const request = await optionalJson(join(state, 'health-request.json'));
        if (request || Date.now() >= nextHealth) {
          const identity = identitySchema.parse(await jsonFile(join(state, 'identity.json')));
          const nonce = typeof request?.nonce === 'string' ? request.nonce : randomUUID();
          try {
            const response = await fetch(new URL('/api/devices/health', identity.server), { method: 'POST', redirect: 'error',
              headers: { Authorization: `Bearer ${identity.deviceCredential}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ nonce }), signal: AbortSignal.timeout(5000) });
            if (!response.ok) throw new Error(`Server rejected device health (${response.status})`);
            const ack = await response.json();
            if (ack.nonce !== nonce || ack.deviceId !== identity.deviceId) throw new Error('Unexpected health acknowledgement');
            healthAttempts = 0; nextHealth = Date.now() + 10_000;
            await atomicJson(join(state, 'health.json'), { nonce, deviceId: identity.deviceId, checkedAt: new Date().toISOString(), state: 'connected', attempts: healthAttempts, nextAttemptAt: new Date(nextHealth).toISOString() });
          } catch (error) {
            healthAttempts++; nextHealth = Date.now() + Math.min(300_000, 60_000 * 2 ** Math.min(healthAttempts - 1, 8));
            await atomicJson(join(state, 'health.json'), { nonce, checkedAt: new Date().toISOString(), state: 'unavailable', error: (error as Error).message,
              attempts: healthAttempts, nextAttemptAt: new Date(nextHealth).toISOString() });
          }
          if (request) await unlink(join(state, 'health-request.json')).catch(() => undefined);
        }
      } catch { errors.push('Background configuration could not be read; retained local state needs inspection'); }
      await atomicJson(join(state, 'runtime.json'), { pid: process.pid, instance, checkedAt: new Date().toISOString(), errors });
      if (!stop.signal.aborted) await setTimeout(1000, undefined, { signal: stop.signal }).catch(() => undefined);
    } while (!stop.signal.aborted);
  } finally { await unlink(lockPath).catch(() => undefined); await releaseRuntime(lease); if (process.connected) process.disconnect(); }
}
export async function installedStatus(state: string) {
  const installation = installationSchema.parse(await jsonFile(join(state, 'installation.json')));
  const identity = identitySchema.parse(await jsonFile(join(state, 'identity.json')));
  const runtime = await optionalJson(join(state, 'runtime.json')); const server = await optionalJson(join(state, 'health.json'));
  let supervisor: any = null; let worker: any = null; let controlError: string | null = null;
  try { supervisor = await askRuntime(state, 'supervisor'); worker = await askRuntime(state, 'worker'); }
  catch (error) { controlError = (error as Error).message; }
  const clients = [];
  for (const client of installation.clients) {
    const sourceState = join(state, 'sources', client.source);
    const tracked = await optionalJson(join(sourceState, 'tracked.json')) ?? [];
    const capture = await optionalJson(join(sourceState, 'status.json'));
    const gap = await optionalJson(join(sourceState, 'hook-gap.json'));
    const queued = await readdir(join(sourceState, 'spool')).catch(() => []);
    clients.push({ ...client, trust: !client.configured ? 'not-configured' : tracked.length ? 'host-event-observed; all-hook-trust-not-asserted' : 'pending-host-confirmation',
      firstEvent: tracked.length ? tracked.map((item: any) => item.qualifiedAt).sort()[0] : null,
      confirmedUploads: tracked.filter((item: any) => item.acknowledgedSnapshotId).length, queuedEvents: queued.filter(file => file.endsWith('.json')).length, capture, gap });
  }
  return { installed: true, deviceId: identity.deviceId, deploymentId: installation.deploymentId, stateDirectory: state,
    background: supervisor?.worker?.instance === worker?.instance && worker?.supervisorInstance === supervisor?.instance && worker?.state === 'running' ? 'running' : 'unavailable', runtime,
    supervisor, worker, controlError, lastSweepCompletedAt: runtime?.checkedAt ?? null,
    autostart: await autostartStatus(state), server: server && { ...server, fresh: Date.now() - Date.parse(server.checkedAt) < 20_000 }, clients,
    codexUnclassifiedEvents: (await readdir(join(state, 'inbox', 'codex', 'spool')).catch(() => [])).filter(file => file.endsWith('.json')).length,
    notice: '配置、宿主信任、首次事件、服务器连接及原件确认分别验证。Desktop 与完整安装门槛尚未通过。' };
}
