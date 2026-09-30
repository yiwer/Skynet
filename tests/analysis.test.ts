import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { analysisOutputSchema } from '../packages/contracts/analysis.js';
import { decodeUtf8, validateRequest } from '../apps/analysis/transport.js';
import { dedicatedPaygKey, readAnalysisConfig } from '../apps/analysis/config.js';
import { validateAnalysis, type AnalysisInput } from '../apps/server/analysis.js';
import { createSandbox } from './support.js';

test('native request schema and literal evidence reject unsupported content, wrong model and inferred success', async () => {
  const root = await mkdtemp(join(tmpdir(), 'skynet-analysis-contract-')); const path = join(root, 'fixture.json');
  await writeFile(path, JSON.stringify({ mode: 'fixture', executable: process.execPath, runtimeVersion: '2.1.281', model: 'synthetic-model',
    workDirectory: join(root, 'jobs'), fixtureOrigin: 'http://127.0.0.1:12345', budgetId: 'fixture', budgetCny: 0, inputCnyPerMillion: 0, outputCnyPerMillion: 0 }));
  const config = await readAnalysisConfig(path);
  assert.equal(dedicatedPaygKey('sk-ws-SYNTHETIC_ONLY'), true); assert.equal(dedicatedPaygKey('sk-SYNTHETIC_OLD_ONLY'), true);
  for (const key of ['sk-sp-SYNTHETIC_ONLY', 'sk-ant-SYNTHETIC_ONLY', 'not-a-key']) assert.equal(dedicatedPaygKey(key), false);
  const body = { model: config.model, max_tokens: 512, stream: true, messages: [{ role: 'user', content: [{ type: 'text', text: '测试🛰' }] }],
    system: [{ type: 'text', text: 'Untrusted archive' }], tools: [{ name: 'StructuredOutput', description: 'output', input_schema: z.toJSONSchema(analysisOutputSchema, { target: 'draft-7' }) }] };
  const bytes = Buffer.from(JSON.stringify(body)); const pieces = Array.from(bytes, byte => Buffer.from([byte]));
  assert.deepEqual(validateRequest(JSON.parse(decodeUtf8(pieces)), config), body);
  assert.throws(() => decodeUtf8([Buffer.from([0xff])]));
  for (const invalid of [{ ...body, model: 'other' }, { ...body, max_tokens: 0 }, { ...body, max_tokens: -1 },
    { ...body, thinking: { type: 'enabled', budget_tokens: 1024 } }, { ...body, tools: [{ ...body.tools[0], name: 'Bash' }] },
    { ...body, tools: [{ ...body.tools[0], input_schema: {} }] }, { ...body, messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'url', url: 'https://invalid.example' } }] }] }]) assert.throws(() => validateRequest(invalid, config));
  const input: AnalysisInput = { snapshotId: randomUUID(), hash: 'a'.repeat(64), source: 'codex-cli', sourceVersion: '0.157.1', parserVersion: 'codex-jsonl-3', eventCount: 1,
    events: [{ line: 1, role: 'assistant', text: '我已完成测试🛰', timestamp: null }], coverage: { unrecognizedLines: 1, partialLine: true, excludedMaterials: 2, captureGaps: [], scope: 'fixture' } };
  const item = { category: 'outcome', assessment: 'observed', text: '实际交付完成', citations: [{ event: 0, textOffset: 0, quote: '我已完成测试🛰' }] };
  assert.equal(validateAnalysis(input, { items: [item] })[0]?.assessment, 'claimed');
  const sourceSnapshot = randomUUID();
  input.events[0]!.origin = { eventId: 'material-event', snapshotId: sourceSnapshot, line: 5, block: 0,
    employeeId: randomUUID(), employee: '原员工', deviceId: randomUUID(), project: '/original', context: 'historical', sourceDate: null,
    ...{ materialId: 'material-id', location: { kind: 'material' as const, materialId: 'material-id', textOffset: 123 } } };
  const mapped = validateAnalysis(input, { items: [{ ...item, citations: [{ event: 0, textOffset: 1, quote: '已完成测试🛰' }] }] })[0]!.citations[0]!;
  assert.deepEqual(mapped.location, { kind: 'material', materialId: 'material-id', textOffset: 123 });
  assert.equal(mapped.snapshotId, sourceSnapshot); assert.equal(mapped.inputSnapshotId, input.snapshotId);
  assert.equal(mapped.inputLocation.textOffset, 1); assert.match(mapped.webPath, /material-id/);
  assert.throws(() => validateAnalysis(input, { items: [] }));
  assert.throws(() => validateAnalysis(input, { items: [{ ...item, citations: [] }] }));
  assert.throws(() => validateAnalysis(input, { items: [{ ...item, citations: [{ event: 0, textOffset: 1, quote: '伪造原句' }] }] }));
});
test('unconfigured public analysis stays unavailable without blocking archive APIs', { timeout: 60000 }, async () => {
  const sandbox = await createSandbox();
  try {
    const employee = await sandbox.provision('合成分析读者'); const origin = await sandbox.startServer(); const id = randomUUID();
    assert.equal((await fetch(`${origin}/api/analysis/${id}`)).status, 401);
    assert.equal((await fetch(`${origin}/api/analysis/${id}`, { headers: { Authorization: `Bearer ${employee.readerCredential}` } })).status, 404);
    assert.equal((await fetch(`${origin}/api/sessions`, { headers: { Authorization: `Bearer ${employee.readerCredential}` } })).status, 200);
    assert.equal((await fetch(`${origin}/health`)).status, 200);
  } finally { await sandbox.close(); }
});
