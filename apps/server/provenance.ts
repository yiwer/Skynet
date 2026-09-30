import type pg from 'pg';
import { digest, type Database } from './database.js';
import { RawStore } from './raw-store.js';
import { HttpError } from './identities.js';
import { readEvidence } from './evidence.js';
import { activityFor } from '../../packages/activity.js';
import type { Manifest } from '../../packages/contracts/archive.js';
import type { EventOrigin, Provenance } from '../../packages/contracts/provenance.js';
import { locatedOrigin, restoredMaterial, qualifiedMaterialPrefix } from './material-provenance.js';

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
  const rawLines = bytes.toString('utf8').split('\n');
  const known = (await q.query(`SELECT n.occurrence_hash,o.event_id AS "eventId",o.snapshot_id AS "snapshotId",o.line,o.block,
    o.employee_id AS "employeeId",e.name AS employee,o.device_id AS "deviceId",o.project,o.context,o.source_date AS "sourceDate",o.material_id AS "materialId",o.text_offset AS "textOffset"
    FROM native_event_occurrences n JOIN archive_event_origins o ON o.event_id=n.event_id JOIN employees e ON e.id=o.employee_id
    WHERE n.device_id=$1 AND n.source=$2 AND n.source_session_id=$3`, [record.device_id, manifest.source, manifest.sourceSessionId])).rows;
  const occurrences = new Map<string, EventOrigin>(known.map(row => [row.occurrence_hash, row as EventOrigin]));
  const origins = events.map(event => {
    const block = event.block ?? 0;
    const inherited = (event.line <= prefixLines ? prefix.get(`${event.line}/${block}`) : undefined)
      ?? (event.line <= localPrefixLines ? localPrefix.get(`${event.line}/${block}`) : undefined);
    const line = rawLines[event.line - 1]!;
    const occurrence = nativeKey(line, manifest.source);
    const occurrenceHash = occurrence ? digest(JSON.stringify([occurrence, digest(line), block])) : null;
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
  await q.query('UPDATE snapshots SET provenance=$2 WHERE id=$1', [record.id, provenance]);
  return provenance;
}

export async function eventOrigins(q: Query, snapshotId: string, materialId?: string) {
  const rows = await q.query(`SELECT s.line,s.block,o.event_id AS "eventId",o.snapshot_id AS "snapshotId",o.line AS "originLine",o.block AS "originBlock",
    o.employee_id AS "employeeId",e.name AS employee,o.device_id AS "deviceId",o.project,o.context,o.source_date AS "sourceDate",o.material_id AS "materialId",o.text_offset AS "textOffset"
    FROM ${materialId ? 'material_events' : 'snapshot_events'} s JOIN archive_event_origins o ON o.event_id=s.event_id JOIN employees e ON e.id=o.employee_id
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

export async function archiveStatistics(db: Database, offset = 0) {
  const warnings = (await db.query(`SELECT count(*) FILTER (WHERE provenance->>'relation'='unconfirmed')::integer AS "unconfirmedRelationSnapshots",
    count(*) FILTER (WHERE provenance->>'relation'<>'unconfirmed' AND provenance->>'warning' IS NOT NULL)::integer AS "uncertainRewriteSnapshots" FROM snapshots`)).rows[0];
  const rows = await db.query(`SELECT o.employee_id AS "employeeId",e.name AS employee,o.source_date AS date,
    count(*)::integer AS records,count(DISTINCT(o.snapshot_id,o.material_id,o.line)) FILTER (WHERE o.role='user')::integer AS "userTurns",
    count(*) FILTER (WHERE o.role='tool request')::integer AS "toolCalls",
    count(*) FILTER (WHERE o.context='historical')::integer AS "historicalRecords",
    count(*) FILTER (WHERE o.context IN ('unknown-time','unknown-enrollment'))::integer AS "unknownRecords",
    count(*) FILTER (WHERE o.context='after-enrollment')::integer AS "activityRecords",
    count(DISTINCT(o.snapshot_id,o.material_id,o.line)) FILTER (WHERE o.role='user' AND o.context='after-enrollment')::integer AS "activityUserTurns",
    count(*) FILTER (WHERE o.role='tool request' AND o.context='after-enrollment')::integer AS "activityToolCalls"
    FROM archive_event_origins o JOIN employees e ON e.id=o.employee_id GROUP BY o.employee_id,e.name,o.source_date
    ORDER BY e.name,o.employee_id,o.source_date NULLS LAST LIMIT 51 OFFSET $1`, [offset]);
  return { timeZone: 'Asia/Shanghai', rows: rows.rows.slice(0, 50), warnings, nextOffset: rows.rows.length > 50 ? offset + 50 : null,
    definition: '每个已确认原生事件只计一次；用户轮次按原件或材料行，工具调用按解析 block。按已确认活动、历史或关联上下文、未知分类；仅独立采集且原始接入后来源时间明确的记录计活动。材料曾被保存不证明独立活动，确认续用的旧材料记录保留来源日期并计历史或未知；未独立采集的材料不计条目。未确认复制可能重复。不是工时、评分或排名。' };
}
