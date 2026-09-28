#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';
import { setTimeout } from 'node:timers/promises';

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  state: { type: 'string' }, once: { type: 'boolean' },
  package: { type: 'string' }, target: { type: 'string' }, 'desktop-version': { type: 'string' }, runtime: { type: 'string' },
  'source-version': { type: 'string' },
  output: { type: 'string' }, origin: { type: 'string' }, deployment: { type: 'string' },
} });
const command = positionals[0];
if (!['setup', 'status', 'restore', 'pack-agent'].includes(command ?? '') && !values.state) throw new Error('--state must name an explicit private collector directory');
const state = values.state ? resolve(values.state) : ['setup', 'status'].includes(command ?? '') ? (await import('./install-state.js')).defaultState() : '';
async function stdin() {
  let input = '';
  for await (const part of process.stdin) {
    input += part;
    if (input.length > 64 * 1024) throw new Error('Input exceeds limit');
  }
  return JSON.parse(input);
}

if (command === 'pack-agent') {
  if (!values.output || !values.origin || !values.deployment) throw new Error('Operator packaging requires --output NEW_DIRECTORY --origin HTTPS_ORIGIN --deployment ID');
  console.log(JSON.stringify(await (await import('./package.js')).packAgent(values.output, values.origin, values.deployment)));
} else if (command === 'restore') {
  const { restorePackage } = await import('./restore.js');
  const version = values['source-version'] ?? values['desktop-version'];
  if (values['source-version'] && values['desktop-version'] && values['source-version'] !== values['desktop-version']) throw new Error('Conflicting restore source versions');
  if (!values.package || !values.target || !values.runtime) {
    throw new Error('Restore requires --package FILE --target NEW_ABSOLUTE_DIRECTORY --runtime ABSOLUTE_NATIVE_EXECUTABLE (Codex also requires --source-version VERSION)');
  }
  console.log(JSON.stringify(await restorePackage({ packagePath: values.package, target: values.target,
    sourceVersion: version, runtime: values.runtime })));
} else if (command === 'hook') {
  const { recordHook, recordHookGap } = await import('./hook.js');
  // Hooks never veto work, print payloads, or wait for the network.
  try { await recordHook(state, await stdin()); }
  catch {
    try {
      await recordHookGap(state);
    } catch { /* A read-only/full disk cannot persist diagnostics; the host must still continue. */ }
  }
} else if (command === 'setup') {
  if (values.state) {
    // Legacy explicit-state integration harness; employee setup never consumes JSON.
    const { setup } = await import('./local.js');
    console.log(JSON.stringify(await setup(state, await stdin())));
  } else console.log(JSON.stringify(await (await import('./installer.js')).install(state)));
} else if (command === 'background') {
  await (await import('./runtime.js')).runInstalled(state);
} else if (command === 'retry') {
  // Ask the owning background to retry; never start a competing installed writer.
  await (await import('../../packages/filesystem.js')).atomicJson(join(state, 'retry-request.json'), { requestedAt: new Date().toISOString() });
  console.log(JSON.stringify({ state: 'retry-requested', notice: 'The owning collector will make one immediate delivery attempt on its next sweep.' }));
} else if (command === 'run') {
  const { collectOnce } = await import('./local.js');
  const settings = JSON.parse(await readFile(join(state, 'settings.json'), 'utf8'));
  if (settings.sharedIdentity) throw new Error('Installed sources are owned by the shared background; use retry or status instead');
  const release = await (await import('./enrollment.js')).setupLock(state, 'collector');
  const stop = new AbortController();
  process.once('SIGINT', () => stop.abort()); process.once('SIGTERM', () => stop.abort());
  try {
    do {
      try { console.log(JSON.stringify(await collectOnce(state))); }
      catch (error) { console.error((error as Error).message); if (values.once) process.exitCode = 1; }
      if (values.once || stop.signal.aborted) break;
      await setTimeout(1000, undefined, { signal: stop.signal }).catch(() => undefined);
    } while (!stop.signal.aborted);
  } finally { await release(); }
} else if (command === 'status') {
  if (!values.state) {
    console.log(JSON.stringify(await (await import('./runtime.js')).installedStatus(state)));
  } else {
  const result: Record<string, unknown> = {};
  for (const filename of ['status.json', 'hook-gap.json']) {
    try { result[filename] = JSON.parse(await readFile(join(state, filename), 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  console.log(JSON.stringify(result));
  }
} else throw new Error('Expected setup, hook, run, retry, status, restore, or pack-agent');
