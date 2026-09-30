import { randomUUID } from 'node:crypto';
import { digest, type Database } from './database.js';
import type { ArchiveQuery } from './archive-query.js';
import { HttpError } from './identities.js';
import { readEvidence } from './evidence.js';
import { analysisOutputSchema, type AnalysisItem, type AnalysisRun } from '../../packages/contracts/analysis.js';
import { evidenceLink, type EvidenceLocation } from '../../packages/contracts/search.js';
import type { EvidenceLine } from '../../packages/contracts/archive.js';
import type { ActivityEvent } from '../../packages/activity.js';
import { activityFor } from '../../packages/activity.js';
import { eventOrigins } from './provenance.js';
import type { EventOrigin } from '../../packages/contracts/provenance.js';

export async function migrateAnalysis(db: Database) {
  const client = await db.connect();
  try {
  await client.query(`BEGIN; SELECT pg_advisory_xact_lock(7402122);
    CREATE TABLE IF NOT EXISTS analysis_workers (id text PRIMARY KEY, config jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS analysis_jobs (id uuid PRIMARY KEY, snapshot_id uuid NOT NULL REFERENCES snapshots(id),
      actor_id uuid NOT NULL REFERENCES employees(id), state text NOT NULL, config jsonb NOT NULL, input jsonb NOT NULL,
      result jsonb, error text, created_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz, finished_at timestamptz,
      run_token uuid, deadline timestamptz);
    CREATE INDEX IF NOT EXISTS analysis_snapshot_time ON analysis_jobs(snapshot_id,created_at DESC,id DESC);
    CREATE TABLE IF NOT EXISTS analysis_budgets (id text PRIMARY KEY, reserved_cny numeric NOT NULL DEFAULT 0);
    COMMIT;`);
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}
export type AnalysisInput = AnalysisRun['input'] & { events: (EvidenceLine & Partial<Pick<ActivityEvent, 'origin' | 'context' | 'sourceDate'>>)[] };
const runProjection = `id,snapshot_id AS "snapshotId",state,config,input - 'events' AS input,result,error,
  created_at AS "createdAt",started_at AS "startedAt",finished_at AS "finishedAt"`;
export function analysisService(db: Database, archive: ArchiveQuery) {
  async function worker() {
    const result = await db.query("SELECT DISTINCT config FROM analysis_workers WHERE updated_at > now()-interval '15 seconds'");
    // Mixed deployments must not silently select a different model, credential or budget.
    return result.rows.length === 1 ? result.rows[0]?.config as AnalysisRun['config'] : undefined;
  }
  async function availability() {
    const config = await worker();
    return config ? { ready: true, reason: config.mode === 'fixture' ? '合成演示运行时；未调用真实千问，不作为正式分析验收' : 'Claude Code 分析运行时可用',
      mode: config.mode, model: config.model, runtimeVersion: config.runtimeVersion }
      : { ready: false, reason: '分析未配置或运行时离线；需部署专用 Claude Code、千问按量模型、凭据与预算。原件仍可同步、查询和导出。' };
  }
  async function list(snapshotId: string, offset = 0) {
    await archive.snapshot(snapshotId);
    const result = await db.query(`SELECT ${runProjection} FROM analysis_jobs WHERE snapshot_id=$1 ORDER BY created_at DESC,id DESC LIMIT 11 OFFSET $2`, [snapshotId, offset]);
    const runs: AnalysisRun[] = []; let bytes = 2048;
    for (const run of result.rows.slice(0, 10)) {
      const size = Buffer.byteLength(JSON.stringify(run));
      if (runs.length && bytes + size > 80 * 1024) break;
      runs.push(run); bytes += size;
    }
    return { runs, nextOffset: result.rows.length > runs.length ? offset + runs.length : null, availability: await availability() };
  }
  async function request(snapshotId: string, actorId: string) {
    const record = await archive.snapshot(snapshotId); const config = await worker();
    if (!config) throw new HttpError(503, '分析未配置或运行时离线；原件不受影响');
    if (record.manifest.byteLength > config.maxInputBytes) throw new HttpError(413, '该原件超过短会话分析限额；尚未分析，请使用后续长会话处理');
    const { bytes } = await archive.exported(snapshotId, 'raw');
    if (digest(bytes) !== record.hash || bytes.length !== record.manifest.byteLength) throw new HttpError(409, '分析输入原件校验失败；没有调用模型');
    const parsed = readEvidence(bytes, record.source);
    const origins = new Map<string, EventOrigin>((await eventOrigins(db, snapshotId)).map(origin => [`${origin.line}/${origin.block}`,
      { ...origin, line: origin.originLine, block: origin.originBlock }]));
    const attributed = activityFor(parsed.events, record.manifest.enrolledAt, undefined, origins);
    const input: AnalysisInput = { snapshotId, hash: record.hash, parserVersion: parsed.parserVersion, source: record.source,
      sourceVersion: record.manifest.sourceVersion, eventCount: parsed.events.length, events: attributed.events,
      coverage: { unrecognizedLines: parsed.unrecognizedLines, partialLine: parsed.partialLine,
        excludedMaterials: record.manifest.capture?.materials.length ?? 0, captureGaps: record.manifest.capture?.gaps ?? [],
        scope: '当前不可变主原件的全部已解析事件；未知行、未闭合末行及关联材料未进入本次分析；这不表示这些范围没有活动。' } };
    if (!input.eventCount) throw new HttpError(422, '原件没有可分析的已解析事件；仍可下载完整原件');
    if (Buffer.byteLength(JSON.stringify(input)) > config.maxInputBytes) throw new HttpError(413, '规范化输入超过短会话限额；尚未分析');
    if (Buffer.byteLength(JSON.stringify({ ...input, events: undefined })) > 16 * 1024) throw new HttpError(413, '覆盖元数据超过短会话限额；尚未分析，完整清单仍可导出');
    const client = await db.connect();
    try {
      await client.query('BEGIN'); await client.query('SELECT pg_advisory_xact_lock(7402123)');
      const existing = await client.query(`SELECT ${runProjection} FROM analysis_jobs WHERE snapshot_id=$1 AND config->>'configurationHash'=$2
        AND state IN ('queued','running','succeeded') ORDER BY created_at DESC LIMIT 1`, [snapshotId, config.configurationHash]);
      if (existing.rows[0]) { await client.query('COMMIT'); return existing.rows[0]; }
      const count = await client.query("SELECT count(*)::int AS count FROM analysis_jobs WHERE state IN ('queued','running')");
      if (count.rows[0].count >= 100) throw new HttpError(429, '分析队列已满，请稍后重试；原件不受影响');
      const result = await client.query(`INSERT INTO analysis_jobs(id,snapshot_id,actor_id,state,config,input) VALUES($1,$2,$3,'queued',$4,$5) RETURNING ${runProjection}`,
        [randomUUID(), snapshotId, actorId, config, input]);
      await client.query('COMMIT'); return result.rows[0];
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async function get(id: string) {
    const result = await db.query(`SELECT ${runProjection} FROM analysis_jobs WHERE id=$1`, [id]);
    if (!result.rows[0]) throw new HttpError(404, '分析任务不存在');
    return result.rows[0] as AnalysisRun;
  }
  return { list, request, availability, get };
}
export type AnalysisService = ReturnType<typeof analysisService>;

export function validateAnalysis(input: AnalysisInput, value: unknown): AnalysisItem[] {
  const output = analysisOutputSchema.parse(value);
  if (!output.items.length) throw new Error('Empty analysis is not a successful extraction');
  const items = output.items.map(item => {
    if (item.assessment !== 'insufficient' && !item.citations.length) throw new Error('Uncited conclusion');
    const citations = item.citations.map(citation => {
      const event = input.events[citation.event];
      if (!event || event.text.slice(citation.textOffset, citation.textOffset + citation.quote.length) !== citation.quote) throw new Error('Citation does not match original evidence');
      const snapshotId = event.origin?.snapshotId ?? input.snapshotId;
      const inputLocation = { kind: 'event' as const, offset: citation.event, textOffset: citation.textOffset,
        line: event.line, block: event.block, parserVersion: input.parserVersion };
      // Material/raw origin anchors are in the original artifact's coordinate system. A
      // semantic quote offset cannot be added to raw JSON offsets across escaped text.
      const origin = event.origin as (EventOrigin & { materialId?: string; textOffset?: number; location?: EvidenceLocation }) | undefined;
      const location: EvidenceLocation = origin?.location ?? (origin?.materialId
        ? { kind: 'material', materialId: origin.materialId, textOffset: origin.textOffset ?? 0 }
        : { kind: 'event' as const, offset: citation.event, textOffset: citation.textOffset,
        line: event.origin?.line ?? event.line, block: event.block === undefined ? undefined : event.origin?.block ?? event.block, parserVersion: input.parserVersion });
      return { ...citation, snapshotId, role: event.role, origin: event.origin ?? null, context: event.context ?? 'unknown-enrollment',
        inputSnapshotId: input.snapshotId, inputLocation, location, webPath: evidenceLink(snapshotId, location) };
    });
    let assessment = item.assessment;
    // Citation existence does not prove a generated proposition. Only literal tool output is
    // labeled observed, and that label describes the record, never independent real-world verification.
    if (assessment === 'observed' && !(citations.length === 1 && citations[0]!.role === 'tool result' && item.text === citations[0]!.quote)) {
      assessment = citations.every(citation => ['user', 'assistant'].includes(citation.role)) ? 'claimed' : 'inferred';
    }
    if (assessment === 'claimed' && !citations.every(citation => ['user', 'assistant'].includes(citation.role))) assessment = 'inferred';
    return { ...item, assessment, citations, classificationAdjusted: assessment !== item.assessment };
  });
  if (Buffer.byteLength(JSON.stringify(items)) > 48 * 1024) throw new Error('Analysis result exceeds published size limit');
  return items;
}
