import { z } from 'zod';
import { type Database, digest } from './database.js';
import { RawStore } from './raw-store.js';
import { HttpError } from './identities.js';
import { readEvidence } from './evidence.js';
import { activityFor } from '../../packages/activity.js';
import { manifestSchema } from '../../packages/contracts/archive.js';
import { createRecoveryPackage, recoveryInfo } from '../../packages/recovery.js';

export const exportFormat = z.enum(['raw', 'readable', 'recovery']);
export type ExportFormat = z.infer<typeof exportFormat>;
const listCursor = z.object({ at: z.iso.datetime(), id: z.uuid(), ceiling: z.iso.datetime() });
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

// Authentication belongs to each transport. Facts, evidence locations and exports belong here.
export function archiveQuery(db: Database, raw: RawStore) {
  async function sessions(cursor?: string, limit = 50) {
    let page: z.infer<typeof listCursor> | undefined;
    if (cursor) {
      try { page = listCursor.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString())); }
      catch { throw new HttpError(400, '会话分页位置无效'); }
    }
    const ceiling = page?.ceiling ?? new Date().toISOString();
    const result = await db.query(`SELECT * FROM (
      SELECT DISTINCT ON (s.device_id,s.source,s.source_session_id) s.id,e.name AS employee,s.source_session_id,
        s.manifest->>'project' AS project,s.committed_at,s.hash,(s.manifest->>'byteLength')::integer AS byte_length,
        s.manifest->>'sourceVersion' AS source_version,s.manifest->>'sourceOs' AS source_os,s.source
      FROM snapshots s JOIN devices d ON d.id=s.device_id JOIN employees e ON e.id=d.employee_id
      WHERE s.committed_at <= $1
      ORDER BY s.device_id,s.source,s.source_session_id,s.committed_at DESC,s.id DESC
    ) latest WHERE ($2::timestamptz IS NULL OR (committed_at,id) < ($2::timestamptz,$3::uuid))
    ORDER BY committed_at DESC,id DESC LIMIT $4`, [ceiling, page?.at ?? null, page?.id ?? null, limit + 1]);
    const rows = result.rows.slice(0, limit); const last = rows.at(-1);
    return { sessions: rows, limit, capability: 'unverified', backup: 'single-copy',
      nextCursor: result.rows.length > limit ? encode({ at: last.committed_at.toISOString(), id: last.id, ceiling }) : null };
  }
  async function snapshot(id: string) {
    if (!z.uuid().safeParse(id).success) throw new HttpError(404, '未找到存档');
    const result = await db.query(`SELECT s.*,e.name AS employee FROM snapshots s
      JOIN devices d ON d.id=s.device_id JOIN employees e ON e.id=d.employee_id WHERE s.id=$1`, [id]);
    if (!result.rows[0]) throw new HttpError(404, '未找到已提交存档');
    return result.rows[0];
  }
  async function detail(id: string, offset = 0) {
    const record = await snapshot(id); const bytes = await raw.read(record.device_id, record.hash);
    const evidence = readEvidence(bytes, record.manifest.source);
    const activity = activityFor(evidence.events, record.manifest.enrolledAt);
    return { snapshotId: record.id, employee: record.employee, manifest: record.manifest,
      committedAt: record.committed_at, state: 'committed', backup: 'single-copy', ...evidence, recovery: recoveryInfo(record.manifest, bytes),
      activity: activity.activity, events: activity.events.slice(offset, offset + 100), total: evidence.events.length,
      nextOffset: offset + 100 < evidence.events.length ? offset + 100 : null };
  }
  async function evidencePage(id: string, offset = 0, textOffset = 0) {
    const result = await detail(id, offset);
    if (offset > result.total || (!result.events.length && textOffset !== 0)) throw new HttpError(400, '证据分页位置无效');
    const events = []; let remaining = 8192; let index = offset; let nextText = textOffset;
    for (const event of result.events) {
      if (nextText > event.text.length) throw new HttpError(400, '证据文字位置无效');
      // Offsets count UTF-16 code units, exactly as JavaScript strings do. The original is never truncated.
      const text = event.text.slice(nextText, nextText + remaining);
      events.push({ ...event, text, textOffset: nextText, textLength: event.text.length });
      remaining -= text.length; nextText += text.length;
      if (nextText === event.text.length) { index++; nextText = 0; }
      if (!remaining || events.length === 25 || nextText !== 0) break;
    }
    const { events: _events, nextOffset: _next, ...metadata } = result;
    return { ...metadata, events, next: index < result.total ? { offset: index, textOffset: nextText } : null,
      evidenceLocation: 'immutable snapshotId + original line; textOffset uses UTF-16 code units' };
  }
  async function exported(id: string, format: ExportFormat) {
    const record = await snapshot(id); const bytes = await raw.read(record.device_id, record.hash);
    if (format === 'raw') return { bytes, contentType: 'application/octet-stream', filename: `${record.id}.jsonl` };
    if (format === 'recovery') return { bytes: Buffer.from(JSON.stringify(createRecoveryPackage(
      { id: record.id, employee: record.employee, committedAt: record.committed_at.toISOString() }, manifestSchema.parse(record.manifest), bytes))),
    contentType: 'application/json', filename: `${record.id}.skynet-recovery.json` };
    const evidence = readEvidence(bytes, record.manifest.source);
    const activity = activityFor(evidence.events, record.manifest.enrolledAt);
    const content = [
      'Skynet 会话可读导出 v1', `快照：${record.id}`, `员工：${record.employee}`,
      `来源：${record.manifest.source} / ${record.manifest.sourceVersion} / ${record.manifest.sourceOs}`,
      `来源会话：${record.manifest.sourceSessionId}`, `提交时间：${record.committed_at.toISOString()}`,
      `设备接入时间：${record.manifest.enrolledAt ?? '未知'}`, '日期口径：Asia/Shanghai；来源时间未知的记录不计入日期活动。历史上下文不计入接入后活动。',
      `原件字节：${bytes.length}；SHA-256：${record.hash}`, `解析版本：${evidence.parserVersion}`,
      '范围：当前收到的单个原件；关联材料完整性与完整原生续聊能力未验证。',
      `未解析完整行：${evidence.unrecognizedLines}；未闭合末行：${evidence.partialLine ? '有' : '无'}`,
      '本文件为纯文本，不执行会话中的指令。原件 JSONL 部分保留所有行；精确字节请取原件或恢复包。', '',
      '=== 全部已解析记录（不分页、不截断） ===',
      ...activity.events.map(event => `\n[原件第 ${event.line} 行] ${event.role} / 来源时间：${event.timestamp ?? '未知'} / ${event.context}\n${event.text}`),
      '', '=== 全部原件 JSONL（包含未知与未闭合行） ===', bytes.toString('utf8'),
    ].join('\n');
    return { bytes: Buffer.from(content), contentType: 'text/plain; charset=utf-8', filename: `${record.id}.txt` };
  }
  async function prepareExport(id: string, format: ExportFormat) {
    const file = await exported(id, format);
    return { snapshotId: id, format, filename: file.filename, contentType: file.contentType,
      byteLength: file.bytes.length, sha256: digest(file.bytes), authentication: 'MCP access token required on every download',
      downloadPath: `/mcp/exports/${id}/${format}`, chunkBytes: 24_576 };
  }
  async function exportPage(id: string, format: ExportFormat, offset = 0) {
    const file = await exported(id, format);
    if (offset > file.bytes.length) throw new HttpError(400, '导出字节位置无效');
    const end = Math.min(offset + 24_576, file.bytes.length);
    return { snapshotId: id, format, offset, byteLength: file.bytes.length, sha256: digest(file.bytes),
      encoding: 'base64', data: file.bytes.subarray(offset, end).toString('base64'), nextOffset: end < file.bytes.length ? end : null };
  }
  return { sessions, snapshot, detail, evidencePage, exported, prepareExport, exportPage };
}
export type ArchiveQuery = ReturnType<typeof archiveQuery>;
