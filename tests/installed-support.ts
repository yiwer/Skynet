import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { command } from './support.js';
import { mkdir, readFile } from 'node:fs/promises';

export async function installAgent(directory: string, origin: string, env: NodeJS.ProcessEnv, key: string, options?: { packCli?: string }) {
  const started = Date.now();
  const packed = JSON.parse(await command(process.execPath, [options?.packCli ?? 'dist/apps/collector/cli.js', 'pack-agent', '--output', join(directory, 'release'),
    '--origin', origin, '--deployment', 'isolated-acceptance'], process.env));
  const prefix = join(directory, 'npm prefix with spaces');
  await mkdir(prefix);
  const npmCli = process.env.npm_execpath ?? join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  const installed = await command(process.execPath, [npmCli, 'install', '--global', '--ignore-scripts', '--no-audit', '--no-fund', '--offline', '--prefix', prefix, packed.package], process.env);
  const cli = join(prefix, ...(process.platform === 'win32' ? [] : ['lib']), 'node_modules', '@skynet', 'agent', 'dist', 'apps', 'collector', 'cli.js');
  const shim = join(prefix, ...(process.platform === 'win32' ? ['skynet.cmd'] : ['bin', 'skynet']));
  const run = (action: string, environment = { ...env, SKYNET_KEY: undefined } as NodeJS.ProcessEnv) => process.platform === 'win32'
    ? command('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from('& $env:SKYNET_TEST_SHIM $env:SKYNET_TEST_COMMAND; exit $LASTEXITCODE', 'utf16le').toString('base64')],
      { ...environment, SKYNET_TEST_SHIM: shim, SKYNET_TEST_COMMAND: action })
    : command(shim, [action], environment);
  const start = Date.now();
  let stdout: string;
  try { stdout = await run('setup', { ...env, SKYNET_KEY: key }); }
  catch (error) {
    const candidate = resolve(process.platform === 'win32' ? env.LOCALAPPDATA! : process.platform === 'darwin'
      ? join(env.HOME!, 'Library', 'Application Support') : env.XDG_STATE_HOME ?? join(env.HOME!, '.local', 'state'), 'Skynet');
    const within = relative(resolve(directory), candidate);
    if (within && within !== '..' && !within.startsWith(`..${sep}`) && !isAbsolute(within)) {
      try { await stopInstalled(candidate); }
      catch { console.error('Isolated installer cleanup unavailable; original setup failure retained.'); }
    }
    throw error;
  }
  let status = JSON.parse(stdout);
  if (process.env.SKYNET_TEST_MAINTENANCE) {
    try {
      const before = status.deviceId;
      status = JSON.parse(await command(process.execPath, [cli, 'repair'], { ...env, SKYNET_KEY: undefined }));
      const upgraded = JSON.parse(await command(process.execPath, ['dist/apps/collector/cli.js', 'pack-agent', '--output', join(directory, 'native upgrade release'),
        '--origin', origin, '--deployment', 'isolated-acceptance', '--version', '0.2.0'], process.env));
      const nextCli = join(dirname(upgraded.package), 'dist', 'apps', 'collector', 'cli.js');
      status = JSON.parse(await command(process.execPath, [nextCli, 'upgrade'], { ...env, SKYNET_KEY: undefined }));
      if (status.deviceId !== before || status.runtimeVersion !== '0.2.0' || status.background !== 'running') throw new Error('Native setup repair/upgrade did not retain a running shared identity');
      await (await import('node:fs/promises')).writeFile(join(directory, 'native-maintenance-evidence.json'), JSON.stringify({ repair: true, upgrade: true,
        deviceId: status.deviceId, version: status.runtimeVersion, phase: status.upgrade.phase }, null, 2));
    } catch (error) {
      try { await stopInstalled(status.stateDirectory); }
      catch { console.error('Isolated maintenance cleanup unavailable; original failure retained.'); }
      throw error;
    }
  }
  return { cli, prefix, status, setupMs: Date.now() - start, packInstallAndSetupMs: Date.now() - started, output: installed + stdout,
    run };
}
export async function stopInstalled(state: string) {
  const launcher = join(state, 'skynet-launcher.mjs');
  // These are uniquely generated test installations. Remove only their owned
  // scheduled task, then ask their authenticated controller to stop its writer.
  try { await readFile(launcher); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  await command(process.execPath, [launcher, 'autostart-remove', '--state', state], process.env);
  try { await readFile(join(state, 'runtime-control.json')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  await command(process.execPath, [launcher, 'stop', '--state', state], process.env);
}
