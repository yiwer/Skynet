import { mkdir, readFile, open, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';
import { setTimeout } from 'node:timers/promises';
import { atomicJson, collectOnce, recordHook, setup } from './local.js';
import { restorePackage } from './restore.js';

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  state: { type: 'string' }, once: { type: 'boolean' },
  package: { type: 'string' }, target: { type: 'string' }, 'desktop-version': { type: 'string' }, runtime: { type: 'string' },
} });
const command = positionals[0];
if (command !== 'restore' && !values.state) throw new Error('--state must name an explicit private collector directory');
const state = values.state ? resolve(values.state) : '';
async function stdin() {
  let input = '';
  for await (const part of process.stdin) {
    input += part;
    if (input.length > 64 * 1024) throw new Error('Input exceeds limit');
  }
  return JSON.parse(input);
}

if (command === 'restore') {
  if (!values.package || !values.target || !values['desktop-version'] || !values.runtime) {
    throw new Error('Restore requires --package FILE --target NEW_ABSOLUTE_DIRECTORY --desktop-version VERSION --runtime ABSOLUTE_CODEX_EXECUTABLE');
  }
  console.log(JSON.stringify(await restorePackage({ packagePath: values.package, target: values.target,
    desktopVersion: values['desktop-version'], runtime: values.runtime })));
} else if (command === 'hook') {
  // Hooks never veto work, print payloads, or wait for the network.
  try { await recordHook(state, await stdin()); }
  catch {
    try {
      await mkdir(state, { recursive: true, mode: 0o700 });
      await atomicJson(join(state, 'hook-gap.json'), { at: new Date().toISOString(), error: 'Host activity could not be queued; check hook input and local storage' });
    } catch { /* A read-only/full disk cannot persist diagnostics; the host must still continue. */ }
  }
} else if (command === 'setup') {
  console.log(JSON.stringify(await setup(state, await stdin())));
} else if (command === 'run') {
  const lockPath = join(state, 'collector.lock');
  const lock = await open(lockPath, 'wx', 0o600).catch(() => { throw new Error('Collector lock exists; ensure no collector is running before removing a stale lock'); });
  await lock.writeFile(String(process.pid)); await lock.close();
  const stop = new AbortController();
  process.once('SIGINT', () => stop.abort()); process.once('SIGTERM', () => stop.abort());
  try {
    do {
      try { console.log(JSON.stringify(await collectOnce(state))); }
      catch (error) { console.error((error as Error).message); if (values.once) process.exitCode = 1; }
      if (values.once || stop.signal.aborted) break;
      await setTimeout(1000, undefined, { signal: stop.signal }).catch(() => undefined);
    } while (!stop.signal.aborted);
  } finally { await unlink(lockPath); }
} else if (command === 'status') {
  const result: Record<string, unknown> = {};
  for (const filename of ['status.json', 'hook-gap.json']) {
    try { result[filename] = JSON.parse(await readFile(join(state, filename), 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  console.log(JSON.stringify(result));
} else throw new Error('Expected setup, hook, run, status, or restore');
