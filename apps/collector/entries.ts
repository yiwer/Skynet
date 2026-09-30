import { join } from 'node:path';
import { z } from 'zod';
import { atomicJson } from '../../packages/filesystem.js';
import { channels, installationSchema, jsonFile, optionalJson, type Installation } from './install-state.js';
import { applyConfiguration, planConfiguration } from './integrations.js';
import { ensureRunning, stopRuntime } from './supervisor.js';
import { setupLock } from './enrollment.js';

export const packageEntrySchema = z.object({ channel: z.enum(channels), version: z.string().regex(/^\d+\.\d+\.\d+$/) }).strict();
export function registeredEntries(installation: Installation | null) {
  // Installations predating channel ownership were all npm installations.
  return installation?.entries ?? (installation ? [{ channel: 'npm' as const, packageVersion: '0.1.0',
    registeredAt: installation.installedAt, sources: installation.clients.filter(client => client.configured).map(client => client.source) }] : []);
}
export function compareVersions(left: string, right: string) {
  const a = left.split('.').map(Number); const b = right.split('.').map(Number);
  for (let index = 0; index < 3; index++) if (a[index] !== b[index]) return a[index]! - b[index]!;
  return 0;
}
export async function removeEntry(state: string, channel: string) {
  const selected = z.enum(channels).parse(channel);
  const release = await setupLock(state);
  try {
    const upgrade = await optionalJson(join(state, 'upgrade.json'));
    if (upgrade && ['prepared', 'switched'].includes(upgrade.phase)) throw new Error('Interrupted upgrade exists; run repair before changing entry ownership');
    const installation = installationSchema.parse(await jsonFile(join(state, 'installation.json')));
    const remaining = registeredEntries(installation).filter(entry => entry.channel !== selected);
    const active = new Set(remaining.flatMap(entry => entry.sources));
    if (installation.clients.some(client => client.source !== 'claude-code-cli' && client.configured && !active.has(client.source))
      && (await jsonFile(join(installation.runtime, 'package.json'))).captureFenceVersion !== 1)
      throw new Error('This older runtime cannot enforce this Codex source capture fence. Upgrade before removing its final owner, or use full uninstall; current entries and evidence retained.');
    const retained = installation.configurations.filter(configuration =>
      installation.clients.some(client => client.configPath === configuration.path && active.has(client.source)));
    const plans = [];
    for (const configuration of installation.configurations.filter(item => !retained.includes(item)))
      plans.push(await planConfiguration(configuration.path, {}, configuration.entries));
    const stopsCapture = installation.clients.some(client => client.configured && !active.has(client.source));
    if (stopsCapture) await stopRuntime(state);
    try {
      const clients = installation.clients.map(client => ({ ...client, configured: active.has(client.source),
        notice: active.has(client.source) ? client.notice : '此来源没有已登记入口；已停止读取新原件，仅交付已经冻结的未确认材料。' }));
      // Publish the capture fence before changing hooks. A crash or config-write
      // failure must not restart native reads after the final owner left.
      await atomicJson(join(state, 'installation.json'), { ...installation, entries: remaining, clients });
      for (const plan of plans) await applyConfiguration(plan);
      await atomicJson(join(state, 'installation.json'), { ...installation, entries: remaining, configurations: retained, clients });
      return { removed: selected, entries: remaining, stateDirectory: state,
        notice: '身份、共享后台、已登记会话及待确认材料保留。另用宿主的正常插件卸载命令移除市场入口；整体停用使用完整卸载流程。' };
    } finally { if (stopsCapture) await ensureRunning(state, installation.node, installation.launcher); }
  } finally { await release(); }
}
