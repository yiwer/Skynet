import { digest, type Database } from './database.js';
import { HttpError } from './identities.js';
import { consistentReportingInputs } from './reporting-frontier.js';
import type { assessmentService } from './assessment.js';
import type { usageOutputService } from './usage-output.js';
import type { sessionEfficiencyService } from './session-efficiency.js';
import type { activityService } from './activity.js';
import type { ReportService } from './reports.js';
import type { workViewService } from './work-views.js';
import type {profileCoachingService} from './profile-coaching.js';
import { dailyPath, monday, addDays } from '../../packages/contracts/work-views.js';
import { beijingDate, type DailyItem } from '../../packages/contracts/reports.js';
import { profileQuery, profileSections, type CapabilityProfile, type CapabilityProfilePage } from '../../packages/contracts/capability-profile.js';

export async function migrateCapabilityProfiles(db: Database) {
  await db.query(`CREATE TABLE IF NOT EXISTS capability_profiles(version text PRIMARY KEY,employee_id uuid NOT NULL REFERENCES employees(id),payload jsonb NOT NULL);
    CREATE INDEX IF NOT EXISTS capability_profile_assessment ON capability_profiles(employee_id,(payload->'assessment'->>'version'))`);
}
export function capabilityProfileService(db: Database, assessments: ReturnType<typeof assessmentService>, usage: ReturnType<typeof usageOutputService>,
  efficiency: ReturnType<typeof sessionEfficiencyService>, activity: ReturnType<typeof activityService>,
  reports: ReportService, workViews: ReturnType<typeof workViewService>, coaching:ReturnType<typeof profileCoachingService>, clock: () => Date = () => new Date()) {
  async function workContent(employeeId: string, from: string | null, to: string, activeDates: string[]): Promise<CapabilityProfile['work']> {
    const scheduled = (await db.query('SELECT date FROM daily_report_periods WHERE employee_id=$1 AND date BETWEEN $2 AND $3 ORDER BY date', [employeeId, from ?? to, to])).rows;
    const dates = [...new Set([...activeDates, ...scheduled.map(row => row.date as string)])].sort().reverse();
    if (dates.length > 3660) throw new HttpError(413, '画像工作日期超过范围上限');
    const result: CapabilityProfile['work'] = { reports: [], items: [] }, findings = new Map<string, CapabilityProfile['work']['items'][number]>();
    const append = (item: DailyItem, date: string, reportId: string) => {
      const id = digest(JSON.stringify([date, item]));
      let finding = findings.get(id);
      if (!finding) { finding = { id, date, item, reportIds: [] }; findings.set(id, finding); result.items.push(finding); }
      if (!finding.reportIds.includes(reportId)) finding.reportIds.push(reportId);
      if (findings.size > 10000) throw new HttpError(413, '画像工作条目超过范围上限');
    };
    for (const date of dates) {
      let page = await reports.read(employeeId, date);
      const id = 'daily/' + date + '/' + page.revision;
      result.reports.push({ id, kind: 'daily', from: date, to: date, version: page.version, revision: page.revision, state: page.state, refreshPending: page.refreshPending, path: dailyPath(employeeId, date, page.revision) });
      for (;;) {
        for (const item of page.items) append(item, date, id);
        if (page.nextOffset === null) break;
        page = await reports.read(employeeId, date, page.nextOffset, page.revision);
      }
    }
    for (const start of [...new Set(dates.map(monday))]) {
      const selection = { kind: 'weekly' as const, subject: employeeId, from: start, to: addDays(start, 6) };
      let page = await workViews.read(selection);
      const id = 'weekly/' + start + '/' + page.revision;
      result.reports.push({ id, kind: 'weekly', from: start, to: selection.to, version: page.version, revision: page.revision, state: page.state, refreshPending: page.refreshPending,
        path: '#work?' + new URLSearchParams({ ...selection, ...(page.revision ? { revision: String(page.revision) } : {}) }) });
      for (;;) {
        for (const { employeeId: owner, employee: _name, sourceDate, dailyRevision: _revision, dailyVersion: _version, dailyPath: _path, continuation: _continuation, ...item } of page.items)
          if (owner === employeeId && sourceDate >= (from ?? to) && sourceDate <= to) append(item, sourceDate, id);
        if (page.nextOffset === null) break;
        page = await workViews.read(selection, page.nextOffset, page.revision);
      }
    }
    return result;
  }
  async function header(employeeId: string): Promise<CapabilityProfile['header']> {
    const rows = (await db.query(`SELECT d.id,d.name,d.active,d.enrolled_at,max(s.committed_at) AS synced_at
      FROM devices d LEFT JOIN snapshots s ON s.device_id=d.id WHERE d.employee_id=$1
      GROUP BY d.id ORDER BY d.name,d.id LIMIT 2001`, [employeeId])).rows;
    if (rows.length > 2000) throw new HttpError(413, '员工设备数量超过单次读取上限');
    const devices = rows.map(row => ({ id: row.id as string, name: row.name as string, active: row.active as boolean,
      enrolledAt: row.enrolled_at?.toISOString() ?? null, lastSyncedAt: row.synced_at?.toISOString() ?? null }));
    return { deviceCount: devices.length, devices, enrolledAt: !devices.length || devices.some(device => !device.enrolledAt) ? null : devices.map(device => device.enrolledAt!).sort()[0]!,
      lastSyncedAt: devices.flatMap(device => device.lastSyncedAt ? [device.lastSyncedAt] : []).sort().at(-1) ?? null };
  }
  async function load(employeeId: string, input: unknown = {}, full = false): Promise<CapabilityProfile> {
    const q = profileQuery.parse(input);
    if (q.version) {
      if (full) throw new HttpError(400, '固定画像不能重算');
      const row = (await db.query('SELECT payload FROM capability_profiles WHERE version=$1 AND employee_id=$2', [q.version, employeeId])).rows[0];
      if (!row) throw new HttpError(404, '画像版本不存在');
      const result = row.payload as CapabilityProfile;
      if (q.period && q.period !== result.assessment.selection?.period || q.preset && q.preset !== result.assessment.preset) throw new HttpError(409, '画像版本与周期或方案不一致');
      if (q.assessmentVersion && q.assessmentVersion !== result.assessment.version) throw new HttpError(409, '画像与评估版本不一致');
      return result;
    }
    if (full && (q.assessmentVersion || q.offset || q.section)) throw new HttpError(400, '画像重算不能指定固定来源或分页');
    const requested = q.assessmentVersion ? await assessments.export(employeeId, { version: q.assessmentVersion, ...(q.period ? { period: q.period } : {}), ...(q.preset ? { preset: q.preset } : {}) }) : null;
    if (requested) {
      const stored = (await db.query("SELECT payload FROM capability_profiles WHERE employee_id=$1 AND payload->'assessment'->>'version'=$2 ORDER BY payload->>'generatedAt' DESC,version LIMIT 1", [employeeId, requested.version])).rows[0];
      if (stored) return stored.payload;
    }
    const scope = { period: q.period ?? requested?.selection?.period ?? 'since-enrollment' as const, preset: q.preset ?? requested?.preset ?? '默认' as const };
    const content = await consistentReportingInputs(db, clock, async () => {
      const head = full ? await assessments.recompute(employeeId, scope) : null;
      const assessment = await assessments.export(employeeId, { ...scope, ...(head ? { version: head.version } : {}) });
      if (requested && assessment.version !== requested.version) throw new HttpError(409, '此历史评估尚无完整画像；仍可读取固定评估');
      const report = await usage.export({ period: scope.period, version: assessment.inputs.usageVersion });
      const mine = report.employees.find(person => person.employeeId === employeeId);
      const { employeeId: _id, employee: _name, daily, agents, activeDates, ...totals } = mine ?? {
        employeeId, employee: assessment.employee, daily: [], agents: [], activeDates: [], sessions: 0, userTurns: 0, toolCalls: 0,
        inputTokens: 0, outputTokens: 0, knownInputTokens: 0, knownOutputTokens: 0, unknownTokenSessions: 0, unknownInputSessions: 0, unknownOutputSessions: 0,
        outputs: Object.fromEntries(['verified','claimed','codeChanges','tests','commits'].map(kind => [kind, { value: 0, known: 0, unknownSessions: 0, added: 0, removed: 0, passed: 0, failed: 0 }])) as CapabilityProfile['kpis']['outputs'] };
      const efficiencyReport = await efficiency.export({ period: scope.period, employeeId });
      if (efficiencyReport.metricVersion !== assessment.inputs.metricsVersion) throw new HttpError(409, '画像指标正在更新，请重新读取');
      const sessions = efficiencyReport.sessions.map(({ sessionId, snapshotId, source, sourceSessionId, projects, dates, tokens, knownTokens, userTurns, toolCalls, verified, codeChanges, efficiency, rework, taskType, webPath, timing }) =>
        ({ sessionId, snapshotId, source, sourceSessionId, projects, dates, tokens, knownTokens, userTurns, toolCalls, verified, codeChanges, efficiency, rework, taskType, webPath, waitFraction: timing?.waitFraction ?? null }));
      const taskCounts = new Map<CapabilityProfile['taskDistribution'][number]['taskType'], number>();
      for (const session of sessions) taskCounts.set(session.taskType, (taskCounts.get(session.taskType) ?? 0) + 1);
      const receiptDates = (await db.query(`SELECT r.receipt->>'firstDisconnectedAt' AS disconnected,r.receipt->>'acknowledgedAt' AS acknowledged
        FROM delivery_receipts r JOIN devices d ON d.id=r.device_id WHERE d.employee_id=$1`, [employeeId])).rows
        .flatMap(row => [row.disconnected, row.acknowledged].filter(Boolean).map(time => beijingDate(new Date(time))))
        .filter(date => date >= report.scope.from && date <= report.scope.to);
      const recentActivity: CapabilityProfile['recentActivity'] = { events: [], references: [], hasEarlier: false }, dates = [...new Set([...activeDates, ...receiptDates])].sort().reverse(), seenActivity = new Set<string>();
      for (const [index, date] of dates.entries()) {
        const page = await activity.export({ date, employeeId });
        recentActivity.references.push({ date, version: page.version, path: '#activity?' + new URLSearchParams({ date, employeeId, version: page.version }) });
        const events = [...page.events].filter(event => !seenActivity.has(event.id)).sort((a, b) => (b.timestamp ?? '').localeCompare(a.timestamp ?? '') || a.id.localeCompare(b.id));
        const remaining = 20 - recentActivity.events.length;
        recentActivity.events.push(...events.slice(0, remaining));
        for (const event of events.slice(0, remaining)) seenActivity.add(event.id);
        if (recentActivity.events.length >= 20) { recentActivity.hasEarlier = events.length > remaining || index + 1 < dates.length; break; }
      }
      return { algorithmVersion: 'capability-profile-2', employeeId, employee: assessment.employee, range: assessment.range, assessment, coaching:await coaching.read(assessment,report),
        header: await header(employeeId), kpis: { ...totals, activeDays: activeDates.length }, usage: { version: report.version, metricVersion: report.metricVersion, daily, agents,
          sourceInputsComplete: mine?.sourceInputsComplete ?? true, unknownReasons: mine?.unknownReasons ?? [], unscopedSources: mine?.unscopedSources ?? 0 },
        sessions, taskDistribution: [...taskCounts].sort(([a], [b]) => a.localeCompare(b)).map(([taskType, sessions]) => ({ taskType, sessions })), recentActivity,
        work: await workContent(employeeId, assessment.range.from, assessment.range.to, activeDates),
        references: { efficiency: { version: efficiencyReport.version, metricVersion: efficiencyReport.metricVersion, path: '#efficiency?' + new URLSearchParams({ period: scope.period, employeeId, version: efficiencyReport.version }) } } };
    }, async client => ({
      delivery: (await client.query('SELECT device_id,upload_id,snapshot_id,receipt_hash,received_at FROM delivery_receipts ORDER BY device_id,upload_id')).rows,
      devices: (await client.query('SELECT id,name,active FROM devices WHERE employee_id=$1 ORDER BY id', [employeeId])).rows,
      daily: (await client.query('SELECT date,revision,version FROM daily_report_revisions WHERE employee_id=$1 ORDER BY date,revision', [employeeId])).rows,
      dailyPending: (await client.query('SELECT date,generation,refresh_pending,qualification_revision,source_revision FROM daily_report_periods WHERE employee_id=$1 ORDER BY date', [employeeId])).rows,
      weekly: (await client.query("SELECT r.period_id,r.revision,r.version FROM work_view_revisions r JOIN work_view_periods p ON p.id=r.period_id WHERE p.selection->>'kind'='weekly' AND p.selection->>'subject'=$1 ORDER BY r.period_id,r.revision", [employeeId])).rows,
      weeklyPending: (await client.query("SELECT id,generation,refresh_pending,qualification_revision,candidate_revision FROM work_view_periods WHERE selection->>'kind'='weekly' AND selection->>'subject'=$1 ORDER BY id", [employeeId])).rows,
    }));
    const {previous,current}=content.coaching.trend;
    if(previous.modelVersion!==current.modelVersion||current.modelVersion!==content.assessment.modelVersion||previous.baselineVersion!==current.baselineVersion
      ||current.baselineVersion!==content.assessment.inputs.baselineVersion||previous.frontierVersion!==current.frontierVersion||current.frontierVersion!==content.assessment.inputs.frontierVersion)
      throw new HttpError(409,'画像周趋势的模型或来源正在更新，请重新读取');
    const version = digest(JSON.stringify(content, (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value));
    const value: CapabilityProfile = { ...content, version, generatedAt: clock().toISOString() };
    if (Buffer.byteLength(JSON.stringify(value)) > 16 * 1024 * 1024) throw new HttpError(413, '画像导出超过范围上限');
    await db.query('INSERT INTO capability_profiles(version,employee_id,payload) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [version, employeeId, value]);
    return (await db.query('SELECT payload FROM capability_profiles WHERE version=$1', [version])).rows[0].payload;
  }
  async function read(employeeId: string, input: unknown = {}, full = false) {
    const q = profileQuery.parse(input), stored = await load(employeeId, input, full), value = structuredClone(stored) as CapabilityProfilePage;
    const sections = { daily: value.usage.daily, devices: value.header.devices, sessions: value.sessions, work: value.work.items, reports: value.work.reports, activity: value.recentActivity.events };
    value.pages = {} as CapabilityProfilePage['pages'];
    const analysisCount = value.assessment.inputs.analysisVersions.length, insightCount = value.assessment.inputs.insightVersions.length;
    value.assessment.inputs.analysisVersions = value.assessment.inputs.analysisVersions.slice(0, 32);
    value.assessment.inputs.insightVersions = value.assessment.inputs.insightVersions.slice(0, 32);
    value.assessment.inputPage = { offset: 0, analysisCount, insightCount, nextOffset: Math.max(analysisCount, insightCount) > 32 ? 32 : null };
    for (const section of profileSections) {
      const rows = sections[section], total = rows.length, offset = q.section === section ? q.offset : 0;
      if (offset > total) throw new HttpError(400, '画像分页位置超出范围');
      const limit = q.section && q.section !== section ? 0 : 20;
      rows.splice(0, offset); rows.splice(limit);
      value.pages[section] = { total, offset, nextOffset: offset + rows.length < total ? offset + rows.length : null };
    }
    // Bound both the shared page and its actual MCP JSON text envelope.
    while (Buffer.byteLength(JSON.stringify(value)) > 32 * 1024 || Buffer.byteLength(JSON.stringify({content:[{type:'text',text:JSON.stringify(value)}]})) > 48 * 1024) {
      const section = profileSections.filter(key => sections[key].length > (q.section === key ? 1 : 0))
        .sort((a, b) => Buffer.byteLength(JSON.stringify(sections[b])) - Buffer.byteLength(JSON.stringify(sections[a])))[0];
      if (!section) throw new HttpError(413, '画像单条内容超过响应上限，请使用完整导出');
      sections[section].pop(); value.pages[section].nextOffset = value.pages[section].offset + sections[section].length;
    }
    return value;
  }
  return { read, export: (employeeId: string, input: unknown) => {
    const q = profileQuery.parse(input); if (q.section || q.offset) throw new HttpError(400, '完整导出不能指定分页');
    return load(employeeId, q);
  }, recompute: (employeeId: string, input: unknown) => read(employeeId, input, true) };
}
