import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mcpSandbox } from './mcp-support.js';

test('an over-limit event scope fails completely while a smaller project remains readable', { timeout: 300000 }, async () => {
  const now = new Date(Date.now() + 86400000), sandbox = await mcpSandbox({ reportClock: () => now });
  const json = (body: unknown) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const owner = await sandbox.provision('指标事件边界');
    const enrollment = await sandbox.api('/api/devices/enroll', owner.enrollmentCredential, json({ installationId: randomUUID(), name: '合成事件边界设备' }));
    assert.equal(enrollment.status, 200); const device = await enrollment.json();
    async function upload(project: string, count: number) {
      const id = randomUUID(), rows: object[] = [{ type: 'session_meta', timestamp: now.toISOString(), payload: { id } }];
      for (let index = 0; index < count; index++) rows.push({ type: 'response_item', timestamp: now.toISOString(),
        payload: { type: 'function_call', name: 'synthetic_check', call_id: String(index), arguments: '{}' } });
      const bytes = Buffer.from(rows.map(row => JSON.stringify(row)).join('\n') + '\n'), hash = createHash('sha256').update(bytes).digest('hex');
      const staged = await sandbox.api('/api/chunks/' + hash, device.deviceCredential,
        { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes });
      assert.equal(staged.status, 201, await staged.clone().text());
      const committed = await sandbox.api('/api/snapshots', device.deviceCredential, json({ protocolVersion: 1, sourceSessionId: id,
        source: 'codex-cli', sourceVersion: '0.157.1', sourceOs: process.platform, project, hash, byteLength: bytes.length,
        qualifiedAt: now.toISOString(), capability: 'unverified' }));
      assert.equal(committed.status, 200, await committed.clone().text());
    }
    await upload('/synthetic/bounded-small', 1);
    for (let index = 0; index < 4; index++) await upload('/synthetic/bounded-large', 25001);
    for (const path of ['/api/metrics?period=since-enrollment', '/api/metrics/export?period=since-enrollment&project=%2Fsynthetic%2Fbounded-large']) {
      const response = await sandbox.api(path, owner.readerCredential);
      assert.equal(response.status, 413, await response.clone().text());
      assert.match((await response.json()).error, /未返回截断汇总/);
    }
    const full = await sandbox.api('/api/metrics/recompute', owner.readerCredential, json({ period: 'since-enrollment' }));
    assert.equal(full.status, 413, await full.clone().text());
    const small = await sandbox.api('/api/metrics?period=since-enrollment&project=%2Fsynthetic%2Fbounded-small', owner.readerCredential);
    assert.equal(small.status, 200, await small.clone().text());
    const result = await small.json();
    assert.deepEqual([result.totals.sessions, result.totals.toolCalls, result.totals.userTurns], [1, 1, 0]);
    assert.equal(result.totals.inputTokens, null, 'a bounded subset cannot invent unavailable native usage');
    const repeated = await sandbox.api('/api/metrics/recompute', owner.readerCredential,
      json({ period: 'since-enrollment', project: '/synthetic/bounded-small' }));
    assert.equal(repeated.status, 200); assert.deepEqual(await repeated.json(), result);
  } finally { await sandbox.close(); }
});
