import { readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { collectOnce } from './local.js';
import { atomicJson } from '../../packages/filesystem.js';
import { identitySchema, installationSchema, jsonFile, optionalJson } from './install-state.js';
import { askRuntime, ownRuntime, releaseRuntime } from './runtime-control.js';
import { autostartStatus } from './autostart.js';
import { CaptureMonitor } from './capture-health.js';
import { reportDeliveryHealth } from './health.js';
import { registeredEntries } from './entries.js';
import { payloadRoot } from './release.js';
import { codexRouting } from './codex-routing.js';
export { ensureRunning } from './supervisor.js';

export async function runInstalled(state: string) {
  if (!process.send || !process.connected) throw new Error('Installed workers must be started by the owning supervisor; use skynet start');
  const active = installationSchema.parse(await jsonFile(join(state, 'installation.json')));
  if (active.runtime !== payloadRoot) throw new Error('This worker payload is no longer the active release; use the registered stable launcher');
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
  const lease = await ownRuntime(state, 'worker', () => ({ pid: process.pid, instance, runtime: payloadRoot, supervisorInstance, startedAt, state: stop.signal.aborted ? 'stopping' : 'running' }), () => stop.abort());
  const legacy = await optionalJson(lockPath);
  if (legacy && legacy.version !== 2) {
    try { process.kill(legacy.pid, 0); throw new Error('Legacy worker may still be active; stop it using its original installation before migrating'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') { await releaseRuntime(lease); throw error; } }
  }
  await atomicJson(lockPath, { version: 2, pid: process.pid, instance, supervisorInstance });
  await atomicJson(join(state, 'runtime.json'), { pid: process.pid, instance, startedAt, checkedAt: null,
    errors: [], errorsScope: 'last-sweep', codexRouting: null });
  process.send({ type: 'ready', instance });
  const previousHealth = await optionalJson(join(state, 'health.json'));
  let nextHealth = Date.parse(previousHealth?.nextAttemptAt ?? '') || 0;
  let healthAttempts = previousHealth?.attempts ?? 0;
  const routeCodex = codexRouting(state);
  try {
    do {
      const errors: string[] = [];
      let routing: Awaited<ReturnType<typeof routeCodex>> = null;
      try {
        const installation = installationSchema.parse(await jsonFile(join(state, 'installation.json')));
        try { routing = await routeCodex(installation); errors.push(...routing?.errors ?? []); } catch { errors.push('Codex routing unavailable; queued events retained'); }
        for (const client of installation.clients) {
          const sourceState = join(state, 'sources', client.source);
          try {
            if (!await optionalJson(join(sourceState, 'settings.json'))) continue;
            await collectOnce(sourceState, { capture: client.configured });
          } catch (error) {
            errors.push(`Collector unavailable: ${client.source}; state retained`);
            // A source settings ACL may fail while the shared private identity is
            // still readable. Report that scope without reading any source bytes.
            try {
              const monitor = await CaptureMonitor.open(sourceState); monitor.fail(error);
              const identity = identitySchema.parse(await jsonFile(join(state, 'identity.json')));
              await reportDeliveryHealth(sourceState, { ...identity, source: client.source }, undefined, await monitor.save());
            } catch { /* No readable identity/network: existing server status expires honestly. */ }
          }
        }
        const request = await optionalJson(join(state, 'health-request.json'));
        if (request || Date.now() >= nextHealth) {
          const identity = identitySchema.parse(await jsonFile(join(state, 'identity.json')));
          const nonce = typeof request?.nonce === 'string' ? request.nonce : randomUUID();
          try {
            const clients = await Promise.all(installation.clients.map(async client => {
              const tracked = await optionalJson(join(state, 'sources', client.source, 'tracked.json'));
              return { source: client.source, configured: client.configured, hostEvent: Array.isArray(tracked) && tracked.length ? 'observed' : 'not-observed' };
            }));
            const response = await fetch(new URL('/api/devices/health', identity.server), { method: 'POST', redirect: 'error',
              headers: { Authorization: `Bearer ${identity.deviceCredential}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ nonce, installation: { clients } }), signal: AbortSignal.timeout(5000) });
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
      await atomicJson(join(state, 'runtime.json'), { pid: process.pid, instance, checkedAt: new Date().toISOString(),
        errors, errorsScope: 'last-sweep', codexRouting: routing?.status ?? null }).catch(() => undefined);
      if (!stop.signal.aborted) await setTimeout(1000, undefined, { signal: stop.signal }).catch(() => undefined);
    } while (!stop.signal.aborted);
  } finally { await unlink(lockPath).catch(() => undefined); await releaseRuntime(lease); if (process.connected) process.disconnect(); }
}
export async function installedStatus(state: string) {
  const value = await optionalJson(join(state, 'installation.json'));
  if (!value) return { installed: false, stateDirectory: state, background: 'not-configured',
    notice: '尚未绑定。插件与 npm 接入均需要 Node 24；在本地终端设置个人 SKYNET_KEY 后运行随包 setup，并完成宿主正常信任。' };
  const installation = installationSchema.parse(value);
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
    const coverage = await optionalJson(join(sourceState, 'capture-health.json'));
    const queued = await readdir(join(sourceState, 'spool')).catch(() => []);
    clients.push({ ...client, trust: !client.configured ? 'not-configured' : tracked.length ? 'host-event-observed; all-hook-trust-not-asserted' : 'pending-host-confirmation',
      firstEvent: tracked.length ? tracked.map((item: any) => item.qualifiedAt).sort()[0] : null,
      confirmedUploads: tracked.filter((item: any) => item.acknowledgedSnapshotId).length, queuedEvents: queued.filter(file => file.endsWith('.json')).length, capture, gap, coverage });
  }
  return { installed: true, deviceId: identity.deviceId, deploymentId: installation.deploymentId, stateDirectory: state,
    launcher: installation.launcher,
    lifecycle: installation.lifecycle ?? 'active', runtimeVersion: (await jsonFile(join(installation.runtime, 'package.json'))).version,
    upgrade: await optionalJson(join(state, 'upgrade.json')).then(value => value ? { phase: value.phase, updatedAt: value.updatedAt } : null),
    entries: registeredEntries(installation),
    background: supervisor?.worker?.instance === worker?.instance && worker?.supervisorInstance === supervisor?.instance && worker?.state === 'running' ? 'running' : 'unavailable', runtime,
    supervisor, worker, controlError, lastSweepCompletedAt: runtime?.checkedAt ?? null,
    autostart: await autostartStatus(state), server: server && { ...server, fresh: Date.now() - Date.parse(server.checkedAt) < 20_000 }, clients,
    codexUnclassifiedEvents: (await readdir(join(state, 'inbox', 'codex', 'spool')).catch(() => [])).filter(file => file.endsWith('.json')).length,
    notice: '配置、宿主信任、首次事件、服务器连接及原件确认分别验证。Desktop 与完整安装门槛尚未通过。' };
}
