import { z } from 'zod';
import { activityFor, type ActivityEvent } from '../../packages/activity.js';
import { manifestSchema, hashSchema, type Manifest } from '../../packages/contracts/archive.js';
import { conversationInputSchema, conversationLink, type ConversationInput, type ConversationPage } from '../../packages/contracts/conversation.js';
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

const cursorSchema = z.object({
  version: z.literal(1), snapshotId: z.uuid(), hash: hashSchema,
  parserVersion: z.string().max(128), attributionRevision: z.string().max(128),
  includeTools: z.boolean(), offset: z.number().int().min(0), textOffset: z.number().int().min(0),
}).strict();
const tool = (event: ActivityEvent) => event.role === 'tool request' || event.role === 'tool result';
type Projected = ActivityEvent & { offset: number; hiddenToolCalls: number; hiddenToolEvents: number;
  toolEvidence: ConversationPage['messages'][number]['toolEvidence'] };
type Reading = { manifest: Manifest; employee: string; hash: string; evidence: ReturnType<typeof readEvidence>;
  messages: Projected[]; totalMessages: number; totalToolCalls: number; totalToolEvents: number;
  trailingHiddenToolCalls: number; trailingHiddenToolEvents: number; estimatedBytes: number };

/** Rendering facts only; a recorded tool result never verifies an assistant's claims. */
export function projectConversation(events: ActivityEvent[]) {
  let pendingCalls = 0; let pendingEvents = 0; let turnHasResult = false;
  let totalToolCalls = 0; let totalToolEvents = 0;
  const messages: Projected[] = events.map((event, offset) => {
    if (event.role === 'user') turnHasResult = false;
    if (tool(event)) { pendingEvents++; totalToolEvents++; }
    if (event.role === 'tool request') { pendingCalls++; totalToolCalls++; }
    if (event.role === 'tool result') turnHasResult = true;
    const assistant = event.role === 'assistant';
    const message: Projected = { ...event, offset,
      hiddenToolCalls: assistant ? pendingCalls : 0, hiddenToolEvents: assistant ? pendingEvents : 0,
      toolEvidence: assistant ? (turnHasResult ? 'present-not-assessed' : 'none-observed') : 'not-applicable' };
    if (assistant) { pendingCalls = 0; pendingEvents = 0; }
    return message;
  });
  return { messages, totalMessages: messages.length - totalToolEvents, totalToolCalls, totalToolEvents,
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
    const projection = projectConversation(activityFor(evidence.events, manifest.enrolledAt, undefined, origins).events);
    if (await attributionRevision(db, snapshotId) !== revision) throw new HttpError(409, '原件归属版本已更新，请重新读取对话');
    return { manifest, hash: row.hash, employee: row.employee, evidence, ...projection,
      estimatedBytes: bytes.length * 3 + origins.size * 1536 + projection.messages.length * 256 };
  }
  async function page(snapshotId: string, value: ConversationInput = {}): Promise<ConversationPage> {
    if (!z.uuid().safeParse(snapshotId).success) throw new HttpError(404, '未找到存档');
    const parsed = conversationInputSchema.safeParse(value);
    if (!parsed.success) throw new HttpError(400, '对话读取参数无效');
    const input = parsed.data;
    let cursor: z.infer<typeof cursorSchema> | undefined;
    if (input.cursor) {
      try { cursor = cursorSchema.parse(JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8'))); }
      catch { throw new HttpError(400, '对话分页位置无效'); }
      if (cursor.snapshotId !== snapshotId || cursor.includeTools !== input.includeTools) throw new HttpError(400, '分页位置不属于当前对话或工具显示方式');
    }
    await verifySnapshotIntegrity(db, raw, snapshotId);
    const revision = await attributionRevision(db, snapshotId);
    if (cursor && cursor.attributionRevision !== revision) throw new HttpError(409, '原件归属版本已更新，请重新读取对话');
    const reading = await cache.get(`${snapshotId}:${revision}`, () => load(snapshotId, revision));
    const { evidence, manifest, messages } = reading;
    if (cursor && (cursor.hash !== reading.hash || cursor.parserVersion !== evidence.parserVersion)) {
      throw new HttpError(409, '对话原件或解析版本已更新，请重新读取');
    }
    let offset = cursor?.offset ?? 0; let textOffset = cursor?.textOffset ?? 0; let includeTools = input.includeTools;
    if (input.anchor) {
      if (input.anchor.parserVersion && input.anchor.parserVersion !== evidence.parserVersion) throw new HttpError(409, '对话解析版本已更新，请重新定位');
      offset = messages.findIndex(event => event.line === input.anchor!.line && (event.block ?? 0) === input.anchor!.block);
      if (offset < 0) throw new HttpError(404, '此原件位置没有可解析的对话消息，请查看原件');
      textOffset = input.anchor.textOffset;
      if (tool(messages[offset]!)) includeTools = true;
    }
    if (offset > messages.length || (offset === messages.length && textOffset !== 0)
      || (messages[offset] && textOffset > messages[offset]!.text.length)
      || (!includeTools && messages[offset] && tool(messages[offset]!) && textOffset !== 0)) throw new HttpError(400, '对话文字位置无效');
    const result: ConversationPage['messages'] = []; let remaining = 2048;
    while (offset < messages.length && result.length < input.limit) {
      const event = messages[offset]!;
      if (!includeTools && tool(event)) { offset++; continue; }
      const end = textEnd(event.text, textOffset, remaining);
      if (end === textOffset && event.text.length > textOffset) break;
      const location = { kind: 'event' as const, offset, line: event.line, block: event.block ?? 0,
        textOffset, parserVersion: evidence.parserVersion };
      result.push({ ...event, id: `${event.line}:${event.block ?? 0}`, block: event.block ?? 0,
        text: event.text.slice(textOffset, end), textOffset, textLength: event.text.length,
        hiddenToolCalls: includeTools ? 0 : event.hiddenToolCalls, hiddenToolEvents: includeTools ? 0 : event.hiddenToolEvents,
        evidencePath: evidenceLink(snapshotId, location), conversationPath: conversationLink(snapshotId, location)! });
      remaining -= end - textOffset; textOffset = end;
      if (textOffset === event.text.length) { offset++; textOffset = 0; }
      if (remaining === 0 || textOffset !== 0) break;
    }
    // Hidden trailing tools must not manufacture an empty continuation page.
    while (!includeTools && offset < messages.length && tool(messages[offset]!)) offset++;
    if (await attributionRevision(db, snapshotId) !== revision) throw new HttpError(409, '原件归属版本已更新，请重新读取对话');
    const related = (manifest.capture?.materials ?? []).filter(material => material.role === 'subagent' || material.role === 'child-transcript');
    return { snapshotId, hash: reading.hash, parserVersion: evidence.parserVersion, attributionRevision: revision,
      source: manifest.source, sourceSessionId: manifest.sourceSessionId, employee: reading.employee, includeTools,
      totalMessages: reading.totalMessages, totalToolCalls: reading.totalToolCalls,
      totalToolEvents: reading.totalToolEvents, trailingHiddenToolCalls: includeTools ? 0 : reading.trailingHiddenToolCalls,
      trailingHiddenToolEvents: includeTools ? 0 : reading.trailingHiddenToolEvents,
      messages: result, nextCursor: offset < messages.length ? Buffer.from(JSON.stringify({ version: 1, snapshotId,
        hash: reading.hash, parserVersion: evidence.parserVersion, attributionRevision: revision,
        includeTools, offset, textOffset })).toString('base64url') : null, anchor: input.anchor ?? null,
      status: { compacted: manifest.capture?.compacted ?? null, unrecognizedLines: evidence.unrecognizedLines,
        partialLine: evidence.partialLine || (manifest.capture?.partialLine ?? false), captureGapCount: manifest.capture?.gaps.length ?? 0,
        captureGapExamples: (manifest.capture?.gaps ?? []).slice(0, 5), offlineBackfill: 'unknown', ongoing: 'unknown', verification: 'not-assessed' },
      related: related.slice(0, 10).map(material => ({ materialId: material.id, role: material.role, name: material.name,
        sourceSessionId: material.sourceSessionId ?? null,
        webPath: evidenceLink(snapshotId, { kind: 'material', materialId: material.id, textOffset: 0 }) })),
      relatedTotal: related.length, relatedDetailsPath: evidenceLink(snapshotId), rawPath: `/api/snapshots/${snapshotId}/raw` };
  }
  return { page };
}
