import type pg from 'pg';
import {digest,type Database} from './database.js';
import {RawStore} from './raw-store.js';
import {decodeOriginalLine,originalByteLines} from '../../packages/native/raw-lines.js';
import {nativeKey} from '../../packages/native/occurrences.js';
import {readEvidence} from './evidence.js';
import {activityFor} from '../../packages/activity.js';
type Query=Pick<Database,'query'>|Pick<pg.PoolClient,'query'>;
export const integrityVersion='original-utf8-1';

/** Append exact-original validity proofs; never change the immutable ledger.
 * Pending legacy rows cannot contribute current counts until verified. */
export async function verifyOriginIntegrity(q:Query,raw:RawStore,ids:string[]){
  const cache=new Map<string,Buffer>();let cachedBytes=0;
  const scans=new Map<string,{iterator:ReturnType<typeof originalByteLines>;line:number}>();
  for(let offset=0;offset<ids.length;offset+=1000){
    const rows=(await q.query(`SELECT o.event_id,o.device_id,o.line,o.material_id,s.hash,s.manifest FROM archive_event_origins o
      JOIN snapshots s ON s.id=o.snapshot_id WHERE o.event_id=ANY($1::text[])
      AND NOT EXISTS(SELECT 1 FROM event_integrity i WHERE i.event_id=o.event_id AND i.version=$2) ORDER BY o.event_id`,[ids.slice(offset,offset+1000),integrityVersion])).rows;
    const groups=new Map<string,{device:string;hash:string;rows:typeof rows}>();
    for(const row of rows){const material=row.material_id?row.manifest.capture?.materials?.find((item:any)=>item.id===row.material_id):undefined;
      const hash=row.material_id?material?.hash:row.hash;if(typeof hash!=='string')throw new Error('Original integrity material descriptor missing');
      const key=`${row.device_id}:${hash}`;let group=groups.get(key);if(!group){group={device:row.device_id,hash,rows:[]};groups.set(key,group);}group.rows.push(row);}
    for(const [key,group]of groups){let bytes=cache.get(key);if(!bytes){bytes=await raw.read(group.device,group.hash);if(cachedBytes+bytes.length>128*1024*1024){cache.clear();scans.clear();cachedBytes=0;}cache.set(key,bytes);cachedBytes+=bytes.length;}
      const requested=new Set<number>(group.rows.map(row=>row.line)),checked=new Map<number,{valid:boolean;hash:string}>();
      const first=Math.min(...requested),last=Math.max(...requested);let scan=scans.get(key);
      // Normal capture pages are in original line order. Retain only the raw
      // iterator, not a per-line decoded/hash cache; scan a large primary once.
      if(!scan||first<=scan.line){scan={iterator:originalByteLines(bytes),line:0};scans.set(key,scan);}
      while(scan.line<last){const next=scan.iterator.next();if(next.done)break;const line=next.value;scan.line=line.line;
        if(requested.has(line.line))checked.set(line.line,{valid:decodeOriginalLine(line.bytes)!==null,hash:digest(line.bytes)});
        if(line.line%1000===0)await new Promise<void>(resolve=>setImmediate(resolve));}
      const proof=group.rows.map(row=>{const line=checked.get(row.line);return {event_id:row.event_id,valid:line?.valid??false,record_hash:line?.hash??null,reason:line?(line.valid?null:'invalid-utf8'):'missing-complete-original-line'};});
      await q.query(`INSERT INTO event_integrity(event_id,version,valid,record_hash,reason)
        SELECT x.event_id,$2,x.valid,x.record_hash,x.reason FROM jsonb_to_recordset($1::jsonb)
        AS x(event_id text,valid boolean,record_hash text,reason text) ORDER BY x.event_id ON CONFLICT(event_id,version) DO NOTHING`,[JSON.stringify(proof),integrityVersion]);
    }
  }
}
export async function verifySnapshotIntegrity(q:Query,raw:RawStore,id:string,materialId?:string){
  const ids=(await q.query(`SELECT DISTINCT event_id FROM ${materialId?'material_events':'snapshot_events'} WHERE snapshot_id=$1 ${materialId?'AND material_id=$2':''}`,
    materialId?[id,materialId]:[id])).rows.map(row=>row.event_id as string);
  await verifyOriginIntegrity(q,raw,ids);
  if(!materialId)await repairLegacyCarriers(q,raw,id);
}

/** A confirmed legacy decoded-byte collision may be repaired only using an
 * exact, independently registered normal primary from the same source/device.
 * The old origin and old carrier mappings remain immutable. */
type SourceScope={deviceId:string;source:string;sessionId:string};
async function repairCarriers(q:Query,raw:RawStore,snapshotId?:string,scope?:SourceScope){
  const rows=(await q.query(`SELECT se.snapshot_id,se.line,se.block,se.event_id,s.device_id,s.hash,s.manifest,s.committed_at,
    o.device_id AS original_device,o.source AS original_source,o.source_session_id AS original_session,o.material_id,
    d.employee_id,d.enrolled_at,n.occurrence_hash FROM snapshot_events se
    JOIN snapshots s ON s.id=se.snapshot_id JOIN devices d ON d.id=s.device_id
    JOIN archive_event_origins o ON o.event_id=se.event_id JOIN event_integrity i ON i.event_id=o.event_id AND i.version=$1 AND NOT i.valid
    JOIN native_event_occurrences n ON n.event_id=o.event_id AND n.device_id=s.device_id AND n.source=s.source AND n.source_session_id=s.source_session_id
    WHERE ($2::uuid IS NULL OR s.id=$2) AND ($3::uuid IS NULL OR (s.device_id=$3 AND s.source=$4 AND s.source_session_id=$5))
      AND NOT EXISTS(SELECT 1 FROM event_origin_overrides v WHERE v.snapshot_id=se.snapshot_id AND v.line=se.line AND v.block=se.block AND v.version=$1)
    ORDER BY s.committed_at,s.id,se.line,se.block LIMIT 1000`,[integrityVersion,snapshotId??null,scope?.deviceId??null,scope?.source??null,scope?.sessionId??null])).rows;
  const groups=new Map<string,typeof rows>();
  for(const row of rows){const object=`${row.device_id}:${row.hash}`;if(!groups.has(object)){if(groups.size===2)continue;groups.set(object,[]);}groups.get(object)!.push(row);}
  for(const group of groups.values()){
    const bytes=await raw.read(group[0].device_id,group[0].hash),requested=new Set<number>(group.map(row=>row.line)),records=new Map<number,Buffer>();
    for(const line of originalByteLines(bytes)){if(requested.has(line.line))records.set(line.line,line.bytes);if(line.line%1000===0)await new Promise<void>(resolve=>setImmediate(resolve));}
    for(const row of group){const record=records.get(row.line);
    const text=record?decodeOriginalLine(record):null,key=text===null?null:nativeKey(text,row.manifest.source);
    const hash=record?digest(record):null,occurrence=key&&hash?digest(JSON.stringify([key,hash,row.block])):null;
    const event=record?readEvidence(Buffer.concat([record,Buffer.from('\n')]),row.manifest.source).events.find(event=>(event.block??0)===row.block):undefined;
    const normal=!row.manifest.restoredFrom&&!row.material_id&&row.device_id===row.original_device&&row.manifest.source===row.original_source&&row.manifest.sourceSessionId===row.original_session
      &&row.manifest.enrolledAt&&Date.parse(row.manifest.enrolledAt)===new Date(row.enrolled_at).getTime();
    let eventId:string|null=null,reason='unverified-legacy-carrier';
    if(normal&&event&&occurrence===row.occurrence_hash){
      const salted=digest(JSON.stringify([key,hash,row.block,integrityVersion]));
      eventId=digest(JSON.stringify([row.device_id,row.manifest.source,row.manifest.sourceSessionId,salted]));
      const classified=activityFor([event],row.manifest.enrolledAt).events[0]!;
      await q.query(`INSERT INTO archive_event_origins(event_id,snapshot_id,line,block,employee_id,device_id,project,source,source_session_id,role,timestamp,source_date,context)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT DO NOTHING`,
        [eventId,row.snapshot_id,row.line,row.block,row.employee_id,row.device_id,row.manifest.project,row.manifest.source,row.manifest.sourceSessionId,event.role,event.timestamp,classified.sourceDate,classified.context]);
      await q.query(`INSERT INTO native_event_occurrences(device_id,source,source_session_id,occurrence_hash,event_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
        [row.device_id,row.manifest.source,row.manifest.sourceSessionId,salted,eventId]);
      await q.query(`INSERT INTO event_integrity(event_id,version,valid,record_hash) VALUES($1,$2,true,$3) ON CONFLICT DO NOTHING`,[eventId,integrityVersion,hash]);
      reason='exact-normal-native-carrier';
    }
    await q.query(`INSERT INTO event_origin_overrides(snapshot_id,line,block,version,event_id,record_hash,reason) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
      [row.snapshot_id,row.line,row.block,integrityVersion,eventId,hash,reason]);
    }
  }
}
export async function repairLegacyCarriers(q:Query,raw:RawStore,snapshotId?:string,scope?:SourceScope){
  // PoolClient also has connect(); release identifies an already borrowed
  // transaction connection. Never reconnect it or start a nested transaction.
  if('connect' in q&&!('release' in q)){const client=await (q as Database).connect();try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(7402119)');await repairCarriers(client,raw,snapshotId,scope);await client.query('COMMIT');}
    catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}}
  else await repairCarriers(q,raw,snapshotId,scope);
}
/** Missing proofs are a durable work queue. Two original objects /1000 rows per
 * tick, at most128MiB of raw, no host-directory scan or historical re-upload. */
export async function reconcileOriginIntegrity(q:Query,raw:RawStore){
  const rows=(await q.query(`SELECT o.event_id,o.device_id,COALESCE(m.value->>'hash',s.hash) AS hash FROM archive_event_origins o
    JOIN snapshots s ON s.id=o.snapshot_id LEFT JOIN LATERAL jsonb_array_elements(s.manifest->'capture'->'materials')m(value) ON m.value->>'id'=o.material_id
    WHERE NOT EXISTS(SELECT 1 FROM event_integrity i WHERE i.event_id=o.event_id AND i.version=$1) ORDER BY o.event_id LIMIT 1000`,[integrityVersion])).rows;
  const objects=new Set<string>(),ids:string[]=[];
  for(const row of rows){const key=`${row.device_id}:${row.hash}`;if(!objects.has(key)&&objects.size===2)continue;objects.add(key);ids.push(row.event_id);}
  await verifyOriginIntegrity(q,raw,ids);
  await repairLegacyCarriers(q,raw);
}
