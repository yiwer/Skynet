import { digest, type Database } from './database.js';
import { HttpError } from './identities.js';
import { consistentReportingInputs } from './reporting-frontier.js';
import type { assessmentService } from './assessment.js';
import type { usageOutputService } from './usage-output.js';
import { profileQuery, type CapabilityProfile } from '../../packages/contracts/capability-profile.js';

export async function migrateCapabilityProfiles(db: Database) {
  await db.query('CREATE TABLE IF NOT EXISTS capability_profiles(version text PRIMARY KEY,employee_id uuid NOT NULL REFERENCES employees(id),payload jsonb NOT NULL)');
}
export function capabilityProfileService(db: Database, assessments: ReturnType<typeof assessmentService>, usage: ReturnType<typeof usageOutputService>, clock: () => Date = () => new Date()) {
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
      return result;
    }
    const scope = { period: q.period ?? 'since-enrollment' as const, preset: q.preset ?? '默认' as const };
    const content = await consistentReportingInputs(db, clock, async () => {
      const head = full ? await assessments.recompute(employeeId, scope) : null;
      const assessment = await assessments.export(employeeId, { ...scope, ...(head ? { version: head.version } : {}) });
      const report = await usage.export({ period: scope.period, version: assessment.inputs.usageVersion });
      const mine = report.employees.find(person => person.employeeId === employeeId);
      const { employeeId: _id, employee: _name, daily, agents, activeDates, ...totals } = mine ?? {
        employeeId, employee: assessment.employee, daily: [], agents: [], activeDates: [], sessions: 0, userTurns: 0, toolCalls: 0,
        inputTokens: 0, outputTokens: 0, knownInputTokens: 0, knownOutputTokens: 0, unknownTokenSessions: 0, unknownInputSessions: 0, unknownOutputSessions: 0,
        outputs: Object.fromEntries(['verified','claimed','codeChanges','tests','commits'].map(kind => [kind, { value: 0, known: 0, unknownSessions: 0, added: 0, removed: 0, passed: 0, failed: 0 }])) as CapabilityProfile['kpis']['outputs'] };
      return { algorithmVersion: 'capability-profile-1', employeeId, employee: assessment.employee, range: assessment.range, assessment,
        header: await header(employeeId), kpis: { ...totals, activeDays: activeDates.length }, usage: { version: report.version, metricVersion: report.metricVersion, daily, agents } };
    });
    const version = digest(JSON.stringify(content, (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value));
    const value: CapabilityProfile = { ...content, version, generatedAt: clock().toISOString() };
    if (Buffer.byteLength(JSON.stringify(value)) > 16 * 1024 * 1024) throw new HttpError(413, '画像导出超过范围上限');
    await db.query('INSERT INTO capability_profiles(version,employee_id,payload) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [version, employeeId, value]);
    return (await db.query('SELECT payload FROM capability_profiles WHERE version=$1', [version])).rows[0].payload;
  }
  async function read(employeeId: string, input: unknown = {}, full = false) {
    const value = await load(employeeId, input, full);
    if (Buffer.byteLength(JSON.stringify(value)) > 80 * 1024) throw new HttpError(413, '画像响应超过范围上限');
    return value;
  }
  return { read, export: load, recompute: (employeeId: string, input: unknown) => read(employeeId, input, true) };
}
