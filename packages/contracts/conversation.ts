import { z } from 'zod';
import type { Source } from './archive.js';
import type { ActivityContext } from '../activity.js';
import type { EventOrigin } from './provenance.js';
import type { EvidenceLocation } from './search.js';

export const conversationAnchorSchema = z.object({
  line: z.number().int().min(1), block: z.number().int().min(0).default(0),
  textOffset: z.number().int().min(0).default(0), parserVersion: z.string().min(1).max(128).optional(),
}).strict();
export const conversationInputSchema = z.object({
  cursor: z.string().max(2048).optional(), includeTools: z.boolean().default(false),
  includeContext: z.boolean().default(false),
  limit: z.number().int().min(1).max(25).default(10), anchor: conversationAnchorSchema.optional(),
}).strict().refine(value => !(value.cursor && value.anchor), '对话分页与定位不能同时指定');
export type ConversationInput = z.input<typeof conversationInputSchema>;
export type ConversationAnchor = z.infer<typeof conversationAnchorSchema>;

/** Only recorded identifiers/timing. No reasoning text or reconstructed tool output. */
export interface ConversationTrace {
  nativeId?: string; callId?: string; turnId?: string; model?: string; channel?: string;
  toolName?: string; status?: string; startedAt?: string; completedAt?: string;
  durationMs?: number; durationSource?: 'recorded' | 'source-timestamps';
  executionDurationMs?: number; exitCode?: number; traceLine?: number;
}
export interface ConversationTool {
  callId: string; name?: string; kind: 'request' | 'result';
  association: 'paired' | 'unmatched' | 'ambiguous';
  peer?: { line: number; block: number; role: string };
}
export interface ConversationTraceSpan extends ConversationTrace {
  line: number; kind: string;
}
export const conversationTraceInputSchema = z.object({
  cursor: z.string().max(2048).optional(), turnId: z.string().min(1).max(256).optional(),
  limit: z.number().int().min(1).max(25).default(10),
}).strict();
export type ConversationTraceInput = z.input<typeof conversationTraceInputSchema>;
export interface ConversationTracePage {
  snapshotId: string; parserVersion: string; readingVersion: string;
  spans: Array<ConversationTraceSpan & { evidencePath: string }>;
  total: number; nextCursor: string | null;
}

export interface ConversationMessage {
  id: string; offset: number; line: number; block: number; role: string;
  text: string; textOffset: number; textLength: number; timestamp: string | null;
  context: ActivityContext; sourceDate: string | null; origin?: EventOrigin;
  hiddenToolCalls: number; hiddenToolEvents: number;
  toolEvidence: 'none-observed' | 'present-not-assessed' | 'not-applicable';
  evidencePath: string; conversationPath: string;
  contextKind?: 'system' | 'developer' | 'environment';
  trace?: ConversationTrace; tool?: ConversationTool;
}
export interface ConversationPage {
  snapshotId: string; hash: string; parserVersion: string; attributionRevision: string;
  source: Source; sourceSessionId: string; employee: string; includeTools: boolean;
  includeContext: boolean; readingVersion: string; totalContextEvents: number;
  traceCount: number; tracePath: string;
  totalMessages: number; totalToolCalls: number; totalToolEvents: number;
  trailingHiddenToolCalls: number; trailingHiddenToolEvents: number;
  messages: ConversationMessage[]; nextCursor: string | null; anchor: ConversationAnchor | null;
  status: {
    compacted: boolean | null; unrecognizedLines: number; partialLine: boolean;
    captureGapCount: number; captureGapExamples: Array<{ code: string; reference: string }>;
    offlineBackfill: 'unknown'; ongoing: 'unknown'; verification: 'not-assessed';
  };
  related: Array<{ materialId: string; role: string; name: string; sourceSessionId: string | null; webPath: string }>;
  relatedTotal: number;
  relatedDetailsPath: string;
  rawPath: string;
}

/** Conversation links are separate from evidence links; both identify an immutable original. */
export function conversationLink(snapshotId: string, location?: EvidenceLocation | ConversationAnchor | null) {
  if (location && 'kind' in location && location.kind !== 'event') return null;
  if (location && location.line === undefined) return null;
  const params = new URLSearchParams({ view: 'conversation' });
  if (location?.line !== undefined) {
    params.set('line', String(location.line)); params.set('block', String(location.block ?? 0));
    params.set('textOffset', String(location.textOffset));
    if (location.parserVersion) params.set('parserVersion', location.parserVersion);
    // An exact tool hit must remain readable even though ordinary conversation entry hides tools.
    params.set('includeTools', 'true');
  }
  return `#${snapshotId}?${params}`;
}
