import { digest, type Database } from './database.js';
import type { usageOutputService } from './usage-output.js';
import type { sessionInsightsService } from './session-insights.js';
import type { waitsService } from './waits.js';
import { beijingDate } from '../../packages/contracts/reports.js';
import { addDays } from '../../packages/contracts/work-views.js';
import type { CapabilityAssessment, AssessmentPreset, AssessmentPeriod } from '../../packages/contracts/assessment.js';
import { emptyDimensions, scoreMetric, concludeAssessment, assessmentModelVersion } from './assessment-model.js';
import { assessmentSessions, assessmentBaseline, fillAssessmentFactors, median } from './assessment-factors.js';
import { dimKeys } from '../../packages/contracts/assessment.js';

const weekday = (date: string) => ![0, 6].includes(new Date(date + 'T00:00:00Z').getUTCDay());
export async function assessmentInputs(db: Database, usage: ReturnType<typeof usageOutputService>, insights: ReturnType<typeof sessionInsightsService>, waits: ReturnType<typeof waitsService>, clock: () => Date, full = false, preset: AssessmentPreset = '默认', period: AssessmentPeriod = 'since-enrollment') {
  const selection = { period };
  const usageHead = full ? await usage.recompute(selection) : null, waitHead = full ? await waits.recompute(selection) : null;
  const report = await usage.export({ ...selection, ...(usageHead ? { version: usageHead.version } : {}) });
  const waitReport = await waits.export({ ...selection, ...(waitHead ? { version: waitHead.version } : {}) });
  const baselineHead = period !== 'since-enrollment' && full ? await usage.recompute({ period: 'since-enrollment' }) : null;
  const baselineReport = period === 'since-enrollment' ? report : await usage.export({ period: 'since-enrollment', ...(baselineHead ? { version: baselineHead.version } : {}) });
  const baselineReferences = [...new Map(baselineReport.sessions.flatMap(row => row.insightVersions).map(ref => [ref.version, ref])).values()];
  const references = [...new Map([...report.sessions.flatMap(row => row.insightVersions), ...baselineReferences].map(ref => [ref.version, ref])).values()];
  const views = await insights.readVersions(references), messages=[...new Map((await insights.readMessageFacts(views)).flatMap(fact=>fact.messages).map(message=>[message.id,message])).values()];
  const factors = assessmentSessions(report.sessions, views, report.scope,messages);
  const baselineFactors = period === 'since-enrollment' ? factors : assessmentSessions(baselineReport.sessions, views, baselineReport.scope,messages);
  const baseline = { ...assessmentBaseline(baselineFactors), modelVersion: assessmentModelVersion, usageVersion: baselineReport.version,
    sourceVersions: baselineReferences.map(ref => ref.version).sort() }, baselineVersion = digest(JSON.stringify(baseline));
  const people = (await db.query(`SELECT e.id,e.name,min(d.enrolled_at) AS enrolled_at,
    bool_or(d.id IS NOT NULL AND d.enrolled_at IS NULL) AS unknown_enrollment
    FROM employees e LEFT JOIN devices d ON d.employee_id=e.id GROUP BY e.id ORDER BY e.name,e.id`)).rows;
  const to = report.scope.to, elapsedTo = [to, beijingDate(clock())].sort()[0]!;
  const gaps = (await db.query(`SELECT d.employee_id,o.source,o.date,o.gap_observed,o.fault_codes FROM device_coverage_observations o
    JOIN devices d ON d.id=o.device_id WHERE o.date <= $1 AND o.gap_observed ORDER BY d.employee_id,o.date,o.source,o.hour`, [elapsedTo])).rows;
  const values = people.map(person => {
    const sessions = report.sessions.filter(session => session.employeeId === person.id && session.sessions > 0);
    const enrolled = person.enrolled_at && !person.unknown_enrollment ? beijingDate(person.enrolled_at) : null;
    const empty = !!enrolled && enrolled > to;
    const from = enrolled && !empty ? [enrolled, report.scope.from].sort().at(-1)! : null;
    let workdays = 0; if (from) for (let date = from; date <= elapsedTo; date = addDays(date, 1)) if (weekday(date)) workdays++;
    const totals = report.employees.find(employee => employee.employeeId === person.id);
    const dates = new Set(totals?.activeDates ?? []), activeWorkdays = [...dates].filter(weekday).length;
    const sample: CapabilityAssessment['sample'] = { sessions: new Set(sessions.map(s => s.sessionId)).size, prompts: totals?.userTurns ?? 0,
      activeDays: dates.size, workdays, unknownTokenSessions: totals?.unknownTokenSessions ?? 0 };
    const dims = emptyDimensions(preset);
    if (sample.sessions) {
      for (const dim of Object.values(dims)) for (const metric of dim.metrics) scoreMetric(metric, null, 0, metric.key === 'permMed' ? '来源未记录可核对的权限请求与决定时刻' : '尚无完整且适用的分析');
      scoreMetric(dims.adopt.metrics[0]!, from && workdays ? activeWorkdays / workdays : null, workdays, from ? '范围内没有工作日' : '接入日期未知');
      scoreMetric(dims.adopt.metrics[1]!, dates.size ? sample.sessions / dates.size : null, dates.size);
      for (const metric of dims.adopt.metrics) { metric.evidence = sessions.slice(0, 3).map(s => ({ snapshotId: s.snapshotId, webPath: s.webPath })); metric.evidenceCount = sessions.length; }
    }
    const observations = gaps.filter(gap => !empty && gap.employee_id === person.id && gap.date >= (from ?? report.scope.from));
    const issues = [...new Set([...observations.map(gap => `${gap.source || '客户端'} · ${gap.date} 采集缺口`),
      ...(sessions.some(s => s.unknownReasons.some(reason => /缺口|不可读取|无效编码/.test(reason))) ? ['来源原件不完整'] : [])])];
    const mine = factors.filter(s => s.employeeId === person.id), filled = fillAssessmentFactors(dims, mine, baseline, waitReport, person.id);
    const verdict = concludeAssessment(dims, sample, issues);
    if (filled.promptTip) for (const tip of verdict.tips) if (tip.dim === 'prompt') tip.text = filled.promptTip;
    return { id: person.id as string, name: person.name as string, range: { from, to, timeZone: 'Asia/Shanghai' as const, ...(empty ? { empty: true } : {}) }, sample, dims, issues, verdict, representatives: filled.representatives,
      analysisVersions: [...new Set(mine.flatMap(s => s.analysisVersions))].sort(), insightVersions: [...new Set(mine.flatMap(s => s.versions.map(v => v.version)))].sort(),
      coverageVersion: digest(JSON.stringify([observations, sessions.map(s => [s.sessionId, s.sourceInputsComplete])])) };
  });
  for (const key of dimKeys) { const reference = median(values.flatMap(person => person.dims[key].score === null ? [] : [person.dims[key].score!])); for (const person of values) person.dims[key].teamMedian = reference; }
  return { report, factors, waitsVersion: waitReport.version, baseline, baselineVersion, people: values };
}
