import { randomUUID } from 'node:crypto';
import { digest, type Database } from './database.js';
import { HttpError } from './identities.js';
import type { AnalysisService } from './analysis.js';
import type { AnalysisRun, AnalysisProcessing } from '../../packages/contracts/analysis.js';
import { beijingDate, dueReportDate, reportDate, correctionInput, type ReportCorrection, type DailyItem, type DailyReport } from '../../packages/contracts/reports.js';
import { ledgerCountProjection } from './provenance.js';
import {readEvidence} from './evidence.js';
import {qualificationDaySql} from './qualification.js';
import {transientStatistics,type WorkStatisticsService} from './work-statistics.js';
import {statisticsExtractorVersion} from '../../packages/native-statistics.js';
import {unscopedRawGapsSql} from './evidence-integrity.js';

// This is a report display classification, never a rewrite of an origin. The
// last authenticated project correction assigns each eligible event exactly once.
export const displayProjectSql=(origin:string)=>`COALESCE((SELECT c.payload->'input'->>'project' FROM report_corrections c
  WHERE c.employee_id=${origin}.employee_id AND c.date=${origin}.source_date AND c.payload->'input'->>'kind'='project'
    AND (c.payload->'input'->'eventIds') ? ${origin}.event_id ORDER BY c.sequence DESC LIMIT 1),${origin}.project)`;

export async function migrateReports(db: Database) {
  const client = await db.connect();
  try { await client.query(`BEGIN; SELECT pg_advisory_xact_lock(7402128);
    CREATE TABLE IF NOT EXISTS daily_report_periods(employee_id uuid NOT NULL REFERENCES employees(id),date text NOT NULL,
    requested_at timestamptz NOT NULL DEFAULT now(),last_checked_at timestamptz,PRIMARY KEY(employee_id,date));
    ALTER TABLE daily_report_periods ADD COLUMN IF NOT EXISTS last_checked_at timestamptz;
    ALTER TABLE daily_report_periods ADD COLUMN IF NOT EXISTS generation integer NOT NULL DEFAULT 0;
    ALTER TABLE daily_report_periods ADD COLUMN IF NOT EXISTS refresh_pending boolean NOT NULL DEFAULT true;
    ALTER TABLE daily_report_periods ADD COLUMN IF NOT EXISTS qualification_revision bigint NOT NULL DEFAULT 0;
    ALTER TABLE daily_report_periods ADD COLUMN IF NOT EXISTS source_revision text NOT NULL DEFAULT '';
    ALTER TABLE daily_report_periods ADD COLUMN IF NOT EXISTS last_inspected_at timestamptz;
    CREATE INDEX IF NOT EXISTS snapshot_event_carriers ON snapshot_events(event_id,snapshot_id);
    CREATE INDEX IF NOT EXISTS report_origin_day ON archive_event_origins(employee_id,source_date,context,event_id);
    CREATE TABLE IF NOT EXISTS daily_report_revisions(id uuid PRIMARY KEY,employee_id uuid NOT NULL REFERENCES employees(id),date text NOT NULL,
      revision integer NOT NULL,version text NOT NULL,payload jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(employee_id,date,revision));
    CREATE INDEX IF NOT EXISTS daily_report_latest ON daily_report_revisions(employee_id,date,revision DESC);
    CREATE TABLE IF NOT EXISTS report_corrections(id uuid PRIMARY KEY,employee_id uuid NOT NULL REFERENCES employees(id),date text NOT NULL,
      sequence integer NOT NULL,actor_id uuid NOT NULL REFERENCES employees(id),payload jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(employee_id,date,sequence));
    CREATE TABLE IF NOT EXISTS daily_report_schedule(id integer PRIMARY KEY CHECK(id=1),last_date text NOT NULL);
    COMMIT;`); } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

// Conclusions supported solely by another day/employee or saved historical context
// cannot become this employee's work. Mixed citations retain their background role.
export function dailyItems(runs: AnalysisRun[], employeeId: string, date: string, eventIds: Set<string>,projects=new Map<string,{project:string;correctionId:string}>()): DailyItem[] {
  const items: DailyItem[] = []; const seen = new Set<string>();
  for (const run of runs) for (const item of run.result?.items ?? []) {
    const activity = item.citations.filter(citation => citation.origin?.employeeId === employeeId
      && citation.origin.sourceDate === date && citation.origin.context === 'after-enrollment' && eventIds.has(citation.origin.eventId));
    for (const project of new Set(activity.map(citation => projects.get(citation.origin!.eventId)?.project??citation.origin!.project))) {
      const citations = activity.filter(citation => (projects.get(citation.origin!.eventId)?.project??citation.origin!.project) === project);
      const ids = [...new Set(citations.map(citation => citation.origin!.eventId))].sort();
      const key = digest(JSON.stringify([project, item.category, item.assessment, item.text, ids]));
      if (seen.has(key)) continue; seen.add(key);
      // Theme association is explicit analysis text, not a claim that equal words
      // prove equal events. Only topics citing this same project's eligible events qualify.
      const topics = run.result!.items.filter(candidate => candidate.category === 'topic' && candidate.citations.some(citation =>
        citation.origin && (projects.get(citation.origin.eventId)?.project??citation.origin.project) === project && citation.origin.employeeId === employeeId && citation.origin.sourceDate === date
        && citation.origin.context === 'after-enrollment' && eventIds.has(citation.origin.eventId)));
      const themes = [...new Set(topics.map(topic => topic.text))];
      const theme = item.category === 'topic' ? item.text : themes.length === 1 ? themes[0]! : '主题关联尚不确定';
      items.push({ ...item, citations, project,originalProject:citations[0]!.origin!.project,projectCorrectionId:projects.get(citations[0]!.origin!.eventId)?.correctionId, theme, themeAssociation: item.category === 'topic' ? 'topic-record' : themes.length === 1 ? 'inferred-single-topic' : 'unassigned', analysisId: run.id,
        activityEventIds: ids, backgroundCitations: item.citations.filter(citation => !citations.includes(citation)), fixture: run.result!.fixture });
    }
  }
  return items.sort((a, b) => a.project.localeCompare(b.project) || a.theme.localeCompare(b.theme) || a.category.localeCompare(b.category) || a.text.localeCompare(b.text));
}

const definition = '记录、用户轮次（原件或材料行）、工具调用（解析 block）按不可变 eventId 去重，仅计原员工在本来源日期的已确认接入后活动。人工显示项目归类按事件唯一分配，不改变员工本日总计、原件来源项目或原句；同一原件行涉及多项目时，各项目用户轮次可能重叠，不能相加当员工总轮次。历史或关联上下文与未知单列；材料仅被保存不算活动。未确认复制保持独立，可能存在无法确认的重复。文件、原生 token、活动区间及按日设备覆盖尚未知；区间不是人工工时。无已确认记录不证明没有工作。';
// Optional for historical short-session results. #23 owns the full per-range
// contract; reports expose its compact scope plus the immutable analysis ID.
type Processing = AnalysisProcessing;
const qualificationForPeriod = qualificationDaySql('p.employee_id','p.date');
export function reportRunCoverage(run: AnalysisRun) {
  const processing = (run.result as (AnalysisRun['result'] & { processing?: Processing }))?.processing;
  const coverage = run.input.coverage;
  return { incomplete: coverage.unrecognizedLines > 0 || coverage.partialLine || coverage.captureGaps.length > 0
    || coverage.excludedMaterials > 0 || !!processing && (!processing.complete || processing.omittedFindings > 0
      || ['failed', 'limited'].includes(processing.aggregation) || processing.ranges.some(range => range.state !== 'extracted')),
    processingScope: processing ? { version: processing.version, complete: processing.complete, aggregation: processing.aggregation,
      omittedFindings: processing.omittedFindings, extractedRanges: processing.ranges.filter(range => range.state === 'extracted').length,
      failedRanges: processing.ranges.filter(range => range.state === 'failed').length, skippedRanges: processing.ranges.filter(range => range.state === 'skipped').length } : undefined };
}
export function reportService(db: Database, analysis: AnalysisService,statistics:WorkStatisticsService,clock: () => Date = () => new Date()) {
  const parserVersions=['codex-cli','codex-desktop','claude-code-cli'].map(source=>readEvidence(Buffer.alloc(0),source as 'codex-cli').parserVersion);
  async function sourceRevision(query: Pick<Database,'query'>,employeeId:string,date:string) {
    const row=(await query.query(`SELECT
      (SELECT MAX(s.committed_at)::text FROM effective_event_origins o JOIN effective_snapshot_events se ON se.event_id=o.event_id JOIN snapshots s ON s.id=se.snapshot_id
        WHERE o.employee_id=$1 AND o.source_date=$2 AND o.context='after-enrollment') AS carrier,
      (SELECT count(*)::text FROM effective_event_origins o WHERE o.employee_id=$1 AND o.source_date=$2 AND o.context='after-enrollment') AS events,
      (SELECT count(*)::text FROM effective_event_origins o WHERE o.employee_id=$1 AND o.source_date IS NULL) AS undated,
      ${qualificationDaySql('$1','$2')} AS qualification,
      ${unscopedRawGapsSql('$1')} AS unscoped_raw_gaps,
      (SELECT MAX(t.updated_at)::text FROM analysis_targets t JOIN snapshots s ON s.id=t.desired_snapshot_id WHERE EXISTS(
        SELECT 1 FROM effective_snapshot_events se JOIN effective_event_origins o ON o.event_id=se.event_id WHERE se.snapshot_id=s.id AND o.employee_id=$1 AND o.source_date=$2 AND o.context='after-enrollment')) AS targets,
      (SELECT string_agg(DISTINCT config->>'configurationHash',',' ORDER BY config->>'configurationHash') FROM analysis_workers WHERE updated_at>now()-interval '15 seconds') AS config`,[employeeId,date])).rows[0];
    return digest(JSON.stringify({row,parserVersions,statisticsExtractorVersion}));
  }
  async function validate(employeeId: string, date: string, reader: Pick<Database, 'query'> = db) {
    reportDate.parse(date);
    const employee = (await reader.query('SELECT id,name FROM employees WHERE id=$1', [employeeId])).rows[0];
    if (!employee) throw new HttpError(404, '员工不存在');
    return employee;
  }
  async function readAt(reader: Pick<Database, 'query'>, employeeId: string, date: string, offset = 0, revision?: number): Promise<DailyReport> {
    const employee = await validate(employeeId, date, reader);
    const row = (await reader.query(`SELECT revision,version,payload,created_at,
      (SELECT refresh_pending OR qualification_revision<${qualificationForPeriod} FROM daily_report_periods p WHERE employee_id=$1 AND date=$2) AS refresh_pending
      FROM daily_report_revisions WHERE employee_id=$1 AND date=$2
      AND ($3::integer IS NULL OR revision=$3) ORDER BY revision DESC LIMIT 1`, [employeeId, date, revision ?? null])).rows[0];
    if (!row) {
      if (revision !== undefined) throw new HttpError(404, '报告版本不存在');
      const queued = (await reader.query('SELECT 1 FROM daily_report_periods WHERE employee_id=$1 AND date=$2', [employeeId, date])).rowCount;
      return { employeeId, employee: employee.name, date, timeZone: 'Asia/Shanghai', revision: 0, version: null,
        state: queued ? 'queued' : 'not-scheduled', createdAt: null, items: [], nextOffset: null, statistics: null, coverage: null, refreshPending: !!queued };
    }
    const report = row.payload as DailyReport; const page: DailyItem[] = []; let bytes = 4096 + Buffer.byteLength(JSON.stringify(report.coverage)) + Buffer.byteLength(JSON.stringify(report.corrections ?? []));
    for (const item of report.items.slice(offset, offset + 20)) {
      const size = Buffer.byteLength(JSON.stringify(item)); if (page.length && bytes + size > 80 * 1024) break;
      page.push(item); bytes += size;
    }
    const period=revision===undefined?(await reader.query('SELECT source_revision FROM daily_report_periods WHERE employee_id=$1 AND date=$2',[employeeId,date])).rows[0]:null;
    const changed=period&&period.source_revision!==await sourceRevision(reader,employeeId,date);
    return { ...report, employee: employee.name, revision: row.revision, version: row.version, createdAt: row.created_at.toISOString(),
      items: page, nextOffset: offset + page.length < report.items.length ? offset + page.length : null,
      refreshPending: revision === undefined ? row.refresh_pending||!!changed : false };
  }
  const read = (employeeId: string, date: string, offset = 0, revision?: number) => readAt(db, employeeId, date, offset, revision);
  async function request(employeeId: string, date: string) {
    await validate(employeeId, date);
    if (date > beijingDate(clock())) throw new HttpError(422, '尚未到来的日期不能生成日报');
    const managed = (await db.query(`SELECT 1 FROM devices WHERE employee_id=$1 AND enrolled_at < ($2::date+interval '1 day') AT TIME ZONE 'Asia/Shanghai' LIMIT 1`, [employeeId, date])).rowCount;
    if (!managed) throw new HttpError(422, '该日期尚无明确设备接入边界；不回填接入前日报');
    await db.query(`INSERT INTO daily_report_periods(employee_id,date) VALUES($1,$2) ON CONFLICT(employee_id,date)
      DO UPDATE SET generation=daily_report_periods.generation+1,refresh_pending=true`, [employeeId, date]);
    // Public refresh and scheduled work use the same durable period and service.
    await refresh(employeeId, date);
    return read(employeeId, date);
  }
  async function correctionHistory(employeeId:string,date:string,offset=0) {
    await validate(employeeId,date);
    const rows=(await db.query(`SELECT c.id,c.sequence,c.actor_id AS "actorId",e.name AS actor,c.created_at AS "createdAt",c.payload
      FROM report_corrections c JOIN employees e ON e.id=c.actor_id WHERE c.employee_id=$1 AND c.date=$2 ORDER BY c.sequence DESC LIMIT 21 OFFSET $3`,[employeeId,date,offset])).rows;
    const corrections:ReportCorrection[]=[];let bytes=1024;
    for(const row of rows.slice(0,20)){const value={...row.payload.input,id:row.id,sequence:row.sequence,actorId:row.actorId,actor:row.payload.actor??row.actor,createdAt:row.createdAt.toISOString()};const size=Buffer.byteLength(JSON.stringify(value));if(corrections.length&&bytes+size>24*1024)break;corrections.push(value);bytes+=size;}
    return {corrections,nextOffset:rows.length>corrections.length?offset+corrections.length:null};
  }
  async function correct(employeeId:string,date:string,actorId:string,value:unknown) {
    await validate(employeeId,date);const input=correctionInput.parse(value);const client=await db.connect();
    try{
      await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(7402128)');
      const existing=(await client.query('SELECT employee_id,date,actor_id,payload FROM report_corrections WHERE id=$1',[input.requestId])).rows[0];
      if(existing){if(existing.employee_id!==employeeId||existing.date!==date||existing.actor_id!==actorId||JSON.stringify(correctionInput.parse(existing.payload.input))!==JSON.stringify(input))throw new HttpError(409,'更正操作标识已用于不同内容');await client.query('COMMIT');return read(employeeId,date);}
      const latest=(await client.query('SELECT revision FROM daily_report_revisions WHERE employee_id=$1 AND date=$2 ORDER BY revision DESC LIMIT 1',[employeeId,date])).rows[0];
      if(latest?.revision!==input.expectedRevision)throw new HttpError(409,'报告已有新版，请读取最新版本后提交更正');
      if((await client.query('SELECT 1 FROM report_corrections WHERE employee_id=$1 AND date=$2 AND (payload->>\'expectedRevision\')::integer=$3',[employeeId,date,input.expectedRevision])).rowCount)throw new HttpError(409,'该报告已有待生成更正，请等待新版后继续');
      const sequence=Number((await client.query('SELECT COALESCE(MAX(sequence),0)+1 AS next FROM report_corrections WHERE employee_id=$1 AND date=$2',[employeeId,date])).rows[0].next);
      if(sequence>500)throw new HttpError(422,'本日更正超过500条处理边界；历史和原件仍保留');
      if(input.kind==='theme'||input.kind==='project'){
        const origins=(await client.query("SELECT event_id,project FROM effective_event_origins WHERE employee_id=$1 AND source_date=$2 AND context='after-enrollment' AND event_id=ANY($3)",[employeeId,date,input.eventIds])).rows;
        if(origins.length!==new Set(input.eventIds).size||new Set(origins.map(row=>row.project)).size!==1)throw new HttpError(422,'归类必须引用本日原员工同一原项目的已确认事件');
      }
      const actor=(await client.query('SELECT name FROM employees WHERE id=$1',[actorId])).rows[0];
      await client.query('INSERT INTO report_corrections(id,employee_id,date,sequence,actor_id,payload) VALUES($1,$2,$3,$4,$5,$6)',[input.requestId,employeeId,date,sequence,actorId,{...input,input,actor:actor.name}]);
      await client.query('UPDATE daily_report_periods SET generation=generation+1,refresh_pending=true WHERE employee_id=$1 AND date=$2',[employeeId,date]);
      await client.query(`UPDATE work_view_periods SET generation=generation+1,refresh_pending=true WHERE selection->>'from'<=$2 AND selection->>'to'>=$2
        AND (selection->>'kind'='project' OR selection->>'subject'=$1)`,[employeeId,date]);
      await client.query('COMMIT');
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
    await refresh(employeeId,date);return read(employeeId,date);
  }
  async function refresh(employeeId: string, date: string) {
    const client = await db.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      // One report normalizer globally: parallel authenticated refreshes must not
      // occupy every pool connection while nested analysis requests await a slot.
      // Other requests leave a durable pending generation for the bounded poll.
      const lock = await client.query('SELECT pg_try_advisory_xact_lock(7402128) AS locked');
      if (!lock.rows[0].locked) { await client.query('ROLLBACK'); return; }
      const generation = (await client.query('SELECT generation FROM daily_report_periods WHERE employee_id=$1 AND date=$2', [employeeId, date])).rows[0]?.generation;
      const qualificationRevision = (await client.query(`SELECT ${qualificationForPeriod} AS revision FROM daily_report_periods p WHERE employee_id=$1 AND date=$2`,[employeeId,date])).rows[0]?.revision??'0';
      const sourceVersion=await sourceRevision(client,employeeId,date);
      const employee = (await client.query('SELECT name FROM employees WHERE id=$1', [employeeId])).rows[0];
      const correctionRows=(await client.query(`SELECT c.id,c.sequence,c.actor_id AS "actorId",e.name AS actor,c.created_at AS "createdAt",c.payload,
        count(*) OVER() AS total FROM report_corrections c JOIN employees e ON e.id=c.actor_id WHERE c.employee_id=$1 AND c.date=$2 ORDER BY sequence DESC LIMIT 500`,[employeeId,date])).rows;
      const allCorrections:ReportCorrection[]=correctionRows.map(row=>({...row.payload.input,id:row.id,sequence:row.sequence,actorId:row.actorId,actor:row.payload.actor??row.actor,createdAt:row.createdAt.toISOString()}));
      const corrections=allCorrections.slice(0,8);const reanalyze=allCorrections.find(value=>value.kind==='reanalyze');
      const events = (await client.query(`SELECT event_id,project FROM effective_event_origins WHERE employee_id=$1 AND source_date=$2
        AND context='after-enrollment' ORDER BY event_id LIMIT 10001`, [employeeId, date])).rows;
      const ledger = (await client.query(`SELECT ${ledgerCountProjection} FROM effective_event_origins o WHERE o.employee_id=$1 AND o.source_date=$2`, [employeeId, date])).rows[0];
      const projectRows = (await client.query(`SELECT ${displayProjectSql('o')} AS project,${ledgerCountProjection} FROM effective_event_origins o
        WHERE o.employee_id=$1 AND o.source_date=$2 GROUP BY ${displayProjectSql('o')} ORDER BY project LIMIT 101`, [employeeId, date])).rows;
      const projectStatistics: NonNullable<DailyReport['coverage']>['projectStatistics'] = []; let projectBytes = 0;
      for (const row of projectRows.slice(0, 100)) {
        const value = { project: row.project as string, records: row.activityRecords as number, userTurns: row.activityUserTurns as number, toolCalls: row.activityToolCalls as number };
        const size = Buffer.byteLength(JSON.stringify(value)); if (projectBytes + size > 16 * 1024) break;
        projectStatistics.push(value); projectBytes += size;
      }
      const projectStatisticsComplete = projectStatistics.length === projectRows.length;
      const counts = { records: ledger.activityRecords, userTurns: ledger.activityUserTurns, toolCalls: ledger.activityToolCalls,
        historicalRecords: ledger.historicalRecords, unknownRecords: ledger.unknownRecords };
      const undated = Number((await client.query(`SELECT count(*) FROM effective_event_origins WHERE employee_id=$1 AND source_date IS NULL`, [employeeId])).rows[0].count);
      // Each event's latest exact carrier is chosen, including restored primary
      // copies. Original origin coordinates/ownership stay frozen in analysis input.
      const snapshots = events.length > 10000 ? [] : (await client.query(`SELECT DISTINCT s.id,s.hash FROM effective_event_origins o
        CROSS JOIN LATERAL (SELECT ss.id,ss.hash FROM effective_snapshot_events se JOIN snapshots ss ON ss.id=se.snapshot_id
          WHERE se.event_id=o.event_id ORDER BY ss.committed_at DESC,ss.id DESC LIMIT 1) s
        WHERE o.employee_id=$1 AND o.source_date=$2 AND o.context='after-enrollment' ORDER BY s.id LIMIT 101`, [employeeId, date])).rows;
      const overflow = events.length > 10000 || snapshots.length > 100;
      const messages = ['只总结本来源日期的已确认活动；背景引用不计当天工作。', '按日设备覆盖、未解析原件与遗漏活动尚未证实；零已确认记录不代表无活动。',
        '文件与 Token 为来源记录量；活动区间是已记录活动点，人工工时未知。统计原句使用本版固定统计引用。'];
      if (undated) messages.push(`${undated} 条来源日期未知，不能任意归入本日。`);
      if (overflow) messages.push('本日输入超出 10000 事件 / 100 主原件处理边界；保留统计，未完整生成主题。');
      if (!projectStatisticsComplete) messages.push('逐项目计数超过 100 项 / 16KiB 元数据边界；未覆盖项目计数保持未知，员工本日总计数仍保留。');
      const runs: AnalysisRun[] = []; const inputs: NonNullable<DailyReport['coverage']>['inputs'] = [];
      const available = await analysis.availability();
      if (!available.ready) messages.push(available.reason);
      for (const snapshot of overflow ? [] : snapshots) {
        try {
          const run = await analysis.request(snapshot.id, reanalyze?.actorId??null, reanalyze?{trigger:'manual',recomputeId:reanalyze.id}:{ trigger: 'scheduled' }) as AnalysisRun;
          runs.push(run); inputs.push({ snapshotId: snapshot.id, hash: snapshot.hash, analysisId: run.id, state: run.state,
            applicable: run.applicable, generation: run.generation, configurationHash: run.config.configurationHash, parserVersion: run.input.parserVersion,
            attributionRevision: run.input.attributionRevision,
            processingScope: reportRunCoverage(run).processingScope });
          if (run.state === 'failed') messages.push(`分析 ${run.id} 失败；本日材料尚不足以形成完整主题。`);
          if (run.state === 'succeeded' && !run.applicable) messages.push(`分析 ${run.id} 已过时，不能作为当前日报结论；旧分析及原件仍可核查。`);
        } catch (error) {
          const message = error instanceof HttpError ? error.message : '分析暂时不可用；原件仍保留';
          messages.push(message); inputs.push({ snapshotId: snapshot.id, hash: snapshot.hash, analysisId: null, state: 'unavailable' });
        }
      }
      const ids = new Set<string>(events.slice(0, 10000).map(row => row.event_id));
      const waiting = runs.some(run => ['queued', 'running', 'retry-wait'].includes(run.state));
      const evidenceIncomplete = runs.some(run => reportRunCoverage(run).incomplete);
      const incomplete = overflow || evidenceIncomplete || inputs.some(input => ['failed', 'unavailable'].includes(input.state)
        || (input.state === 'succeeded' && !input.applicable));
      const projects=new Map<string,{project:string;correctionId:string}>();
      for(const correction of allCorrections)if(correction.kind==='project')for(const id of correction.eventIds)if(!projects.has(id))projects.set(id,{project:correction.project,correctionId:correction.id});
      const items = dailyItems(runs.filter(run => run.state === 'succeeded' && run.applicable), employeeId, date, ids,projects);
      for(const item of items){const correction=allCorrections.find(value=>value.kind==='theme'&&item.activityEventIds.some(id=>value.eventIds.includes(id)));
        if(correction?.kind==='theme'){item.originalTheme=item.theme;item.theme=correction.theme;item.themeAssociation='manual-correction';item.correctionId=correction.id;}}
      let state: DailyReport['state'] = waiting ? 'waiting-analysis' : incomplete ? (runs.some(run => run.state === 'succeeded' && run.applicable) ? 'partial' : 'unavailable')
        : events.length && !items.length ? 'partial' : 'ready';
      if (events.length && !items.length && !waiting) messages.push('没有可用于本日目标、行动、结果或阻塞的分析引用；不能推断这些事项为零。');
      for (const run of runs) {
        const coverage = run.input.coverage;
        if (coverage.unrecognizedLines || coverage.partialLine || coverage.captureGaps.length || coverage.excludedMaterials)
          messages.push(`原件 ${run.snapshotId}：${coverage.unrecognizedLines} 行未解析，${coverage.partialLine ? '有未闭合末行' : '末行闭合'}，${coverage.excludedMaterials} 项关联材料未分析，${coverage.captureGaps.length} 项采集缺口。未分析不表示无活动。`);
        const processing = reportRunCoverage(run).processingScope;
        if (processing && (!processing.complete || processing.failedRanges || processing.skippedRanges || processing.omittedFindings))
          messages.push(`分析 ${run.id}：${processing.extractedRanges} 范围提取、${processing.failedRanges} 失败、${processing.skippedRanges} 跳过，聚合 ${processing.aggregation}，省略 ${processing.omittedFindings} 项。仅保留本日已证实原句，未覆盖范围未知。`);
      }
      const originalEventHash = digest(JSON.stringify([...ids]));
      const recorded=await statistics.freeze(client,employeeId,date);
      const {paths:_paths,...files}=recorded.files;
      if(!recorded.sourceInputsComplete){messages.push('确定性统计仍有原件、完整性或处理边界缺口；可观察值不代表全部工作。');if(state==='ready')state='partial';}
      const payload: DailyReport = { employeeId, employee: employee.name, date, timeZone: 'Asia/Shanghai', revision: 0, version: null,
        state, createdAt: null, items, nextOffset: null, refreshPending: false,
        corrections,correctionCount:Number(correctionRows[0]?.total??0),
        statistics: { ...counts, files, tokens: recorded.tokens, activityIntervals: recorded.intervals,sourceInputsComplete:recorded.sourceInputsComplete,humanWorkHours: null, definition },
        coverage: { messages: [...new Set(messages)], inputs, qualificationRevision, sourceRevision:sourceVersion, originalEventIdsSample: [...ids].slice(0, 20), originalEventCount: counts.records,
          projectStatistics, projectStatisticsComplete,
          workStatistics:{employeeId,date,revision:recorded.revision,version:recorded.version},
          originalEventHash, originalEventHashComplete: events.length <= 10000, eligibleInputsComplete: !incomplete && !waiting,
          dailyDeviceCoverage: 'unknown', fixture: runs.some(run => run.result?.fixture || run.config.mode === 'fixture') } };
      // Bound public metadata separately from paged conclusions; retain exact
      // event input identity as a digest instead of a response containing 10000 IDs.
      const version = digest(JSON.stringify({ payload, originalEventHash, runs: runs.map(run => ({ id: run.id, config: run.config, input: run.input })) }));
      // Raw uploads, configuration/parser changes and explicit recomputations can
      // arrive while normalization prepares jobs outside this repeatable snapshot.
      // Publish only the still-current input; the persistent pending period retries.
      if(await sourceRevision(db,employeeId,date)!==sourceVersion){await client.query('ROLLBACK');return;}
      const latest = (await client.query(`SELECT revision,version FROM daily_report_revisions WHERE employee_id=$1 AND date=$2 ORDER BY revision DESC LIMIT 1`, [employeeId, date])).rows[0];
      if (latest?.version !== version) await client.query(`INSERT INTO daily_report_revisions(id,employee_id,date,revision,version,payload)
        VALUES($1,$2,$3,$4,$5,$6)`, [randomUUID(), employeeId, date, (latest?.revision ?? 0) + 1, version, payload]);
      await client.query(`UPDATE daily_report_periods SET last_checked_at=now(),qualification_revision=$4,source_revision=$5,refresh_pending=CASE WHEN generation=$3 THEN false ELSE refresh_pending END
        WHERE employee_id=$1 AND date=$2`, [employeeId, date, generation,qualificationRevision,sourceVersion]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      // A newer public refresh generation won while this repeatable input was
      // being analyzed. Its durable pending request will be handled by the poll.
      if (transientStatistics(error)) return;
      throw error;
    } finally { client.release(); }
  }
  async function tick(now = clock()) {
    const due = dueReportDate(now);
    if (due) {
      const client = await db.connect();
      try {
        await client.query('BEGIN'); await client.query('SELECT pg_advisory_xact_lock(7402129)');
        const row = (await client.query('SELECT last_date FROM daily_report_schedule WHERE id=1')).rows[0];
        // Initial deployment starts with the due natural day, never pre-enrollment
        // years carried in old sessions. Subsequent downtime catches up in batches.
        const start = row ? beijingDate(new Date(new Date(`${row.last_date}T00:00:00+08:00`).getTime()+86400_000)) : due;
        const end = [due, beijingDate(new Date(new Date(`${start}T00:00:00+08:00`).getTime()+30*86400_000))].sort()[0]!;
        await client.query(`INSERT INTO daily_report_periods(employee_id,date)
          SELECT DISTINCT d.employee_id,to_char(day,'YYYY-MM-DD') FROM generate_series($1::date,$2::date,interval '1 day') day
          JOIN devices d ON d.enrolled_at < (day::date+interval '1 day') AT TIME ZONE 'Asia/Shanghai'
          ON CONFLICT DO NOTHING`, [start, end]);
        if (start <= end) await client.query('INSERT INTO daily_report_schedule(id,last_date) VALUES(1,$1) ON CONFLICT(id) DO UPDATE SET last_date=EXCLUDED.last_date', [end]);
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    }
    // Inspect only existing managed periods, fairly and in bounded batches. Late
    // raw bytes never manufacture pre-enrollment reports or enter today's counts.
    const inspected=(await db.query('SELECT employee_id,date,source_revision FROM daily_report_periods ORDER BY last_inspected_at NULLS FIRST,requested_at LIMIT 20')).rows;
    for(const period of inspected){const current=await sourceRevision(db,period.employee_id,period.date);
      await db.query(`UPDATE daily_report_periods SET last_inspected_at=now(),refresh_pending=refresh_pending OR source_revision<>$3 WHERE employee_id=$1 AND date=$2`,[period.employee_id,period.date,current]);}
    const periods = (await db.query(`SELECT p.employee_id,p.date FROM daily_report_periods p
      LEFT JOIN LATERAL (SELECT payload,created_at FROM daily_report_revisions r WHERE r.employee_id=p.employee_id AND r.date=p.date ORDER BY revision DESC LIMIT 1) r ON true
      WHERE p.refresh_pending OR p.qualification_revision<${qualificationForPeriod} OR r.payload IS NULL OR r.payload->>'state' IN ('waiting-analysis','queued','unavailable')
      ORDER BY p.last_checked_at NULLS FIRST,p.requested_at LIMIT 10`)).rows;
    for (const period of periods) await refresh(period.employee_id, period.date);
  }
  async function list(offset = 0) {
    const result = (await db.query(`SELECT p.employee_id AS "employeeId",e.name AS employee,p.date,
      coalesce(r.payload->>'state','queued') AS state,coalesce(r.revision,0) AS revision,r.version
      FROM daily_report_periods p JOIN employees e ON e.id=p.employee_id LEFT JOIN LATERAL
      (SELECT revision,version,payload FROM daily_report_revisions WHERE employee_id=p.employee_id AND date=p.date ORDER BY revision DESC LIMIT 1) r ON true
      ORDER BY p.date DESC,e.name,p.employee_id LIMIT 51 OFFSET $1`, [offset])).rows;
    return { reports: result.slice(0, 50), nextOffset: result.length > 50 ? offset + 50 : null, timeZone: 'Asia/Shanghai',
      schedule: '每天北京时间 09:00 将前一自然日入队；入队不保证届时完成。' };
  }
  async function employees(offset = 0) {
    const rows = (await db.query(`SELECT id,name FROM employees ORDER BY name,id LIMIT 101 OFFSET $1`, [offset])).rows;
    return { employees: rows.slice(0, 100), nextOffset: rows.length > 100 ? offset + 100 : null };
  }
  return { read, readAt, request, list, tick, employees,correct,correctionHistory,inputRevision:sourceRevision };
}
export type ReportService = ReturnType<typeof reportService>;
