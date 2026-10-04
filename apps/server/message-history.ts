import type pg from 'pg';
import {HttpError} from './identities.js';
import type {Manifest} from '../../packages/contracts/archive.js';

/** Only server-verified ancestry can carry a beginning forward. A later append
 * or materials-only capture cannot erase an earlier lost-prefix boundary. */
export async function messageHistoryProofs(client:pg.PoolClient,ids:string[]):Promise<Map<string,boolean>>{
  const records=(await client.query(`WITH RECURSIVE history(id) AS (
    SELECT id FROM snapshots WHERE id=ANY($1::uuid[])
    UNION SELECT p.id FROM history h JOIN snapshots s ON s.id=h.id JOIN snapshots p ON p.id=(s.provenance->>'sourceSnapshotId')::uuid
      WHERE s.provenance->>'relation' IN ('same-device-continuation','verified-restoration')
  ) SELECT s.id,s.manifest,s.provenance,EXISTS(SELECT 1 FROM snapshots earlier
      WHERE earlier.device_id=s.device_id AND earlier.source=s.source AND earlier.source_session_id=s.source_session_id
      AND (earlier.committed_at,earlier.id)<=(s.committed_at,s.id)
      AND (earlier.manifest->'capture'->>'change' IN ('rewrite','truncate') OR earlier.manifest->'capture'->>'compacted'='true')) AS lost
    FROM history h JOIN snapshots s ON s.id=h.id LIMIT 20001`,[ids])).rows as {id:string;manifest:Manifest;provenance:{relation:string;sourceSnapshotId?:string;warning?:string}|null;lost:boolean}[];
  if(records.length>20000)throw new HttpError(413,'提示词历史超过范围上限');
  const byId=new Map(records.map(row=>[row.id,row])),proofs=new Map<string,boolean>();
  function complete(id:string,seen=new Set<string>()):boolean{const cached=proofs.get(id);if(cached!==undefined)return cached;
    if(seen.has(id)||seen.size>=128)return false;seen.add(id);const row=byId.get(id);if(!row)return false;
    const capture=row.manifest.capture,relation=row.provenance?.relation;
    let valid=!row.lost&&!capture?.compacted&&!['rewrite','truncate'].includes(capture?.change??'')&&!capture?.gaps.some(gap=>gap.code==='history-unavailable'||gap.code==='native-mapping-unverified');
    const trusted=relation==='same-device-continuation'||relation==='verified-restoration';
    if(valid&&trusted)valid=!row.provenance?.warning&&!!row.provenance?.sourceSnapshotId&&complete(row.provenance.sourceSnapshotId,seen);
    else if(valid&&capture&&['append','materials'].includes(capture.change))valid=false;
    proofs.set(id,valid);return valid;}
  for(const id of ids)complete(id);return proofs;
}
