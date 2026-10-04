import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { appendReviewNote, reviewNotesQuery, type ReviewNote, type ReviewNotesPage } from '../../packages/contracts/review-notes.js';
import type { Database } from './database.js';
import { HttpError, identities } from './identities.js';

export async function migrateReviewNotes(db: Database) {
  await db.query(`CREATE TABLE IF NOT EXISTS review_notes (
    seq bigserial UNIQUE NOT NULL,id uuid PRIMARY KEY,employee_id uuid NOT NULL REFERENCES employees(id),
    author_id uuid NOT NULL REFERENCES employees(id),author_name text NOT NULL,request_id uuid,
    assessment_version text NOT NULL REFERENCES assessment_revisions(version),text text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
  ); ALTER TABLE review_notes ADD COLUMN IF NOT EXISTS request_id uuid;
  CREATE UNIQUE INDEX IF NOT EXISTS review_notes_request_once ON review_notes(author_id,request_id);
  CREATE INDEX IF NOT EXISTS review_notes_employee ON review_notes(employee_id,seq DESC)`);
}
const projection = `id,employee_id AS "employeeId",jsonb_build_object('id',author_id,'name',author_name) AS author,
  assessment_version AS "assessmentVersion",text,to_char(created_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD"T"HH24:MI:SS.MS')||'+08:00' AS "createdAt"`;
const sequence = z.string().regex(/^[1-9][0-9]{0,18}$/).refine(value => BigInt(value) <= 9223372036854775807n);
const cursorSchema = z.object({ employeeId: z.uuid(), through: sequence, before: sequence }).strict();

export function reviewNotesService(db: Database) {
  async function read(employeeId: string, input: unknown = {}): Promise<ReviewNotesPage> {
    const query = reviewNotesQuery.parse(input);
    let cursor: z.infer<typeof cursorSchema> | undefined;
    if (query.cursor) {
      try {
        cursor = cursorSchema.parse(JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')));
        if (cursor.employeeId !== employeeId || BigInt(cursor.before) > BigInt(cursor.through)) throw new Error();
      } catch { throw new HttpError(400, '备注分页游标无效'); }
    }
    const client = await db.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      if (!(await client.query('SELECT 1 FROM employees WHERE id=$1', [employeeId])).rowCount) throw new HttpError(404, '员工不存在');
      const through = cursor?.through ?? (await client.query('SELECT COALESCE(max(seq),0)::text AS seq FROM review_notes WHERE employee_id=$1', [employeeId])).rows[0].seq;
      const rows = (await client.query(`SELECT ${projection},seq::text FROM review_notes WHERE employee_id=$1 AND seq<=$2 AND ($3::bigint IS NULL OR seq<$3) ORDER BY review_notes.seq DESC LIMIT 11`, [employeeId, through, cursor?.before ?? null])).rows;
      const count = Number((await client.query('SELECT count(*)::text AS count FROM review_notes WHERE employee_id=$1 AND seq<=$2', [employeeId, through])).rows[0].count);
      const page = rows.slice(0, 10), nextCursor = rows.length > 10 ? Buffer.from(JSON.stringify({ employeeId, through, before: page.at(-1)!.seq })).toString('base64url') : null;
      const notes = page.map(({ seq: _seq, ...note }) => note as ReviewNote);
      await client.query('COMMIT'); return { employeeId, notes, count, nextCursor };
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async function append(employeeId: string, authorization: string | undefined, input: unknown): Promise<ReviewNote> {
    const value = appendReviewNote.parse(input), client = await db.connect();
    try {
      await client.query('BEGIN');
      const actor = await identities(db).reader(authorization, client, true);
      if (!(await client.query('SELECT 1 FROM employees WHERE id=$1', [employeeId])).rowCount) throw new HttpError(404, '员工不存在');
      if (!(await client.query('SELECT 1 FROM assessment_revisions WHERE version=$1 AND employee_id=$2', [value.assessmentVersion, employeeId])).rowCount) throw new HttpError(404, '评估版本不存在');
      // Allocate list positions in commit order for this employee so a cursor never skips an earlier in-flight append.
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('review-notes:'||$1,0))", [employeeId]);
      let row = (await client.query(`INSERT INTO review_notes(id,employee_id,author_id,author_name,assessment_version,text,request_id)
        VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(author_id,request_id) DO NOTHING RETURNING ${projection}`,
      [randomUUID(), employeeId, actor.id, actor.name, value.assessmentVersion, value.text, value.requestId])).rows[0];
      if (!row) {
        row = (await client.query(`SELECT ${projection} FROM review_notes WHERE author_id=$1 AND request_id=$2`, [actor.id, value.requestId])).rows[0];
        if (!row || row.employeeId !== employeeId || row.assessmentVersion !== value.assessmentVersion || row.text !== value.text) throw new HttpError(409, '该提交编号已用于另一条备注');
      }
      await client.query('COMMIT'); return row;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  return { read, append };
}
