import { readFile, readdir } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { atomicJson, atomicText } from '../../packages/filesystem.js';
import { installationSchema, jsonFile, optionalJson, protectState, type Installation } from './install-state.js';
import { setupLock } from './enrollment.js';
import { applyConfiguration, planConfiguration } from './integrations.js';
import { compareVersions, packageEntrySchema, registeredEntries } from './entries.js';
import { deploymentSchema } from './installer.js';
import { checkRuntime, launcherText, payloadRoot, runtimeDigest, stageRuntime } from './release.js';
import { ownRuntime, releaseRuntime, repairControl } from './runtime-control.js';
import { ensureRunning } from './supervisor.js';
import { installAutostart, removeAutostart } from './autostart.js';
import { installedStatus } from './runtime.js';
import { collectOnce } from './local.js';
import { assertCaptureFences } from './capture-fence.js';

const journalSchema = z.object({ previous: installationSchema, next: installationSchema,
  previousDigest: z.string().regex(/^[a-f0-9]{64}$/), nextDigest: z.string().regex(/^[a-f0-9]{64}$/),
  phase: z.enum(['prepared', 'switched', 'complete', 'rolled-back']), updatedAt: z.iso.datetime() }).strict();
type Journal = z.infer<typeof journalSchema>;
function ownedPaths(state: string, installation: Installation) {
  if (resolve(installation.launcher) !== join(resolve(state), 'skynet-launcher.mjs')) throw new Error('Stable launcher ownership mismatch; no files replaced');
  for (const path of [installation.runtime, ...(installation.maintenanceRuntime ? [installation.maintenanceRuntime] : [])]) {
    const within = relative(join(resolve(state), 'runtime'), resolve(path));
    if (!within || within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) throw new Error('Runtime ownership mismatch; no files replaced');
  }
}
async function writePointer(state: string, target: Installation, allowed: Installation[]) {
  ownedPaths(state, target);
  const before = await readFile(target.launcher, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (before !== null && !allowed.some(item => before === launcherText(item.runtime, item.maintenanceRuntime))) throw new Error('Stable launcher ownership conflict; changed file retained');
  await atomicText(target.launcher, launcherText(target.runtime, target.maintenanceRuntime));
  await atomicJson(join(state, 'installation.json'), target);
}
async function journal(state: string) {
  const value = await optionalJson(join(state, 'upgrade.json'));
  if (!value) return null;
  const result = journalSchema.parse(value); ownedPaths(state, result.previous); ownedPaths(state, result.next); return result;
}
async function saveJournal(state: string, value: Journal, phase: Journal['phase']) {
  value.phase = phase; value.updatedAt = new Date().toISOString(); await atomicJson(join(state, 'upgrade.json'), value);
}
async function restorePrevious(state: string, value: Journal) {
  const current = installationSchema.parse(await jsonFile(join(state, 'installation.json'))); ownedPaths(state, current);
  if (![value.previous.runtime, value.next.runtime].includes(current.runtime) || current.node !== value.previous.node || current.launcher !== value.previous.launcher)
    throw new Error('Upgrade journal does not own the current runtime registration; current entries, settings and evidence retained');
  // Roll back executable code only. Another entry may have been registered or
  // removed after a successful upgrade; its current capture fence and exact
  // config ownership must survive, rather than replaying an old installation.
  const target = installationSchema.parse({ ...current, runtime: value.previous.runtime, maintenanceRuntime: current.maintenanceRuntime ?? value.next.runtime });
  if (target.lifecycle !== 'uninstalled') await assertCaptureFences(state, target);
  if (await runtimeDigest(value.previous.runtime) !== value.previousDigest) throw new Error('Previous runtime payload changed; rollback retained evidence and needs operator inspection');
  await checkRuntime(target.runtime, target.node, target);
  await removeAutostart(state); await repairControl(state);
  await writePointer(state, target, [value.previous, value.next, current, target]);
  await saveJournal(state, value, 'rolled-back');
}
async function configurationPlan(path: string, entries: Record<string, unknown>, owned: Record<string, unknown>) {
  // Missing exact owned hooks can be restored. A changed hook still containing
  // our launcher is a conflict; never delete user edits or replay whole backups.
  const current = await optionalJson(path); const present: Record<string, unknown> = {};
  for (const [event, value] of Object.entries(owned)) {
    const hooks = current?.hooks?.[event] ?? [];
    if (!Array.isArray(hooks)) throw new Error('Host hook event has an unsupported shape');
    if (hooks.some(item => JSON.stringify(item) === JSON.stringify(value))) present[event] = value;
    else if (hooks.some(item => JSON.stringify(item).includes('skynet-launcher.mjs'))) throw new Error('Skynet hook ownership conflict; existing configuration retained');
  }
  return planConfiguration(path, entries, present);
}
async function repairUnlocked(state: string) {
  const pending = await journal(state);
  if (pending && ['prepared', 'switched'].includes(pending.phase)) await restorePrevious(state, pending);
  const installation = installationSchema.parse(await jsonFile(join(state, 'installation.json'))); ownedPaths(state, installation);
  if (installation.lifecycle !== 'uninstalled') await assertCaptureFences(state, installation);
  await checkRuntime(installation.runtime, installation.node, installation);
  const retained = installation.configurations.filter(configuration => installation.lifecycle !== 'uninstalled'
    && installation.clients.some(client => client.configPath === configuration.path && client.configured));
  const plans = await Promise.all(installation.configurations.map(configuration => configurationPlan(configuration.path,
    retained.includes(configuration) ? configuration.entries : {}, configuration.entries)));
  await removeAutostart(state); await repairControl(state);
  await writePointer(state, installation, [installation]);
  for (const plan of plans) await applyConfiguration(plan);
  await atomicJson(join(state, 'installation.json'), { ...installation, configurations: retained });
  const canRunDisabled = (await jsonFile(join(installation.runtime, 'package.json'))).captureFenceVersion === 1;
  if (installation.lifecycle !== 'uninstalled' && (installation.clients.some(client => client.configured) || canRunDisabled)) {
    await installAutostart(state, installation);
    await ensureRunning(state, installation.node, installation.launcher);
  }
  const status = await installedStatus(state);
  return installation.lifecycle !== 'uninstalled' && !installation.clients.some(client => client.configured) && !canRunDisabled
    ? { ...status, notice: '所有来源已停止。较旧 runtime 无法保证停用后的 Codex routing 边界；使用保留的维护 launcher drain 仅交付冻结材料，或显式升级。' } : status;
}
export async function maintain(state: string, action: 'repair' | 'upgrade' | 'rollback' | 'uninstall' | 'drain') {
  if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Collector maintenance requires Node 24');
  await protectState(state); const release = await setupLock(state);
  try {
    if (action === 'repair') return repairUnlocked(state);
    const installation = installationSchema.parse(await jsonFile(join(state, 'installation.json'))); ownedPaths(state, installation);
    const unfinished = await journal(state);
    if (['uninstall', 'drain'].includes(action) && unfinished && ['prepared', 'switched'].includes(unfinished.phase)) throw new Error('Interrupted upgrade exists; run repair before uninstall/drain');
    if (action === 'upgrade') {
      const pending = await journal(state);
      if (pending && ['prepared', 'switched'].includes(pending.phase)) throw new Error('Interrupted upgrade exists; run repair before trying another upgrade');
      const deployment = deploymentSchema.parse(await jsonFile(join(payloadRoot, 'deployment.json')));
      if (deployment.deploymentId !== installation.deploymentId) throw new Error('Upgrade package belongs to another deployment');
      const identity = await jsonFile(join(state, 'identity.json'));
      if (new URL(deployment.enrollmentOrigin).origin !== identity.server) throw new Error('Upgrade package belongs to another server');
      const manifest = await jsonFile(join(payloadRoot, 'package.json'));
      const entry = packageEntrySchema.parse(await optionalJson(join(payloadRoot, 'entry.json')) ?? { channel: 'npm', version: manifest.version });
      if (entry.version !== manifest.version) throw new Error('Upgrade entry does not match its payload');
      const version = (await jsonFile(join(installation.runtime, 'package.json'))).version;
      if (compareVersions(entry.version, version) <= 0) throw new Error('Upgrade requires a strictly newer release; use repair for the current version');
      const staged = await stageRuntime(state, entry.version);
      const next = installationSchema.parse({ ...installation, runtime: staged.runtime, maintenanceRuntime: staged.runtime,
        entries: registeredEntries(installation).map(item => item.channel === entry.channel ? { ...item, packageVersion: entry.version } : item) });
      await checkRuntime(next.runtime, next.node, next);
      const value: Journal = { previous: installation, next, previousDigest: await runtimeDigest(installation.runtime),
        nextDigest: staged.digest, phase: 'prepared', updatedAt: new Date().toISOString() };
      await saveJournal(state, value, 'prepared');
      try {
        await removeAutostart(state); await repairControl(state);
        await writePointer(state, next, [installation]); await saveJournal(state, value, 'switched');
        if (await runtimeDigest(next.runtime) !== value.nextDigest) throw new Error('Staged runtime changed before activation');
        if (next.lifecycle !== 'uninstalled') { await installAutostart(state, next); await ensureRunning(state, next.node, next.launcher); }
        await saveJournal(state, value, 'complete');
      } catch (error) {
        await restorePrevious(state, value);
        if (installation.lifecycle !== 'uninstalled') { await installAutostart(state, installation); await ensureRunning(state, installation.node, installation.launcher); }
        throw new Error(`Upgrade failed; previous runtime restored and evidence retained: ${(error as Error).message}`);
      }
      return installedStatus(state);
    }
    if (action === 'rollback') {
      const value = await journal(state); if (!value) throw new Error('No recorded upgrade to roll back');
      if (installation.lifecycle === 'uninstalled') throw new Error('Capture is uninstalled; rollback must not reactivate it');
      await restorePrevious(state, value); return repairUnlocked(state);
    }
    if (action === 'uninstall') {
      // Plan all host changes before stopping or changing the durable capture
      // fence. Retry can finish partially published config removals safely.
      const plans = await Promise.all(installation.configurations.map(configuration => configurationPlan(configuration.path, {}, configuration.entries)));
      await removeAutostart(state); await repairControl(state);
      const stopped = { ...installation, lifecycle: 'uninstalled' as const, entries: [],
        clients: installation.clients.map(client => ({ ...client, configured: false, notice: '已完整停用；未确认材料保留，显式 drain 仅交付冻结材料。' })) };
      await atomicJson(join(state, 'installation.json'), stopped);
      for (const plan of plans) await applyConfiguration(plan);
      await atomicJson(join(state, 'installation.json'), { ...stopped, configurations: [] });
      return { ...(await installedStatus(state)), notice: '自有 hooks 和登录任务已移除，采集后台已停止。服务器存档、私有设备身份、原件、未确认队列和稳定恢复工具保留；drain 仅补传冻结材料。npm/市场包请用原安装渠道移除；确认补传后再人工处理此私有目录。' };
    }
    if (installation.clients.some(client => client.configured)) throw new Error('drain requires all capture entries to be removed or the collector to be uninstalled');
    // Run the current verified delivery code under the same two OS leases. An
    // actual pre-#14 worker still routed Codex inbox bytes even when capture was
    // disabled; launching that worker after rollback would violate the fence.
    await removeAutostart(state); await repairControl(state);
    const instance = randomUUID(); const stop = new AbortController();
    const supervisor = await ownRuntime(state, 'supervisor', () => ({ pid: process.pid, instance, mode: 'frozen-drain', worker: { pid: process.pid, instance }, state: stop.signal.aborted ? 'stopping' : 'running' }), () => stop.abort());
    let worker;
    let completed = false;
    try {
      worker = await ownRuntime(state, 'worker', () => ({ pid: process.pid, instance, supervisorInstance: instance, mode: 'frozen-drain', state: stop.signal.aborted ? 'stopping' : 'running' }), () => stop.abort());
      for (const client of installation.clients) await atomicJson(join(state, 'sources', client.source, 'retry-request.json'), { requestedAt: new Date().toISOString() }).catch(error => { if (error.code !== 'ENOENT') throw error; });
      const deadline = Date.now() + 30_000;
      while (!stop.signal.aborted && Date.now() < deadline) {
        for (const client of installation.clients) {
          const source = join(state, 'sources', client.source);
          if (await optionalJson(join(source, 'settings.json'))) await collectOnce(source, { capture: false });
        }
        const pending = await Promise.all(installation.clients.map(client => readdir(join(state, 'sources', client.source, 'delivery', 'pending'))
          .catch(error => { if (error.code === 'ENOENT') return []; throw error; })));
        if (pending.every(files => !files.some(file => file.endsWith('.json')))) {
          completed = true; break;
        }
        await setTimeout(100);
      }
      if (!completed) throw new Error('Frozen delivery remains unconfirmed; data retained. Retry drain when the server is reachable; no new native bytes were read');
    } finally { if (worker) await releaseRuntime(worker); await releaseRuntime(supervisor); }
    const status = await installedStatus(state);
    if (!status.clients || status.codexUnclassifiedEvents === undefined) throw new Error('Installed delivery status is unavailable; frozen evidence retained');
    const retainedUnfrozenEvents = status.clients.reduce((count, client) => count + client.queuedEvents, 0) + status.codexUnclassifiedEvents;
    return { ...status, retainedUnfrozenEvents, notice: '冻结队列已交付，采集仍停用、后台已停止。尚未冻结的 hook 事件及原生材料没有读取；事件继续保留，不能将补传完成称为全部活动已存档。重新 setup 接入才继续采集。' };
  } finally { await release(); }
}
