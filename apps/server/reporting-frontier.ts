import { digest, type Database } from './database.js';
import { HttpError } from './identities.js';
import { attributionRevisions } from './qualification.js';
import { inputIntegrityVersion } from './evidence-integrity.js';
import { beijingDate } from '../../packages/contracts/reports.js';
import type pg from 'pg';

/** Semantic input identity, read under one snapshot. Include originals without
 * business events: their unknown coverage can still affect the assessment.
 * Heartbeat times and derived report/cache revisions are deliberately absent. */
async function reportingFrontier(db: Database, clock: () => Date, extra?:(client:pg.PoolClient)=>Promise<unknown>) {
  const client = await db.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const day = beijingDate(clock());
    const snapshots = (await client.query(`SELECT id,device_id,source,source_session_id,hash,
      encode(sha256(convert_to(manifest::text,'UTF8')),'hex') AS manifest,
      encode(sha256(convert_to(provenance::text,'UTF8')),'hex') AS provenance,committed_at
      FROM snapshots ORDER BY id LIMIT 20001`)).rows;
    if (snapshots.length > 20000) throw new HttpError(413, '报告原件数量超过单次计算上限');
    const revisions = await attributionRevisions(client, snapshots.map(row => row.id));
    const people = (await client.query('SELECT id,name FROM employees ORDER BY id')).rows;
    const devices = (await client.query('SELECT id,employee_id,enrolled_at FROM devices ORDER BY id')).rows;
    const jobs = (await client.query(`SELECT DISTINCT ON(snapshot_id) snapshot_id,id,state,target_id,target_generation,
      encode(sha256(convert_to(config::text,'UTF8')),'hex') AS config,
      encode(sha256(convert_to(input::text,'UTF8')),'hex') AS input,
      encode(sha256(convert_to(result::text,'UTF8')),'hex') AS result
      FROM analysis_jobs ORDER BY snapshot_id,created_at DESC,id DESC`)).rows;
    const targets = (await client.query(`SELECT id,desired_snapshot_id,applicable_job_id,generation,config_hash,parser_version,attribution_revision
      FROM analysis_targets ORDER BY id`)).rows;
    const integrity = (await client.query(`SELECT snapshot_id,complete,unrecognized_lines,partial_line,revision
      FROM snapshot_input_integrity WHERE version=$1 ORDER BY snapshot_id`, [inputIntegrityVersion])).rows;
    const gaps = (await client.query(`SELECT device_id,source,date,hour,gap_observed,fault_codes
      FROM device_coverage_observations WHERE date <= $1 AND gap_observed ORDER BY device_id,source,date,hour`, [day])).rows;
    const additional=extra?await extra(client):undefined;
    await client.query('COMMIT');
    return digest(JSON.stringify(['reporting-frontier-1', day,
      snapshots.map(row => [row, revisions.get(row.id)]), people, devices, jobs, targets, integrity, gaps,...(extra?[additional]:[])]));
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

/** Compose live services, then bind their result only after the full input
 * identity is unchanged. Callers must persist their combined result afterwards;
 * component services may independently persist their own valid frozen versions. */
export async function consistentReportingInputs<T extends object>(db: Database, clock: () => Date, read: () => Promise<T>,extra?:(client:pg.PoolClient)=>Promise<unknown>): Promise<T & { frontierVersion: string }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = await reportingFrontier(db, clock,extra), value = await read();
    if (await reportingFrontier(db, clock,extra) === before) return { ...value, frontierVersion: before };
  }
  throw new HttpError(409, '报告来源正在更新，请重新读取；未保存混合输入的报告');
}
