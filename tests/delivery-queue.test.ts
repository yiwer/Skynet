import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeliveryQueue } from '../apps/collector/delivery.js';
import type { Manifest } from '../packages/contracts/archive.js';

test('queue quota rejects only the new generation and keeps every existing pending reference across reopen', { timeout: 60_000 }, async () => {
  const state = await mkdtemp(join(tmpdir(), 'skynet-queue-quota-')); const queue = await DeliveryQueue.open(state);
  const bytes = Buffer.from('{"type":"synthetic-quota-evidence"}\n');
  const hash = createHash('sha256').update(bytes).digest('hex');
  const manifest: Manifest = { protocolVersion: 1, sourceSessionId: 'quota-0', source: 'codex-cli', sourceVersion: '0.157.1', sourceOs: process.platform,
    project: '/synthetic/quota', hash, byteLength: bytes.length, qualifiedAt: new Date().toISOString(), capability: 'unverified' };
  const limit = (await queue.health()).quotaSnapshots;
  for (let index = 0; index < limit; index++) await queue.enqueue({ ...manifest, sourceSessionId: `quota-${index}` }, hash, [bytes]);
  await assert.rejects(queue.enqueue({ ...manifest, sourceSessionId: 'quota-rejected' }, hash, [bytes]), /quota reached/);
  const reopened = await DeliveryQueue.open(state); const health = await reopened.health();
  assert.equal(health.pendingSnapshots, limit); assert.equal(health.pendingBytes, bytes.length);
  assert.equal(health.quotaBlocked, true); assert.ok(health.oldestPendingAt);
  assert.equal((await readdir(join(state, 'delivery', 'pending'))).length, limit);
  assert.equal((await readdir(join(state, 'delivery', 'blobs'))).length, 1);
  assert.deepEqual(await readFile(join(state, 'delivery', 'blobs', hash)), bytes);
  assert.equal(reopened.latest('codex-cli', 'quota-rejected'), undefined);
  assert.ok(reopened.latest('codex-cli', 'quota-0')); assert.ok(reopened.latest('codex-cli', `quota-${limit - 1}`));
});
