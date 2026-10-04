import { z } from 'zod';
import { sourceTimestamp, type EvidenceLine, type Source } from '../../packages/contracts/archive.js';
import { readClaudeEvidence } from '../../packages/native/claude.js';
import {completeOriginalLines,partialOriginalLine} from '../../packages/native/raw-lines.js';
import type { PreparedOriginal } from '../../packages/native/prepared-original.js';

const identifier = z.string().min(1);
const textPart = z.object({ type: z.enum(['input_text', 'output_text']), text: z.string() });
const toolOutput = z.union([z.string(), z.array(textPart)]);
const recordSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('session_meta'), payload: z.object({ id: identifier }) }),
  z.object({
    type: z.literal('response_item'),
    timestamp: z.unknown().optional(),
    payload: z.discriminatedUnion('type', [
      z.object({ type: z.literal('message'), role: z.enum(['user', 'assistant', 'system', 'developer']),
        content: z.array(textPart).min(1).refine(parts => parts.some(part => part.text.length > 0)) }),
      z.object({ type: z.literal('function_call'), name: identifier, namespace: identifier.optional(), arguments: z.string(), call_id: identifier }),
      z.object({ type: z.literal('function_call_output'), output: toolOutput, call_id: identifier }),
      z.object({ type: z.literal('custom_tool_call'), name: identifier, input: z.string(), call_id: identifier }),
      z.object({ type: z.literal('custom_tool_call_output'), output: toolOutput, call_id: identifier }),
    ]),
  }),
]);

export function readEvidence(bytes: Buffer, source: Source = 'codex-desktop', prepared?: PreparedOriginal) {
  if (source === 'claude-code-cli') return readClaudeEvidence(bytes, prepared);
  const events: EvidenceLine[] = [];
  let unrecognizedLines = 0;
  for (const record of prepared?.records ?? completeOriginalLines(bytes)) {
    const { line: lineNumber, text: line } = record;
    if(line===null){unrecognizedLines++;continue;}
    if (!line.trim()) continue;
    try {
      // Count a source line only when its whole supported event is readable. In particular,
      // extracting text beside an unsupported image would falsely imply a complete message.
      const value = 'parsed' in record ? (record.parsed ? record.value : undefined) : JSON.parse(line);
      // Unsupported auxiliary rows still count as unrecognized here; only the
      // coverage reader can qualify them. Avoid allocating a schema error per
      // known non-business row while keeping the same accepted event formats.
      if (value?.type !== 'session_meta' && value?.type !== 'response_item') { unrecognizedLines++; continue; }
      const parsed = recordSchema.safeParse(value);
      if (!parsed.success) { unrecognizedLines++; continue; }
      const item = parsed.data;
      if (item.type === 'session_meta') continue;
      const payload = item.payload;
      let role: string;
      let text: string;
      if (payload.type === 'message') {
        role = payload.role;
        text = payload.content.map(part => part.text).join('\n');
      } else if (payload.type === 'custom_tool_call') {
        role = 'tool request'; text = `${payload.name}\n${payload.input}`;
      } else if (payload.type === 'function_call') {
        role = 'tool request'; text = `${payload.namespace ? `${payload.namespace}.` : ''}${payload.name}\n${payload.arguments}`;
      } else {
        role = 'tool result'; text = typeof payload.output === 'string' ? payload.output : payload.output.map(part => part.text).join('\n');
      }
      events.push({ line: lineNumber, role, text, timestamp: sourceTimestamp(item.timestamp) });
    } catch { unrecognizedLines++; }
  }
  return { parserVersion: 'codex-jsonl-4', events, unrecognizedLines, partialLine: partialOriginalLine(bytes) };
}
