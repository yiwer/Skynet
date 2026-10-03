import { z } from 'zod';
import { sourceTimestamp, type EvidenceLine } from '../contracts/archive.js';
import {completeOriginalLines,partialOriginalLine} from './raw-lines.js';

const text = z.object({ type: z.literal('text'), text: z.string() });
const toolUse = z.object({ type: z.literal('tool_use'), id: z.string().min(1), name: z.string().min(1), input: z.record(z.string(), z.unknown()) });
const toolResult = z.object({ type: z.literal('tool_result'), tool_use_id: z.string().min(1),
  content: z.union([z.string(), z.array(text)]), is_error: z.boolean().optional() });
const messageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('user'), timestamp: z.unknown().optional(),
    message: z.object({ role: z.literal('user'), content: z.union([z.string(), z.array(z.union([text, toolResult])).min(1)]) }) }),
  z.object({ type: z.literal('assistant'), timestamp: z.unknown().optional(),
    message: z.object({ role: z.literal('assistant'), content: z.array(z.union([text, toolUse])).min(1) }) }),
]);

// Claude has no session_meta header. Queue records may precede the first message.
// Validate all complete records bearing native identity; never infer it from a filename alone.
export function claudeIdentity(bytes: Buffer, expectedSessionId: string) {
  let version: string | undefined;
  let messageFound = false;
  for (const line of bytes.toString('utf8').split('\n').slice(0, -1)) {
    if (!line.trim()) continue;
    let item: unknown;
    try { item = JSON.parse(line); } catch { continue; } // Preserve damaged/unknown raw bytes as an evidence gap.
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    if (record.sessionId !== undefined && record.sessionId !== expectedSessionId) throw new Error('Native session identity mismatch');
    if (record.type === 'user' || record.type === 'assistant') {
      if (record.sessionId !== expectedSessionId || typeof record.uuid !== 'string' || typeof record.version !== 'string') continue;
      messageFound = true; version = record.version;
    }
  }
  if (!messageFound) throw new Error('Claude transcript has no complete identified message yet');
  return { version: version! };
}

export function readClaudeEvidence(bytes: Buffer) {
  const events: EvidenceLine[] = [];
  let unrecognizedLines = 0;
  for (const {line:lineNumber,text:line} of completeOriginalLines(bytes)) {
    if(line===null){unrecognizedLines++;continue;}
    if (!line.trim()) continue;
    try {
      const parsed = messageSchema.safeParse(JSON.parse(line));
      if (!parsed.success) { unrecognizedLines++; continue; }
      const item = parsed.data;
      const content = item.message.content;
      if (typeof content === 'string') {
        events.push({ line: lineNumber, role: 'user', text: content, timestamp: sourceTimestamp(item.timestamp) });
        continue;
      }
      // Validate the entire message before emitting any block: unsupported images/thinking
      // remain visible as an unparsed line, never as a supposedly complete text message.
      for (const [block, part] of content.entries()) {
        let role: string; let rendered: string;
        if (part.type === 'text') { role = item.type; rendered = part.text; }
        else if (part.type === 'tool_use') { role = 'tool request'; rendered = `${part.name} (${part.id})\n${JSON.stringify(part.input, null, 2)}`; }
        else { role = 'tool result'; rendered = `${part.tool_use_id}${part.is_error ? ' · error' : ''}\n${typeof part.content === 'string' ? part.content : part.content.map(p => p.text).join('\n')}`; }
        events.push({ line: lineNumber, block, role, text: rendered, timestamp: sourceTimestamp(item.timestamp) });
      }
    } catch { unrecognizedLines++; }
  }
  return { parserVersion: 'claude-jsonl-3', events, unrecognizedLines, partialLine: partialOriginalLine(bytes) };
}
