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
import { analysisProjection, analysisTransaction, migrateQueue, sweepQueue } from '../analysis/queue.js';

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
    `);
  await migrateQueue(client); await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}
export type AnalysisInput = AnalysisRun['input'] & { events: (EvidenceLine & Partial<Pick<ActivityEvent, 'origin' | 'context' | 'sourceDate'>>)[] };
const runProjection = analysisProjection;
export async function prepareAnalysisInput(db: Database, archive: ArchiveQuery, snapshotId: string, config: AnalysisRun['config']) {
    const record = await archive.snapshot(snapshotId);
    if (record.manifest.byteLength > config.maxInputBytes) throw new HttpError(413, '该原件超过短会话分析限额；尚未分析，请使用后续长会话处理');
    const { bytes } = await archive.exported(snapshotId, 'raw');
    if (digest(bytes) !== record.hash || bytes.length !== record.manifest.byteLength) throw new HttpError(409, '分析输入原件校验失败；没有调用模型');
    try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { throw new HttpError(422, '原件包含损坏的 UTF-8；没有调用模型，完整原始字节仍可存档、查询与导出'); }
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
    return { record, input };
}
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
    await analysisTransaction(db, sweepQueue);
    await archive.snapshot(snapshotId);
    const result = await db.query(`SELECT ${runProjection} FROM analysis_jobs j WHERE snapshot_id=$1 ORDER BY created_at DESC,id DESC LIMIT 11 OFFSET $2`, [snapshotId, offset]);
    const runs: AnalysisRun[] = []; let bytes = 2048;
    for (const run of result.rows.slice(0, 10)) {
      const size = Buffer.byteLength(JSON.stringify(run));
      if (runs.length && bytes + size > 80 * 1024) break;
      runs.push(run); bytes += size;
    }
    return { runs, nextOffset: result.rows.length > runs.length ? offset + runs.length : null, availability: await availability() };
  }
  // Scheduled reporting records a system principal, never a source employee as requester.
  // for a manual per-session request. Archive ACK never calls normalization or this service.
  async function request(snapshotId: string, actorId: string | null, options: { trigger?: AnalysisRun['trigger']; config?: AnalysisRun['config'] } = {}) {
    const trigger = options.trigger ?? 'manual'; const actorKind = actorId ? 'user' : 'system';
    if (!actorId && trigger === 'manual') throw new HttpError(400, '人工请求必须记录认证用户');
    const config = options.config ?? await worker();
    if (!config) throw new HttpError(503, '分析未配置、配置混用或运行时离线；原件不受影响');
    const { record, input } = await prepareAnalysisInput(db, archive, snapshotId, config);
    return analysisTransaction(db, async client => {
      await sweepQueue(client);
      const latest = (await client.query('SELECT id FROM snapshots WHERE device_id=$1 AND source=$2 AND source_session_id=$3 ORDER BY committed_at DESC,id DESC LIMIT 1',
        [record.device_id, record.source, record.source_session_id])).rows[0];
      const target = (await client.query(`INSERT INTO analysis_targets(id,device_id,source,source_session_id,desired_snapshot_id,config_hash,actor_id,actor_kind)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(device_id,source,source_session_id) DO UPDATE SET
        generation=analysis_targets.generation+CASE WHEN analysis_targets.config_hash<>EXCLUDED.config_hash THEN 1 ELSE 0 END,
        applicable_job_id=CASE WHEN analysis_targets.config_hash<>EXCLUDED.config_hash THEN NULL ELSE analysis_targets.applicable_job_id END,
        config_hash=EXCLUDED.config_hash,actor_id=EXCLUDED.actor_id,actor_kind=EXCLUDED.actor_kind,error=NULL RETURNING id,generation`,
        [randomUUID(), record.device_id, record.source, record.source_session_id, latest.id, config.configurationHash, actorId, actorKind])).rows[0];
      const existing = await client.query(`SELECT ${runProjection} FROM analysis_jobs j WHERE snapshot_id=$1 AND config->>'configurationHash'=$2
        AND target_generation=$3 ORDER BY created_at DESC,id DESC LIMIT 1`, [snapshotId, config.configurationHash, target.generation]);
      if (existing.rows[0]) return existing.rows[0];
      const count = await client.query("SELECT count(*)::int AS count FROM analysis_jobs WHERE state IN ('queued','running','retry-wait')");
      if (count.rows[0].count >= 100) throw new HttpError(429, '分析队列已满，请稍后重试；原件不受影响');
      const result = await client.query(`INSERT INTO analysis_jobs AS j(id,snapshot_id,actor_id,state,config,input,target_id,target_generation,max_attempts,trigger,actor_kind)
        VALUES($1,$2,$3,'queued',$4,$5,$6,$7,$8,$9,$10) RETURNING ${runProjection}`,
        [randomUUID(), snapshotId, actorId, config, input, target.id, target.generation, config.maxAttempts ?? 1, trigger, actorKind]);
      await client.query("INSERT INTO analysis_actions(id,job_id,actor_id,actor_kind,action) VALUES($1,$2,$3,$4,'request')", [randomUUID(), result.rows[0].id, actorId, actorKind]);
      return result.rows[0];
    });
  }
  async function get(id: string) {
    await analysisTransaction(db, sweepQueue);
    const result = await db.query(`SELECT ${runProjection} FROM analysis_jobs j WHERE id=$1`, [id]);
    if (!result.rows[0]) throw new HttpError(404, '分析任务不存在');
    return result.rows[0] as AnalysisRun;
  }
  async function retry(id: string, actorId: string) {
    const config = await worker(); if (!config) throw new HttpError(503, '分析配置离线或混用；原件不受影响');
    await analysisTransaction(db, async client => {
      await sweepQueue(client);
      const row = (await client.query('SELECT j.*,t.generation AS desired_generation FROM analysis_jobs j LEFT JOIN analysis_targets t ON t.id=j.target_id WHERE j.id=$1 FOR UPDATE OF j', [id])).rows[0];
      if (!row) throw new HttpError(404, '分析任务不存在');
      if (row.config.configurationHash !== config.configurationHash || row.target_generation !== row.desired_generation) throw new HttpError(409, '输入或配置版本已过期，请从最新快照发起新版本');
      if (!['failed', 'retry-wait'].includes(row.state) || row.attempts >= row.max_attempts) throw new HttpError(409, '任务不可重试或已达持久尝试上限；未知用量预留保留');
      await client.query("UPDATE analysis_jobs SET state='queued',next_attempt_at=now(),finished_at=NULL,error=NULL WHERE id=$1", [id]);
      await client.query("INSERT INTO analysis_actions(id,job_id,actor_id,action) VALUES($1,$2,$3,'retry')", [randomUUID(), id, actorId]);
    });
    return get(id);
  }
  async function enqueueLatest(config: AnalysisRun['config']) {
    if (!config.autoAnalyzeUpdates) return;
    await analysisTransaction(db, sweepQueue);
    const targets = await db.query(`SELECT t.*,s.committed_at FROM analysis_targets t JOIN snapshots s ON s.id=t.desired_snapshot_id
      WHERE t.config_hash=$1 AND s.committed_at<now()-$2*interval '1 second'
        AND NOT EXISTS(SELECT 1 FROM analysis_jobs j WHERE j.target_id=t.id AND j.target_generation=t.generation)
      ORDER BY t.updated_at LIMIT 20`, [config.configurationHash, config.autoDebounceSeconds]);
    for (const target of targets.rows) try {
      await request(target.desired_snapshot_id, null, { config, trigger: 'incremental' });
    } catch (error) {
      const reason = error instanceof HttpError ? error.message : '分析输入准备暂时失败；原件仍可查询与导出';
      await db.query('UPDATE analysis_targets SET error=$2 WHERE id=$1 AND generation=$3', [target.id, reason, target.generation]);
    }
  }
  async function enqueueLatestIfReady() {
    const config = await worker();
    if (config) await enqueueLatest(config);
  }
  async function operations(offset = 0) {
    await analysisTransaction(db, sweepQueue);
    const workers = (await db.query(`SELECT id,config,updated_at AS "updatedAt",updated_at>now()-interval '15 seconds' AS online
      FROM analysis_workers ORDER BY updated_at DESC LIMIT 10`)).rows;
    const counts = (await db.query('SELECT state,count(*)::integer AS count FROM analysis_jobs GROUP BY state')).rows;
    const budgets = (await db.query('SELECT id,reserved_cny AS "reservedCny" FROM analysis_budgets ORDER BY id LIMIT 20')).rows;
    const targets = (await db.query(`SELECT id,desired_snapshot_id AS "desiredSnapshotId",generation,config_hash AS "configurationHash",applicable_job_id AS "applicableJobId",error
      FROM analysis_targets ORDER BY updated_at DESC,id DESC LIMIT 10 OFFSET $1`, [offset])).rows;
    const metadataProjection = runProjection.replace('j.result', '(j.result IS NOT NULL) AS "resultAvailable",NULL::jsonb AS result');
    const rows = (await db.query(`SELECT ${metadataProjection} FROM analysis_jobs j ORDER BY created_at DESC,id DESC LIMIT 11 OFFSET $1`, [offset])).rows;
    const runs: AnalysisRun[] = []; let bytes = Buffer.byteLength(JSON.stringify({ workers, counts, budgets, targets })) + 2048;
    for (const run of rows.slice(0, 10)) { const size = Buffer.byteLength(JSON.stringify(run)); if (runs.length && bytes + size > 80 * 1024) break; runs.push(run); bytes += size; }
    return { availability: await availability(), workers, counts, budgets, targets, runs,
      nextOffset: rows.length > runs.length ? offset + runs.length : null, providerBilledCny: null,
      definition: '每个输入/配置版本持久有限尝试；预算逐尝试预留且未知失败不退款。增量仅处理已跟踪目标；日周定时器可独立创建目标，不依赖人工逐会话请求。' };
  }
  return { list, request, availability, get, retry, operations, enqueueLatest, enqueueLatestIfReady };
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
