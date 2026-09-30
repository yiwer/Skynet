import { z } from 'zod';
import { type Database, digest } from './database.js';
import { RawStore } from './raw-store.js';
import { HttpError } from './identities.js';
import { readEvidence } from './evidence.js';
import { activityFor, beijingDate } from '../../packages/activity.js';
import { manifestSchema, type Manifest } from '../../packages/contracts/archive.js';
import { createRecoveryPackage, recoveryInfo } from '../../packages/recovery.js';
import { QueryCache } from './query-cache.js';
import { readCaptureHealth } from './capture-health.js';
import { archiveSearch } from './archive-search.js';
import { locationSchema, type EvidenceLocation } from '../../packages/contracts/search.js';
import { eventOrigins, archiveStatistics } from './provenance.js';
import type { EventOrigin } from '../../packages/contracts/provenance.js';
import type { Provenance } from '../../packages/contracts/provenance.js';
import { attributionRevision } from './qualification.js';
import {verifySnapshotIntegrity} from './evidence-integrity.js';

export const exportFormat = z.enum(['raw', 'readable', 'recovery']);
export type ExportFormat = z.infer<typeof exportFormat>;
const listCursor = z.object({ at: z.iso.datetime(), id: z.uuid(), ceiling: z.iso.datetime() });
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const textEnd = (text: string, start: number, length: number) => {
  let end = Math.min(start + length, text.length);
  if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1]!) && /[\uDC00-\uDFFF]/.test(text[end]!)) end--;
  return end;
};

// Authentication belongs to each transport. Facts, evidence locations and exports belong here.
export function archiveQuery(db: Database, raw: RawStore) {
  const search = archiveSearch(db, raw);
  // Sizes are charged conservatively for UTF-16 text and native JSON parse structures.
  const evidenceCache = new QueryCache<Awaited<ReturnType<typeof parsed>>>(192 * 1024 * 1024, value => value.estimatedBytes);
  const exportCache = new QueryCache<{ bytes: Buffer; contentType: string; filename: string; text?: string }>(256 * 1024 * 1024,
    value => value.bytes.length + (value.text?.length ?? 0) * 2);
  async function sessions(cursor?: string, limit = 50) {
    let page: z.infer<typeof listCursor> | undefined;
    if (cursor) {
      try { page = listCursor.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString())); }
      catch { throw new HttpError(400, '会话分页位置无效'); }
    }
    const ceiling = page?.ceiling ?? null;
    const result = await db.query(`WITH boundary AS (SELECT COALESCE($1::timestamptz,statement_timestamp()) AS ceiling)
      SELECT *,to_char(committed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time,
      (SELECT to_char(ceiling AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') FROM boundary) AS query_ceiling FROM (
      SELECT DISTINCT ON (s.device_id,s.source,s.source_session_id) s.id,e.name AS employee,s.source_session_id,
        s.manifest->>'project' AS project,s.committed_at,s.hash,(s.manifest->>'byteLength')::integer AS byte_length,
        s.manifest->>'sourceVersion' AS source_version,s.manifest->>'sourceOs' AS source_os,s.source
      FROM snapshots s JOIN devices d ON d.id=s.device_id JOIN employees e ON e.id=d.employee_id
      WHERE s.committed_at <= (SELECT ceiling FROM boundary)
      ORDER BY s.device_id,s.source,s.source_session_id,s.committed_at DESC,s.id DESC
    ) latest WHERE ($2::timestamptz IS NULL OR (committed_at,id) < ($2::timestamptz,$3::uuid))
    ORDER BY committed_at DESC,id DESC LIMIT $4`, [ceiling, page?.at ?? null, page?.id ?? null, limit + 1]);
    const selected = []; let pageBytes = 512;
    for (const row of result.rows.slice(0, limit)) {
      const size = Buffer.byteLength(JSON.stringify(row));
      if (selected.length && pageBytes + size > 8192) break;
      selected.push(row); pageBytes += size;
    }
    const last = selected.at(-1);
    const rows = selected.map(({ cursor_time: _cursor, query_ceiling: _ceiling, ...row }) => row);
    return { sessions: rows, limit, capability: 'unverified', backup: 'single-copy',
      nextCursor: result.rows.length > selected.length ? encode({ at: last.cursor_time, id: last.id, ceiling: last.query_ceiling }) : null };
  }
  async function snapshot(id: string) {
    if (!z.uuid().safeParse(id).success) throw new HttpError(404, '未找到存档');
    const result = await db.query(`SELECT s.*,e.name AS employee,e.id AS employee_id FROM snapshots s
      JOIN devices d ON d.id=s.device_id JOIN employees e ON e.id=d.employee_id WHERE s.id=$1`, [id]);
    if (!result.rows[0]) throw new HttpError(404, '未找到已提交存档');
    return result.rows[0];
  }
  async function parsed(id: string) {
    const record = await snapshot(id); const bytes = await raw.read(record.device_id, record.hash);
    const evidence = readEvidence(bytes, record.manifest.source);
    const origins = new Map<string, EventOrigin>((await eventOrigins(db, id)).map(origin => [`${origin.line}/${origin.block}`,
      { ...origin, line: origin.originLine, block: origin.originBlock }]));
    const activity = activityFor(evidence.events, record.manifest.enrolledAt, beijingDate(new Date()), origins);
    return { record, evidence, activity, recovery: recoveryInfo(record.manifest, bytes), estimatedBytes: bytes.length * 3 + origins.size * 1536 };
  }
  async function detail(id: string, offset = 0, summary = false) {
    if (!z.uuid().safeParse(id).success) throw new HttpError(404, '未找到存档');
    await verifySnapshotIntegrity(db,raw,id);
    const revision=await attributionRevision(db,id);
    const { record, evidence, activity, recovery } = await evidenceCache.get(`${id}:${beijingDate(new Date())}:${revision}`, async () => {
      if(await attributionRevision(db,id)!==revision)throw new HttpError(409,'原件归属版本已更新，请重新读取');
      const value=await parsed(id);
      if(await attributionRevision(db,id)!==revision)throw new HttpError(409,'原件归属版本已更新，请重新读取');
      return value;
    });
    if(await attributionRevision(db,id)!==revision)throw new HttpError(409,'原件归属版本已更新，请重新读取');
    return { snapshotId: record.id, employee: record.employee, deviceId: record.device_id, manifest: record.manifest,
      committedAt: record.committed_at, state: 'committed', backup: 'single-copy', ...evidence, recovery, provenance: record.provenance,
      captureHealth: await readCaptureHealth(db, record.device_id, record.source, record.source_session_id),
      activity: activity.activity, events: summary ? [] : activity.events.slice(offset, offset + 100), total: evidence.events.length,
      nextOffset: offset + 100 < evidence.events.length ? offset + 100 : null };
  }
  async function evidencePage(id: string, offset = 0, textOffset = 0) {
    const result = await detail(id, offset);
    if (offset > result.total || (!result.events.length && textOffset !== 0)) throw new HttpError(400, '证据分页位置无效');
    const events = []; let remaining = 2048; let index = offset; let nextText = textOffset;
    for (const event of result.events) {
      if (nextText > event.text.length) throw new HttpError(400, '证据文字位置无效');
      // Offsets count UTF-16 code units, exactly as JavaScript strings do. The original is never truncated.
      const text = event.text.slice(nextText, textEnd(event.text, nextText, remaining));
      events.push({ ...event, text, textOffset: nextText, textLength: event.text.length });
      remaining -= text.length; nextText += text.length;
      if (nextText === event.text.length) { index++; nextText = 0; }
      if (!remaining || events.length === 25 || nextText !== 0) break;
    }
    const { events: _events, nextOffset: _next, manifest, recovery, activity, captureHealth, ...metadata } = result;
    const { capture, ...manifestHeader } = manifestSchema.parse(manifest);
    const { artifacts, gaps, lineage, ...recoveryHeader } = recovery;
    const { days, ...activityHeader } = activity;
    return { ...metadata, manifest: manifestHeader,
      captureHealth: { report: captureHealth.report, receivedAt: captureHealth.receivedAt, faultCount: captureHealth.total, detailsTool: 'read_capture_status' },
      recovery: { ...recoveryHeader, artifactCount: artifacts.length, gapCount: gaps.length, lineageCount: lineage.length, detailsTool: 'read_manifest' },
      activity: { ...activityHeader, sourceDayCount: days.length, sourceDaysLocation: 'each evidence event sourceDate; full Web snapshot detail' },
      capture: capture ? {
      generation: capture.generation, revision: capture.revision, change: capture.change, previousSnapshotId: capture.previousSnapshotId,
      compacted: capture.compacted, partialLine: capture.partialLine, materialCount: capture.materials.length, gapCount: capture.gaps.length, lineageCount: capture.lineage.length,
    } : null, manifestPaging: { tool: 'read_manifest', snapshotId: id, textOffset: 0 },
    events, next: index < result.total ? { offset: index, textOffset: nextText } : null,
      evidenceLocation: 'immutable snapshotId + original line; textOffset uses UTF-16 code units' };
  }
  async function captureStatus(id: string, offset = 0) {
    const record = await snapshot(id);
    return { snapshotId: id, ...await readCaptureHealth(db, record.device_id, record.source, record.source_session_id, offset) };
  }
  async function manifestPage(id: string, textOffset = 0) {
    const record = await snapshot(id); const text = JSON.stringify(record.manifest);
    if (textOffset > text.length) throw new HttpError(400, '清单文字位置无效');
    const end = textEnd(text, textOffset, 2048);
    return { snapshotId: id, textOffset, text: text.slice(textOffset, end), totalChars: text.length, sha256: digest(text),
      nextOffset: end < text.length ? end : null, encoding: 'JSON text; offsets count UTF-16 code units' };
  }
  async function exported(id: string, format: ExportFormat) {
    if (!z.uuid().safeParse(id).success) throw new HttpError(404, '未找到存档');
    if(format==='readable')await verifySnapshotIntegrity(db,raw,id);
    const revision=format==='readable'?await attributionRevision(db,id):'raw';
    const value=await exportCache.get(`${id}:${format}:${revision}`, async () => {
      if(format==='readable'&&await attributionRevision(db,id)!==revision)throw new HttpError(409,'原件归属版本已更新，请重新导出');
      const value=await buildExport(id, format);
      if(format==='readable'&&await attributionRevision(db,id)!==revision)throw new HttpError(409,'原件归属版本已更新，请重新导出');
      return value;
    });
    if(format==='readable'&&await attributionRevision(db,id)!==revision)throw new HttpError(409,'原件归属版本已更新，请重新导出');
    return value;
  }
  async function buildExport(id: string, format: ExportFormat) {
    const record = await snapshot(id); const bytes = await raw.read(record.device_id, record.hash);
    if (format === 'raw') return { bytes, contentType: 'application/octet-stream', filename: `${record.id}.jsonl` };
    const manifest = manifestSchema.parse(record.manifest);
    const materials = await Promise.all((manifest.capture?.materials ?? []).map(async material => ({ id: material.id, bytes: await raw.read(record.device_id, material.hash) })));
    if (format === 'recovery') return { bytes: Buffer.from(JSON.stringify(createRecoveryPackage(
      { id: record.id, employee: record.employee, committedAt: record.committed_at.toISOString() }, manifest, bytes, materials))),
    contentType: 'application/json', filename: `${record.id}.skynet-recovery.json` };
    const { evidence, activity } = await parsed(id);
    const associated = await Promise.all((manifest.capture?.materials ?? []).map(async (material, index) => {
      const data = materials[index]!.bytes;
      return `\n=== 关联材料 ${material.name}（${material.role}；上下文，不计新增活动） ===\nSHA-256：${material.hash}；字节：${material.byteLength}\n捕获来源：${JSON.stringify(await materialOwnership(record, material.id))}\n编码：${material.mediaType === 'binary' ? 'base64' : 'UTF-8'}\n${material.mediaType === 'binary' ? data.toString('base64') : data.toString('utf8')}`;
    }));
    const content = [
      'Skynet 会话可读导出 v1', `快照：${record.id}`, `员工：${record.employee}`,
      `来源：${record.manifest.source} / ${record.manifest.sourceVersion} / ${record.manifest.sourceOs}`,
      `来源会话：${record.manifest.sourceSessionId}`, `提交时间：${record.committed_at.toISOString()}`,
      `设备接入时间：${record.manifest.enrolledAt ?? '未知'}`, '日期口径：Asia/Shanghai；来源时间未知的记录不计入日期活动。历史上下文不计入接入后活动。',
      `原件字节：${bytes.length}；SHA-256：${record.hash}`, `解析版本：${evidence.parserVersion}`,
      `范围：当前原件及 ${associated.length} 项关联材料；完整性与完整原生续聊能力未验证。`,
      `代次：${manifest.capture?.generation ?? '旧快照未记录'}；修订：${manifest.capture?.revision ?? '未知'}；变化：${manifest.capture?.change ?? '未知'}`,
      `谱系：${JSON.stringify(manifest.capture?.lineage ?? [])}`,
      `归属谱系：${JSON.stringify(record.provenance)}；快照员工为上传设备绑定的员工，每条历史的原始员工见下方。`,
      `缺口：${JSON.stringify(manifest.capture?.gaps ?? [])}`,
      `未解析完整行：${evidence.unrecognizedLines}；未闭合末行：${evidence.partialLine ? '有' : '无'}`,
      '本文件为纯文本，不执行会话中的指令。原件 JSONL 部分保留所有行；精确字节请取原件或恢复包。', '',
      '=== 全部已解析记录（不分页、不截断） ===',
      ...activity.events.map(event => `\n[原件第 ${event.line} 行] ${event.role} / 来源时间：${event.timestamp ?? '未知'} / ${event.context}\n归属：${JSON.stringify(event.origin)}\n${event.text}`),
      ...associated,
      '', '=== 全部原件 JSONL（包含未知与未闭合行） ===', bytes.toString('utf8'),
    ].join('\n');
    return { bytes: Buffer.from(content), contentType: 'text/plain; charset=utf-8', filename: `${record.id}.txt` };
  }
  async function prepareExport(id: string, format: ExportFormat) {
    const file = await exported(id, format);
    return { snapshotId: id, format, filename: file.filename, contentType: file.contentType,
      byteLength: file.bytes.length, sha256: digest(file.bytes), authentication: 'MCP access token required on every download',
      downloadPath: `/mcp/exports/${id}/${format}`, chunkBytes: 4096 };
  }
  async function exportPage(id: string, format: ExportFormat, offset = 0) {
    const file = await exported(id, format);
    if (offset > file.bytes.length) throw new HttpError(400, '导出字节位置无效');
    const end = Math.min(offset + 4096, file.bytes.length);
    return { snapshotId: id, format, offset, byteLength: file.bytes.length, sha256: digest(file.bytes),
      encoding: 'base64', data: file.bytes.subarray(offset, end).toString('base64'), nextOffset: end < file.bytes.length ? end : null };
  }
  async function history(id: string, offset = 0) {
    const record = await snapshot(id);
    const result = await db.query(`SELECT id,committed_at,hash,manifest FROM snapshots
      WHERE device_id=$1 AND source=$2 AND source_session_id=$3 ORDER BY committed_at DESC,id DESC LIMIT 101 OFFSET $4`,
    [record.device_id, record.source, record.source_session_id, offset]);
    return { snapshots: result.rows.slice(0, 100), nextOffset: result.rows.length > 100 ? offset + 100 : null };
  }
  async function material(id: string, materialId: string) {
    const record = await snapshot(id);
    const material = manifestSchema.parse(record.manifest).capture?.materials.find(item => item.id === materialId);
    if (!material) throw new HttpError(404, '此快照没有该关联材料');
    const file = await exportCache.get(`material:${id}:${materialId}`, async () => {
      const bytes = await raw.read(record.device_id, material.hash);
      return { bytes, filename: `${material.id}.bin`, contentType: 'application/octet-stream',
        text: material.mediaType === 'binary' ? bytes.toString('base64') : bytes.toString('utf8') };
    });
    return { material, bytes: file.bytes, text: file.text!, ownership: await materialOwnership(record, materialId) };
  }
  async function materialOwnership(record: { id: string; manifest: Manifest; device_id: string; employee: string; provenance: Provenance | null }, materialId: string) {
    const selected = record.manifest.capture?.materials.find(item => item.id === materialId);
    if (!selected) throw new HttpError(404, '此快照没有该关联材料');
    let origin = record; let warning: string | null = null; const visited = new Set<string>();
    let previousSource: { snapshotId: string; materialId: string; employeeId: string; employee: string; deviceId: string } | null = null;
    for (let depth = 0; depth < 32; depth++) {
      if (visited.has(origin.id)) { warning = '关联材料谱系存在循环，保留当前已确认来源。'; break; }
      visited.add(origin.id);
      const sourceId = origin.provenance?.sourceSnapshotId;
      if (!sourceId) break;
      const prior = await snapshot(sourceId);
      const candidate = manifestSchema.parse(prior.manifest).capture?.materials.find(item => item.id === materialId && item.role === selected.role && item.sourceSessionId === selected.sourceSessionId);
      if (!candidate) break;
      if (candidate.hash !== selected.hash || candidate.byteLength !== selected.byteLength) {
        previousSource = { snapshotId: prior.id, materialId, employeeId: prior.employee_id, employee: prior.employee, deviceId: prior.device_id };
        warning = `关联材料已变化，不能把整份材料归为当前员工或此前员工；此前来源快照 ${prior.id} / 材料 ${materialId}，员工 ${prior.employee}。单独续用此子会话的历史员工归属仍待核实。`; break;
      }
      origin = prior;
      if (depth === 31) warning = '关联材料谱系超过 32 层；更早来源尚未核实。';
    }
    const owner = (await db.query('SELECT employee_id FROM devices WHERE id=$1', [origin.device_id])).rows[0];
    return { snapshotId: origin.id, materialId, deviceId: origin.device_id, employeeId: owner.employee_id, employee: origin.employee,
      relation: previousSource ? 'changed-context-uncertain' : origin.id === record.id ? 'captured-context' : 'verified-identical-context', countedAsActivity: false, warning, previousSource,
      limitation: '这是关联上下文的捕获来源，不是独立员工活动。材料经正常宿主事件独立采集后，只有服务器验证原生身份和完整原件前缀的恢复声明才能确认历史事件归属。' };
  }
  async function materialPage(id: string, materialId: string, offset = 0, limit = 32_768) {
    const file = await material(id, materialId);
    const text = file.text;
    if (offset > text.length) throw new HttpError(400, '关联材料文字位置无效');
    const end = textEnd(text, offset, limit);
    return { material: file.material, ownership: file.ownership, context: 'associated-context-only', encoding: file.material.mediaType === 'binary' ? 'base64' : 'utf8',
      text: text.slice(offset, end), nextOffset: end < text.length ? end : null };
  }
  async function locationPage(id: string, input: EvidenceLocation) {
    const location = locationSchema.parse(input);
    if (location.kind === 'raw') return search.rawPage(await snapshot(id), location.line, location.textOffset);
    if (location.kind === 'material') {
      const page = await materialPage(id, location.materialId, location.textOffset, 2048);
      return { ...page, snapshotId: id, kind: 'material', textOffset: location.textOffset,
        next: page.nextOffset === null ? null : { ...location, textOffset: page.nextOffset } };
    }
    const { evidence } = await evidenceCache.get(`${id}:${beijingDate(new Date())}`, () => parsed(id));
    if (location.parserVersion && location.parserVersion !== evidence.parserVersion) throw new HttpError(409,
      `证据解析版本已改变；原件未变，请重新搜索，或下载原件查看第 ${location.line ?? 1} 行`);
    const offset = location.line === undefined ? location.offset : evidence.events.findIndex(event => event.line === location.line && event.block === location.block);
    if (offset < 0) throw new HttpError(400, '该原件行或 block 没有对应的已解析记录');
    const page = await evidencePage(id, offset, location.textOffset);
    const nextEvent = page.next ? evidence.events[page.next.offset] : undefined;
    return { ...page, kind: 'event', next: page.next === null ? null : { kind: 'event', ...page.next,
      line: nextEvent?.line, block: nextEvent?.block, parserVersion: evidence.parserVersion } };
  }
  return { sessions, snapshot, detail, evidencePage, manifestPage, exported, prepareExport, exportPage, history, material, materialPage,
    search: search.search, locationPage, captureStatus, statistics: (offset = 0) => archiveStatistics(db, offset) };
}
export type ArchiveQuery = ReturnType<typeof archiveQuery>;
