import { digest, type Database } from './database.js';
import { HttpError } from './identities.js';
import { assessmentQuery, type CapabilityAssessment } from '../../packages/contracts/assessment.js';
import { assessmentModel, assessmentModelVersion } from './assessment-model.js';
import { assessmentInputs } from './assessment-inputs.js';
import { consistentReportingInputs } from './reporting-frontier.js';
import type { usageOutputService } from './usage-output.js';
import type { sessionInsightsService } from './session-insights.js';
import type { waitsService } from './waits.js';

export async function migrateAssessments(db: Database) {
  await db.query(`CREATE TABLE IF NOT EXISTS assessment_models(version text PRIMARY KEY,payload jsonb NOT NULL);
    CREATE TABLE IF NOT EXISTS assessment_baselines(version text PRIMARY KEY,payload jsonb NOT NULL);
    CREATE TABLE IF NOT EXISTS assessment_revisions(version text PRIMARY KEY,employee_id uuid NOT NULL REFERENCES employees(id),payload jsonb NOT NULL)`);
  await db.query('INSERT INTO assessment_models(version,payload) VALUES($1,$2) ON CONFLICT DO NOTHING', [assessmentModelVersion, assessmentModel]);
}
export function assessmentService(db: Database, usage: ReturnType<typeof usageOutputService>, insights: ReturnType<typeof sessionInsightsService>, waits: ReturnType<typeof waitsService>, clock: () => Date = () => new Date()) {
  async function model(version: string) {
    const row = (await db.query('SELECT payload FROM assessment_models WHERE version=$1', [version])).rows[0];
    if (!row) throw new HttpError(404, '评估模型版本不存在'); return row.payload;
  }
  async function baseline(version: string) {
    const row = (await db.query('SELECT payload FROM assessment_baselines WHERE version=$1', [version])).rows[0];
    if (!row) throw new HttpError(404, '评估基线版本不存在'); return row.payload;
  }
  async function load(employeeId: string, input: unknown = {}, full = false): Promise<CapabilityAssessment> {
    const q = assessmentQuery.parse(input);
    if (q.inputOffset && (!q.version || full)) throw new HttpError(400, '后续输入分页需要固定评估版本');
    if (q.version) {
      if (full) throw new HttpError(400, '固定版本不能重算');
      const row = (await db.query('SELECT payload FROM assessment_revisions WHERE version=$1 AND employee_id=$2', [q.version, employeeId])).rows[0];
      if (!row) throw new HttpError(404, '评估版本不存在');
      if (q.preset && q.preset !== row.payload.preset || q.period && q.period !== (row.payload.selection?.period ?? 'since-enrollment')) throw new HttpError(409, '评估版本与所选周期或方案不一致');
      return row.payload;
    }
    const preset = q.preset ?? '默认', period = q.period ?? 'since-enrollment';
    const inputSet = await consistentReportingInputs(db, clock, () => assessmentInputs(db, usage, insights, waits, clock, full, preset));
    const employee = inputSet.people.find(person => person.id === employeeId);
    if (!employee) throw new HttpError(404, '员工不存在');
    const { baselineVersion } = inputSet;
    await db.query('INSERT INTO assessment_baselines(version,payload) VALUES($1,$2) ON CONFLICT DO NOTHING', [baselineVersion, inputSet.baseline]);
    const content = { employeeId, employee: employee.name, period: '接入至今', preset, selection: { period, preset }, modelVersion: assessmentModelVersion,
      inputs: { metricsVersion: inputSet.report.metricVersion, usageVersion: inputSet.report.version, analysisVersions: employee.analysisVersions, insightVersions: employee.insightVersions, baselineVersion, waitsVersion: inputSet.waitsVersion, coverageVersion: employee.coverageVersion, frontierVersion: inputSet.frontierVersion },
      range: employee.range, dims: employee.dims, ...employee.verdict,
      sample: employee.sample, coverageIssues: employee.issues, representatives: employee.representatives };
    const version = digest(JSON.stringify(content));
    await db.query('INSERT INTO assessment_revisions(version,employee_id,payload) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [version, employeeId, { ...content, version, generatedAt: clock().toISOString() }]);
    return (await db.query('SELECT payload FROM assessment_revisions WHERE version=$1', [version])).rows[0].payload;
  }
  function page(value: CapabilityAssessment, offset: number, limit: number) {
    const analysisCount = value.inputs.analysisVersions.length, insightCount = value.inputs.insightVersions.length;
    return { ...value, inputs: { ...value.inputs, analysisVersions: value.inputs.analysisVersions.slice(offset, offset + limit), insightVersions: value.inputs.insightVersions.slice(offset, offset + limit) },
      inputPage: { offset, analysisCount, insightCount, nextOffset: Math.max(analysisCount, insightCount) > offset + limit ? offset + limit : null } };
  }
  async function read(employeeId: string, input: unknown = {}, full = false) {
    const q = assessmentQuery.parse(input), value = await load(employeeId, q, full);
    return page(value, q.inputOffset, 32);
  }
  return { read, model, baseline, recompute: (employeeId: string, input: unknown) => read(employeeId, input, true),
    export: async (employeeId: string, input: unknown) => page(await load(employeeId, input), 0, Number.MAX_SAFE_INTEGER) };
}
