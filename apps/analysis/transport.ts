import { z } from 'zod';
import { analysisOutputSchema } from '../../packages/contracts/analysis.js';
import type { AnalysisConfig } from './config.js';

const text = z.string().max(1_048_576);
const cache = z.object({ type: z.literal('ephemeral'), ttl: z.enum(['5m', '1h']).optional() }).strict();
const textBlock = z.object({ type: z.literal('text'), text, cache_control: cache.optional() }).strict();
// Tool-use history does not advertise or enable a tool. The native CLI returns an error for
// unsolicited tools; permitting that error history lets it finish with StructuredOutput.
const block = z.union([textBlock,
  z.object({ type: z.literal('tool_use'), id: z.string().max(256), name: z.string().max(128), input: z.record(z.string(), z.unknown()) }).strict(),
  z.object({ type: z.literal('tool_result'), tool_use_id: z.string().max(256), content: z.union([text, z.array(textBlock).max(32)]),
    is_error: z.boolean().optional(), cache_control: cache.optional() }).strict(),
]);
const schema = z.object({ model: z.string(), max_tokens: z.number().int().positive(), stream: z.literal(true),
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.union([text, z.array(block).max(256)]) }).strict()).min(1).max(64),
  system: z.array(textBlock).max(32),
  tools: z.array(z.object({ name: z.literal('StructuredOutput'), description: z.string().max(2048), input_schema: z.unknown() }).strict()).length(1),
  metadata: z.object({ user_id: z.string().max(2048) }).strict().optional(),
  context_management: z.object({ edits: z.array(z.object({ type: z.literal('clear_thinking_20251015'), keep: z.literal('all') }).strict()).max(1) }).strict().optional(),
}).strict();
const expected = z.toJSONSchema(analysisOutputSchema);
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, part]) => `${JSON.stringify(key)}:${canonical(part)}`).join(',')}}`;
  return JSON.stringify(value);
}
export function decodeUtf8(parts: Buffer[]) { return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts)); }
export function validateRequest(value: unknown, config: AnalysisConfig) {
  const parsed = schema.parse(value);
  if (parsed.model !== config.model || parsed.max_tokens > config.maxOutputTokens) throw new Error('Model/output limit mismatch');
  // The native CLI strips JSON Schema's descriptive $schema property before advertisement.
  const { $schema: _schema, ...nativeSchema } = expected;
  if (canonical(parsed.tools[0]!.input_schema) !== canonical(nativeSchema) && canonical(parsed.tools[0]!.input_schema) !== canonical(expected)) throw new Error('Unexpected output schema');
  return parsed;
}
