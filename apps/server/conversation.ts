import { z } from 'zod';
import { activityFor, type ActivityEvent } from '../../packages/activity.js';
import { manifestSchema, hashSchema, type Manifest } from '../../packages/contracts/archive.js';
import { conversationInputSchema, conversationTraceInputSchema, conversationLink, type ConversationInput, type ConversationPage,
  type ConversationMessage, type ConversationTraceInput, type ConversationTracePage, type ConversationTraceSpan } from '../../packages/contracts/conversation.js';
import type { EventOrigin } from '../../packages/contracts/provenance.js';
import { evidenceLink } from '../../packages/contracts/search.js';
import type { Database } from './database.js';
import { readEvidence } from './evidence.js';
import { verifySnapshotIntegrity } from './evidence-integrity.js';
import { HttpError } from './identities.js';
import { eventOrigins } from './provenance.js';
import { attributionRevision } from './qualification.js';
import { QueryCache } from './query-cache.js';
import type { RawStore } from './raw-store.js';
import { conversationContext, displayCharacters, readConversationTrace } from './conversation-trace.js';
import { readNativeTurnState, type NativeTurnState } from '../../packages/native/turn-state.js';
import { readDeliveryObservation } from './delivery-receipts.js';

const readingVersion = 'conversation-2';
const cursorSchema = z.object({
  version: z.literal(2), readingVersion: z.enum(['conversation-2', 'conversation-3']), snapshotId: z.uuid(), hash: hashSchema,
  parserVersion: z.string().max(128), attributionRevision: z.string().max(128),
  deliveryRevision: hashSchema.optional(),
  includeTools: z.boolean(), includeContext: z.boolean(), offset: z.number().int().min(0), textOffset: z.number().int().min(0),
}).strict();
const traceCursorSchema = z.object({
  version: z.literal(1), readingVersion: z.literal(readingVersion), snapshotId: z.uuid(), hash: hashSchema,
  parserVersion: z.string().max(128), attributionRevision: z.string().max(128),
  turnId: z.string().max(256).nullable(), offset: z.number().int().min(0),
}).strict();
const tool = (event: ActivityEvent) => event.role === 'tool request' || event.role === 'tool result';
type Decorated = ActivityEvent & Pick<ConversationMessage, 'trace' | 'tool' | 'contextKind'>;
type Projected = Decorated & { offset: number; hiddenToolCalls: number; hiddenToolEvents: number;
  toolEvidence: ConversationPage['messages'][number]['toolEvidence'] };
type Reading = { manifest: Manifest; employee: string; hash: string; evidence: ReturnType<typeof readEvidence>;
  turn: NativeTurnState;
  messages: Projected[]; spans: ConversationTraceSpan[]; totalMessages: number; totalContextEvents: number; totalToolCalls: number; totalToolEvents: number;
  trailingHiddenToolCalls: number; trailingHiddenToolEvents: number; estimatedBytes: number };

/** Rendering facts only; a recorded tool result never verifies an assistant's claims. */
export function projectConversation(events: Decorated[]) {
  const groups = new Map<string, { requests: Decorated[]; results: Decorated[] }>();
  for (const event of events) if (tool(event) && event.trace?.callId) {
    const key = JSON.stringify([event.trace.turnId ?? null, event.trace.callId]);
    const group = groups.get(key) ?? { requests: [], results: [] };
    (event.role === 'tool request' ? group.requests : group.results).push(event); groups.set(key, group);
  }
  let pendingCalls = 0; let pendingEvents = 0; let turnHasResult = false;
  let totalToolCalls = 0; let totalToolEvents = 0;
  const messages: Projected[] = events.map((event, offset) => {
    const contextKind = conversationContext(event);
    if (event.role === 'user') turnHasResult = false;
    if (tool(event)) { pendingEvents++; totalToolEvents++; }
    if (event.role === 'tool request') { pendingCalls++; totalToolCalls++; }
    if (event.role === 'tool result') turnHasResult = true;
    const assistant = event.role === 'assistant';
    let association: ConversationMessage['tool'];
    if (tool(event) && event.trace?.callId) {
      const { requests, results } = groups.get(JSON.stringify([event.trace.turnId ?? null, event.trace.callId]))!;
      const paired = requests.length === 1 && results.length === 1;
      const peer = paired ? (event.role === 'tool request' ? results[0]! : requests[0]!) : undefined;
      const name = event.trace.toolName ?? (paired ? requests[0]!.trace?.toolName : undefined);
      association = { callId: event.trace.callId, ...(name ? { name } : {}),
        kind: event.role === 'tool request' ? 'request' : 'result',
        association: paired ? 'paired' : requests.length > 1 || results.length > 1 ? 'ambiguous' : 'unmatched',
        ...(peer ? { peer: { line: peer.line, block: peer.block ?? 0, role: peer.role } } : {}) };
    }
    const message: Projected = { ...event, ...(contextKind ? { contextKind } : {}), ...(association ? { tool: association } : {}), offset,
      hiddenToolCalls: assistant ? pendingCalls : 0, hiddenToolEvents: assistant ? pendingEvents : 0,
      toolEvidence: assistant ? (turnHasResult ? 'present-not-assessed' : 'none-observed') : 'not-applicable' };
    if (assistant) { pendingCalls = 0; pendingEvents = 0; }
    return message;
  });
  const totalContextEvents = messages.filter(event => event.contextKind).length;
  return { messages, totalMessages: messages.length - totalToolEvents - totalContextEvents, totalContextEvents, totalToolCalls, totalToolEvents,
    trailingHiddenToolCalls: pendingCalls, trailingHiddenToolEvents: pendingEvents };
}

function textEnd(text: string, start: number, length: number) {
  let end = Math.min(text.length, start + length);
  if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1]!) && /[\uDC00-\uDFFF]/.test(text[end]!)) end--;
  return end;
}

// All transports authenticate before calling this shared reader. Snapshot identity freezes the
// original; a changed interpretation is rejected rather than silently mixed into a continuation.
export function conversationQuery(db: Database, raw: RawStore) {
  const cache = new QueryCache<Reading>(192 * 1024 * 1024, value => value.estimatedBytes);
  async function load(snapshotId: string, revision: string): Promise<Reading> {
    const row = (await db.query(`SELECT s.manifest,s.hash,s.device_id,e.name AS employee FROM snapshots s
      JOIN devices d ON d.id=s.device_id JOIN employees e ON e.id=d.employee_id WHERE s.id=$1`, [snapshotId])).rows[0];
    if (!row) throw new HttpError(404, '未找到已提交存档');
    const manifest = manifestSchema.parse(row.manifest);
    const bytes = await raw.read(row.device_id, row.hash);
    const evidence = readEvidence(bytes, manifest.source);
    const origins = new Map<string, EventOrigin>((await eventOrigins(db, snapshotId)).map(origin =>
      [`${origin.line}/${origin.block}`, { ...origin, line: origin.originLine, block: origin.originBlock }]));
    const trace = readConversationTrace(bytes, manifest.source);
    const projection = projectConversation(activityFor(evidence.events, manifest.enrolledAt, undefined, origins).events.map(event => {
      const metadata = trace.events.get(`${event.line}/${event.block ?? 0}`);
      return { ...event, ...(metadata ? { trace: metadata } : {}) };
    }));
    if (await attributionRevision(db, snapshotId) !== revision) throw new HttpError(409, '原件归属版本已更新，请重新读取对话');
    return { manifest, hash: row.hash, employee: row.employee, evidence, ...projection, spans: trace.spans, turn: readNativeTurnState(bytes, manifest.source),
      estimatedBytes: bytes.length * 3 + origins.size * 1536 + projection.messages.length * 2048 + trace.spans.length * 2048 };
  }
  async function currentReading(snapshotId:string,revision:string){
    const row=(await db.query('SELECT device_id,hash FROM snapshots WHERE id=$1',[snapshotId])).rows[0];
    if(!row)throw new HttpError(404,'未找到已提交存档');
    // A parsed rendering can be cached; each current page/trace must still
    // observe missing or altered source bytes after an earlier warm read.
    await raw.read(row.device_id,row.hash);
    return cache.get(`${snapshotId}:${revision}`,()=>load(snapshotId,revision));
  }
  async function page(snapshotId: string, value: ConversationInput = {}): Promise<ConversationPage> {
    if (!z.uuid().safeParse(snapshotId).success) throw new HttpError(404, '未找到存档');
    const parsed = conversationInputSchema.safeParse(value);
    if (!parsed.success) throw new HttpError(400, '对话读取参数无效');
    const input = parsed.data;
    let cursor: z.infer<typeof cursorSchema> | undefined;
    if (input.cursor) {
      try {
        const decoded: unknown = JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8'));
        if (decoded && typeof decoded === 'object' && 'version' in decoded && decoded.version === 1) throw new HttpError(409, '对话读取版本已更新，请重新读取');
        cursor = cursorSchema.parse(decoded);
      } catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, '对话分页位置无效'); }
      if (cursor.snapshotId !== snapshotId || cursor.includeTools !== input.includeTools || cursor.includeContext !== input.includeContext) throw new HttpError(400, '分页位置不属于当前对话或显示方式');
    }
    const readingVersion = input.readingVersion ?? cursor?.readingVersion ?? 'conversation-3';
    if (cursor && cursor.readingVersion !== readingVersion) throw new HttpError(409, '对话读取版本已更新，请重新读取');
    const delivery = readingVersion === 'conversation-3' ? await readDeliveryObservation(db, snapshotId) : undefined;
    if (cursor && readingVersion === 'conversation-3' && cursor.deliveryRevision !== delivery!.revision) throw new HttpError(409, '投递来源状态已更新，请重新读取对话');
    await verifySnapshotIntegrity(db, raw, snapshotId);
    const revision = await attributionRevision(db, snapshotId);
    if (cursor && cursor.attributionRevision !== revision) throw new HttpError(409, '原件归属版本已更新，请重新读取对话');
    const reading = await currentReading(snapshotId,revision);
    const { evidence, manifest, messages } = reading;
    if (cursor && (cursor.hash !== reading.hash || cursor.parserVersion !== evidence.parserVersion)) {
      throw new HttpError(409, '对话原件或解析版本已更新，请重新读取');
    }
    let offset = cursor?.offset ?? 0; let textOffset = cursor?.textOffset ?? 0; let includeTools = input.includeTools; let includeContext = input.includeContext;
    if (input.anchor) {
      if (input.anchor.parserVersion && input.anchor.parserVersion !== evidence.parserVersion) throw new HttpError(409, '对话解析版本已更新，请重新定位');
      offset = messages.findIndex(event => event.line === input.anchor!.line && (event.block ?? 0) === input.anchor!.block);
      if (offset < 0) throw new HttpError(404, '此原件位置没有可解析的对话消息，请查看原件');
      textOffset = input.anchor.textOffset;
      if (tool(messages[offset]!)) includeTools = true;
      if (messages[offset]!.contextKind) includeContext = true;
    }
    if (offset > messages.length || (offset === messages.length && textOffset !== 0)
      || (messages[offset] && textOffset > messages[offset]!.text.length)
      || (messages[offset] && ((!includeTools && tool(messages[offset]!)) || (!includeContext && messages[offset]!.contextKind)) && textOffset !== 0)) throw new HttpError(400, '对话文字位置无效');
    const hidden = (event: Projected) => (!includeTools && tool(event)) || (!includeContext && Boolean(event.contextKind));
    const result: ConversationPage['messages'] = []; let remaining = 2048;
    while (offset < messages.length && result.length < input.limit) {
      const event = messages[offset]!;
      if (hidden(event)) { offset++; continue; }
      const metadataSize = displayCharacters({ trace: event.trace, tool: event.tool, contextKind: event.contextKind });
      if (remaining < metadataSize) break;
      const end = textEnd(event.text, textOffset, remaining - metadataSize);
      if (end === textOffset && event.text.length > textOffset) break;
      const location = { kind: 'event' as const, offset, line: event.line, block: event.block ?? 0,
        textOffset, parserVersion: evidence.parserVersion };
      result.push({ ...event, id: `${event.line}:${event.block ?? 0}`, block: event.block ?? 0,
        text: event.text.slice(textOffset, end), textOffset, textLength: event.text.length,
        hiddenToolCalls: includeTools || (readingVersion === 'conversation-3' && textOffset > 0) ? 0 : event.hiddenToolCalls,
        hiddenToolEvents: includeTools || (readingVersion === 'conversation-3' && textOffset > 0) ? 0 : event.hiddenToolEvents,
        evidencePath: evidenceLink(snapshotId, location), conversationPath: conversationLink(snapshotId, location)! });
      remaining -= end - textOffset + metadataSize; textOffset = end;
      if (textOffset === event.text.length) { offset++; textOffset = 0; }
      if (remaining === 0 || textOffset !== 0) break;
    }
    // Hidden trailing records must not manufacture an empty continuation page.
    while (offset < messages.length && hidden(messages[offset]!)) offset++;
    if (await attributionRevision(db, snapshotId) !== revision) throw new HttpError(409, '原件归属版本已更新，请重新读取对话');
    if (delivery && (await readDeliveryObservation(db, snapshotId)).revision !== delivery.revision) throw new HttpError(409, '投递来源状态已更新，请重新读取对话');
    const related = (manifest.capture?.materials ?? []).filter(material => material.role === 'subagent' || material.role === 'child-transcript');
    return { snapshotId, hash: reading.hash, parserVersion: evidence.parserVersion, attributionRevision: revision,
      source: manifest.source, sourceSessionId: manifest.sourceSessionId, employee: reading.employee, includeTools, includeContext, readingVersion,
      totalContextEvents: reading.totalContextEvents, traceCount: reading.spans.length, tracePath: `/api/snapshots/${snapshotId}/conversation/trace`,
      totalMessages: reading.totalMessages, totalToolCalls: reading.totalToolCalls,
      totalToolEvents: reading.totalToolEvents, trailingHiddenToolCalls: includeTools || (readingVersion === 'conversation-3' && offset < messages.length) ? 0 : reading.trailingHiddenToolCalls,
      trailingHiddenToolEvents: includeTools || (readingVersion === 'conversation-3' && offset < messages.length) ? 0 : reading.trailingHiddenToolEvents,
      messages: result, nextCursor: offset < messages.length ? Buffer.from(JSON.stringify({ version: 2, readingVersion, snapshotId,
        hash: reading.hash, parserVersion: evidence.parserVersion, attributionRevision: revision,
        ...(delivery ? { deliveryRevision: delivery.revision } : {}),
        includeTools, includeContext, offset, textOffset })).toString('base64url') : null, anchor: input.anchor ?? null,
      status: { compacted: manifest.capture?.compacted ?? null, unrecognizedLines: evidence.unrecognizedLines,
        partialLine: evidence.partialLine || (manifest.capture?.partialLine ?? false), captureGapCount: manifest.capture?.gaps.length ?? 0,
        captureGapExamples: (manifest.capture?.gaps ?? []).slice(0, 5),
        offlineBackfill: !delivery?.receiptCount ? 'unknown' : delivery.disconnectedAttempts > 0 ? 'observed' : 'not-observed',
        ...(delivery ? { delivery } : {}),
        ongoing: readingVersion === 'conversation-3' ? reading.turn.state : 'unknown',
        ...(readingVersion === 'conversation-3' ? { turn: reading.turn } : {}), verification: 'not-assessed' },
      related: related.slice(0, 10).map(material => ({ materialId: material.id, role: material.role, name: material.name,
        sourceSessionId: material.sourceSessionId ?? null,
        webPath: evidenceLink(snapshotId, { kind: 'material', materialId: material.id, textOffset: 0 }) })),
      relatedTotal: related.length, relatedDetailsPath: evidenceLink(snapshotId), rawPath: `/api/snapshots/${snapshotId}/raw` };
  }
  async function trace(snapshotId: string, value: ConversationTraceInput = {}): Promise<ConversationTracePage> {
    if (!z.uuid().safeParse(snapshotId).success) throw new HttpError(404, '未找到存档');
    const parsed = conversationTraceInputSchema.safeParse(value);
    if (!parsed.success) throw new HttpError(400, 'Trace 读取参数无效');
    const input = parsed.data;
    let cursor: z.infer<typeof traceCursorSchema> | undefined;
    if (input.cursor) {
      try { cursor = traceCursorSchema.parse(JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8'))); }
      catch { throw new HttpError(400, 'Trace 分页位置无效'); }
      if (cursor.snapshotId !== snapshotId || cursor.turnId !== (input.turnId ?? null)) throw new HttpError(400, '分页位置不属于当前 Trace');
    }
    await verifySnapshotIntegrity(db, raw, snapshotId);
    const revision = await attributionRevision(db, snapshotId);
    const reading = await currentReading(snapshotId,revision);
    if (cursor && (cursor.hash !== reading.hash || cursor.parserVersion !== reading.evidence.parserVersion || cursor.attributionRevision !== revision)) throw new HttpError(409, 'Trace 原件或归属版本已更新，请重新读取');
    const source = reading.spans.filter(span => !input.turnId || span.turnId === input.turnId);
    let offset = cursor?.offset ?? 0; let remaining = 2048;
    if (offset > source.length) throw new HttpError(400, 'Trace 分页位置无效');
    const spans: ConversationTracePage['spans'] = [];
    while (offset < source.length && spans.length < input.limit) {
      const span = { ...source[offset]!, evidencePath: evidenceLink(snapshotId, { kind: 'raw', line: source[offset]!.line, textOffset: 0 }) };
      const size = displayCharacters(span); if (size > remaining) break;
      spans.push(span); remaining -= size; offset++;
    }
    if (await attributionRevision(db, snapshotId) !== revision) throw new HttpError(409, '原件归属版本已更新，请重新读取 Trace');
    return { snapshotId, parserVersion: reading.evidence.parserVersion, readingVersion, spans, total: source.length,
      nextCursor: offset < source.length ? Buffer.from(JSON.stringify({ version: 1, readingVersion, snapshotId,
        hash: reading.hash, parserVersion: reading.evidence.parserVersion, attributionRevision: revision,
        turnId: input.turnId ?? null, offset })).toString('base64url') : null };
  }
  return { page, trace };
}
