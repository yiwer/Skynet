import type { EvidenceLine, Source } from '../../packages/contracts/archive.js';
import { sourceTimestamp } from '../../packages/contracts/archive.js';
import type { ConversationMessage, ConversationTrace, ConversationTraceSpan } from '../../packages/contracts/conversation.js';
import { completeOriginalLines } from '../../packages/native/raw-lines.js';

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : undefined;
const identifier = (value: unknown, limit = 256) => typeof value === 'string' && value.length > 0 && value.length <= limit ? value : undefined;
const duration = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
const milliseconds = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 8.64e15 ? new Date(value).toISOString() : undefined;
// Codex task lifecycle fields use Unix seconds; item lifecycle fields explicitly use *_ms.
const lifecycleTime = (value: unknown) => typeof value === 'number' ? milliseconds(value * 1000) : stringTime(value);
const stringTime = (value: unknown) => sourceTimestamp(identifier(value, 64)) ?? undefined;
const defined = <T extends object>(value: T): T => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;

export function conversationContext(event: EvidenceLine): ConversationMessage['contextKind'] {
  if (event.role === 'system' || event.role === 'developer') return event.role;
  if (event.role !== 'user') return undefined;
  const match = /^<environment_context>([\s\S]*?)<\/environment_context>$/.exec(event.text.trim());
  // A single complete native envelope only: never hide mixed user text or multiple wrappers.
  return match && !/<\/?environment_context>/.test(match[1]!) ? 'environment' : undefined;
}

function timing(row: ObjectValue, item?: ObjectValue): ConversationTrace {
  const startedAt = milliseconds(row.started_at_ms) ?? lifecycleTime(row.started_at);
  const completedAt = milliseconds(row.completed_at_ms) ?? lifecycleTime(row.completed_at);
  const recorded = duration(row.duration_ms);
  const elapsed = startedAt && completedAt ? Date.parse(completedAt) - Date.parse(startedAt) : undefined;
  const nativeDuration = object(item?.duration);
  const seconds = duration(nativeDuration?.secs), nanos = duration(nativeDuration?.nanos);
  const executionDurationMs = seconds !== undefined && nanos !== undefined && nanos < 1e9 ? duration(seconds * 1000 + nanos / 1e6) : undefined;
  return defined({ startedAt, completedAt,
    ...(recorded !== undefined ? { durationMs: recorded, durationSource: 'recorded' as const }
      : elapsed !== undefined && elapsed >= 0 ? { durationMs: elapsed, durationSource: 'source-timestamps' as const } : {}),
    executionDurationMs,
    exitCode: typeof item?.exit_code === 'number' && Number.isSafeInteger(item.exit_code) ? item.exit_code : undefined });
}

/** Decorates immutable source locations. Native completion events do not create duplicate messages. */
export function readConversationTrace(bytes: Buffer, source: Source) {
  const events = new Map<string, ConversationTrace>();
  const spans: ConversationTraceSpan[] = [];
  const models = new Map<string, Set<string>>();
  let turnId: string | undefined;
  for (const { line, text } of completeOriginalLines(bytes)) {
    if (!text?.trim()) continue;
    let row: ObjectValue | undefined;
    try { row = object(JSON.parse(text)); } catch { continue; }
    if (!row) continue;
    if (source === 'claude-code-cli') {
      const message = object(row.message), nativeId = identifier(row.uuid);
      if (!message || (row.type !== 'assistant' && row.type !== 'user')) continue;
      if (typeof message.content === 'string') { if (nativeId) events.set(`${line}/0`, { nativeId }); continue; }
      if (!Array.isArray(message.content)) continue;
      for (const [block, rawPart] of message.content.entries()) {
        const part = object(rawPart); if (!part) continue;
        const trace = defined({ nativeId,
          callId: identifier(part.type === 'tool_use' ? part.id : part.type === 'tool_result' ? part.tool_use_id : undefined),
          toolName: part.type === 'tool_use' ? identifier(part.name, 128) : undefined,
          status: part.type === 'tool_result' && typeof part.is_error === 'boolean' ? (part.is_error ? 'error' : 'completed') : undefined });
        if (Object.keys(trace).length) events.set(`${line}/${block}`, trace);
      }
      continue;
    }
    const payload = object(row.payload); if (!payload) continue;
    if (row.type === 'turn_context' || (row.type === 'event_msg' && payload.type === 'task_started')) {
      turnId = identifier(payload.turn_id);
      const model = identifier(payload.model, 128);
      if (turnId && model) { const known = models.get(turnId) ?? new Set<string>(); known.add(model); models.set(turnId, known); }
      continue;
    }
    if (row.type === 'response_item') {
      const metadata = object(payload.internal_chat_message_metadata_passthrough);
      const name = identifier(payload.name, 96), namespace = identifier(payload.namespace, 30);
      const trace = defined({ nativeId: identifier(payload.id), callId: identifier(payload.call_id),
        turnId: metadata?.turn_id === undefined ? turnId : identifier(metadata.turn_id),
        model: identifier(payload.model, 128), channel: identifier(payload.phase, 64) ?? identifier(payload.channel, 64),
        toolName: name ? (namespace ? `${namespace}.${name}` : name) : undefined,
        status: identifier(payload.status, 64) });
      if (Object.keys(trace).length) events.set(`${line}/0`, trace);
      continue;
    }
    if (row.type !== 'event_msg') continue;
    if (payload.type === 'item_completed') {
      const item = object(payload.item), nativeId = identifier(item?.id), kind = identifier(item?.type, 64);
      if (!item || !nativeId || !kind) continue;
      spans.push(defined({ line, nativeId, kind, turnId: identifier(payload.turn_id),
        channel: identifier(item.phase, 64), status: identifier(item.status, 64), ...timing(payload, item) }));
    } else if (payload.type === 'task_complete') {
      const completedTurn = identifier(payload.turn_id);
      if (completedTurn) spans.push(defined({ line, kind: 'AgentTurn', turnId: completedTurn, ...timing(payload) }));
      if (completedTurn === turnId) turnId = undefined;
    }
  }
  const completions = new Map<string, ConversationTraceSpan[]>();
  for (const span of spans) {
    const known = span.turnId ? models.get(span.turnId) : undefined;
    if (known?.size === 1) span.model = [...known][0]!;
    if (span.nativeId && span.turnId) { const key = JSON.stringify([span.turnId, span.nativeId]); const matches = completions.get(key) ?? []; matches.push(span); completions.set(key, matches); }
  }
  const identities = new Map<string, number>();
  for (const trace of events.values()) if (trace.nativeId && trace.turnId) {
    const key = JSON.stringify([trace.turnId, trace.nativeId]); identities.set(key, (identities.get(key) ?? 0) + 1);
  }
  for (const trace of events.values()) {
    const known = trace.turnId ? models.get(trace.turnId) : undefined;
    if (!trace.model && known?.size === 1) trace.model = [...known][0]!;
    const key = trace.nativeId && trace.turnId ? JSON.stringify([trace.turnId, trace.nativeId]) : undefined;
    const matches = key ? completions.get(key) : undefined;
    if (key && identities.get(key) === 1 && matches?.length === 1) {
      const { line, kind: _kind, ...span } = matches[0]!;
      Object.assign(trace, span, { traceLine: line });
    }
  }
  return { events, spans };
}

/** All added display strings participate in the same bounded conversation response. */
export function displayCharacters(value: unknown): number {
  if (typeof value === 'string') return value.length;
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + displayCharacters(item), 0);
  if (value && typeof value === 'object') return Object.values(value).reduce<number>((sum, item) => sum + displayCharacters(item), 0);
  return 0;
}
