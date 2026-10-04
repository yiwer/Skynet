import type pg from 'pg';
import { digest } from './database.js';

/** Identity of the immutable ledger inputs used by recorded metrics. Snapshot
 * metadata and people/device fields are compared by value. Qualification,
 * integrity and override rows are append-only. Pair the maximum revision with
 * cardinality: concurrent transactions can commit sequence values out of order,
 * so a maximum alone would miss a newly committed lower-numbered proof.
 * This does not establish raw-object availability: callers must freshly read
 * and verify every original before reusing a result with this identity. */
export async function currentMetricInputs(client: pg.PoolClient): Promise<string | undefined> {
  const snapshots = (await client.query(`SELECT id,device_id,source,source_session_id,hash,committed_at,
    encode(sha256(convert_to(manifest::text,'UTF8')),'hex') AS manifest,
    encode(sha256(convert_to(provenance::text,'UTF8')),'hex') AS provenance
    FROM snapshots ORDER BY id LIMIT 20001`)).rows;
  // A small selected scope may still be valid in a larger archive. Declining
  // this optimization must not impose a new global reporting limit.
  if (snapshots.length > 20000) return undefined;
  const people = (await client.query('SELECT id,name FROM employees ORDER BY id')).rows;
  const devices = (await client.query('SELECT id,employee_id,enrolled_at FROM devices ORDER BY id')).rows;
  const proofs = (await client.query(`SELECT
    (SELECT ARRAY[count(*),max(revision)] FROM event_qualifications) AS qualification,
    (SELECT ARRAY[count(*),max(revision)] FROM event_integrity) AS integrity,
    (SELECT ARRAY[count(*),max(revision)] FROM event_origin_overrides) AS override,
    (SELECT ARRAY[count(*),max(revision)] FROM snapshot_input_integrity) AS input_integrity`)).rows[0];
  return digest(JSON.stringify(['metric-current-inputs-1', snapshots, people, devices, proofs]));
}
