import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { cpus, totalmem } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createSandbox } from './support.js';
import { mcpSandbox } from './mcp-support.js';
import type { MetricsPage } from '../packages/contracts/metrics.js';

// Explicit acceptance command: real public uploads and queries, no seeded tables
// or cached-statistics preconditioning. One cold sample is not a cold P95 claim.
const seed = await createSandbox();
const accounts: Awaited<ReturnType<typeof seed.provision>>[] = [];
try { for (let person = 0; person < 10; person++) accounts.push(await seed.provision(`性能合成员工${String(person).padStart(2, '0')}`)); }
catch (error) { await seed.close(); throw error; }
const startDay = new Date(); startDay.setUTCHours(0, 0, 0, 0); startDay.setUTCDate(startDay.getUTCDate() + 1);
const reportClock = new Date(startDay.getTime() + 28 * 86400000);
const sandbox = await mcpSandbox({ sandbox: seed, reportClock: () => reportClock });
const destination = process.env.SKYNET_PERFORMANCE_EVIDENCE ?? join(sandbox.directory, 'metrics-performance.json');
const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
async function checked(path: string, credential: string, init?: RequestInit, status = 200): Promise<any> {
  const response = await sandbox.api(path, credential, init);
  assert.equal(response.status, status, `${path}: ${await response.clone().text()}`);
  return response.json();
}
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const encode = (rows: unknown[]) => Buffer.from(rows.map(row => JSON.stringify(row)).join('\n') + '\n');
const timings: number[] = [];
let uploaded = 0, bytesTotal = 0;
const report: Record<string, unknown> = {
  kind: 'metrics-foundation-performance-not-full-AC32', commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  workingTreeDirty: Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()),
  workingDiffSha256: digest(execFileSync('git', ['diff', 'HEAD'])),
  measuredAt: new Date().toISOString(), node: process.version, platform: process.platform,
  cpu: cpus()[0]?.model, logicalCpu: cpus().length, memoryBytes: totalmem(),
  dataset: { employees: 10, sessions: 1000, businessEvents: 80000, userTurns: 20000, toolCalls: 20000,
    inputTokens: 2000000, outputTokens: 500000, source: 'synthetic Codex CLI 0.157.1',
    sourceFrom: startDay.toISOString(), reportClock: reportClock.toISOString(), uploadConcurrency: 4 },
  limits: 'One first-read sample, ten subsequent live reads; shared development host. Activity/profile and repeated cold samples are separate AC-32 work.'
};
try {
  const devices: Array<{ deviceCredential: string; readerCredential: string; employeeId: string }> = [];
  for (const account of accounts) {
    const enrollment = await checked('/api/devices/enroll', account.enrollmentCredential, json({ installationId: randomUUID(), name: 'isolated-performance' }));
    devices.push({ ...account, ...enrollment });
  }
  const jobs = Array.from({ length: 1000 }, (_, index) => index);
  const started = performance.now();
  let firstInput: { id: string; bytes: Buffer; timestamp: string } | undefined;
  async function upload(index: number, id: string, bytes: Buffer, timestamp: string) {
    const device = devices[index % 10]!;
    await checked(`/api/chunks/${digest(bytes)}`, device.deviceCredential, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(bytes) }, 201);
    await checked('/api/snapshots', device.deviceCredential, json({ protocolVersion: 1, sourceSessionId: id, source: 'codex-cli', sourceVersion: '0.157.1', sourceOs: process.platform,
      project: `/synthetic/load/project-${Math.floor(index / 10) % 5 % 3}`, hash: digest(bytes), byteLength: bytes.length, qualifiedAt: timestamp, capability: 'unverified' }));
  }
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (jobs.length) {
      const index = jobs.shift()!, sequence = Math.floor(index / 10), day = Math.floor(sequence / 5), slot = sequence % 5;
      const base = startDay.getTime() + (Math.floor(day / 5) * 7 + day % 5) * 86400000 + (1 + slot * 2) * 3600000;
      const timestamp = (step: number) => new Date(base + step * 1000).toISOString();
      const id = randomUUID(), rows: unknown[] = [{ timestamp: timestamp(0), type: 'session_meta', payload: { id } }];
      const usage = (n: number) => ({ timestamp: timestamp(n * 40), type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: {
        input_tokens: n * 100, cached_input_tokens: n * 20, output_tokens: n * 25, reasoning_output_tokens: 0, total_tokens: n * 125 } } } });
      const baseline = usage(0); baseline.timestamp = new Date(startDay.getTime() - 2 * 86400000).toISOString(); rows.push(baseline);
      for (let turn = 0; turn < 20; turn++) {
        rows.push({ timestamp: timestamp(turn * 40 + 1), type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: `合成会话${index}轮${turn}：核查接口并补充测试。` }] } });
        rows.push({ timestamp: timestamp(turn * 40 + 2), type: 'response_item', payload: { type: 'function_call', name: 'shell', call_id: `tool-${turn}`, arguments: '{"command":"npm test"}' } });
        rows.push({ timestamp: timestamp(turn * 40 + 3), type: 'response_item', payload: { type: 'function_call_output', call_id: `tool-${turn}`, output: '# tests 3\n# pass 3\n# fail 0\n' } });
        rows.push({ timestamp: timestamp(turn * 40 + 4), type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: `合成回执${turn}。` }] } });
        rows.push(usage(turn + 1));
      }
      const bytes = encode(rows); bytesTotal += bytes.length;
      await upload(index, id, bytes, timestamp(0));
      if (index === 0) firstInput = { id, bytes, timestamp: timestamp(900) };
      uploaded++;
    }
  }));
  report.uploadMs = performance.now() - started; report.originalBytes = bytesTotal;
  const path = '/api/metrics?period=since-enrollment', reader = devices[0]!.readerCredential;
  let initial: MetricsPage | undefined;
  for (let iteration = 0; iteration < 11; iteration++) {
    const start = performance.now(), result: MetricsPage = await checked(path, reader);
    timings.push(performance.now() - start);
    assert.deepEqual([result.totals.sessions, result.totals.userTurns, result.totals.toolCalls, result.totals.inputTokens, result.totals.outputTokens], [1000, 20000, 20000, 2000000, 500000]);
    if (!initial) initial = result; else assert.deepEqual(result, initial, 'unchanged live reads retain the same result version');
    console.log(JSON.stringify({ read: iteration, ms: Math.round(timings.at(-1)!), sessions: result.totals.sessions }));
  }
  const warm = timings.slice(1).sort((a, b) => a - b);
  report.subsequentP50Ms = warm[4]; report.subsequentP95Ms = warm[9];
  assert.deepEqual(await checked('/api/metrics/recompute', reader, json({ period: 'since-enrollment' })), initial, 'full recomputation preserves the frozen result');
  const scoped = await Promise.all(devices.slice(0, 2).map(device => checked(path + '&employeeId=' + device.employeeId, reader)));
  for (const result of scoped) assert.deepEqual([result.totals.sessions, result.totals.userTurns, result.totals.inputTokens], [100, 2000, 200000]);
  const more = Buffer.concat([firstInput!.bytes, encode([
    { timestamp: firstInput!.timestamp, type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '接续原会话，保留历史版本。' }] } },
    { timestamp: firstInput!.timestamp, type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 2100, cached_input_tokens: 420, output_tokens: 525, reasoning_output_tokens: 0, total_tokens: 2625 } } } }
  ])]);
  await upload(0, firstInput!.id, more, firstInput!.timestamp);
  const next: MetricsPage = await checked(path, reader);
  assert.notEqual(next.version, initial!.version);
  assert.deepEqual([next.totals.sessions, next.totals.userTurns, next.totals.toolCalls, next.totals.inputTokens, next.totals.outputTokens], [1000, 20001, 20000, 2000100, 500025]);
  assert.deepEqual(await checked(path + '&version=' + initial!.version, reader), initial, 'later input cannot overwrite an earlier fixed result');
  assert.deepEqual(await checked('/api/metrics/recompute', reader, json({ period: 'since-enrollment' })), next);
  report.correctness = 'known totals, concurrent scopes, recomputation, changed input and historical version passed';
  // Collect the full distribution and verify result semantics even when the
  // first sample is slow. Threshold failures remain failures, not skipped work.
  assert.ok(timings[0]! <= 3000, `First read ${Math.round(timings[0]!)}ms exceeds 3000ms`);
  assert.ok(warm[9]! <= 1000, `Subsequent P95 ${Math.round(warm[9]!)}ms exceeds 1000ms`);
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = String(error); throw error; }
finally {
  Object.assign(report, { uploaded, readsMs: timings, firstReadMs: timings[0], sandboxDirectory: sandbox.directory });
  await writeFile(destination, JSON.stringify(report, null, 2));
  console.log(`Metrics performance evidence: ${destination}`);
  await sandbox.close();
}
