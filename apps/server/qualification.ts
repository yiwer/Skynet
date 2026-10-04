import type pg from 'pg';
import type { Database } from './database.js';
import type { Manifest } from '../../packages/contracts/archive.js';
import type { ActivityEvent } from '../../packages/activity.js';
import type { EventOrigin } from '../../packages/contracts/provenance.js';

type Query = Pick<Database,'query'> | Pick<pg.PoolClient,'query'>;
export async function validQualificationBytes(bytes:Buffer) {
  const decoder=new TextDecoder('utf-8',{fatal:true});
  try {
    for(let offset=0;offset<bytes.length;offset+=65536) {
      decoder.decode(bytes.subarray(offset,offset+65536),{stream:true});
      if(offset%1048576===0)await new Promise<void>(resolve=>setImmediate(resolve));
    }
    decoder.decode();return true;
  } catch {return false;}
}
// Global append sequence makes max revision change for any later qualification
// in this exact carrier, without changing its bytes, parser or stable event IDs.
const carrierEvents=(snapshot:string)=>`(SELECT event_id FROM snapshot_events WHERE snapshot_id=${snapshot}
  UNION SELECT event_id FROM effective_snapshot_events WHERE snapshot_id=${snapshot})`;
// Keep old base proofs in the revision even when an effective mapping changes.
// Every component can only increase; replacing a high old proof with a lower
// existing canonical proof cannot cancel the new override revision.
export const attributionRevisionSql = (snapshot: string) => `((SELECT COALESCE(MAX(c.revision),0) FROM ${carrierEvents(snapshot)} se
  JOIN event_qualifications c ON c.event_id=se.event_id)+(SELECT COALESCE(MAX(i.revision),0)
  FROM ${carrierEvents(snapshot)} se JOIN event_integrity i ON i.event_id=se.event_id WHERE i.version='original-utf8-1')+(SELECT COALESCE(MAX(v.revision),0) FROM event_origin_overrides v WHERE v.snapshot_id=${snapshot} AND v.version='original-utf8-1'))`;
export const qualificationDaySql = (employee: string, date: string) => `((SELECT COALESCE(MAX(c.revision),0)
  FROM archive_event_origins qo JOIN event_qualifications c ON c.event_id=qo.event_id WHERE qo.employee_id=${employee} AND qo.source_date=${date})+
  (SELECT COALESCE(MAX(i.revision),0) FROM archive_event_origins qo JOIN event_integrity i ON i.event_id=qo.event_id
  WHERE qo.employee_id=${employee} AND qo.source_date=${date} AND i.version='original-utf8-1'))`;
export async function attributionRevision(q:Query,snapshotId:string) {
  return String((await q.query(`SELECT ${attributionRevisionSql('$1')} AS revision`,[snapshotId])).rows[0].revision);
}

/** Resolve a report's carriers together. Correlating the scalar expression per
 * snapshot can scan all integrity rows once for every newly uploaded snapshot
 * before PostgreSQL has table statistics. Keep the same three maxima and both
 * base/effective event mappings, with one set-based join for the selected scope.
 * Effective events are COALESCE(override, base): adding only matched non-null
 * overrides to every base event has the same union. These consumers only take
 * MAX, so repeated event identities do not need another deduplication sort. */
export async function attributionRevisions(q:Query,snapshotIds:string[]):Promise<Map<string,string>> {
  if(!snapshotIds.length)return new Map();
  const rows=(await q.query(`WITH carriers AS (
    SELECT snapshot_id,event_id FROM snapshot_events WHERE snapshot_id=ANY($1::uuid[])
    UNION ALL
    SELECT v.snapshot_id,v.event_id FROM event_origin_overrides v
      JOIN snapshot_events s ON s.snapshot_id=v.snapshot_id AND s.line=v.line AND s.block=v.block
      WHERE v.snapshot_id=ANY($1::uuid[]) AND v.version='original-utf8-1' AND v.event_id IS NOT NULL
  ), revisions AS (
    SELECT se.snapshot_id,MAX(c.revision) AS qualification,MAX(i.revision) AS integrity
    FROM carriers se LEFT JOIN event_qualifications c ON c.event_id=se.event_id
      LEFT JOIN event_integrity i ON i.event_id=se.event_id AND i.version='original-utf8-1'
    GROUP BY se.snapshot_id
  ), overrides AS (
    SELECT snapshot_id,MAX(revision) AS revision FROM event_origin_overrides
    WHERE snapshot_id=ANY($1::uuid[]) AND version='original-utf8-1' GROUP BY snapshot_id
  ) SELECT s.snapshot_id,(COALESCE(r.qualification,0)+COALESCE(r.integrity,0)+COALESCE(v.revision,0))::text AS revision
    FROM unnest($1::uuid[]) AS s(snapshot_id)
    LEFT JOIN revisions r USING(snapshot_id) LEFT JOIN overrides v USING(snapshot_id)`,[snapshotIds])).rows;
  return new Map(rows.map(row=>[row.snapshot_id as string,row.revision as string]));
}

/** A copied or restored prefix cannot establish original-device qualification.
 * Called only after the server has verified exact material/native lineage and
 * created this primary's immutable event mapping in the archive transaction. */
export async function qualifyOriginalEvents(q:Query,record:{id:string;device_id:string;manifest:Manifest},
  origins:{event:ActivityEvent;origin:EventOrigin}[],recordHash:(line:number)=>string) {
  if(record.manifest.restoredFrom || !record.manifest.enrolledAt) return 0;
  const eligible=origins.filter(({event,origin})=>origin.materialId && origin.deviceId===record.device_id && !origin.qualification
    && event.sourceDate===origin.sourceDate);
  if(!eligible.length)return 0;
  const rows=eligible.map(({event,origin})=>({event_id:origin.eventId,line:event.line,block:event.block??0,
    context:event.context,record_hash:recordHash(event.line)}));
  // Insert once: retries or later identical carriers do not add activity or
  // qualification revisions. Base ownership, dates and context stay immutable.
  const inserted=await q.query(`INSERT INTO event_qualifications(event_id,proof_snapshot_id,proof_line,proof_block,context,enrolled_at,record_hash)
    SELECT x.event_id,$2,x.line,x.block,x.context,$3,x.record_hash FROM jsonb_to_recordset($1::jsonb)
    AS x(event_id text,line integer,block integer,context text,record_hash text)
    JOIN archive_event_origins o ON o.event_id=x.event_id
    WHERE o.device_id=$4 AND o.material_id IS NOT NULL AND o.source=$5 AND o.source_session_id=$6
      AND NOT EXISTS(SELECT 1 FROM event_qualifications c WHERE c.event_id=x.event_id)
    ON CONFLICT(event_id,proof_snapshot_id) DO NOTHING`,[JSON.stringify(rows),record.id,record.manifest.enrolledAt,
    record.device_id,record.manifest.source,record.manifest.sourceSessionId]);
  return inserted.rowCount??0;
}
