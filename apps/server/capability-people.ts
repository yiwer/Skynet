import { digest, type Database } from './database.js';
import { HttpError } from './identities.js';
import type { assessmentService } from './assessment.js';
import { capabilityLevels, peopleQuery, type CapabilityCard, type CapabilityPeople } from '../../packages/contracts/capability-people.js';
import { dimKeys } from '../../packages/contracts/assessment.js';
import { assessmentModelVersion } from './assessment-model.js';

export async function migrateCapabilityPeople(db: Database) {
  await db.query('CREATE TABLE IF NOT EXISTS capability_people_revisions(version text PRIMARY KEY,payload jsonb NOT NULL)');
}
export function capabilityPeopleService(db: Database, assessments: ReturnType<typeof assessmentService>, clock: () => Date = () => new Date()) {
  async function load(input: unknown = {}, full = false): Promise<CapabilityPeople> {
    const q = peopleQuery.parse(input);
    if (q.version) {
      if (full) throw new HttpError(400, '固定员工一览版本不能重算');
      const row = (await db.query('SELECT payload FROM capability_people_revisions WHERE version=$1', [q.version])).rows[0];
      if (!row) throw new HttpError(404, '员工一览版本不存在');
      const value = row.payload as CapabilityPeople;
      if (q.period && q.period !== value.selection.period || q.preset && q.preset !== value.selection.preset) throw new HttpError(409, '员工一览版本与所选周期或方案不一致');
      return value;
    }
    const selection = { period: q.period ?? 'since-enrollment', preset: q.preset ?? '默认' } as const;
    const inputSet = await assessments.batch(selection, full);
    const employees: CapabilityCard[] = inputSet.values.map(value => {
      const output = inputSet.report.employees.find(row => row.employeeId === value.employeeId)?.outputs.verified;
      const sessions = inputSet.factors.filter(row => row.employeeId === value.employeeId), known = sessions.every(row => row.rework !== null);
      const denominator = sessions.reduce((n, row) => n + row.prompts.filter(prompt => !prompt.first).length, 0);
      const numerator = known ? sessions.reduce((n, row) => n + row.rework!, 0) : null;
      return { employeeId: value.employeeId, employee: value.employee, index: value.index, margin: value.margin, confidence: value.confidence, level: value.level,
        reason: value.reason, sample: value.sample, range: value.range, coverageIssues: value.coverageIssues, assessmentVersion: value.version,
        profilePath: '#profile?' + new URLSearchParams({ employeeId: value.employeeId, period: selection.period, preset: selection.preset, version: value.version }),
        dims: Object.fromEntries(dimKeys.map(key => [key, { label: value.dims[key].label, score: value.dims[key].score }])) as CapabilityCard['dims'],
        verified: output ?? { value: 0, known: 0, unknownSessions: 0, added: 0, removed: 0, passed: 0, failed: 0 },
        rework: { numerator, denominator, value: numerator === null || !denominator ? null : numerator / denominator } };
    }).sort((a, b) => capabilityLevels.indexOf(a.level) - capabilityLevels.indexOf(b.level) || a.employee.localeCompare(b.employee, 'zh-CN') || a.employeeId.localeCompare(b.employeeId));
    const content = { selection, modelVersion: assessmentModelVersion, frontierVersion: inputSet.frontierVersion, usageVersion: inputSet.report.version,
      baselineVersion: inputSet.baselineVersion, groups: capabilityLevels.map(level => ({ level, count: employees.filter(person => person.level === level).length })), total: employees.length, employees, nextOffset: null };
    const version = digest(JSON.stringify(content, (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value));
    const value = { ...content, version, generatedAt: clock().toISOString() };
    if (Buffer.byteLength(JSON.stringify(value)) > 16 * 1024 * 1024) throw new HttpError(413, '员工一览导出超过范围上限');
    await db.query('INSERT INTO capability_people_revisions(version,payload) VALUES($1,$2) ON CONFLICT DO NOTHING', [version, value]);
    return (await db.query('SELECT payload FROM capability_people_revisions WHERE version=$1', [version])).rows[0].payload;
  }
  async function read(input: unknown = {}, full = false) {
    const q = peopleQuery.parse(input), value = await load(q, full);
    const result = { ...value, employees: value.employees.slice(q.offset, q.offset + 20), nextOffset: value.total > q.offset + 20 ? q.offset + 20 : null };
    if (Buffer.byteLength(JSON.stringify(result)) > 80 * 1024) throw new HttpError(413, '员工一览响应超过范围上限');
    return result;
  }
  return { read, export: (input: unknown) => load(input), recompute: (input: unknown) => read(input, true) };
}
