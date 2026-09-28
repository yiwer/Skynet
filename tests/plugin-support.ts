import assert from 'node:assert/strict';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { command } from './support.js';
import { installAgent, stopInstalled } from './installed-support.js';

export async function installNativePlugins(directory: string, origin: string, environment: NodeJS.ProcessEnv, key: string, host: 'claude' | 'codex') {
  const env: NodeJS.ProcessEnv = { ...environment, SKYNET_KEY: undefined };
  env.CODEX_HOME ??= join(env.HOME!, '.codex'); env.CLAUDE_CONFIG_DIR ??= join(env.HOME!, '.claude');
  await mkdir(env.CODEX_HOME, { recursive: true }); await mkdir(env.CLAUDE_CONFIG_DIR, { recursive: true });
  const catalog = join(directory, 'plugin catalog with spaces');
  const packed = JSON.parse(await command(process.execPath, ['dist/apps/collector/cli.js', 'pack-plugins', '--output', catalog,
    '--origin', origin, '--deployment', 'isolated-acceptance'], process.env));
  const evidence: any = { packed, host, operations: [], setupInput: 'local SKYNET_KEY environment; never argv/model' };
  const state = join(env.LOCALAPPDATA!, 'Skynet');
  const installer = async (selected: 'claude' | 'codex') => {
    const runtime = selected === 'claude' ? process.env.SKYNET_CLAUDE_RUNTIME : process.env.SKYNET_CODEX_CLI;
    assert.ok(runtime); env.PATH = `${dirname(runtime)};${env.PATH}`;
    const pluginId = `skynet-${selected}@${packed.marketplace}`;
    let installedPath: string;
    if (selected === 'claude') {
      await command(runtime, ['plugin', 'validate', join(catalog, 'plugins', 'skynet-claude')], env);
      await command(runtime, ['plugin', 'marketplace', 'add', catalog, '--scope', 'user'], env);
      await command(runtime, ['plugin', 'install', pluginId, '--scope', 'user', '--json'], env);
      const listed = JSON.parse(await command(runtime, ['plugin', 'list', '--json'], env));
      installedPath = listed.find((item: any) => item.id === pluginId && item.enabled).installPath;
    } else {
      await command(runtime, ['plugin', 'marketplace', 'add', catalog, '--json'], env);
      const installed = JSON.parse(await command(runtime, ['plugin', 'add', pluginId, '--json'], env));
      installedPath = installed.installedPath;
      const listed = JSON.parse(await command(runtime, ['plugin', 'list', '--json'], env));
      assert.ok(listed.installed.some((item: any) => item.pluginId === pluginId && item.enabled));
    }
    const script = join(installedPath, 'scripts', 'skynet.cjs');
    await access(script); assert.ok(installedPath.includes('cache'));
    const before = JSON.parse(await command(process.execPath, [script, 'status'], env));
    const result = JSON.parse(await command(process.execPath, [script, 'setup'], { ...env, SKYNET_KEY: key }));
    evidence.operations.push({ selected, pluginId, installedPath, previouslyBound: before.installed, deviceId: result.deviceId,
      supervisor: result.supervisor.instance, worker: result.worker.instance, entries: result.entries });
    return { result, runtime, pluginId, installedPath };
  };
  // The first binding comes exclusively from the installed marketplace payload.
  try {
  const first = await installer(host); assert.equal(first.result.entries.length, 1);
  if (process.env.SKYNET_TEST_PLUGINS === 'coexist') {
    const second = await installer(host === 'claude' ? 'codex' : 'claude');
    const npm = await installAgent(directory, origin, env, key);
    for (const result of [second.result, npm.status]) {
      assert.equal(result.deviceId, first.result.deviceId); assert.equal(result.worker.instance, first.result.worker.instance);
      assert.equal(result.supervisor.instance, first.result.supervisor.instance);
    }
    assert.equal(npm.status.entries.length, 3);
    // Remove the first plugin through the ordinary host CLI. A missing cache has
    // no uninstall callback; the stable registered capture must still work.
    await command(first.runtime, host === 'claude'
      ? ['plugin', 'uninstall', first.pluginId, '--scope', 'user'] : ['plugin', 'remove', first.pluginId, '--json'], env);
    const cacheRemains = await access(first.installedPath).then(() => true, () => false);
    if (cacheRemains) {
      const owned = relative(resolve(directory), resolve(first.installedPath));
      assert.ok(owned && owned !== '..' && !owned.startsWith(`..${sep}`) && !isAbsolute(owned));
      await rename(first.installedPath, `${first.installedPath}-unavailable-owned-fixture`);
    }
    await assert.rejects(access(first.installedPath), /ENOENT/);
    evidence.hostUninstallRemovedCache = !cacheRemains;
    evidence.cacheUnavailableBy = cacheRemains ? 'test renamed only its owned leftover cache' : 'host uninstall';
    evidence.marketplaceOnlyRemovalRequiresEntryRemove = true;
  }
  const run = (action: string) => command(process.execPath, [join(state, 'skynet-launcher.mjs'), action], env);
  const status = JSON.parse(await run('status'));
  for (const configuration of JSON.parse(await readFile(join(state, 'installation.json'), 'utf8')).configurations) {
    const current = JSON.parse(await readFile(configuration.path, 'utf8'));
    for (const [event, entry] of Object.entries(configuration.entries))
      assert.equal(current.hooks[event].filter((item: unknown) => JSON.stringify(item) === JSON.stringify(entry)).length, 1);
  }
  evidence.final = { deviceId: status.deviceId, entries: status.entries, background: status.background };
  await writeFile(join(directory, 'native-plugin-evidence.json'), JSON.stringify(evidence, null, 2));
  return { status, run };
  } catch (error) { await stopInstalled(state); throw error; }
}
