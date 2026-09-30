import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { deploymentSchema } from './installer.js';
import { serverOrigin } from './install-state.js';
import { packageEntrySchema } from './entries.js';
import {copyFrozenPayload} from './frozen-payload.js';

// Operator-only packaging. This creates a private local npm tarball; it never
// publishes a registry package or places any employee credential in the payload.
export async function packAgent(output: string, origin: string, deploymentId: string, version = '0.1.0') {
  packageEntrySchema.parse({ channel: 'npm', version });
  const directory = resolve(output);
  const deployment = deploymentSchema.parse({ deploymentId, enrollmentOrigin: serverOrigin(origin), protocolVersion: 1 });
  await mkdir(directory); // Refuse to overwrite an existing release directory.
  await writeAgentPayload(directory, deployment, version);
  const npmCli = process.env.npm_execpath ?? join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  const result = await promisify(execFile)(process.execPath, [npmCli, 'pack', '--ignore-scripts', '--json'], { cwd: directory, windowsHide: true, env: { ...process.env, SKYNET_KEY: undefined } });
  return { package: join(directory, JSON.parse(result.stdout)[0].filename), deployment };
}
export async function writeAgentPayload(directory: string, deployment: ReturnType<typeof deploymentSchema.parse>, version = '0.1.0') {
  await copyFrozenPayload(directory);
  const require = createRequire(import.meta.url);
  await writeFile(join(directory, 'deployment.json'), JSON.stringify(deployment, null, 2));
  await writeFile(join(directory, 'package.json'), JSON.stringify({ name: '@skynet/agent', version, private: true,
    description: 'Deployment-specific Skynet collector; run skynet setup explicitly', type: 'module', engines: { node: '>=24 <25' },
    bin: { skynet: 'dist/apps/collector/cli.js' }, files: ['dist/apps/collector', 'dist/packages', 'deployment.json', 'README.md'],
    dependencies: { zod: require('zod/package.json').version }, bundledDependencies: ['zod'] }, null, 2));
  await writeFile(join(directory, 'README.md'), '# Skynet agent\n\nRequires Node 24 and an installed Agent. Install with npm (install scripts may be disabled), set only your personal SKYNET_KEY and run `skynet setup`. Complete the host’s normal hook/workspace trust. Run `skynet status` to distinguish configuration, trust, first event and committed archives.\n\nUse `skynet repair` for missing owned configuration or interrupted upgrade recovery. Obtain a strictly newer deployment release and execute its `upgrade` command; `rollback` restores earlier code while retaining current entry ownership, identity and frozen evidence. Run `uninstall` before removing npm/market packages: only owned hooks/tasks/background stop, server archives and private state remain. The retained stable launcher provides `drain` to deliver frozen pending bytes without reading new native activity; unfrozen hook events remain visible and are not covered by a successful drain. Explicit setup is required to reconnect capture.\n\nWindows current-user login tasks are supported; actual login/reboot/sleep, Desktop UI and other OS login adapters remain unverified. Keep keys in a local terminal, outside Agent conversations.\n');
}
