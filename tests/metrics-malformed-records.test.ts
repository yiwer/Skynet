import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createSandbox } from './support.js';
import { createApp } from '../apps/server/app.js';
import { connect, digest } from '../apps/server/database.js';

test('non-object native records remain unknown without breaking another employee metrics or original bytes', { timeout: 120000 }, async () => {
  const sandbox = await createSandbox(), db = connect(sandbox.env.DATABASE_URL!);
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  try {
    const alpha = await sandbox.provision('完整原件员工'), beta = await sandbox.provision('格式缺口员工');
    const now = new Date(Date.now() + 60000), timestamp = now.toISOString();
    app = await createApp({ db, rawDirectory: sandbox.env.RAW_DIRECTORY!, reportClock: () => now });
    const api = (url: string, credential = alpha.readerCredential, payload?: unknown, method: 'GET'|'POST'|'PUT' = 'GET') => app!.inject({ url, method,
      headers: { Authorization: `Bearer ${credential}`, ...(Buffer.isBuffer(payload) ? { 'Content-Type': 'application/octet-stream' } : {}) },
      ...(payload !== undefined ? { payload: payload as object } : {}) });
    const enroll = async (employee: typeof alpha) => {
      const response = await api('/api/devices/enroll', employee.enrollmentCredential, { installationId: randomUUID(), name: '原件边界设备' }, 'POST');
      assert.equal(response.statusCode, 200, response.body); return response.json().deviceCredential as string;
    };
    const a = await enroll(alpha), b = await enroll(beta);
    const user = (sessionId: string) => ({ type: 'user', sessionId, uuid: randomUUID(), version: '2.1.281', timestamp, message: { role: 'user', content: '保留这条原始用户消息' } });
    const upload = async (credential: string, source: string, version: string, sessionId: string, rows: unknown[]) => {
      const bytes = Buffer.from(rows.map(row => JSON.stringify(row)).join('\n') + '\n');
      assert.equal((await api('/api/chunks/' + digest(bytes), credential, bytes, 'PUT')).statusCode, 201);
      const response = await api('/api/snapshots', credential, { protocolVersion: 1, source, sourceVersion: version, sourceSessionId: sessionId,
        sourceOs: process.platform, project: '/synthetic/non-object-records', hash: digest(bytes), byteLength: bytes.length, qualifiedAt: timestamp, capability: 'unverified' }, 'POST');
      assert.equal(response.statusCode, 200, response.body);
      return { snapshotId: response.json().snapshotId as string, bytes };
    };
    const goodId = randomUUID();
    const originals = [await upload(a, 'claude-code-cli', '2.1.281', goodId, [user(goodId), { type: 'assistant', sessionId: goodId, uuid: randomUUID(), version: '2.1.281', timestamp,
      message: { id: randomUUID(), role: 'assistant', content: [{ type: 'text', text: '完整回复' }], usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }])];
    for (const source of ['codex-cli', 'codex-desktop', 'claude-code-cli']) {
      const id = randomUUID();
      const message = source === 'claude-code-cli' ? user(id) : { timestamp, type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '有效消息前后的格式缺口不能中断报表' }] } };
      originals.push(await upload(b, source, source === 'claude-code-cli' ? '2.1.281' : source === 'codex-cli' ? '0.157.1' : 'synthetic-fixture-1', id,
        [null, 42, [], 'unsupported native record', message, ...(source === 'claude-code-cli' ? [{ type: 'assistant', sessionId: id, timestamp, message: { role: 'assistant', content: [null] } }] : [])]));
    }
    const mine = await api('/api/metrics?period=since-enrollment&employeeId=' + alpha.employeeId);
    assert.equal(mine.statusCode, 200, mine.body);
    assert.equal(mine.json().totals.inputTokens, 100); assert.equal(mine.json().totals.outputTokens, 20);
    const team = await api('/api/metrics?period=since-enrollment');
    assert.equal(team.statusCode, 200, team.body);
    assert.equal(team.json().totals.inputTokens, null);
    assert.equal(team.json().employees.find((person: {employeeId:string}) => person.employeeId === beta.employeeId).sourceInputsComplete, false);
    const recomputed = await api('/api/metrics/recompute', alpha.readerCredential, { period: 'since-enrollment' }, 'POST');
    assert.equal(recomputed.statusCode, 200, recomputed.body); assert.deepEqual(recomputed.json(), team.json());
    for (const original of originals) {
      const raw = await api(`/api/snapshots/${original.snapshotId}/raw`);
      assert.equal(raw.statusCode, 200); assert.deepEqual(raw.rawPayload, original.bytes);
    }
  } finally { await app?.close(); await db.end(); await sandbox.close(); }
});
