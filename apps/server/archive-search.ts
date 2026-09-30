import { setImmediate } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { digest, type Database } from './database.js';
import type { RawStore } from './raw-store.js';
import { HttpError } from './identities.js';
import { readEvidence } from './evidence.js';
import { beijingDate } from '../../packages/activity.js';
import { manifestSchema, sourceTimestamp, type SessionSummary } from '../../packages/contracts/archive.js';
import { evidenceLink, searchSchema, type SearchInput, type SearchHit, type EvidenceLocation } from '../../packages/contracts/search.js';
import { eventOrigins } from './provenance.js';

const cursorSchema = z.object({ scan: z.uuid(), offset: z.number().int().min(0), query: z.string().length(64) });
const scope = '每个匹配快照返回首个命中：已解析原文、原件 JSONL（含未知和未闭合行）、文本关联材料；二进制不做 OCR。员工和项目按已确认事件原始归属匹配；无法解析的原件行及关联材料只能按上传设备员工/清单项目匹配。内容、员工、项目均为不区分大小写的字面包含。日期是命中记录的北京时间来源日期，未知日期不匹配日期筛选；关联材料日期未知。';
export const textBoundary = (text: string, end: number) => end > 0 && /[\uD800-\uDBFF]/.test(text[end - 1]!) && /[\uDC00-\uDFFF]/.test(text[end] ?? '') ? end - 1 : end;

export async function migrateArchiveSearch(db: Database) {
  await db.query(`CREATE TABLE IF NOT EXISTS archive_search_scans (
    id uuid PRIMARY KEY, query_hash text NOT NULL, snapshot_ids uuid[] NOT NULL,
    created_at timestamptz NOT NULL DEFAULT statement_timestamp()
  )`);
}

// Bounded, resumable scans over persisted immutable originals avoid a second, lossy content index.
// A continuation can contain zero hits. Only complete=true means the fixed range is exhausted.
export function archiveSearch(db: Database, raw: RawStore) {
  let busy = false;
  async function exclusive<T>(operation: () => Promise<T>) {
    if (busy) throw new HttpError(429, '另一项原文检索正在读取，请稍后重试同一页');
    busy = true;
    try { return await operation(); } finally { busy = false; }
  }
  async function search(input: SearchInput) {
    const { cursor, limit, ...filters } = searchSchema.parse(input);
    const fingerprint = digest(JSON.stringify(filters));
    let page: z.infer<typeof cursorSchema> | undefined;
    if (cursor) {
      try { page = cursorSchema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString())); }
      catch { throw new HttpError(400, '搜索分页位置无效'); }
      if (page.query !== fingerprint) throw new HttpError(400, '筛选已改变，请从第一页重新搜索');
    }
    return exclusive(async () => {
      const connection = await db.connect();
      let rows; let scanId = page?.scan; let boundary: string;
      try {
        await connection.query('BEGIN'); await connection.query("SET LOCAL statement_timeout = '5s'");
        if (!scanId) {
          // Freeze membership in one MVCC statement, including the latest revision selection.
          // A transaction opened earlier but committed later cannot appear midway through a scan.
          await connection.query('SELECT pg_advisory_xact_lock(7402127)');
          await connection.query("DELETE FROM archive_search_scans WHERE created_at < statement_timestamp()-interval '15 minutes'");
          const count = await connection.query('SELECT count(*)::integer AS count FROM archive_search_scans');
          if (count.rows[0].count >= 128) throw new HttpError(429, '同时保留的搜索已达上限，请继续已有搜索或 15 分钟后重试');
          const selected = await connection.query(`WITH candidates AS (SELECT s.*,e.name AS employee,
              row_number() OVER (PARTITION BY s.device_id,s.source,s.source_session_id ORDER BY s.committed_at DESC,s.id DESC) AS recency
              FROM snapshots s JOIN devices d ON d.id=s.device_id JOIN employees e ON e.id=d.employee_id)
            SELECT id FROM candidates c WHERE ($1='all' OR recency=1) AND ($5::text IS NULL OR source=$5) AND
              ((strpos(lower(employee),lower($2))>0 AND strpos(lower(manifest->>'project'),lower($3))>0
                AND ($4='all' OR COALESCE(manifest->>'project','')=''))
              OR EXISTS(SELECT 1 FROM snapshot_events se JOIN archive_event_origins o ON o.event_id=se.event_id JOIN employees oe ON oe.id=o.employee_id
                WHERE se.snapshot_id=c.id AND strpos(lower(oe.name),lower($2))>0 AND strpos(lower(o.project),lower($3))>0 AND ($4='all' OR o.project='')))
            ORDER BY committed_at DESC,id DESC LIMIT 100001`,
          [filters.history, filters.employee, filters.project, filters.projectState, filters.source ?? null]);
          if (selected.rows.length > 100_000) throw new HttpError(413, '候选快照超过单次检索的 100,000 份上限，请收窄员工、项目或 Agent；未返回不完整结果');
          scanId = randomUUID();
          await connection.query('INSERT INTO archive_search_scans(id,query_hash,snapshot_ids) VALUES($1,$2,$3)', [scanId, fingerprint, selected.rows.map(row => row.id)]);
        }
        const scan = await connection.query("SELECT query_hash,created_at,cardinality(snapshot_ids) AS total FROM archive_search_scans WHERE id=$1 AND created_at >= statement_timestamp()-interval '15 minutes'", [scanId]);
        if (!scan.rows[0]) throw new HttpError(410, '本次搜索已过期，请重新搜索；原件没有删除');
        if (scan.rows[0].query_hash !== fingerprint || (page?.offset ?? 0) > scan.rows[0].total) throw new HttpError(400, '搜索分页位置与筛选不匹配');
        boundary = scan.rows[0].created_at.toISOString();
        const result = await connection.query(`SELECT s.*,e.name AS employee FROM archive_search_scans q,
          unnest(q.snapshot_ids[$2::integer+1:$2::integer+9]) WITH ORDINALITY AS member(id,ordinal)
          JOIN snapshots s ON s.id=member.id JOIN devices d ON d.id=s.device_id JOIN employees e ON e.id=d.employee_id
          WHERE q.id=$1 ORDER BY member.ordinal`, [scanId, page?.offset ?? 0]);
        rows = result.rows; await connection.query('COMMIT');
      } catch (error) { await connection.query('ROLLBACK'); throw error; } finally { connection.release(); }
      const hits: SearchHit[] = []; let scanned = 0; let scannedBytes = 0;
      const expression = filters.content ? new RegExp(filters.content.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'iu') : null;
      const dateMatches = (timestamp: string | null) => {
        const date = timestamp ? beijingDate(timestamp) : null;
        return !(filters.from || filters.to) || date !== null && (!filters.from || date >= filters.from) && (!filters.to || date <= filters.to);
      };
      for (const row of rows.slice(0, 8)) {
        const manifest = manifestSchema.parse(row.manifest);
        const bytes = await raw.read(row.device_id, row.hash); scannedBytes += bytes.length;
        const evidence = readEvidence(bytes, manifest.source);
        const origins = new Map((await eventOrigins(db, row.id)).map(event => [`${event.line}/${event.block}`, event]));
        const ownerMatches = (employee: string, project: string) => employee.toLowerCase().includes(filters.employee.toLowerCase())
          && project.toLowerCase().includes(filters.project.toLowerCase()) && (filters.projectState === 'all' || project === '');
        const currentOwnerMatches = ownerMatches(row.employee, manifest.project);
        let hitEmployee = row.employee; let hitProject = manifest.project;
        let hit: Pick<SearchHit, 'location' | 'line' | 'block' | 'sourceDate' | 'excerpt' | 'matchLength'> | undefined;
        function match(text: string, timestamp: string | null, location: EvidenceLocation, line: number | null, block: number | null = null) {
          if (!dateMatches(timestamp)) return;
          const found = expression?.exec(text);
          if (expression && !found) return;
          const index = found?.index ?? 0; const start = textBoundary(text, Math.max(0, index - 80));
          hit = { location: { ...location, textOffset: index }, line, block, sourceDate: timestamp ? beijingDate(timestamp) : null,
            excerpt: text.slice(start, textBoundary(text, Math.min(text.length, index + (found?.[0].length ?? 0) + 120))), matchLength: found?.[0].length ?? 0 };
        }
        for (const [offset, event] of evidence.events.entries()) {
          const origin = origins.get(`${event.line}/${event.block ?? 0}`);
          if (!ownerMatches(origin?.employee ?? row.employee, origin?.project ?? manifest.project)) continue;
          match(event.text, event.timestamp, { kind: 'event', offset, textOffset: 0, line: event.line, block: event.block, parserVersion: evidence.parserVersion }, event.line, event.block ?? null);
          if (hit) { hitEmployee = origin?.employee ?? row.employee; hitProject = origin?.project ?? manifest.project; break; }
        }
        if (!hit) {
          // Raw lines also preserve metadata, unsupported formats and partial trailing writes.
          for (const [index, line] of bytes.toString('utf8').split('\n').entries()) {
            if (!line) continue;
            const origin = origins.get(`${index + 1}/0`);
            if (!ownerMatches(origin?.employee ?? row.employee, origin?.project ?? manifest.project)) continue;
            let timestamp: string | null = null;
            try { timestamp = sourceTimestamp(JSON.parse(line)?.timestamp); } catch { /* Unknown source time remains unknown. */ }
            match(line, timestamp, { kind: 'raw', line: index + 1, textOffset: 0 }, index + 1);
            if (hit) { hitEmployee = origin?.employee ?? row.employee; hitProject = origin?.project ?? manifest.project; break; }
          }
        }
        if (!hit && currentOwnerMatches && !(filters.from || filters.to)) for (const material of manifest.capture?.materials ?? []) {
          if (material.mediaType === 'binary') continue;
          const content = await raw.read(row.device_id, material.hash); scannedBytes += content.length;
          match(content.toString('utf8'), null, { kind: 'material', materialId: material.id, textOffset: 0 }, null);
          if (hit) break;
        }
        if (!hit && currentOwnerMatches && !expression && !(filters.from || filters.to)) hit = { location: null, line: null, block: null, sourceDate: null, excerpt: '当前原件为空；可查看清单和完整导出。', matchLength: 0 };
        if (hit) {
          const session: SessionSummary = { id: row.id, employee: hitEmployee, source_session_id: row.source_session_id, project: hitProject,
            committed_at: row.committed_at.toISOString(), hash: row.hash, byte_length: manifest.byteLength, source_version: manifest.sourceVersion, source_os: manifest.sourceOs, source: manifest.source };
          const result = { ...session, ...hit, generation: manifest.capture?.generation ?? null, revision: manifest.capture?.revision ?? null, webPath: evidenceLink(row.id, hit.location) };
          if (hits.length && Buffer.byteLength(JSON.stringify([...hits, result])) > 7000) break;
          hits.push(result);
        }
        scanned++; await setImmediate();
        if (hits.length === limit || scannedBytes >= 128 * 1024 * 1024) break;
      }
      const complete = rows.length <= scanned;
      return { hits, scanned, complete, scope, boundary,
        nextCursor: complete ? null : Buffer.from(JSON.stringify({ scan: scanId, offset: (page?.offset ?? 0) + scanned, query: fingerprint })).toString('base64url') };
    });
  }
  async function rawPage(record: { id: string; device_id: string; hash: string }, line: number, textOffset: number) {
    return exclusive(async () => {
      const lines = (await raw.read(record.device_id, record.hash)).toString('utf8').split('\n');
      const text = lines[line - 1];
      if (text === undefined || textOffset > text.length) throw new HttpError(400, '原件文字位置无效');
      const start = textBoundary(text, textOffset); const end = textBoundary(text, Math.min(text.length, start + 2048));
      const next: EvidenceLocation | null = end < text.length ? { kind: 'raw', line, textOffset: end }
        : line < lines.length && (line < lines.length - 1 || lines[line]) ? { kind: 'raw', line: line + 1, textOffset: 0 } : null;
      return { snapshotId: record.id, kind: 'raw', line, textOffset: start, text: text.slice(start, end), textLength: text.length, next,
        interpretation: '原件 UTF-8 文本；未知行不被当作已解析业务事件。完整精确字节使用 raw 导出。' };
    });
  }
  return { search, rawPage };
}
