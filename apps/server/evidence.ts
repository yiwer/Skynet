import { z } from 'zod';
import type { EvidenceLine } from '../../packages/contracts/archive.js';

const identifier = z.string().min(1);
const textPart = z.object({ type: z.enum(['input_text', 'output_text']), text: z.string() });
const recordSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('session_meta'), payload: z.object({ id: identifier }) }),
  z.object({
    type: z.literal('response_item'),
    timestamp: z.iso.datetime({ offset: true }).optional(),
    payload: z.discriminatedUnion('type', [
      z.object({ type: z.literal('message'), role: z.enum(['user', 'assistant', 'system', 'developer']),
        content: z.array(textPart).min(1).refine(parts => parts.some(part => part.text.length > 0)) }),
      z.object({ type: z.literal('function_call'), name: identifier, arguments: z.string(), call_id: identifier }),
      z.object({ type: z.literal('function_call_output'), output: z.string(), call_id: identifier }),
    ]),
  }),
]);

export function readEvidence(bytes: Buffer) {
  const lines = bytes.toString('utf8').split('\n');
  const partialLine = lines.pop()!;
  const events: EvidenceLine[] = [];
  let unrecognizedLines = 0;
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    try {
      // Count a source line only when its whole supported event is readable. In particular,
      // extracting text beside an unsupported image would falsely imply a complete message.
      const parsed = recordSchema.safeParse(JSON.parse(line));
      if (!parsed.success) { unrecognizedLines++; continue; }
      const item = parsed.data;
      if (item.type === 'session_meta') continue;
      const payload = item.payload;
      let role: string;
      let text: string;
      if (payload.type === 'message') {
        role = payload.role;
        text = payload.content.map(part => part.text).join('\n');
      } else if (payload.type === 'function_call') {
        role = 'tool request'; text = `${payload.name}\n${payload.arguments}`;
      } else {
        role = 'tool result'; text = payload.output;
      }
      events.push({ line: index + 1, role, text, timestamp: item.timestamp ?? null });
    } catch { unrecognizedLines++; }
  }
  return { parserVersion: 'codex-jsonl-2', events, unrecognizedLines, partialLine: partialLine.length > 0 };
}
