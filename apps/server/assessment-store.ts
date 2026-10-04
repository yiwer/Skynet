import { digest, type Database } from './database.js';
import type { CapabilityAssessment } from '../../packages/contracts/assessment.js';

/** Publish each employee's sequence in commit order so a history cursor cannot
 * later admit an older allocated but uncommitted version. No input work is done
 * under this lock; identical content reuses its original generatedAt. */
export async function storeAssessment(db: Database, content: Omit<CapabilityAssessment, 'version' | 'generatedAt' | 'inputPage'>, clock: () => Date) {
  const version = digest(JSON.stringify(content)), client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,4601))', [content.employeeId]);
    await client.query('INSERT INTO assessment_revisions(version,employee_id,payload) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
      [version, content.employeeId, { ...content, version, generatedAt: clock().toISOString() }]);
    const result = (await client.query('SELECT payload FROM assessment_revisions WHERE version=$1', [version])).rows[0].payload as CapabilityAssessment;
    await client.query('COMMIT'); return result;
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}
