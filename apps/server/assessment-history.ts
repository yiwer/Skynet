import { z } from 'zod';
import { digest, type Database } from './database.js';
import { HttpError } from './identities.js';
import { assessmentHistoryQuery, type AssessmentHistoryPage, type CapabilityAssessment } from '../../packages/contracts/assessment.js';

const sequence = z.string().regex(/^\d{1,19}$/).refine(value => BigInt(value) <= 9223372036854775807n);
const cursorSchema = z.object({ scope: z.string().length(64), asOf: sequence, before: sequence }).strict();
export async function assessmentHistory(db: Database, employeeId: string, input: unknown): Promise<AssessmentHistoryPage> {
  const q = assessmentHistoryQuery.parse(input), scope = digest(JSON.stringify([employeeId, q.period ?? null, q.preset ?? null]));
  let cursor: z.infer<typeof cursorSchema> | undefined;
  if (q.cursor) {
    try { cursor = cursorSchema.parse(JSON.parse(Buffer.from(q.cursor, 'base64url').toString('utf8'))); }
    catch { throw new HttpError(400, '历史分页位置无效'); }
    if (cursor.scope !== scope) throw new HttpError(400, '历史分页位置不属于所选范围');
  }
  const client = await db.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    if (!(await client.query('SELECT id FROM employees WHERE id=$1', [employeeId])).rowCount) throw new HttpError(404, '员工不存在');
    const asOf = cursor?.asOf ?? (await client.query('SELECT COALESCE(MAX(ordinal),0)::text AS ordinal FROM assessment_revisions WHERE employee_id=$1', [employeeId])).rows[0].ordinal;
    const filter = `employee_id=$1 AND ordinal <= $2::bigint
      AND ($3::text IS NULL OR COALESCE(payload->'selection'->>'period','since-enrollment')=$3)
      AND ($4::text IS NULL OR payload->>'preset'=$4)`;
    const args = [employeeId, asOf, q.period ?? null, q.preset ?? null];
    const total = (await client.query(`SELECT count(*)::int AS total FROM assessment_revisions WHERE ${filter}`, args)).rows[0].total;
    const rows = (await client.query(`SELECT ordinal::text,payload FROM assessment_revisions WHERE ${filter}
      AND ($5::bigint IS NULL OR ordinal < $5) ORDER BY assessment_revisions.ordinal DESC LIMIT 21`, [...args, cursor?.before ?? null])).rows;
    await client.query('COMMIT');
    const page = rows.slice(0, 20), nextCursor = rows.length > 20 ? Buffer.from(JSON.stringify({ scope, asOf, before: page.at(-1)!.ordinal })).toString('base64url') : null;
    return { total, nextCursor, items: page.map(row => {
      const { version, employeeId, period, preset, selection, range, index, level, confidence, generatedAt, modelVersion } = row.payload as CapabilityAssessment;
      return { version, employeeId, period, preset, selection: selection ?? { period: 'since-enrollment', preset }, range, index, level, confidence, generatedAt, modelVersion };
    }) };
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}
