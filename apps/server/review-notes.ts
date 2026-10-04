import { randomUUID } from 'node:crypto';
import { appendReviewNote, type ReviewNote, type ReviewNotesPage } from '../../packages/contracts/review-notes.js';
import type { Database } from './database.js';
import { HttpError, identities } from './identities.js';

export async function migrateReviewNotes(db: Database) {
  await db.query(`CREATE TABLE IF NOT EXISTS review_notes (
    seq bigserial UNIQUE NOT NULL,id uuid PRIMARY KEY,employee_id uuid NOT NULL REFERENCES employees(id),
    author_id uuid NOT NULL REFERENCES employees(id),author_name text NOT NULL,
    assessment_version text NOT NULL REFERENCES assessment_revisions(version),text text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
  ); CREATE INDEX IF NOT EXISTS review_notes_employee ON review_notes(employee_id,seq DESC)`);
}
const projection = `id,employee_id AS "employeeId",jsonb_build_object('id',author_id,'name',author_name) AS author,
  assessment_version AS "assessmentVersion",text,to_char(created_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD"T"HH24:MI:SS.MS')||'+08:00' AS "createdAt"`;

export function reviewNotesService(db: Database) {
  async function read(employeeId: string): Promise<ReviewNotesPage> {
    if (!(await db.query('SELECT 1 FROM employees WHERE id=$1', [employeeId])).rowCount) throw new HttpError(404, '员工不存在');
    const notes = (await db.query(`SELECT ${projection} FROM review_notes WHERE employee_id=$1 ORDER BY seq DESC`, [employeeId])).rows;
    return { employeeId, notes, count: notes.length, nextCursor: null };
  }
  async function append(employeeId: string, authorization: string | undefined, input: unknown): Promise<ReviewNote> {
    const value = appendReviewNote.parse(input), client = await db.connect();
    try {
      await client.query('BEGIN');
      const actor = await identities(db).reader(authorization, client, true);
      if (!(await client.query('SELECT 1 FROM employees WHERE id=$1', [employeeId])).rowCount) throw new HttpError(404, '员工不存在');
      if (!(await client.query('SELECT 1 FROM assessment_revisions WHERE version=$1 AND employee_id=$2', [value.assessmentVersion, employeeId])).rowCount) throw new HttpError(404, '评估版本不存在');
      const row = (await client.query(`INSERT INTO review_notes(id,employee_id,author_id,author_name,assessment_version,text)
        VALUES($1,$2,$3,$4,$5,$6) RETURNING ${projection}`, [randomUUID(), employeeId, actor.id, actor.name, value.assessmentVersion, value.text])).rows[0];
      await client.query('COMMIT'); return row;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  return { read, append };
}
