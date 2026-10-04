import { digest, type Database } from './database.js';
import { HttpError } from './identities.js';
import { currentMetricInputs } from './metric-current-inputs.js';
import { inputIntegrityVersion } from './evidence-integrity.js';
import { beijingDate } from '../../packages/contracts/reports.js';
import type pg from 'pg';

/** A live source changed without necessarily changing its database ledger. */
export class ReportingSourceChanged extends Error {}

/** Semantic input identity, read under one snapshot. Include originals without
 * business events: their unknown coverage can still affect the assessment.
 * Heartbeat times and derived report/cache revisions are deliberately absent. */
async function reportingFrontier(db: Database, clock: () => Date, extra?:(client:pg.PoolClient)=>Promise<unknown>) {
  const client = await db.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const day = beijingDate(clock());
    // The guard only needs to detect a changed ledger; it does not consume each
    // carrier's numeric revision. The complete metadata identity plus count AND
    // maximum of each append-only proof ledger detects even out-of-order
    // commits without rejoining every event for every composite guard.
    const originals = await currentMetricInputs(client);
    if (originals === undefined) throw new HttpError(413, '报告原件数量超过单次计算上限');
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
    const corrections=(await client.query('SELECT id,sequence FROM inference_corrections ORDER BY sequence')).rows;
    const additional=extra?await extra(client):undefined;
    await client.query('COMMIT');
    return digest(JSON.stringify(['reporting-frontier-2', day,
      originals, jobs, targets, integrity, gaps,
      ...(corrections.length?[['inference-corrections-1',corrections]]:[]),...(extra?[additional]:[])]));
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

/** Compose live services, then bind their result only after the full input
 * identity is unchanged. Callers must persist their combined result afterwards;
 * component services may independently persist their own valid frozen versions. */
export async function consistentReportingInputs<T extends object>(db: Database, clock: () => Date, read: () => Promise<T>,extra?:(client:pg.PoolClient)=>Promise<unknown>): Promise<T & { frontierVersion: string }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try{
      const before = await reportingFrontier(db, clock,extra), value = await read();
      if (await reportingFrontier(db, clock,extra) === before) return { ...value, frontierVersion: before };
    }catch(error){if(!(error instanceof ReportingSourceChanged))throw error;}
  }
  throw new HttpError(409, '报告来源正在更新，请重新读取；未保存混合输入的报告');
}
