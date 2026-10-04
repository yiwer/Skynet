import { digest, type Database } from './database.js';
import { HttpError } from './identities.js';
import { assessmentQuery, type CapabilityAssessment } from '../../packages/contracts/assessment.js';
import { assessmentModel, assessmentModelVersion, concludeAssessment } from './assessment-model.js';
import { assessmentInputs } from './assessment-inputs.js';
import type { MetricsService } from './metrics.js';

export async function migrateAssessments(db: Database) {
  await db.query(`CREATE TABLE IF NOT EXISTS assessment_models(version text PRIMARY KEY,payload jsonb NOT NULL);
    CREATE TABLE IF NOT EXISTS assessment_baselines(version text PRIMARY KEY,payload jsonb NOT NULL);
    CREATE TABLE IF NOT EXISTS assessment_revisions(version text PRIMARY KEY,employee_id uuid NOT NULL REFERENCES employees(id),payload jsonb NOT NULL)`);
  await db.query('INSERT INTO assessment_models(version,payload) VALUES($1,$2) ON CONFLICT DO NOTHING', [assessmentModelVersion, assessmentModel]);
}
export function assessmentService(db: Database, metrics: MetricsService, clock: () => Date = () => new Date()) {
  async function model(version: string) {
    const row = (await db.query('SELECT payload FROM assessment_models WHERE version=$1', [version])).rows[0];
    if (!row) throw new HttpError(404, '评估模型版本不存在'); return row.payload;
  }
  async function read(employeeId: string, input: unknown = {}): Promise<CapabilityAssessment> {
    const q = assessmentQuery.parse(input);
    if (q.version) {
      const row = (await db.query('SELECT payload FROM assessment_revisions WHERE version=$1 AND employee_id=$2', [q.version, employeeId])).rows[0];
      if (!row) throw new HttpError(404, '评估版本不存在'); return row.payload;
    }
    const inputSet = await assessmentInputs(db, metrics, clock), employee = inputSet.people.find(person => person.id === employeeId);
    if (!employee) throw new HttpError(404, '员工不存在');
    const baseline = { modelVersion: assessmentModelVersion, metricsVersion: inputSet.report.version, samples: [] }, baselineVersion = digest(JSON.stringify(baseline));
    await db.query('INSERT INTO assessment_baselines(version,payload) VALUES($1,$2) ON CONFLICT DO NOTHING', [baselineVersion, baseline]);
    const content = { employeeId, employee: employee.name, period: '接入至今' as const, preset: '默认' as const, modelVersion: assessmentModelVersion,
      inputs: { metricsVersion: inputSet.report.version, analysisVersions: [], insightVersions: [], baselineVersion, waitsVersion: '', coverageVersion: employee.coverageVersion },
      range: employee.range, dims: employee.dims, ...concludeAssessment(employee.dims, employee.sample, employee.issues),
      sample: employee.sample, coverageIssues: employee.issues, representatives: { best: null, rework: null } };
    const version = digest(JSON.stringify(content));
    await db.query('INSERT INTO assessment_revisions(version,employee_id,payload) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [version, employeeId, { ...content, version, generatedAt: clock().toISOString() }]);
    return (await db.query('SELECT payload FROM assessment_revisions WHERE version=$1', [version])).rows[0].payload;
  }
  return { read, model };
}
