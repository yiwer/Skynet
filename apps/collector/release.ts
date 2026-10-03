import { lstat, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {copyFrozenPayload,payloadRoot} from './frozen-payload.js';

export {payloadRoot};
export function launcherText(runtime: string, maintenanceRuntime?: string) {
  if (maintenanceRuntime) return `#!/usr/bin/env node\n// Skynet owned stable launcher; contains no credentials.\nconst active = ${JSON.stringify(pathToFileURL(join(runtime, 'dist', 'apps', 'collector', 'cli.js')).href)};\nconst tools = ${JSON.stringify(pathToFileURL(join(maintenanceRuntime, 'dist', 'apps', 'collector', 'cli.js')).href)};\nawait import(['hook', 'run', 'restore'].includes(process.argv[2]) ? active : tools);\n`;
  return `#!/usr/bin/env node\n// Skynet owned stable launcher; contains no credentials.\nawait import(${JSON.stringify(pathToFileURL(join(runtime, 'dist', 'apps', 'collector', 'cli.js')).href)});\n`;
}
export async function runtimeDigest(runtime: string) {
  const hash = createHash('sha256');
  async function visit(directory: string, prefix: string) {
    for (const name of (await readdir(directory)).sort()) {
      const path = join(directory, name); const info = await lstat(path);
      if (info.isSymbolicLink()) throw new Error('Runtime payload must not contain symbolic links');
      if (info.isDirectory()) await visit(path, `${prefix}${name}/`);
      else if (info.isFile()) { const bytes = await readFile(path); hash.update(`${prefix}${name}\0${bytes.length}\0`); hash.update(bytes); }
      else throw new Error('Runtime payload contains an unsupported file');
    }
  }
  // Only executable payload files, not deployment credentials or runtime state.
  for (const name of ['dist', 'node_modules']) await visit(join(runtime, name), `${name}/`);
  hash.update(await readFile(join(runtime, 'package.json')));
  return hash.digest('hex');
}
export async function stageRuntime(state: string, version: string) {
  const runtime = join(state, 'runtime', `${version}-${randomUUID()}`);
  await mkdir(join(runtime, 'dist', 'apps'), { recursive: true, mode: 0o700 });
  await copyFrozenPayload(runtime);
  await writeFile(join(runtime, 'package.json'), JSON.stringify({ type: 'module', version, captureFenceVersion: 1 }), { flag: 'wx', mode: 0o600 });
  for (const file of ['deployment.json', 'entry.json']) {
    const bytes = await readFile(join(payloadRoot, file)).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (bytes) await writeFile(join(runtime, file), bytes, { flag: 'wx', mode: 0o600 });
  }
  await checkRuntime(runtime, process.execPath);
  return { runtime, digest: await runtimeDigest(runtime) };
}
export async function checkRuntime(runtime: string, node: string, installation?: unknown) {
  // A subprocess resolves the staged dependencies without importing an Agent,
  // enrolling, touching hooks, reading transcripts or calling the network.
  const script = `await import(${JSON.stringify(pathToFileURL(join(runtime, 'dist', 'apps', 'collector', 'runtime.js')).href)}); await import(${JSON.stringify(pathToFileURL(join(runtime, 'dist', 'apps', 'collector', 'installer.js')).href)});`
    + (installation ? ` const schema = await import(${JSON.stringify(pathToFileURL(join(runtime, 'dist', 'apps', 'collector', 'install-state.js')).href)}); schema.installationSchema.parse(${JSON.stringify(installation)});` : '');
  await promisify(execFile)(node, ['--input-type=module', '--eval', script], { windowsHide: true, timeout: 10_000, env: { ...process.env, SKYNET_KEY: undefined } });
}
