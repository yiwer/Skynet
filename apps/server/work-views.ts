import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { digest, type Database } from './database.js';
import { HttpError } from './identities.js';
import type { ReportService } from './reports.js';
import { beijingDate, type DailyReport } from '../../packages/contracts/reports.js';
import { addDays, dailyPath, dueWeek, weekDate, workViewQuery, type WorkView, type WorkViewSelection, type WorkViewItem } from '../../packages/contracts/work-views.js';
import { qualificationDaySql } from './qualification.js';
import {displayProjectSql} from './reports.js';

export async function migrateWorkViews(db: Database) {
  const client = await db.connect();
  try { await client.query(`BEGIN; SELECT pg_advisory_xact_lock(7402131);
    CREATE TABLE IF NOT EXISTS work_view_periods(id text PRIMARY KEY,selection jsonb NOT NULL,generation integer NOT NULL DEFAULT 0,
      refresh_pending boolean NOT NULL DEFAULT true,requested_at timestamptz NOT NULL DEFAULT now(),last_checked_at timestamptz);
    ALTER TABLE work_view_periods ADD COLUMN IF NOT EXISTS refresh_daily boolean NOT NULL DEFAULT true;
    ALTER TABLE work_view_periods ADD COLUMN IF NOT EXISTS qualification_revision bigint NOT NULL DEFAULT 0;
    ALTER TABLE work_view_periods ADD COLUMN IF NOT EXISTS candidate_revision text NOT NULL DEFAULT '';
    ALTER TABLE work_view_periods ADD COLUMN IF NOT EXISTS last_inspected_at timestamptz;
    CREATE INDEX IF NOT EXISTS work_view_inspection ON work_view_periods(last_inspected_at,requested_at);
    CREATE INDEX IF NOT EXISTS report_origin_source_day ON archive_event_origins(source_date,employee_id,event_id);
    CREATE INDEX IF NOT EXISTS report_origin_project_day ON archive_event_origins(project,source_date,event_id);
    CREATE TABLE IF NOT EXISTS work_view_revisions(id uuid PRIMARY KEY,period_id text NOT NULL REFERENCES work_view_periods(id),
      revision integer NOT NULL,version text NOT NULL,payload jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(period_id,revision));
    CREATE TABLE IF NOT EXISTS work_view_schedule(id integer PRIMARY KEY CHECK(id=1),last_week text NOT NULL);
    COMMIT;`); } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}
const identity = (selection: WorkViewSelection) => digest(JSON.stringify([selection.kind, selection.subject, selection.from, selection.to]));
const qualificationForView = `((SELECT COALESCE(MAX(c.revision),0) FROM archive_event_origins qo JOIN event_qualifications c ON c.event_id=qo.event_id
  WHERE qo.source_date BETWEEN p.selection->>'from' AND p.selection->>'to' AND CASE WHEN p.selection->>'kind'='weekly'
    THEN qo.employee_id::text=p.selection->>'subject' ELSE ${displayProjectSql('qo')}=p.selection->>'subject' END)+(SELECT COALESCE(MAX(i.revision),0) FROM archive_event_origins qo JOIN event_integrity i ON i.event_id=qo.event_id AND i.version='original-utf8-1'
  WHERE qo.source_date BETWEEN p.selection->>'from' AND p.selection->>'to' AND CASE WHEN p.selection->>'kind'='weekly'
    THEN qo.employee_id::text=p.selection->>'subject' ELSE ${displayProjectSql('qo')}=p.selection->>'subject' END))`;
const candidateRevisionSql=`(SELECT concat(count(*),'/',count(DISTINCT(o.employee_id,o.source_date))) FROM effective_event_origins o
  WHERE o.context='after-enrollment' AND o.source_date BETWEEN p.selection->>'from' AND p.selection->>'to' AND CASE WHEN p.selection->>'kind'='weekly'
    THEN o.employee_id::text=p.selection->>'subject' ELSE ${displayProjectSql('o')}=p.selection->>'subject' END)`;
const changedDays = `EXISTS(SELECT 1 FROM jsonb_array_elements(r.payload->'coverage'->'days') day JOIN daily_report_revisions newer
  ON newer.employee_id=(day->>'employeeId')::uuid AND newer.date=day->>'date' AND newer.revision>(day->>'revision')::integer)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(r.payload->'coverage'->'days') day JOIN daily_report_periods pending
    ON pending.employee_id=(day->>'employeeId')::uuid AND pending.date=day->>'date' WHERE pending.refresh_pending)`;
const definition = '已确认记录、用户轮次和工具调用按原员工、来源日期及不可变 eventId 统计。周报引用固定日报版本；项目计数按该日报版本的显示归类唯一分配原事件，人工项目归类另保留来源项目和审计记录。同一原件行涉及多项目时，项目用户轮次可能重叠，不能相加当员工总轮次。主题文字相同只表示推断关联。未归类项目保留。文件、原生 token、活动区间、人工工时未知；无已确认记录不证明无工作。';

export function workItems(days: DailyReport[], project?: string): WorkViewItem[] {
  return days.flatMap(day => day.items.filter(item => project === undefined || item.project === project).map(item => ({ ...item,
    employeeId: day.employeeId, employee: day.employee, sourceDate: day.date, dailyRevision: day.revision, dailyVersion: day.version!,
    dailyPath: dailyPath(day.employeeId, day.date, day.revision), continuation: item.themeAssociation === 'unassigned' ? 'unassigned' as const : 'inferred-theme-match' as const,
  }))).sort((a, b) => a.project.localeCompare(b.project) || a.theme.localeCompare(b.theme) || a.sourceDate.localeCompare(b.sourceDate)
    || a.employeeId.localeCompare(b.employeeId) || a.category.localeCompare(b.category));
}
export function workViewService(db: Database, daily: ReportService, clock: () => Date = () => new Date()) {
  async function validate(input: WorkViewSelection, reader: Pick<Database, 'query'> = db) {
    const parsed = workViewQuery.parse(input); const { kind, subject, from, to } = parsed;
    if (to < from || to > addDays(from, 30)) throw new HttpError(422, '工作视图日期区间须为 1–31 个自然日');
    let label = subject || '未归类项目';
    if (kind === 'weekly') {
      weekDate.parse(from);
      if (to !== addDays(from, 6)) throw new HttpError(422, '周报必须覆盖周一至周日');
      z.uuid().parse(subject);
      const employee = (await reader.query('SELECT name FROM employees WHERE id=$1', [subject])).rows[0];
      if (!employee) throw new HttpError(404, '员工不存在'); label = employee.name;
    }
    return { selection: { kind, subject, from, to }, label };
  }
  async function readAt(reader: Pick<Database, 'query'>, input: WorkViewSelection, offset = 0, revision?: number): Promise<WorkView> {
    const { selection, label } = await validate(input, reader); const id = identity(selection);
    const row = (await reader.query(`SELECT r.*,(p.refresh_pending OR p.candidate_revision<>${candidateRevisionSql} OR p.qualification_revision<${qualificationForView} OR ${changedDays}) AS refresh_pending FROM work_view_revisions r JOIN work_view_periods p ON p.id=r.period_id
      WHERE r.period_id=$1 AND ($2::integer IS NULL OR r.revision=$2) ORDER BY r.revision DESC LIMIT 1`, [id, revision ?? null])).rows[0];
    if (!row) {
      if (revision !== undefined) throw new HttpError(404, '工作视图版本不存在');
      const queued = !!(await reader.query('SELECT 1 FROM work_view_periods WHERE id=$1', [id])).rowCount;
      return { ...selection, subjectLabel: label, timeZone: 'Asia/Shanghai', revision: 0, version: null, createdAt: null,
        state: queued ? 'queued' : 'not-scheduled', refreshPending: queued, items: [], nextOffset: null, participants: [], statistics: null, coverage: null };
    }
    const view = row.payload as WorkView; const page: WorkViewItem[] = []; let bytes = Buffer.byteLength(JSON.stringify({ ...view, items: [] })) + 1024;
    if (bytes > 56 * 1024) throw new HttpError(413, '该视图来源元数据超过公开响应边界；请缩短日期区间，原日报版本仍可单独读取');
    for (const item of view.items.slice(offset, offset + 20)) {
      const size = Buffer.byteLength(JSON.stringify(item)); if (page.length && bytes + size > 80 * 1024) break; page.push(item); bytes += size;
    }
    return { ...view, revision: row.revision, version: row.version, createdAt: row.created_at.toISOString(), items: page,
      nextOffset: offset + page.length < view.items.length ? offset + page.length : null, refreshPending: revision === undefined ? row.refresh_pending : false };
  }
  const read = (input: WorkViewSelection, offset = 0, revision?: number) => readAt(db, input, offset, revision);
  async function request(input: WorkViewSelection) {
    const { selection } = await validate(input);
    if (selection.from > beijingDate(clock())) throw new HttpError(422, '尚未到来的区间不能生成工作视图');
    await db.query(`INSERT INTO work_view_periods(id,selection) VALUES($1,$2) ON CONFLICT(id)
      DO UPDATE SET generation=work_view_periods.generation+1,refresh_pending=true,refresh_daily=true`, [identity(selection), selection]);
    await refresh(selection); return read(selection);
  }
  async function refresh(selection: WorkViewSelection) {
    const client = await db.connect(); const id = identity(selection); let locked = false;
    try {
      locked = (await client.query('SELECT pg_try_advisory_lock(7402131) AS locked')).rows[0].locked;
      if (!locked) return;
      const period = (await client.query('SELECT generation,refresh_daily FROM work_view_periods WHERE id=$1', [id])).rows[0];
      const generation = period?.generation;
      // Discover bounded employee/day inputs. Context-only materials never create participants.
      const loadPairs = async () => selection.kind === 'weekly' ? (await client.query(`SELECT e.id AS employee_id,e.name,to_char(day,'YYYY-MM-DD') AS date,
        ${qualificationDaySql('e.id', "to_char(day,'YYYY-MM-DD')")} AS qualification_revision,
        EXISTS(SELECT 1 FROM devices d WHERE d.employee_id=e.id AND d.enrolled_at < (day::date+interval '1 day') AT TIME ZONE 'Asia/Shanghai') AS managed
        FROM employees e CROSS JOIN generate_series($2::date,$3::date,interval '1 day') day WHERE e.id=$1 ORDER BY day`, [selection.subject, selection.from, selection.to])).rows
        : (await client.query(`SELECT DISTINCT o.employee_id,e.name,o.source_date AS date,true AS managed,
          ${qualificationDaySql('o.employee_id', 'o.source_date')} AS qualification_revision FROM effective_event_origins o
          JOIN employees e ON e.id=o.employee_id WHERE ${displayProjectSql('o')}=$1 AND o.source_date BETWEEN $2 AND $3 AND o.context='after-enrollment'
          ORDER BY date,o.employee_id LIMIT 51`, [selection.subject, selection.from, selection.to])).rows;
      let pairs = await loadPairs(); const days: DailyReport[] = []; const refs: NonNullable<WorkView['coverage']>['days'] = [];
      let omittedItems = 0; let inputBytes = 0;
      for (const pair of pairs.slice(0, 50)) {
        if (!pair.managed || pair.date > beijingDate(clock())) continue;
        const day = await daily.read(pair.employee_id, pair.date);
        if (period?.refresh_daily || !day.version || day.refreshPending || ['queued', 'waiting-analysis', 'unavailable'].includes(day.state)) await daily.request(pair.employee_id, pair.date);
      }
      // Preparation above may enqueue work. Select all immutable daily revisions
      // from one database snapshot afterwards, never combine independently polled pages.
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      if ((await client.query('SELECT generation FROM work_view_periods WHERE id=$1', [id])).rows[0]?.generation !== generation) { await client.query('ROLLBACK'); return; }
      const qualificationRevision = (await client.query(`SELECT ${qualificationForView} AS revision FROM work_view_periods p WHERE id=$1`, [id])).rows[0].revision as string;
      const candidateRevision=(await client.query(`SELECT ${candidateRevisionSql} AS revision FROM work_view_periods p WHERE id=$1`,[id])).rows[0].revision as string;
      pairs = await loadPairs(); const boundedInputs = pairs.length <= 50;
      for (const pair of pairs.slice(0, 50)) {
        const arrived = pair.date <= beijingDate(clock());
        if (!pair.managed || !arrived) {
          refs.push({ employeeId: pair.employee_id, employee: pair.name, date: pair.date, state: arrived ? 'not-managed' : 'not-arrived',
            revision: 0, version: null, dailyPath: dailyPath(pair.employee_id, pair.date, 0), originalEventHash: null, originalEventCount: null, qualificationRevision: null, expectedQualificationRevision: pair.qualification_revision, eligibleInputsComplete: false }); continue;
        }
        // The shared service creates targets with actorKind=system even if no manager
        // has ever manually requested per-session analysis. It owns parser/config/budget guards.
        const row = (await client.query(`SELECT revision,version,payload FROM daily_report_revisions WHERE employee_id=$1 AND date=$2 ORDER BY revision DESC LIMIT 1`, [pair.employee_id, pair.date])).rows[0];
        if (!row) { refs.push({ employeeId: pair.employee_id, employee: pair.name, date: pair.date, state: 'queued', revision: 0, version: null,
          dailyPath: dailyPath(pair.employee_id, pair.date, 0), originalEventHash: null, originalEventCount: null, qualificationRevision: null, expectedQualificationRevision: pair.qualification_revision, eligibleInputsComplete: false }); continue; }
        const day = { ...row.payload, revision: row.revision, version: row.version } as DailyReport;
        const items: DailyReport['items'] = [];
        for (const item of day.items) {
          const size = Buffer.byteLength(JSON.stringify(item));
          if (items.length >= 500 || inputBytes + size > 2 * 1024 * 1024) { omittedItems += day.items.length - items.length; break; }
          items.push(item); inputBytes += size;
        }
        days.push({ ...day, items });
        const staleQualification = BigInt(day.coverage?.qualificationRevision ?? '0') < BigInt(pair.qualification_revision);
        const staleInput=!!day.coverage?.sourceRevision&&day.coverage.sourceRevision!==await daily.inputRevision(client,day.employeeId,day.date);
        refs.push({ employeeId: day.employeeId, employee: day.employee, date: day.date, state: staleQualification ? 'stale-qualification' : staleInput?'stale-input':day.state, revision: day.revision, version: day.version,
          dailyPath: dailyPath(day.employeeId, day.date, day.revision), originalEventHash: day.coverage?.originalEventHash ?? null,
          originalEventCount: day.coverage?.originalEventCount ?? null, qualificationRevision: day.coverage?.qualificationRevision ?? null,
          expectedQualificationRevision: pair.qualification_revision, eligibleInputsComplete: !staleQualification && !staleInput && !!day.coverage?.eligibleInputsComplete,
          ...(selection.kind==='weekly'&&day.coverage?.workStatistics?{workStatistics:day.coverage.workStatistics,
            statistics:{files:day.statistics?.files??null,tokens:day.statistics?.tokens?(({definition:_definition,usageRecords:_records,unknownRecords:_unknown,...tokens})=>tokens)(day.statistics.tokens):null,
              activityIntervalCount:day.statistics?.activityIntervals?.length??null,sourceInputsComplete:day.statistics?.sourceInputsComplete??false}}:{}) });
      }
      // Counts use only these frozen daily payloads, never the latest live ledger.
      const statisticsKnown = days.length > 0 && days.every(day => selection.kind === 'weekly' ? !!day.statistics : !!day.coverage?.projectStatisticsComplete);
      const count = (key: 'records' | 'userTurns' | 'toolCalls') => statisticsKnown ? days.reduce((sum, day) => sum + (selection.kind === 'weekly'
        ? day.statistics![key] : day.coverage!.projectStatistics!.find(row => row.project === selection.subject)?.[key] ?? 0), 0) : null;
      const totalItems = workItems(days, selection.kind === 'project' ? selection.subject : undefined);
      const items = totalItems.slice(0, 500); omittedItems += Math.max(0, totalItems.length - items.length);
      const waiting = refs.some(ref => ['queued', 'waiting-analysis', 'stale-qualification','stale-input'].includes(ref.state));
      const complete = boundedInputs && statisticsKnown && !omittedItems && refs.length > 0 && refs.every(ref => ref.state === 'ready' && ref.eligibleInputsComplete);
      const state: WorkView['state'] = waiting ? 'waiting-analysis' : complete ? 'ready' : 'partial';
      const participatingDays = days.filter(day => ((selection.kind === 'weekly' ? day.statistics?.records
        : day.coverage?.projectStatistics?.find(row => row.project === selection.subject)?.records) ?? 0) > 0);
      const participants = [...new Set(participatingDays.map(day => day.employeeId))].map(employeeId => ({ employeeId,
        employee: participatingDays.find(day => day.employeeId === employeeId)!.employee,
        dates: [...new Set(participatingDays.filter(day => day.employeeId === employeeId).map(day => day.date))] }));
      const payload: WorkView = { ...selection, subjectLabel: (await validate(selection)).label, timeZone: 'Asia/Shanghai', revision: 0, version: null, createdAt: null,
        state, refreshPending: false, items, nextOffset: null, participants,
        corrections:days.flatMap(day=>(day.corrections??[]).map(value=>({...value,employeeId:day.employeeId,sourceDate:day.date,dailyPath:dailyPath(day.employeeId,day.date,day.revision)}))).slice(0,32),
        statistics: { records: count('records'), userTurns: count('userTurns'), toolCalls: count('toolCalls'), complete: complete && statisticsKnown,
          files: null, tokens: null, activityIntervals: null, humanWorkHours: null, definition },
        coverage: { days: refs, complete, boundedInputs, omittedItems, fixture: days.some(day => day.coverage?.fixture), messages: [
          '周一北京时间 09:00 将前一周周一至周日入队；入队不保证分析完成。按来源日期连接固定日报版本。',
          '跨日同主题仅为文字关联推断，未任意把未关联事项合并；会话内成果保留声称、推断或记录已观察分类。',
          '参与者与统计来自原始归属；保存的历史或关联上下文不是当前员工工作。没有已确认活动不证明无工作。',
          '输入处理完整仅指这些已选日报的已知输入；按日设备覆盖和未到达活动仍未知，不表示全部工作已捕获。',
          ...(!complete ? ['部分日报、设备覆盖、材料或未解析范围尚未知；查看各日报版本中的具体范围。'] : []),
          ...(!boundedInputs ? ['超过 50 员工/日输入边界；未完整组织全部主题。'] : []),
          ...(omittedItems ? ['主题或分页超出 500 项 / 2MiB 处理边界；可继续核查对应固定日报版本。'] : []),
        ] } };
      const version = digest(JSON.stringify(payload));
      const latest = (await client.query('SELECT revision,version FROM work_view_revisions WHERE period_id=$1 ORDER BY revision DESC LIMIT 1', [id])).rows[0];
      if (latest?.version !== version) await client.query('INSERT INTO work_view_revisions(id,period_id,revision,version,payload) VALUES($1,$2,$3,$4,$5)',
        [randomUUID(), id, (latest?.revision ?? 0) + 1, version, payload]);
      await client.query(`UPDATE work_view_periods SET last_checked_at=now(),qualification_revision=$3,candidate_revision=$4,refresh_pending=CASE WHEN generation=$2 THEN false ELSE refresh_pending END,
        refresh_daily=CASE WHEN generation=$2 THEN false ELSE refresh_daily END WHERE id=$1`, [id, generation, qualificationRevision,candidateRevision]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); if ((error as { code?: string }).code === '40001') return; throw error; }
    finally { try { if (locked) await client.query('SELECT pg_advisory_unlock(7402131)'); } finally { client.release(); } }
  }
  async function tick(now = clock()) {
    const due = dueWeek(now); const client = await db.connect();
    try {
      await client.query('BEGIN; SELECT pg_advisory_xact_lock(7402132)');
      const previous = (await client.query('SELECT last_week FROM work_view_schedule WHERE id=1')).rows[0];
      const start = previous ? addDays(previous.last_week, 7) : due;
      const end = [due, addDays(start, 21)].sort()[0]!; // four weeks of bounded catch-up per tick.
      if (start <= end) {
        const employees = (await client.query(`SELECT DISTINCT employee_id FROM devices WHERE enrolled_at < ($1::date+interval '7 days') AT TIME ZONE 'Asia/Shanghai'`, [end])).rows;
        for (let from = start; from <= end; from = addDays(from, 7)) for (const employee of employees) {
          const selection: WorkViewSelection = { kind: 'weekly', subject: employee.employee_id, from, to: addDays(from, 6) };
          await client.query('INSERT INTO work_view_periods(id,selection) VALUES($1,$2) ON CONFLICT DO NOTHING', [identity(selection), selection]);
        }
        await client.query('INSERT INTO work_view_schedule(id,last_week) VALUES(1,$1) ON CONFLICT(id) DO UPDATE SET last_week=EXCLUDED.last_week', [end]);
      }
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    const inspected=(await db.query(`SELECT p.id,p.candidate_revision,${candidateRevisionSql} AS current_revision FROM work_view_periods p
      ORDER BY p.last_inspected_at NULLS FIRST,p.requested_at LIMIT 20`)).rows;
    for(const period of inspected)await db.query('UPDATE work_view_periods SET last_inspected_at=now(),refresh_pending=refresh_pending OR candidate_revision<>$2 WHERE id=$1',[period.id,period.current_revision]);
    const periods = (await db.query(`SELECT p.selection FROM work_view_periods p LEFT JOIN LATERAL
      (SELECT payload FROM work_view_revisions WHERE period_id=p.id ORDER BY revision DESC LIMIT 1) r ON true
      WHERE p.refresh_pending OR p.qualification_revision<${qualificationForView} OR ${changedDays} OR r.payload IS NULL OR r.payload->>'state' IN ('waiting-analysis','queued','unavailable')
        OR EXISTS(SELECT 1 FROM jsonb_array_elements(r.payload->'coverage'->'days') day WHERE day->>'state' IN ('queued','waiting-analysis','unavailable','not-arrived','stale-qualification','stale-input'))
      ORDER BY p.last_checked_at NULLS FIRST,p.requested_at LIMIT 2`)).rows;
    for (const period of periods) await refresh(period.selection);
  }
  async function projects(offset = 0) {
    const rows = (await db.query(`SELECT manifest->>'project' AS project FROM snapshots UNION SELECT payload->'input'->>'project' AS project FROM report_corrections
      WHERE payload->'input'->>'kind'='project' ORDER BY project LIMIT 101 OFFSET $1`, [offset])).rows;
    const projects: { project: string; label: string }[] = []; let bytes = 0;
    for (const row of rows.slice(0, 100)) { const value = { project: row.project as string, label: (row.project || '未归类项目') as string };
      const size = Buffer.byteLength(JSON.stringify(value)); if (projects.length && bytes + size > 48 * 1024) break; projects.push(value); bytes += size; }
    return { projects, nextOffset: rows.length > projects.length ? offset + projects.length : null };
  }
  async function list(offset = 0) {
    const rows = (await db.query(`SELECT p.selection,coalesce(r.revision,0) AS revision,r.version,coalesce(r.payload->>'state','queued') AS state
      FROM work_view_periods p LEFT JOIN LATERAL (SELECT revision,version,payload FROM work_view_revisions WHERE period_id=p.id ORDER BY revision DESC LIMIT 1) r ON true
      ORDER BY p.selection->>'from' DESC,p.id LIMIT 51 OFFSET $1`, [offset])).rows;
    const views = []; let bytes = 0;
    for (const row of rows.slice(0, 50)) { const size = Buffer.byteLength(JSON.stringify(row)); if (views.length && bytes + size > 48 * 1024) break; views.push(row); bytes += size; }
    return { views, nextOffset: rows.length > views.length ? offset + views.length : null, timeZone: 'Asia/Shanghai' };
  }
  return { read, readAt, request, tick, projects, list };
}
export type WorkViewService = ReturnType<typeof workViewService>;
