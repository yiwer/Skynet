import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeStatistics } from '../packages/native-statistics.js';
import { recordedIntervals } from '../apps/server/work-statistics.js';

test('source token counters keep a cumulative baseline, repeated counts, reset and unknown fields distinct', () => {
  const row = (timestamp: string, total: number) => ({ timestamp, type: 'event_msg', payload: { type: 'token_count', info: {
    total_token_usage: { input_tokens: total * 2 / 3, cached_input_tokens: total / 3, output_tokens: total / 3, reasoning_output_tokens: 0, total_tokens: total },
  } } });
  const bytes = Buffer.from([row('2026-09-28T00:00:00Z', 30), row('2026-09-28T00:01:00Z', 60), row('2026-09-28T00:02:00Z', 60), row('2026-09-28T00:03:00Z', 90), row('2026-09-28T00:04:00Z', 30)].map(value => JSON.stringify(value)).join('\n') + '\n');
  const actual = nativeStatistics(bytes, 'codex-cli', '0.157.1');
  assert.equal(actual.usage.length, 4); assert.equal(actual.usage[0]!.value, null);
  assert.deepEqual(actual.usage[2]!.value, { input: 20, cachedInput: 10, cacheWriteInput: null, output: 10, reasoningOutput: 0, total: 30 });
  assert.equal(actual.usage[3]!.value, null);
});

test('Claude blocks sharing message ID count usage once, file paths require supported structured arguments', () => {
  const row = { type: 'assistant', timestamp: '2026-09-28T00:01:00Z', message: { id: 'message-1', usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 10, cache_creation_input_tokens: 5 },
    content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/synthetic/code.ts' } }, { type: 'tool_use', name: 'Bash', input: { command: 'cat /not-proven.ts' } }] } };
  const actual = nativeStatistics(Buffer.from(`${JSON.stringify(row)}\n${JSON.stringify(row)}\n`), 'claude-code-cli', '2.1.281');
  assert.equal(actual.usage.length, 1); assert.equal(actual.usage[0]!.value!.total, 135);
  assert.deepEqual(actual.files[0]!.paths, ['/synthetic/code.ts']); assert.equal(actual.files[1]!.supported, false);
  assert.throws(() => nativeStatistics(Buffer.from([0xff, 10]), 'codex-cli', '0.157.1'));
});

test('activity intervals group only timestamp points in the source day and never calculate human hours', () => {
  const event = (timestamp: string) => ({ device_id: 'original', source: 'codex-cli' as const, source_session_id: 'session', timestamp });
  const actual = recordedIntervals([event('2026-09-27T16:00:00Z'), event('2026-09-27T16:05:00Z'), event('2026-09-27T16:16:00Z'), event('2026-09-27T15:59:00Z')], '2026-09-28');
  assert.deepEqual(actual.map(value => [value.from, value.to, value.points]), [['2026-09-27T16:00:00.000Z', '2026-09-27T16:05:00.000Z', 2], ['2026-09-27T16:16:00.000Z', '2026-09-27T16:16:00.000Z', 1]]);
});
