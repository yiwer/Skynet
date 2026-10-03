import { cp, lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { setTimeout } from 'node:timers/promises';
import { z } from 'zod';
import { atomicJson } from '../../packages/filesystem.js';
import { applyConfiguration, detectClients, hookEntries, planConfiguration } from './integrations.js';
import { identitySchema, installationSchema, jsonFile, optionalJson, protectState, serverOrigin, type Installation } from './install-state.js';
import { ensureRunning, installedStatus } from './runtime.js';
import { enroll, setupLock } from './enrollment.js';
import { initializeControl } from './runtime-control.js';
import { installAutostart } from './autostart.js';
import { compareVersions, packageEntrySchema, registeredEntries } from './entries.js';
import { launcherText } from './release.js';

export const deploymentSchema = z.object({ deploymentId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/),
  enrollmentOrigin: z.string(), protocolVersion: z.literal(1) }).strict();
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export async function install(state: string) {
  const deployment = deploymentSchema.parse(await jsonFile(join(packageRoot, 'deployment.json')).catch(() => { throw new Error('No valid deployment.json in this package; obtain the deployment-specific package from your platform operator'); }));
  const server = serverOrigin(deployment.enrollmentOrigin);
  const manifest = await jsonFile(join(packageRoot, 'package.json'));
  const entry = packageEntrySchema.parse(await optionalJson(join(packageRoot, 'entry.json')) ?? { channel: 'npm', version: manifest.version });
  if (entry.version !== manifest.version) throw new Error('Package entry version does not match its payload');
  if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Setup requires Node 24');
  await protectState(state);
  const releaseSetup = await setupLock(state);
  try {
    const previousValue = await optionalJson(join(state, 'installation.json'));
    const previous = previousValue ? installationSchema.parse(previousValue) : null;
    const upgrade = await optionalJson(join(state, 'upgrade.json'));
    if (upgrade && ['prepared', 'switched'].includes(upgrade.phase)) throw new Error('Interrupted upgrade exists; run repair before setup');
    if (previous && previous.deploymentId !== deployment.deploymentId) throw new Error('This user environment is already bound to another deployment');
    if (previous) {
      const activeVersion = (await jsonFile(join(previous.runtime, 'package.json'))).version;
      if (compareVersions(entry.version, activeVersion) < 0) throw new Error('This entry is older than the installed shared runtime; obtain the current plugin. The runtime and queued evidence were retained.');
      if (compareVersions(entry.version, activeVersion) > 0) throw new Error('A newer shared runtime requires the explicit upgrade workflow; existing runtime retained');
    }
    const identityValue = await optionalJson(join(state, 'identity.json'));
    let identity = identityValue ? identitySchema.parse(identityValue) : null;
    if (identity && identity.server !== server) throw new Error('Existing identity belongs to another server');
    const detected = await detectClients();
    for (const client of detected) {
      client.nativeRoot = await realpath(client.nativeRoot).catch(() => resolve(client.nativeRoot));
      client.configPath = join(await realpath(dirname(client.configPath)).catch(() => resolve(dirname(client.configPath))), basename(client.configPath));
    }
    const allowed = (source: string) => entry.channel === 'npm' || (entry.channel === 'claude-plugin' ? source === 'claude-code-cli' : source !== 'claude-code-cli');
    const clients = detected.map(client => {
      const old = previous?.clients.find(item => item.source === client.source);
      if (old?.configured && !client.detected) return { ...old, detected: false, notice: '之前已配置，当前未检测到宿主；保留已登记来源及待确认材料，请检查宿主或 PATH。' };
      if (old?.configured && (resolve(old.nativeRoot) !== resolve(client.nativeRoot) || old.configPath !== client.configPath)) {
        throw new Error('A configured native home changed; existing hooks and capture state were retained. Explicit migration is required.');
      }
      return { ...client, configured: old?.configured ?? false };
    });
    if (!clients.some(client => allowed(client.source) && (client.detected || client.configured))) throw new Error('No runnable Agent for this entry was detected; install the supported host and retry setup');
    const node = await realpath(process.execPath); const launcher = join(state, 'skynet-launcher.mjs');
    const runtime = previous?.runtime ?? join(state, 'runtime', entry.version);
    const configurations: Installation['configurations'] = [];
    const plans = [];
    for (const client of clients.filter(item => item.configured || (allowed(item.source) && item.detected))) {
      await mkdir(client.nativeRoot, { recursive: true, mode: 0o700 });
      client.nativeRoot = await realpath(client.nativeRoot); client.configured = true;
      client.configPath = join(await realpath(dirname(client.configPath)), basename(client.configPath));
      if (configurations.some(item => item.path === client.configPath)) continue;
      const entries = hookEntries(node, launcher, state, client.source !== 'claude-code-cli');
      const old = previous?.configurations.find(item => item.path === client.configPath);
      plans.push(await planConfiguration(client.configPath, entries, old?.entries));
      configurations.push({ path: client.configPath, entries });
    }
    if (!identity) {
      identity = await enroll(state, server, process.env.SKYNET_KEY ?? '');
      await atomicJson(join(state, 'identity.json'), identity);
    }
    // Copy code outside the npm prefix. Removing the original package must not
    // remove a running collector or the queued evidence and identity it owns.
    if (!await lstat(join(runtime, 'package.json')).catch(() => null)) {
      await mkdir(join(runtime, 'dist', 'apps'), { recursive: true, mode: 0o700 });
      await cp(join(packageRoot, 'dist', 'apps', 'collector'), join(runtime, 'dist', 'apps', 'collector'), { recursive: true, errorOnExist: true });
      await cp(join(packageRoot, 'dist', 'packages'), join(runtime, 'dist', 'packages'), { recursive: true, errorOnExist: true });
      const zodRoot = dirname(createRequire(import.meta.url).resolve('zod/package.json'));
      await cp(zodRoot, join(runtime, 'node_modules', 'zod'), { recursive: true, errorOnExist: true });
      await writeFile(join(runtime, 'package.json'), JSON.stringify({ type: 'module', version: entry.version, captureFenceVersion: 1 }), { flag: 'wx', mode: 0o600 });
    }
    const desiredLauncher = launcherText(runtime, previous?.maintenanceRuntime);
    const existingLauncher = await readFile(launcher, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (existingLauncher !== null && existingLauncher !== desiredLauncher) throw new Error('Stable launcher differs; upgrade/repair is required before replacing it');
    if (!existingLauncher) await writeFile(launcher, desiredLauncher, { flag: 'wx', mode: 0o700 });
    for (const client of clients.filter(item => item.configured)) {
      const sourceState = join(state, 'sources', client.source); await mkdir(join(sourceState, 'spool'), { recursive: true, mode: 0o700 });
      await atomicJson(join(sourceState, 'settings.json'), { sharedIdentity: '../../identity.json', nativeRoot: client.nativeRoot,
        ...(client.source === 'claude-code-cli' ? { nativeTempRoot: await realpath(process.env.CLAUDE_CODE_TMPDIR ?? tmpdir()) } : {}),
        source: client.source, sourceVersion: client.version, sourceOs: process.platform, enrolledAt: identity.enrolledAt });
    }
    const entries = registeredEntries(previous).filter(item => item.channel !== entry.channel);
    entries.push({ channel: entry.channel, packageVersion: entry.version,
      registeredAt: registeredEntries(previous).find(item => item.channel === entry.channel)?.registeredAt ?? new Date().toISOString(),
      sources: clients.filter(client => allowed(client.source) && client.configured).map(client => client.source) });
    const installation = installationSchema.parse({ version: 1, deploymentId: deployment.deploymentId, node, launcher, runtime, entries,
      maintenanceRuntime: previous?.maintenanceRuntime,
      installedAt: previous?.installedAt ?? new Date().toISOString(), clients, configurations });
    // Persist ownership after each config write, so a subsequent setup can safely
    // continue after a failure on another host without duplicating prior hooks.
    const owned = [...(previous?.configurations ?? [])];
    for (const plan of plans) {
      await applyConfiguration(plan);
      const index = owned.findIndex(item => item.path === plan.path); const entry = { path: plan.path, entries: plan.entries };
      if (index < 0) owned.push(entry); else owned[index] = entry;
      await atomicJson(join(state, 'installation.json'), { ...installation, configurations: owned });
    }
    await atomicJson(join(state, 'installation.json'), installation);
    await initializeControl(state);
    await installAutostart(state, installation);
    const nonce = randomUUID(); await atomicJson(join(state, 'health-request.json'), { nonce });
    await ensureRunning(state, node, launcher);
    for (let attempt = 0; attempt < 160; attempt++) {
      const result = await optionalJson(join(state, 'health.json'));
      if (result?.nonce === nonce) {
        if (result.state !== 'connected') throw new Error('Bound and configured, but device health failed; run skynet status to inspect');
        return installedStatus(state);
      }
      await setTimeout(100);
    }
    throw new Error('Bound and configured, but health check timed out; run skynet status to inspect');
  } finally { await releaseSetup(); }
}
