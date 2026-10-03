import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activityFor } from '../packages/activity.js';
import { conversationInputSchema, conversationLink } from '../packages/contracts/conversation.js';
import { readEvidence } from '../apps/server/evidence.js';
import { projectConversation } from '../apps/server/conversation.js';

test('conversation keeps native Claude block order and never upgrades assistant statements to verified facts', () => {
  const original = Buffer.from([
    { type: 'user', timestamp: '2026-01-01T00:00:00Z', message: { role: 'user', content: '旧指令\n原文😀' } },
    { type: 'assistant', message: { role: 'assistant', content: [
      { type: 'text', text: '所有测试通过，仅为自述' },
      { type: 'tool_use', id: 'read-1', name: 'Read', input: { path: 'synthetic.txt' } },
    ] } },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'read-1', content: '并没有测试通过的结果' }] } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '读取结束' }, { type: 'text', text: '中文🚀 原样保留' }] } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tail', name: 'Read', input: {} }] } },
  ].map(value => JSON.stringify(value)).join('\n') + '\n');
  const evidence = readEvidence(original, 'claude-code-cli');
  const projection = projectConversation(activityFor(evidence.events, '2026-02-01T00:00:00Z').events);
  assert.deepEqual(projection.messages.map(event => [event.line, event.block ?? 0, event.role]),
    [[1, 0, 'user'], [2, 0, 'assistant'], [2, 1, 'tool request'], [3, 0, 'tool result'], [4, 0, 'assistant'], [4, 1, 'assistant'], [5, 0, 'tool request']]);
  assert.equal(projection.messages[0]!.context, 'historical');
  assert.equal(projection.messages[0]!.text, '旧指令\n原文😀');
  assert.equal(projection.messages[1]!.toolEvidence, 'none-observed');
  assert.equal(projection.messages[4]!.toolEvidence, 'present-not-assessed');
  assert.equal(projection.messages[4]!.hiddenToolCalls, 1);
  assert.equal(projection.messages[4]!.hiddenToolEvents, 2);
  assert.equal(projection.messages[5]!.hiddenToolCalls, 0);
  assert.equal(projection.messages[5]!.text, '中文🚀 原样保留');
  assert.equal(projection.totalToolCalls, 2);
  assert.equal(projection.totalToolEvents, 3);
  assert.equal(projection.trailingHiddenToolCalls, 1);
  assert.equal(projection.trailingHiddenToolEvents, 1);
});

test('conversation anchors stay distinct from raw/material evidence and force exact tool hits open', () => {
  const snapshot = '12345678-1234-4234-9234-123456789012';
  assert.equal(conversationLink(snapshot, { kind: 'raw', line: 1, textOffset: 0 }), null);
  assert.equal(conversationLink(snapshot, { kind: 'material', materialId: 'child', textOffset: 0 }), null);
  assert.equal(conversationLink(snapshot, { kind: 'event', offset: 9, textOffset: 0 }), null, 'an event index alone is not an original message anchor');
  const link = conversationLink(snapshot, { kind: 'event', offset: 999, line: 4, block: 2, textOffset: 8, parserVersion: 'claude-jsonl-3' });
  assert.equal(link, `#${snapshot}?view=conversation&line=4&block=2&textOffset=8&parserVersion=claude-jsonl-3&includeTools=true`);
  assert.equal(conversationInputSchema.safeParse({ cursor: 'old', anchor: { line: 1 } }).success, false);
});
