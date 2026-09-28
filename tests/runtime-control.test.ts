import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { askRuntime, initializeControl, ownRuntime, releaseRuntime } from '../apps/collector/runtime-control.js';

test('an owned endpoint drains authenticated stop and in-flight status before releasing its lease', async () => {
  let state = '';
  // Windows can reserve part of the dynamic port range. Find an owned isolated
  // registration whose port is actually available before exercising shutdown.
  for (let attempt = 0; attempt < 30; attempt++) {
    state = await mkdtemp(join(tmpdir(), 'skynet-control-stop-')); await initializeControl(state);
    try { const probe = await ownRuntime(state, 'worker', () => ({}), () => {}); await releaseRuntime(probe); break; }
    catch (error) { if (!['EACCES', 'EADDRINUSE'].includes((error as NodeJS.ErrnoException).code ?? '') || attempt === 29) throw error; }
  }
  for (let attempt = 0; attempt < 20; attempt++) {
    let closed: Promise<void> | undefined;
    const server = await ownRuntime(state, 'worker', () => ({ instance: 'owned-test', state: 'running' }), () => { closed = releaseRuntime(server); });
    try {
      const pending = Array.from({ length: 8 }, () => askRuntime(state, 'worker'));
      const acknowledgement = await askRuntime(state, 'worker', 'stop');
      assert.equal(acknowledgement.instance, 'owned-test');
      await Promise.all(pending); await closed;
      assert.equal(await askRuntime(state, 'worker'), null, 'completion is endpoint release, not a swallowed reset');
    } finally { if (server.listening) await releaseRuntime(server); }
  }
  const config = JSON.parse(await readFile(join(state, 'runtime-control.json'), 'utf8'));
  let attempts = 0;
  const broken = createServer(request => { attempts++; request.socket.destroy(); });
  await new Promise<void>(resolve => broken.listen(config.workerPort, '127.0.0.1', resolve));
  try {
    await assert.rejects(askRuntime(state, 'worker'), { code: 'ECONNRESET' });
    assert.equal(attempts, 4, 'a persistently resetting endpoint is unavailable, never interpreted as stopped');
  } finally { await new Promise<void>(resolve => broken.close(() => resolve())); }
});
