import { digest, type Database } from './database.js';
import type { MetricsService } from './metrics.js';
import { beijingDate } from '../../packages/contracts/reports.js';
import { addDays } from '../../packages/contracts/work-views.js';
import type { CapabilityAssessment } from '../../packages/contracts/assessment.js';
import { emptyDimensions, scoreMetric } from './assessment-model.js';

const weekday = (date: string) => ![0, 6].includes(new Date(date + 'T00:00:00Z').getUTCDay());
export async function assessmentInputs(db: Database, metrics: MetricsService, clock: () => Date) {
  const report = await metrics.exportMetrics({ period: 'since-enrollment' });
  const people = (await db.query(`SELECT e.id,e.name,min(d.enrolled_at) AS enrolled_at,
    bool_or(d.id IS NOT NULL AND d.enrolled_at IS NULL) AS unknown_enrollment
    FROM employees e LEFT JOIN devices d ON d.employee_id=e.id GROUP BY e.id ORDER BY e.name,e.id`)).rows;
  const to = beijingDate(clock());
  const gaps = (await db.query(`SELECT d.employee_id,o.source,o.date,o.gap_observed,o.fault_codes FROM device_coverage_observations o
    JOIN devices d ON d.id=o.device_id WHERE o.date <= $1 AND o.gap_observed ORDER BY d.employee_id,o.date,o.source,o.hour`, [to])).rows;
  return { report, people: people.map(person => {
    const sessions = report.sessions.filter(session => session.employeeId === person.id && session.sessions > 0);
    const from = person.enrolled_at && !person.unknown_enrollment ? beijingDate(person.enrolled_at) : null;
    let workdays = 0; if (from) for (let date = from; date <= to; date = addDays(date, 1)) if (weekday(date)) workdays++;
    const dates = new Set(sessions.flatMap(session => session.dates)), activeWorkdays = [...dates].filter(weekday).length;
    const totals = report.employees.find(employee => employee.employeeId === person.id);
    const sample: CapabilityAssessment['sample'] = { sessions: new Set(sessions.map(s => s.sessionId)).size, prompts: totals?.userTurns ?? 0,
      activeDays: dates.size, workdays, unknownTokenSessions: totals?.unknownTokenSessions ?? 0 };
    const dims = emptyDimensions();
    if (sample.sessions) {
      for (const dim of Object.values(dims)) for (const metric of dim.metrics) scoreMetric(metric, null, 0, metric.key === 'permMed' ? '来源未记录可核对的权限请求与决定时刻' : '尚无完整且适用的分析');
      scoreMetric(dims.adopt.metrics[0]!, from && workdays ? activeWorkdays / workdays : null, workdays, from ? '范围内没有工作日' : '接入日期未知');
      scoreMetric(dims.adopt.metrics[1]!, dates.size ? sample.sessions / dates.size : null, dates.size);
      for (const metric of dims.adopt.metrics) { metric.evidence = sessions.slice(0, 3).map(s => ({ snapshotId: s.snapshotId, webPath: s.webPath })); metric.evidenceCount = sessions.length; }
    }
    const observations = gaps.filter(gap => gap.employee_id === person.id && (!from || gap.date >= from));
    const issues = [...new Set([...observations.map(gap => `${gap.source || '客户端'} · ${gap.date} 采集缺口`),
      ...(sessions.some(s => s.unknownReasons.some(reason => /缺口|不可读取|无效编码/.test(reason))) ? ['来源原件不完整'] : [])])];
    return { id: person.id as string, name: person.name as string, range: { from, to, timeZone: 'Asia/Shanghai' as const }, sample, dims, issues,
      coverageVersion: digest(JSON.stringify([observations, sessions.map(s => [s.sessionId, s.sourceInputsComplete])])) };
  }) };
}
