import { randomUUID } from 'node:crypto';
import { digest, type Database } from './database.js';
import { HttpError } from './identities.js';
import type { AnalysisService } from './analysis.js';
import type { AnalysisRun } from '../../packages/contracts/analysis.js';
import { beijingDate, dueReportDate, reportDate, type DailyItem, type DailyReport } from '../../packages/contracts/reports.js';

export async function migrateReports(db: Database) {
  await db.query(`CREATE TABLE IF NOT EXISTS daily_report_periods(employee_id uuid NOT NULL REFERENCES employees(id),date text NOT NULL,
    requested_at timestamptz NOT NULL DEFAULT now(),last_checked_at timestamptz,PRIMARY KEY(employee_id,date));
    ALTER TABLE daily_report_periods ADD COLUMN IF NOT EXISTS last_checked_at timestamptz;
    CREATE INDEX IF NOT EXISTS snapshot_event_carriers ON snapshot_events(event_id,snapshot_id);
    CREATE INDEX IF NOT EXISTS report_origin_day ON archive_event_origins(employee_id,source_date,context,event_id);
    CREATE TABLE IF NOT EXISTS daily_report_revisions(id uuid PRIMARY KEY,employee_id uuid NOT NULL REFERENCES employees(id),date text NOT NULL,
      revision integer NOT NULL,version text NOT NULL,payload jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(employee_id,date,revision));
    CREATE INDEX IF NOT EXISTS daily_report_latest ON daily_report_revisions(employee_id,date,revision DESC);
    CREATE TABLE IF NOT EXISTS daily_report_schedule(id integer PRIMARY KEY CHECK(id=1),last_date text NOT NULL);`);
}

// Conclusions supported solely by another day/employee or saved historical context
// cannot become this employee's work. Mixed citations retain their background role.
export function dailyItems(runs: AnalysisRun[], employeeId: string, date: string, eventIds: Set<string>): DailyItem[] {
  const items: DailyItem[] = []; const seen = new Set<string>();
  for (const run of runs) for (const item of run.result?.items ?? []) {
    const activity = item.citations.filter(citation => citation.origin?.employeeId === employeeId
      && citation.origin.sourceDate === date && citation.origin.context === 'after-enrollment' && eventIds.has(citation.origin.eventId));
    for (const project of new Set(activity.map(citation => citation.origin!.project))) {
      const citations = activity.filter(citation => citation.origin!.project === project);
      const ids = [...new Set(citations.map(citation => citation.origin!.eventId))].sort();
      const key = digest(JSON.stringify([project, item.category, item.assessment, item.text, ids]));
      if (seen.has(key)) continue; seen.add(key);
      // Theme association is explicit analysis text, not a claim that equal words
      // prove equal events. Only topics citing this same project's eligible events qualify.
      const topics = run.result!.items.filter(candidate => candidate.category === 'topic' && candidate.citations.some(citation =>
        citation.origin?.project === project && citation.origin.employeeId === employeeId && citation.origin.sourceDate === date
        && citation.origin.context === 'after-enrollment' && eventIds.has(citation.origin.eventId)));
      const themes = [...new Set(topics.map(topic => topic.text))];
      const theme = item.category === 'topic' ? item.text : themes.length === 1 ? themes[0]! : '主题关联尚不确定';
      items.push({ ...item, citations, project, theme, themeAssociation: item.category === 'topic' ? 'topic-record' : themes.length === 1 ? 'inferred-single-topic' : 'unassigned', analysisId: run.id,
        activityEventIds: ids, backgroundCitations: item.citations.filter(citation => !citations.includes(citation)), fixture: run.result!.fixture });
    }
  }
  return items.sort((a, b) => a.project.localeCompare(b.project) || a.theme.localeCompare(b.theme) || a.category.localeCompare(b.category) || a.text.localeCompare(b.text));
}

const definition = '记录、用户轮次（原件或材料行）、工具调用（解析 block）按不可变 eventId 去重，仅计原员工在本来源日期的已确认接入后活动。历史或关联上下文与未知单列；材料仅被保存不算活动。文件、原生 token、活动区间及按日设备覆盖尚未知；区间不是人工工时。无已确认记录不证明没有工作。';
export function reportService(db: Database, analysis: AnalysisService) {
  async function validate(employeeId: string, date: string) {
    reportDate.parse(date);
    const employee = (await db.query('SELECT id,name FROM employees WHERE id=$1', [employeeId])).rows[0];
    if (!employee) throw new HttpError(404, '员工不存在');
    return employee;
  }
  async function read(employeeId: string, date: string, offset = 0, revision?: number): Promise<DailyReport> {
    const employee = await validate(employeeId, date);
    const row = (await db.query(`SELECT revision,version,payload,created_at FROM daily_report_revisions WHERE employee_id=$1 AND date=$2
      AND ($3::integer IS NULL OR revision=$3) ORDER BY revision DESC LIMIT 1`, [employeeId, date, revision ?? null])).rows[0];
    if (!row) {
      if (revision !== undefined) throw new HttpError(404, '报告版本不存在');
      const queued = (await db.query('SELECT 1 FROM daily_report_periods WHERE employee_id=$1 AND date=$2', [employeeId, date])).rowCount;
      return { employeeId, employee: employee.name, date, timeZone: 'Asia/Shanghai', revision: 0, version: null,
        state: queued ? 'queued' : 'not-scheduled', createdAt: null, items: [], nextOffset: null, statistics: null, coverage: null };
    }
    const report = row.payload as DailyReport; const page: DailyItem[] = []; let bytes = 4096 + Buffer.byteLength(JSON.stringify(report.coverage));
    for (const item of report.items.slice(offset, offset + 20)) {
      const size = Buffer.byteLength(JSON.stringify(item)); if (page.length && bytes + size > 80 * 1024) break;
      page.push(item); bytes += size;
    }
    return { ...report, employee: employee.name, revision: row.revision, version: row.version, createdAt: row.created_at.toISOString(),
      items: page, nextOffset: offset + page.length < report.items.length ? offset + page.length : null };
  }
  async function request(employeeId: string, date: string) {
    await validate(employeeId, date);
    if (date > beijingDate()) throw new HttpError(422, '尚未到来的日期不能生成日报');
    const managed = (await db.query(`SELECT 1 FROM devices WHERE employee_id=$1 AND enrolled_at < ($2::date+interval '1 day') AT TIME ZONE 'Asia/Shanghai' LIMIT 1`, [employeeId, date])).rowCount;
    if (!managed) throw new HttpError(422, '该日期尚无明确设备接入边界；不回填接入前日报');
    await db.query('INSERT INTO daily_report_periods(employee_id,date) VALUES($1,$2) ON CONFLICT DO NOTHING', [employeeId, date]);
    // Public refresh and scheduled work use the same durable period and service.
    await refresh(employeeId, date);
    return read(employeeId, date);
  }
  async function refresh(employeeId: string, date: string) {
    const client = await db.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      const lock = await client.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,7402128)) AS locked', [`${employeeId}/${date}`]);
      if (!lock.rows[0].locked) { await client.query('ROLLBACK'); return; }
      const employee = (await client.query('SELECT name FROM employees WHERE id=$1', [employeeId])).rows[0];
      const events = (await client.query(`SELECT event_id,project FROM archive_event_origins WHERE employee_id=$1 AND source_date=$2
        AND context='after-enrollment' ORDER BY event_id LIMIT 10001`, [employeeId, date])).rows;
      const counts = (await client.query(`SELECT count(*) FILTER(WHERE context='after-enrollment')::integer AS records,
        count(DISTINCT(snapshot_id,material_id,line)) FILTER(WHERE context='after-enrollment' AND role='user')::integer AS "userTurns",
        count(*) FILTER(WHERE context='after-enrollment' AND role='tool request')::integer AS "toolCalls",
        count(*) FILTER(WHERE context='historical')::integer AS "historicalRecords",
        count(*) FILTER(WHERE context IN ('unknown-time','unknown-enrollment'))::integer AS "unknownRecords"
        FROM archive_event_origins WHERE employee_id=$1 AND source_date=$2`, [employeeId, date])).rows[0];
      const undated = Number((await client.query(`SELECT count(*) FROM archive_event_origins WHERE employee_id=$1 AND source_date IS NULL`, [employeeId])).rows[0].count);
      // Each event's latest exact carrier is chosen, including restored primary
      // copies. Original origin coordinates/ownership stay frozen in analysis input.
      const snapshots = (await client.query(`SELECT DISTINCT s.id,s.hash FROM archive_event_origins o
        CROSS JOIN LATERAL (SELECT ss.id,ss.hash FROM snapshot_events se JOIN snapshots ss ON ss.id=se.snapshot_id
          WHERE se.event_id=o.event_id ORDER BY ss.committed_at DESC,ss.id DESC LIMIT 1) s
        WHERE o.employee_id=$1 AND o.source_date=$2 AND o.context='after-enrollment' ORDER BY s.id LIMIT 101`, [employeeId, date])).rows;
      const overflow = events.length > 10000 || snapshots.length > 100;
      const messages = ['只总结本来源日期的已确认活动；背景引用不计当天工作。', '按日设备覆盖、未解析原件与遗漏活动尚未证实；零已确认记录不代表无活动。',
        '文件、原生 token 和活动区间等待完整统计接口；未知不等于零。'];
      if (undated) messages.push(`${undated} 条来源日期未知，不能任意归入本日。`);
      if (overflow) messages.push('本日输入超出 10000 事件 / 100 主原件处理边界；保留统计，未完整生成主题。');
      const runs: AnalysisRun[] = []; const inputs: NonNullable<DailyReport['coverage']>['inputs'] = [];
      const available = await analysis.availability();
      if (!available.ready) messages.push(available.reason);
      for (const snapshot of overflow ? [] : snapshots) {
        try {
          const run = await analysis.request(snapshot.id, null, { trigger: 'scheduled' }) as AnalysisRun;
          runs.push(run); inputs.push({ snapshotId: snapshot.id, hash: snapshot.hash, analysisId: run.id, state: run.state });
          if (run.state === 'failed') messages.push(`分析 ${run.id} 失败；本日材料尚不足以形成完整主题。`);
        } catch (error) {
          const message = error instanceof HttpError ? error.message : '分析暂时不可用；原件仍保留';
          messages.push(message); inputs.push({ snapshotId: snapshot.id, hash: snapshot.hash, analysisId: null, state: 'unavailable' });
        }
      }
      const ids = new Set<string>(events.slice(0, 10000).map(row => row.event_id));
      const waiting = runs.some(run => ['queued', 'running'].includes(run.state));
      const incomplete = overflow || inputs.some(input => ['failed', 'unavailable'].includes(input.state));
      const items = dailyItems(runs.filter(run => run.state === 'succeeded'), employeeId, date, ids);
      const state: DailyReport['state'] = waiting ? 'waiting-analysis' : incomplete ? (items.length ? 'partial' : 'unavailable')
        : events.length && !items.length ? 'partial' : 'ready';
      if (events.length && !items.length && !waiting) messages.push('没有可用于本日目标、行动、结果或阻塞的分析引用；不能推断这些事项为零。');
      for (const run of runs) {
        const coverage = run.input.coverage;
        if (coverage.unrecognizedLines || coverage.partialLine || coverage.captureGaps.length || coverage.excludedMaterials)
          messages.push(`原件 ${run.snapshotId}：${coverage.unrecognizedLines} 行未解析，${coverage.partialLine ? '有未闭合末行' : '末行闭合'}，${coverage.excludedMaterials} 项关联材料未分析，${coverage.captureGaps.length} 项采集缺口。未分析不表示无活动。`);
      }
      const originalEventHash = digest(JSON.stringify([...ids]));
      const payload: DailyReport = { employeeId, employee: employee.name, date, timeZone: 'Asia/Shanghai', revision: 0, version: null,
        state, createdAt: null, items, nextOffset: null,
        statistics: { ...counts, files: null, tokens: null, activityIntervals: null, humanWorkHours: null, definition },
        coverage: { messages: [...new Set(messages)], inputs, originalEventIdsSample: [...ids].slice(0, 20), originalEventCount: events.length,
          originalEventHash, eligibleInputsComplete: !incomplete && !waiting,
          dailyDeviceCoverage: 'unknown', fixture: runs.some(run => run.result?.fixture || run.config.mode === 'fixture') } };
      // Bound public metadata separately from paged conclusions; retain exact
      // event input identity as a digest instead of a response containing 10000 IDs.
      const version = digest(JSON.stringify({ payload, originalEventHash, runs: runs.map(run => ({ id: run.id, config: run.config, input: run.input })) }));
      const latest = (await client.query(`SELECT revision,version FROM daily_report_revisions WHERE employee_id=$1 AND date=$2 ORDER BY revision DESC LIMIT 1`, [employeeId, date])).rows[0];
      if (latest?.version !== version) await client.query(`INSERT INTO daily_report_revisions(id,employee_id,date,revision,version,payload)
        VALUES($1,$2,$3,$4,$5,$6)`, [randomUUID(), employeeId, date, (latest?.revision ?? 0) + 1, version, payload]);
      await client.query('UPDATE daily_report_periods SET last_checked_at=now() WHERE employee_id=$1 AND date=$2', [employeeId, date]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async function tick(now = new Date()) {
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
    const periods = (await db.query(`SELECT p.employee_id,p.date FROM daily_report_periods p
      LEFT JOIN LATERAL (SELECT payload,created_at FROM daily_report_revisions r WHERE r.employee_id=p.employee_id AND r.date=p.date ORDER BY revision DESC LIMIT 1) r ON true
      WHERE r.payload IS NULL OR r.payload->>'state' IN ('waiting-analysis','queued','unavailable')
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
  return { read, request, list, tick, employees };
}
export type ReportService = ReturnType<typeof reportService>;
