import type pg from 'pg';
import { digest, type Database } from './database.js';
import { RawStore } from './raw-store.js';
import { HttpError } from './identities.js';
import { readEvidence } from './evidence.js';
import { activityFor } from '../../packages/activity.js';
import type { Manifest } from '../../packages/contracts/archive.js';
import type { EventOrigin, Provenance } from '../../packages/contracts/provenance.js';
import { locatedOrigin, restoredMaterial, qualifiedMaterialPrefix } from './material-provenance.js';
import { qualifyOriginalEvents, validQualificationBytes } from './qualification.js';
import {completeOriginalLines} from '../../packages/native/raw-lines.js';

type Query = Pick<Database, 'query'> | Pick<pg.PoolClient, 'query'>;
type Record = { id: string; device_id: string; manifest: Manifest; hash: string; committed_at?: Date };
const unconfirmed = '没有经过服务器字节校验的跨设备谱系；保持独立。相同文字、会话 ID 或本地用户名不能证明同一次活动。';

// Native occurrence identifiers are scoped to a bound device/source/session and
// the complete exact raw record. Identical text alone is never an event key.
function nativeKey(line: string, source: Manifest['source']): string | null {
  try {
    const value = JSON.parse(line);
    if (source === 'claude-code-cli' && typeof value.uuid === 'string' && value.uuid.length) return `uuid:${value.uuid}`;
    if (source !== 'claude-code-cli' && value.type === 'response_item' && typeof value.payload?.call_id === 'string') {
      return `call:${value.payload.type}:${value.payload.call_id}`;
    }
  } catch { /* Unsupported source lines remain raw evidence. */ }
  return null;
}
function commonCompleteLines(left: Buffer, right: Buffer) {
  let end = 0;
  while (end < Math.min(left.length, right.length) && left[end] === right[end]) end++;
  return right.subarray(0, end).toString('utf8').split('\n').length - 1;
}

export async function assignOrigins(q: Query, raw: RawStore, record: Record, backfill = false) {
  const manifest = record.manifest;
  const bytes = await raw.read(record.device_id, record.hash);
  const owner = (await q.query(`SELECT d.employee_id,e.name FROM devices d JOIN employees e ON e.id=d.employee_id WHERE d.id=$1`, [record.device_id])).rows[0];
  const claim = manifest.restoredFrom;
  let base: Record | undefined;
  let provenance: Provenance = { version: 1, relation: 'unconfirmed', sourceSnapshotId: null, warning: unconfirmed };
  let prefixLines = 0;
  let materialPrior: Awaited<ReturnType<typeof eventOrigins>> | undefined;
  let materialMappings: Awaited<ReturnType<typeof restoredMaterial>>['mappings'] = [];
  if (claim) {
    base = (await q.query('SELECT id,device_id,manifest,hash,provenance FROM snapshots WHERE id=$1', [claim.snapshotId])).rows[0];
    if (!base || (!claim.materialId && (base.hash !== claim.hash || base.manifest.byteLength !== claim.byteLength
      || base.manifest.source !== manifest.source || base.manifest.sourceSessionId !== manifest.sourceSessionId))) {
      throw new HttpError(409, '恢复来源快照不存在或来源身份不匹配；不能确认历史归属');
    }
    const material = claim.materialId ? await restoredMaterial(q, raw, base, manifest, bytes, (id, materialId) => eventOrigins(q, id, materialId)) : undefined;
    materialMappings = material?.mappings ?? [];
    materialPrior = material?.origins;
    const original = material?.original ?? await raw.read(base.device_id, base.hash);
    if (bytes.length < original.length || !bytes.subarray(0, original.length).equals(original)) {
      throw new HttpError(409, '恢复历史前缀与服务器原件不一致；原件保留，不接受归属声明');
    }
    prefixLines = commonCompleteLines(original, bytes);
    provenance = { version: 1, relation: 'verified-restoration', sourceSnapshotId: base.id, warning: material?.warning ?? null };
  } else {
    const qualified = await qualifiedMaterialPrefix(q, raw, record.device_id, manifest, bytes,
      (id, materialId) => eventOrigins(q, id, materialId), backfill ? record.committed_at : undefined);
    if (qualified?.snapshotId) { materialPrior = qualified.origins; prefixLines = commonCompleteLines(qualified.bytes, bytes);
      provenance = { version: 1, relation: 'same-device-continuation', sourceSnapshotId: qualified.snapshotId, warning: qualified.warning }; }
    else if (qualified) provenance.warning = qualified.warning;
    base = (await q.query(`SELECT id,device_id,manifest,hash FROM snapshots WHERE device_id=$1 AND source=$2 AND source_session_id=$3 AND id<>$4 AND provenance IS NOT NULL
      AND ($5::timestamptz IS NULL OR (committed_at,id)<($5::timestamptz,$4::uuid))
      ORDER BY committed_at DESC,id DESC LIMIT 1`, [record.device_id, manifest.source, manifest.sourceSessionId, record.id, backfill ? record.committed_at : null])).rows[0];
    if (base && !qualified?.snapshotId) {
      const previous = await raw.read(base.device_id, base.hash);
      prefixLines = commonCompleteLines(previous, bytes);
      provenance = { version: 1, relation: 'same-device-continuation', sourceSnapshotId: base.id,
        warning: bytes.length >= previous.length && bytes.subarray(0, previous.length).equals(previous) ? null
          : '原件发生重写或截断；只确认未变前缀和有稳定原生 ID 且字节完全相同的记录。其余记录保持独立，可能存在无法确认的重复。' };
      if (qualified?.warning) provenance.warning = [provenance.warning, qualified.warning].filter(Boolean).join(' ');
    }
  }
  const prior = materialPrior ?? (base ? await eventOrigins(q, base.id) : []);
  const prefix = new Map(prior.map(event => [`${event.line}/${event.block}`, event]));
  // Repeating a restoration claim on a later material-only revision must not
  // turn the target device's already recorded suffix into new activity again.
  let localPrefixLines = 0; const localPrefix = new Map<string, Awaited<ReturnType<typeof eventOrigins>>[number]>();
  if (claim || materialPrior) {
    const local = (await q.query(`SELECT id,device_id,hash FROM snapshots WHERE device_id=$1 AND source=$2 AND source_session_id=$3 AND id<>$4 AND provenance IS NOT NULL
      AND ($5::timestamptz IS NULL OR (committed_at,id)<($5::timestamptz,$4::uuid)) ORDER BY committed_at DESC,id DESC LIMIT 1`,
    [record.device_id, manifest.source, manifest.sourceSessionId, record.id, backfill ? record.committed_at : null])).rows[0];
    if (local) {
      localPrefixLines = commonCompleteLines(await raw.read(local.device_id, local.hash), bytes);
      for (const event of await eventOrigins(q, local.id)) localPrefix.set(`${event.line}/${event.block}`, event);
    }
  }
  const parsed = readEvidence(bytes, manifest.source);
  const events = activityFor(parsed.events, manifest.enrolledAt).events;
  const rawLines = [...completeOriginalLines(bytes)];
  const known = (await q.query(`SELECT n.occurrence_hash,o.event_id AS "eventId",o.snapshot_id AS "snapshotId",o.line,o.block,
    o.employee_id AS "employeeId",e.name AS employee,o.device_id AS "deviceId",o.project,o.context,o.source_date AS "sourceDate",o.material_id AS "materialId",o.text_offset AS "textOffset"
    FROM native_event_occurrences n JOIN effective_event_origins o ON o.event_id=n.event_id JOIN employees e ON e.id=o.employee_id
    WHERE n.device_id=$1 AND n.source=$2 AND n.source_session_id=$3`, [record.device_id, manifest.source, manifest.sourceSessionId])).rows;
  const occurrences = new Map<string, EventOrigin>(known.map(row => [row.occurrence_hash, row as EventOrigin]));
  const origins = events.map(event => {
    const block = event.block ?? 0;
    const inherited = (event.line <= prefixLines ? prefix.get(`${event.line}/${block}`) : undefined)
      ?? (event.line <= localPrefixLines ? localPrefix.get(`${event.line}/${block}`) : undefined);
    const line = rawLines[event.line - 1]!;
    const occurrence = nativeKey(line.text!, manifest.source);
    const occurrenceHash = occurrence ? digest(JSON.stringify([occurrence, digest(line.bytes), block])) : null;
    const existing = occurrenceHash ? occurrences.get(occurrenceHash) : undefined;
    if (inherited && existing && inherited.eventId !== existing.eventId) throw new HttpError(409, '稳定原生记录存在冲突的历史归属；保留原归属，不能覆盖');
    if (inherited) return { event, occurrenceHash, origin: { ...inherited, line: inherited.originLine, block: inherited.originBlock } };
    if (existing) return { event, occurrenceHash, origin: existing };
    const eventId = occurrenceHash ? digest(JSON.stringify([record.device_id, manifest.source, manifest.sourceSessionId, occurrenceHash]))
      : digest(JSON.stringify([record.id, event.line, block]));
    const origin: EventOrigin = { eventId, snapshotId: record.id, line: event.line, block,
      employeeId: owner.employee_id, employee: owner.name, deviceId: record.device_id, project: manifest.project,
      context: event.context, sourceDate: event.sourceDate };
    return { event, occurrenceHash, origin };
  });
  // Batch inserts keep the archive transaction bounded by source size, rather
  // than one database round trip per event. Event ledger and snapshot commit are atomic.
  for (let offset = 0; offset < origins.length; offset += 1000) {
    const page = origins.slice(offset, offset + 1000);
    await q.query(`INSERT INTO archive_event_origins(event_id,snapshot_id,line,block,employee_id,device_id,project,source,source_session_id,role,timestamp,source_date,context,material_id,text_offset)
      SELECT x.event_id,x.snapshot_id,x.line,x.block,x.employee_id,x.device_id,x.project,$2,$3,x.role,x.timestamp,x.source_date,x.context,x.material_id,x.text_offset
      FROM jsonb_to_recordset($1::jsonb) AS x(event_id text,snapshot_id uuid,line integer,block integer,employee_id uuid,device_id uuid,project text,role text,timestamp text,source_date text,context text,material_id text,text_offset integer)
      ON CONFLICT(event_id) DO NOTHING`, [JSON.stringify(page.map(({ event, origin }) => ({ event_id: origin.eventId, snapshot_id: origin.snapshotId,
        line: origin.line, block: origin.block, employee_id: origin.employeeId, device_id: origin.deviceId, project: origin.project,
        role: event.role, timestamp: event.timestamp, source_date: origin.sourceDate, context: origin.context,
        material_id: origin.materialId ?? null, text_offset: origin.textOffset ?? 0 }))), manifest.source, manifest.sourceSessionId]);
    await q.query(`INSERT INTO snapshot_events(snapshot_id,line,block,event_id) SELECT $2,x.line,x.block,x.event_id
      FROM jsonb_to_recordset($1::jsonb) AS x(line integer,block integer,event_id text) ON CONFLICT DO NOTHING`,
    [JSON.stringify(page.map(({ event, origin }) => ({ line: event.line, block: event.block ?? 0, event_id: origin.eventId }))), record.id]);
    await q.query(`INSERT INTO native_event_occurrences(device_id,source,source_session_id,occurrence_hash,event_id)
      SELECT $2,$3,$4,x.occurrence_hash,x.event_id FROM jsonb_to_recordset($1::jsonb) AS x(occurrence_hash text,event_id text)
      ON CONFLICT DO NOTHING`, [JSON.stringify(page.filter(item => item.occurrenceHash).map(({ origin, occurrenceHash }) => ({ occurrence_hash: occurrenceHash, event_id: origin.eventId }))),
    record.device_id, manifest.source, manifest.sourceSessionId]);
  }
  for (const mapping of materialMappings) {
    await q.query(`INSERT INTO material_qualifications(snapshot_id,material_id,device_id,source,source_session_id,hash,byte_length)
      VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`, [mapping.snapshotId, mapping.materialId, mapping.deviceId,
      manifest.source, manifest.sourceSessionId, mapping.hash, mapping.byteLength]);
    for (let offset = 0; offset < mapping.origins.length; offset += 1000) {
      await q.query(`INSERT INTO material_events(snapshot_id,material_id,line,block,event_id)
        SELECT $2,$3,x.line,x.block,x.event_id FROM jsonb_to_recordset($1::jsonb) AS x(line integer,block integer,event_id text)
        ON CONFLICT DO NOTHING`, [JSON.stringify(mapping.origins.slice(offset, offset + 1000).map(event => ({ line: event.line, block: event.block, event_id: event.eventId }))), mapping.snapshotId, mapping.materialId]);
    }
  }
  if(origins.some(({origin})=>origin.materialId&&origin.deviceId===record.device_id&&!origin.qualification)
    && await validQualificationBytes(bytes)) await qualifyOriginalEvents(q,record,origins,line=>digest(rawLines[line-1]!.bytes));
  await q.query('UPDATE snapshots SET provenance=$2 WHERE id=$1', [record.id, provenance]);
  return provenance;
}

export async function eventOrigins(q: Query, snapshotId: string, materialId?: string) {
  const rows = await q.query(`SELECT s.line,s.block,o.event_id AS "eventId",o.snapshot_id AS "snapshotId",o.line AS "originLine",o.block AS "originBlock",
    o.employee_id AS "employeeId",e.name AS employee,o.device_id AS "deviceId",o.project,o.context,o.source_date AS "sourceDate",o.material_id AS "materialId",o.text_offset AS "textOffset",
    CASE WHEN o.qualification_revision>0 THEN jsonb_build_object('revision',o.qualification_revision::text,'proofSnapshotId',o.proof_snapshot_id,
      'proofLine',o.proof_line,'proofBlock',o.proof_block,'enrolledAt',o.proof_enrolled_at) ELSE NULL END AS qualification
    FROM ${materialId ? 'material_events' : 'snapshot_events'} s JOIN effective_event_origins o ON o.event_id=s.event_id JOIN employees e ON e.id=o.employee_id
    WHERE s.snapshot_id=$1 ${materialId ? 'AND s.material_id=$2' : ''} ORDER BY s.line,s.block`, materialId ? [snapshotId, materialId] : [snapshotId]);
  // Location in this snapshot is distinct from the original location of the event.
  return (rows.rows as (EventOrigin & { originLine: number; originBlock: number })[]).map(row => {
    const original = locatedOrigin({ ...row, line: row.originLine, block: row.originBlock });
    return { ...original, line: row.line, block: row.block };
  });
}

export async function backfillOrigins(db: Database, raw: RawStore) {
  // Existing immutable snapshots have no client restoration claims. Process in
  // original commit order once; do not reinterpret every snapshot on every read.
  const client = await db.connect();
  try { while (true) {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(7402119)');
    const rows = await client.query('SELECT id,device_id,manifest,hash,committed_at FROM snapshots WHERE provenance IS NULL ORDER BY committed_at,id LIMIT 100 FOR UPDATE');
    for (const record of rows.rows) await assignOrigins(client, raw, record, true);
    await client.query('COMMIT');
    if (rows.rows.length < 100) break;
  } } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

/** Upgrade already committed original-source primaries in short durable batches.
 * No native directory is read and no unqualified session is imported. */
export async function reconcileOriginalQualifications(db: Database, raw: RawStore) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    // Same ordering as archive origin assignment; never hold the queue/report lock.
    await client.query('SELECT pg_advisory_xact_lock(7402119)');
    const cursor = (await client.query(`SELECT *,to_char(cutoff AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cutoff_time,
      to_char(last_committed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS last_time
      FROM qualification_reconcile WHERE id=1 FOR UPDATE`)).rows[0];
    if (cursor.complete) { await client.query('COMMIT'); return; }
    const rows = (await client.query(`SELECT s.id,s.device_id,s.manifest,s.hash,s.committed_at,d.enrolled_at,
      to_char(s.committed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time
      FROM snapshots s JOIN devices d ON d.id=s.device_id
      WHERE s.provenance IS NOT NULL AND NOT(s.manifest ? 'restoredFrom') AND d.enrolled_at IS NOT NULL
      AND s.committed_at<=$1 AND ($2::timestamptz IS NULL OR (s.committed_at,s.id)>($2::timestamptz,$3::uuid))
      AND EXISTS(SELECT 1 FROM snapshot_events se JOIN archive_event_origins o ON o.event_id=se.event_id
        WHERE se.snapshot_id=s.id AND o.material_id IS NOT NULL AND o.device_id=s.device_id
        AND NOT EXISTS(SELECT 1 FROM event_qualifications c WHERE c.event_id=o.event_id))
      ORDER BY s.committed_at,s.id LIMIT 2`,[cursor.cutoff_time,cursor.last_time,cursor.last_snapshot_id])).rows;
    for (const record of rows) {
      const bytes=await raw.read(record.device_id,record.hash);
      if (!await validQualificationBytes(bytes)) {
        await client.query(`INSERT INTO qualification_reconcile_gaps(snapshot_id,reason) VALUES($1,$2) ON CONFLICT DO NOTHING`,
          [record.id,'旧资格原件包含损坏的 UTF-8；原字节与归属保留，未凭替换字符追加精确资格证明']);
      } else {
        const manifest={...record.manifest,enrolledAt:record.enrolled_at.toISOString()} as Manifest;
        // Page only eligible immutable mappings. Seek their exact raw records;
        // do not expand unrelated JSON, attachments or all primary events again.
        let lastLine=0,lastBlock=-1,rawLine=1,start=0;let currentLine=0,currentEvents:ReturnType<typeof activityFor>['events']=[];
        while(true) {
          const page=(await client.query(`SELECT se.line,se.block,o.event_id AS "eventId",o.snapshot_id AS "snapshotId",o.device_id AS "deviceId",
            o.material_id AS "materialId",o.source_date AS "sourceDate",o.timestamp
            FROM snapshot_events se JOIN archive_event_origins o ON o.event_id=se.event_id
            WHERE se.snapshot_id=$1 AND o.material_id IS NOT NULL AND o.device_id=$2 AND o.source=$3 AND o.source_session_id=$4
            AND (se.line,se.block)>($5,$6) AND NOT EXISTS(SELECT 1 FROM event_qualifications c WHERE c.event_id=o.event_id)
            ORDER BY se.line,se.block LIMIT 1000`,[record.id,record.device_id,manifest.source,manifest.sourceSessionId,lastLine,lastBlock])).rows;
          if(!page.length&&lastLine===0)throw new Error(`Legacy mapping scope mismatch: ${record.id}, ${manifest.source}, ${manifest.sourceSessionId}`);
          const proofs:{event:ReturnType<typeof activityFor>['events'][number];origin:EventOrigin}[]=[];
          const hashes=new Map<number,string>();
          for(const origin of page) {
            while(rawLine<origin.line) {
              const end=bytes.indexOf(10,start);if(end<0)throw new Error('Stored qualification mapping exceeds complete raw records');start=end+1;rawLine++;
              if(rawLine%1000===0)await new Promise<void>(resolve=>setImmediate(resolve));
            }
            const end=bytes.indexOf(10,start);if(end<0)throw new Error('Stored qualification record is incomplete');
            if(currentLine!==origin.line) {
              currentEvents=activityFor(readEvidence(bytes.subarray(start,end+1),manifest.source).events,manifest.enrolledAt).events;
              currentLine=origin.line;
            }
            const event=currentEvents.find(item=>(item.block??0)===origin.block);
            if(!event||event.timestamp!==origin.timestamp||event.sourceDate!==origin.sourceDate)throw new Error('Stored qualification event does not match exact native record');
            proofs.push({event:{...event,line:origin.line},origin});hashes.set(origin.line,digest(bytes.subarray(start,end)));
          }
          const appended=await qualifyOriginalEvents(client,{...record,manifest},proofs,line=>hashes.get(line)!);
          if(proofs.length&&appended!==proofs.length)throw new Error(`Legacy qualification mapping incomplete: ${appended}/${proofs.length}`);
          if(page.length<1000)break;
          const last=page.at(-1)!;lastLine=last.line;lastBlock=last.block;
          await new Promise<void>(resolve=>setImmediate(resolve));
        }
      }
      await client.query('UPDATE qualification_reconcile SET last_committed_at=$1,last_snapshot_id=$2 WHERE id=1',[record.cursor_time,record.id]);
    }
    if(rows.length<2)await client.query('UPDATE qualification_reconcile SET complete=true WHERE id=1');
    await client.query('UPDATE qualification_reconcile SET last_error=NULL WHERE id=1');
    await client.query('COMMIT');
  } catch(error) {
    await client.query('ROLLBACK');
    await client.query("UPDATE qualification_reconcile SET last_error='旧资格后台核查未完成；原归属保留，请检查原件完整性与服务日志' WHERE id=1");
    throw error;
  } finally {client.release();}
}

// Shared deterministic event ledger counts. Reports select a bounded employee/day
// and use the activity columns; the archive view also exposes historical/unknown.
export const ledgerCountProjection = `count(*)::integer AS records,count(DISTINCT(o.snapshot_id,o.material_id,o.line)) FILTER (WHERE o.role='user')::integer AS "userTurns",
    count(*) FILTER (WHERE o.role='tool request')::integer AS "toolCalls",
    count(*) FILTER (WHERE o.context='historical')::integer AS "historicalRecords",
    count(*) FILTER (WHERE o.context IN ('unknown-time','unknown-enrollment'))::integer AS "unknownRecords",
    count(*) FILTER (WHERE o.context='after-enrollment')::integer AS "activityRecords",
    count(DISTINCT(o.snapshot_id,o.material_id,o.line)) FILTER (WHERE o.role='user' AND o.context='after-enrollment')::integer AS "activityUserTurns",
    count(*) FILTER (WHERE o.role='tool request' AND o.context='after-enrollment')::integer AS "activityToolCalls"`;

export async function archiveStatistics(db: Database, offset = 0) {
  const warnings = (await db.query(`SELECT count(*) FILTER (WHERE provenance->>'relation'='unconfirmed')::integer AS "unconfirmedRelationSnapshots",
    count(*) FILTER (WHERE provenance->>'relation'<>'unconfirmed' AND provenance->>'warning' IS NOT NULL)::integer AS "uncertainRewriteSnapshots",
    (SELECT count(*)::integer FROM qualification_reconcile_gaps) AS "qualificationGaps",
    (SELECT last_error FROM qualification_reconcile WHERE id=1) AS "qualificationError" FROM snapshots`)).rows[0];
  const rows = await db.query(`SELECT o.employee_id AS "employeeId",e.name AS employee,o.source_date AS date,
    ${ledgerCountProjection}
    FROM effective_event_origins o JOIN employees e ON e.id=o.employee_id GROUP BY o.employee_id,e.name,o.source_date
    ORDER BY e.name,o.employee_id,o.source_date NULLS LAST LIMIT 51 OFFSET $1`, [offset]);
  return { timeZone: 'Asia/Shanghai', rows: rows.rows.slice(0, 50), warnings, nextOffset: rows.rows.length > 50 ? offset + 50 : null,
    definition: '每个已确认原生事件只计一次；用户轮次按原件或材料行，工具调用按解析 block。按已确认活动、历史或关联上下文、未知分类；仅原来源独立采集且原始接入后来源时间明确的记录计活动。材料曾被保存或被他人续用不证明原来源活动；原来源后来独立采集可追加资格证明，保留原归属、日期与事件身份，重新判断活动分类。未独立采集的材料不计条目。未确认复制可能重复。不是工时、评分或排名。' };
}
