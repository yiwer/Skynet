import test from 'node:test';
import assert from 'node:assert/strict';
import { QueryCache } from '../apps/server/query-cache.js';

test('bounded cold queries wait, coalesce and release their slot after a failed computation', async () => {
  const cache = new QueryCache<number>(16, () => 1);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let running = 0; let maximumRunning = 0; let calls = 0;
  const first = cache.get('failed', async () => {
    running++; maximumRunning = Math.max(maximumRunning, running);
    try { await gate; throw new Error('unavailable archive'); }
    finally { running--; }
  });
  const failed = assert.rejects(first, /unavailable archive/);
  const queued = Array.from({ length: 8 }, (_, index) => cache.get(String(index), async () => {
    calls++; running++; maximumRunning = Math.max(maximumRunning, running);
    try { await Promise.resolve(); return index; } finally { running--; }
  }));
  const same = cache.get('3', async () => { throw new Error('same key must share queued work'); });
  await assert.rejects(cache.get('overflow', async () => 9), (error: any) => error.statusCode === 503);
  assert.equal(calls, 0, 'waiting queries have not started allocating parsed archives');
  release();
  await failed;
  assert.deepEqual(await Promise.all(queued), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(await same, 3); assert.equal(calls, 8); assert.equal(maximumRunning, 1);
  assert.equal(await cache.get('3', async () => { throw new Error('cached result must survive'); }), 3);
  assert.equal(await cache.get('overflow', async () => 9), 9, 'a rejected request can retry after the queue drains');
  assert.equal(await cache.get('failed', async () => 10), 10, 'failed work leaves no stuck pending key');
});
