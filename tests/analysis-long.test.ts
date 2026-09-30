import test from 'node:test';
import assert from 'node:assert/strict';
import { executeAnalysis } from '../apps/analysis/execute.js';
import { mapOutput, planSegments } from '../apps/analysis/long.js';
import type { AnalysisInput } from '../apps/server/analysis.js';
import type { AnalysisConfig } from '../apps/analysis/config.js';

const input: AnalysisInput = { snapshotId: 'immutable', hash: 'unchanged', source: 'codex-cli', sourceVersion: 'measured', parserVersion: 'same', eventCount: 2,
  coverage: { unrecognizedLines: 1, partialLine: true, excludedMaterials: 1, captureGaps: ['missing'], scope: 'parsed original only' },
  events: [{ role: 'user', text: 'BEGIN🛰' + '中🛰'.repeat(1800), line: 2, timestamp: null }, { role: 'tool result', text: 'END🛰', line: 3, timestamp: null }] };
const config = { maxInputBytes: 4096, maxSegments: 16, maxRequests: 32, mode: 'fixture' } as AnalysisConfig;
const usage = { inputTokens: 10, outputTokens: 2, runtimeCostUsd: null, requests: 1, providerBilledCny: null };
test('bounded long extraction maps giant-event UTF16 spans to original and aggregates only validated quotes', async () => {
  const plan = planSegments(input, config); assert.ok(plan.stages.length > 3); assert.equal(plan.skipped, undefined);
  for (const stage of plan.stages) {
    assert.ok(Buffer.byteLength(JSON.stringify(stage.input)) <= config.maxInputBytes);
    for (const event of stage.input.events) assert.ok(!/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(event.text));
  }
  const reconstructed = plan.stages.flatMap(stage => stage.input.events.map((event, index) => ({ text: event.text, anchor: stage.anchors[index]! })))
    .filter(event => event.anchor.event === 0).map(event => event.text).join(''); assert.equal(reconstructed, input.events[0]!.text);
  let calls = 0;
  const result = await executeAnalysis(config, input, new AbortController().signal, async () => true, async (_config, selected, _signal, forward) => {
    assert.equal(await forward!(), true); calls++;
    const citations = selected.analysisContext?.phase === 'aggregate'
      ? selected.events.map((event, index) => ({ event: index, textOffset: 0, quote: event.text })).slice(0, 3)
      : [{ event: 0, textOffset: 0, quote: selected.events[0]!.text.slice(0, 6) }];
    return { usage, output: { items: [{ category: 'topic', assessment: 'inferred', text: '跨段归纳', citations }] } };
  });
  assert.equal(calls, plan.stages.length + 1); assert.equal(result.processing!.complete, true); assert.equal(result.processing!.aggregation, 'succeeded');
  for (const citation of result.items[0]!.citations) assert.equal(input.events[citation.event]!.text.slice(citation.textOffset, citation.textOffset + citation.quote.length), citation.quote);
  assert.equal(result.items[0]!.citations[1]!.inputLocation.kind, 'event'); assert.ok(result.items[0]!.citations[1]!.textOffset > 0);
});
test('failed and skipped segments remain partial; failed usage is unknown and all stages share request budget', async () => {
  let calls = 0;
  const result = await executeAnalysis({ ...config, maxRequests: 3, maxSegments: 2 }, input, new AbortController().signal, async () => true, async (_config, selected, _signal, forward) => {
    assert.equal(await forward!(), true); calls++;
    if (calls === 2) throw new Error('controlled segment failure');
    return { usage, output: { items: [{ category: 'topic', assessment: 'claimed', text: '原句', citations: [{ event: 0, textOffset: 0, quote: selected.events[0]!.text.slice(0, 6) }] }] } };
  });
  assert.equal(result.processing!.complete, false); assert.deepEqual(result.processing!.ranges.map(range => range.state), ['extracted', 'failed', 'skipped']);
  assert.equal(result.usage.requests, 3); assert.equal(result.usage.inputTokens, null); assert.equal(calls, 3);
  const strict = await executeAnalysis({ ...config, maxRequests: 1 }, input, new AbortController().signal, async () => true, async (_config, selected, _signal, forward) => {
    assert.equal(await forward!(), true); assert.equal(await forward!(), false);
    return { usage, output: { items: [{ category: 'topic', assessment: 'claimed', text: '原句', citations: [{ event: 0, textOffset: 0, quote: selected.events[0]!.text.slice(0, 6) }] }] } };
  });
  assert.equal(strict.usage.requests, 1); assert.equal(strict.processing!.complete, false);
});
test('segment boundaries reject a quote outside selection and aggregate rejects summary or substring as original citation', async () => {
  const stage = planSegments(input, config).stages[0]!;
  assert.throws(() => mapOutput(stage, { items: [{ category: 'topic', assessment: 'claimed', text: 'x', citations: [{event:0,textOffset:stage.input.events[0]!.text.length,quote:'中'}] }] }));
  let calls = 0;
  const result = await executeAnalysis(config, input, new AbortController().signal, async () => true, async (_config, selected, _signal, forward) => {
    await forward!(); calls++;
    const aggregate = selected.analysisContext?.phase === 'aggregate';
    return { usage, output: { items: [{ category: 'topic', assessment: 'claimed', text: 'INTERMEDIATE_SUMMARY_NOT_EVIDENCE', citations: [{event:0,textOffset:aggregate?1:0,quote:selected.events[0]!.text.slice(aggregate?1:0,6)}] }] } };
  });
  assert.ok(calls > 2); assert.equal(result.processing!.aggregation, 'failed'); assert.equal(result.processing!.complete, false);
  assert.ok(result.items.every(item => item.citations.every(citation => input.events[citation.event]!.text.slice(citation.textOffset,citation.textOffset+citation.quote.length) === citation.quote)));
});
