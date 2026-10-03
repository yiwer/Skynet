import test from 'node:test';
import assert from 'node:assert/strict';
import { activityFor } from '../packages/activity.js';
import { readEvidence } from '../apps/server/evidence.js';
import { projectConversation } from '../apps/server/conversation.js';
import { conversationContext, displayCharacters, readConversationTrace } from '../apps/server/conversation-trace.js';

const bytes = (rows: unknown[]) => Buffer.from(rows.map(row => JSON.stringify(row)).join('\n') + '\n');
const response = (payload: unknown) => ({ type: 'response_item', payload });

test('native task seconds and item milliseconds retain their distinct recorded timing bases', () => {
  const start = 1_791_024_000;
  const traces = readConversationTrace(bytes([
    { type: 'event_msg', payload: { type: 'task_complete', turn_id: 'turn', started_at: start, completed_at: start + 30, duration_ms: 30_072 } },
    { type: 'event_msg', payload: { type: 'item_completed', turn_id: 'turn', started_at_ms: start * 1000 + 1, completed_at_ms: start * 1000 + 13,
      item: { id: 'item', type: 'CommandExecution', duration: { secs: 0, nanos: 12_700_000 }, exit_code: 0 } } },
    { type: 'event_msg', payload: { type: 'item_completed', item: { id: 'overflow', type: 'CommandExecution', duration: { secs: Number.MAX_VALUE, nanos: 0 } } } },
    { type: 'event_msg', payload: { type: 'task_complete', turn_id: 'long-time', started_at: `2026-10-03T00:00:00.${'0'.repeat(3000)}Z` } },
  ]), 'codex-cli');
  assert.equal(traces.spans[0]!.startedAt, new Date(start * 1000).toISOString());
  assert.equal(traces.spans[0]!.completedAt, new Date((start + 30) * 1000).toISOString());
  assert.equal(traces.spans[0]!.durationMs, 30_072);
  assert.equal(traces.spans[0]!.durationSource, 'recorded');
  assert.equal(traces.spans[1]!.durationMs, 12);
  assert.equal(traces.spans[1]!.executionDurationMs, 12.7);
  assert.equal(traces.spans[2]!.executionDurationMs, undefined);
  assert.equal(traces.spans[3]!.startedAt, undefined, 'unbounded ISO fractional precision cannot consume the whole trace page');
});

test('metadata is bounded without truncating identities or hiding mixed user requests', () => {
  const long = 'x'.repeat(2049);
  const data = bytes([
    { type: 'turn_context', payload: { turn_id: 'valid-turn', model: long } },
    response({ type: 'custom_tool_call', id: long, call_id: long, name: long, input: 'full raw input', phase: long, status: long }),
    response({ type: 'message', id: 'exact', role: 'assistant', internal_chat_message_metadata_passthrough: { turn_id: long }, content: [{ type: 'output_text', text: 'body' }] }),
    { type: 'event_msg', payload: { type: 'item_completed', turn_id: 'valid-turn', started_at_ms: 1000, completed_at_ms: 2000, item: { type: 'AgentMessage', id: 'exact' } } },
  ]);
  const traces = readConversationTrace(data, 'codex-cli');
  assert.deepEqual(traces.events.get('2/0'), { turnId: 'valid-turn' });
  assert.deepEqual(traces.events.get('3/0'), { nativeId: 'exact' }, 'an explicit invalid turn cannot fall back to the surrounding turn');
  const raw = readEvidence(data, 'codex-cli');
  assert.equal(raw.events[0]!.text, `${long}\nfull raw input`);
  for (const text of ['<environment_context>paths</environment_context>\nuser',
    'user\n<environment_context>paths</environment_context>',
    '<environment_context>a</environment_context>user<environment_context>b</environment_context>']) {
    assert.equal(conversationContext({ line: 1, role: 'user', text, timestamp: null }), undefined);
  }
});

test('different native identity tuples cannot collide through embedded NUL characters', () => {
  const traces = readConversationTrace(bytes([
    response({ type: 'message', role: 'assistant', id: 'c', internal_chat_message_metadata_passthrough: { turn_id: 'a\0b' }, content: [{ type: 'output_text', text: 'source' }] }),
    { type: 'event_msg', payload: { type: 'item_completed', turn_id: 'a', started_at_ms: 1000, completed_at_ms: 2000,
      item: { type: 'AgentMessage', id: 'b\0c' } } },
  ]), 'codex-cli');
  assert.equal(traces.events.get('1/0')!.traceLine, undefined);
  assert.equal(traces.events.get('1/0')!.durationMs, undefined);
  assert.equal(traces.spans[0]!.durationMs, 1000, 'the independently recorded span remains readable');
});

test('maximal valid metadata leaves room for text and exact Claude peers do not add duplicate events', () => {
  const max = (length: number) => 'x'.repeat(length);
  const trace = { nativeId: max(256), callId: max(256), turnId: max(256), model: max(128), channel: max(64),
    toolName: max(127), status: max(64), startedAt: new Date(0).toISOString(), completedAt: new Date(1).toISOString(),
    durationMs: 1, durationSource: 'source-timestamps' as const };
  const projected = projectConversation(activityFor([
    { line: 1, role: 'tool request', text: 'input', timestamp: null },
    { line: 2, role: 'tool result', text: 'output', timestamp: null },
  ], '2026-01-01T00:00:00Z').events.map(event => ({ ...event, trace })));
  for (const event of projected.messages) assert.ok(displayCharacters({ trace: event.trace, tool: event.tool }) < 2046);

  const original = bytes([
    { type: 'assistant', uuid: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tool', name: 'Read', input: { path: 'synthetic' } }] } },
    { type: 'user', uuid: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool', content: 'original result' }] } },
  ]);
  const evidence = readEvidence(original, 'claude-code-cli');
  const decoration = readConversationTrace(original, 'claude-code-cli');
  const conversation = projectConversation(activityFor(evidence.events, '2026-01-01T00:00:00Z').events.map(event =>
    ({ ...event, trace: decoration.events.get(`${event.line}/${event.block ?? 0}`) })));
  assert.equal(evidence.parserVersion, 'claude-jsonl-3');
  assert.equal(conversation.messages.length, 2);
  assert.equal(conversation.messages[1]!.tool?.association, 'paired');
  assert.equal(conversation.messages[1]!.tool?.name, 'Read');
  assert.deepEqual(conversation.messages[1]!.tool?.peer, { line: 1, block: 0, role: 'tool request' });
  assert.equal(decoration.spans.length, 0);
});
