import { dirname, join } from 'node:path';
import { command } from './support.js';
import { mkdir, readFile } from 'node:fs/promises';

export async function installAgent(directory: string, origin: string, env: NodeJS.ProcessEnv, key: string) {
  const started = Date.now();
  const packed = JSON.parse(await command(process.execPath, ['dist/apps/collector/cli.js', 'pack-agent', '--output', join(directory, 'release'),
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
  const stdout = await run('setup', { ...env, SKYNET_KEY: key });
  const status = JSON.parse(stdout);
  return { cli, prefix, status, setupMs: Date.now() - start, packInstallAndSetupMs: Date.now() - started, output: installed + stdout,
    run };
}
export async function stopInstalled(state: string) {
  try {
    const { pid } = JSON.parse(await readFile(join(state, 'runtime.json'), 'utf8'));
    // State is created by this test and contains its own spawned background PID.
    process.kill(pid, 'SIGTERM');
  } catch (error) { if (!['ENOENT', 'ESRCH'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error; }
}
