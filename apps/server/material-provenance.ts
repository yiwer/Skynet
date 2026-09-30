import type pg from 'pg';
import { digest, type Database } from './database.js';
import { HttpError } from './identities.js';
import { RawStore } from './raw-store.js';
import { readEvidence } from './evidence.js';
import { activityFor } from '../../packages/activity.js';
import type { Manifest } from '../../packages/contracts/archive.js';
import type { EventOrigin, Provenance } from '../../packages/contracts/provenance.js';
import { evidenceLink } from '../../packages/contracts/search.js';

type Query = Pick<Database, 'query'> | Pick<pg.PoolClient, 'query'>;
type OriginRows = (EventOrigin & { originLine: number; originBlock: number })[];
type LoadOrigins = (id: string, materialId?: string) => Promise<OriginRows>;
export type MaterialSource = { id: string; device_id: string; manifest: Manifest; provenance?: Provenance | null };

/** Follow only a committed, verified chain and an identical native material descriptor. */
export async function materialSource(q: Query, record: MaterialSource, materialId: string) {
  const selected = record.manifest.capture?.materials.find(item => item.id === materialId);
  if (!selected) throw new HttpError(409, '来源快照没有该材料');
  let origin = record; const visited = new Set<string>(); let warning: string | null = null;
  for (let depth = 0; depth < 32; depth++) {
    visited.add(origin.id);
    const sourceId = origin.provenance?.sourceSnapshotId;
    if (!sourceId || visited.has(sourceId)) break;
    const prior = (await q.query('SELECT id,device_id,manifest,provenance FROM snapshots WHERE id=$1', [sourceId])).rows[0] as MaterialSource | undefined;
    const candidate = prior?.manifest.capture?.materials.find(item => item.id === selected.id && item.role === selected.role
      && item.sourceSessionId === selected.sourceSessionId && item.hash === selected.hash && item.byteLength === selected.byteLength);
    if (!prior || !candidate) break;
    origin = prior;
    if (depth === 31) warning = '关联材料谱系超过 32 层，更早历史未确认；可能存在重复。';
  }
  return { origin, material: selected, warning };
}

export function locatedOrigin<T extends EventOrigin>(origin: T): T {
  const location = origin.materialId ? { kind: 'material' as const, materialId: origin.materialId, textOffset: origin.textOffset ?? 0 }
    : { kind: 'raw' as const, line: origin.line, textOffset: 0 };
  return { ...origin, location, webPath: evidenceLink(origin.snapshotId, location) };
}

/** Native identity must come from committed bytes, not the client declaration. */
function nativeIdentity(bytes: Buffer, source: Manifest['source'], sessionId: string) {
  const rows = bytes.toString('utf8').split('\n').filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return null; } });
  if (source !== 'claude-code-cli') return rows[0]?.type === 'session_meta' && rows[0]?.payload?.id === sessionId;
  const identified = rows.filter(row => row?.type === 'user' || row?.type === 'assistant');
  return identified.length > 0 && identified.every(row => row.sessionId === sessionId && typeof row.uuid === 'string');
}

export async function restoredMaterial(q: Query, raw: RawStore, base: MaterialSource, manifest: Manifest, bytes: Buffer,
  loadOrigins: LoadOrigins) {
  const claim = manifest.restoredFrom!;
  const { origin, material, warning: sourceWarning } = await materialSource(q, base, claim.materialId!);
  if (base.manifest.source !== manifest.source || material.hash !== claim.hash || material.byteLength !== claim.byteLength
    || material.sourceSessionId !== manifest.sourceSessionId || material.mediaType !== 'jsonl'
    || material.placement !== (manifest.source === 'claude-code-cli' ? 'claude-session' : 'codex-rollout')
    || !['parent-transcript', 'child-transcript', 'previous-transcript', 'subagent'].includes(material.role)) {
    throw new HttpError(409, '恢复材料来源身份或完整长度不匹配');
  }
  const original = await raw.read(origin.device_id, material.hash);
  if (!nativeIdentity(original, manifest.source, manifest.sourceSessionId) || original.length !== claim.byteLength
    || original.at(-1) !== 10 || bytes.length < original.length || !bytes.subarray(0, original.length).equals(original)) {
    throw new HttpError(409, '恢复材料的原生身份或完整前缀不能验证；原件保留');
  }
  // Related material itself can grow while the restored parent is being captured.
  // Walk only its verified parent chain, proving complete native prefixes at each
  // step; never give the later capturer ownership of a previously proven prefix.
  const history = [{ origin, bytes: original }]; const visited = new Set([origin.id]); let warning = sourceWarning;
  let checkedBytes = original.length;
  for (let depth = 0; depth < 32; depth++) {
    const current = history.at(-1)!; const sourceId = current.origin.provenance?.sourceSnapshotId;
    if (!sourceId || visited.has(sourceId)) break;
    visited.add(sourceId);
    const prior = (await q.query('SELECT id,device_id,manifest,provenance FROM snapshots WHERE id=$1', [sourceId])).rows[0] as MaterialSource | undefined;
    const candidate = prior?.manifest.capture?.materials.find(item => item.id === material.id && item.role === material.role && item.sourceSessionId === material.sourceSessionId);
    if (!prior || !candidate) break;
    if ((checkedBytes += candidate.byteLength) > 128 * 1024 * 1024) { warning = '关联材料历史校验达到字节上限，更早历史未确认；可能存在重复。'; break; }
    const previous = await raw.read(prior.device_id, candidate.hash);
    if (previous.at(-1) !== 10 || !nativeIdentity(previous, manifest.source, manifest.sourceSessionId)
      || current.bytes.length < previous.length || !current.bytes.subarray(0, previous.length).equals(previous)) {
      warning = '关联材料曾重写或截断；未验证此前材料与当前记录是同一次活动，保持独立来源，可能有重复。'; break;
    }
    history.push({ origin: prior, bytes: previous });
    if (depth === 31) warning = '关联材料谱系超过 32 层，更早历史未确认；可能存在重复。';
  }
  const mappings: { snapshotId: string; materialId: string; deviceId: string; hash: string; byteLength: number; origins: OriginRows }[] = [];
  let origins: OriginRows = []; let previousLines = 0;
  for (const segment of history.reverse()) {
    // Freeze the first event identity/ownership mapping. A later original-device
    // primary can append a separate qualification proof without recreating it.
    const frozen = (await q.query('SELECT 1 FROM material_qualifications WHERE snapshot_id=$1 AND material_id=$2', [segment.origin.id, material.id])).rowCount;
    const exact = frozen ? { rows: [] } : await q.query(`SELECT p.id,p.hash,(p.manifest->>'byteLength')::integer AS byte_length FROM snapshots p JOIN snapshots m ON m.id=$4
      WHERE p.device_id=$1 AND p.source=$2 AND p.source_session_id=$3 AND p.hash=$5 AND p.provenance IS NOT NULL
      AND (p.committed_at,p.id)<=(m.committed_at,m.id) ORDER BY p.committed_at,p.id LIMIT 1`,
    [segment.origin.device_id, manifest.source, manifest.sourceSessionId, segment.origin.id, digest(segment.bytes)]);
    const candidates = frozen ? { rows: [] } : exact.rows.length ? exact : await q.query(`SELECT p.id,p.hash,(p.manifest->>'byteLength')::integer AS byte_length FROM snapshots p JOIN snapshots m ON m.id=$4
      WHERE p.device_id=$1 AND p.source=$2 AND p.source_session_id=$3 AND p.provenance IS NOT NULL
      AND (p.committed_at,p.id)<=(m.committed_at,m.id) AND (p.manifest->>'byteLength')::integer >= $5
      ORDER BY p.committed_at,p.id LIMIT 33`,
    [segment.origin.device_id, manifest.source, manifest.sourceSessionId, segment.origin.id, segment.bytes.length]);
    let qualified: OriginRows = frozen ? await loadOrigins(segment.origin.id, material.id) : [];
    if (candidates.rows.length > 32) warning = '同源主会话候选超过 32 个，只核对有界候选；尚未确认的历史可能存在重复。';
    for (const candidate of candidates.rows.slice(0, 32)) {
      if (checkedBytes + candidate.byte_length > 128 * 1024 * 1024) { warning = '同源原件校验达到字节上限，未扫描的历史未确认；可能存在重复。'; break; }
      const primary = await raw.read(segment.origin.device_id, candidate.hash);
      checkedBytes += primary.length;
      if (checkedBytes > 128 * 1024 * 1024) { warning = '同源原件校验达到字节上限，未扫描的历史未确认；可能存在重复。'; break; }
      if (primary.length >= segment.bytes.length && primary.subarray(0, segment.bytes.length).equals(segment.bytes)) {
        qualified = await loadOrigins(candidate.id); break;
      }
    }
    const known = new Map(qualified.map(event => [`${event.line}/${event.block}`, event]));
    const inherited = new Map(origins.map(event => [`${event.line}/${event.block}`, event]));
    const owner = (await q.query('SELECT d.employee_id,e.name FROM devices d JOIN employees e ON e.id=d.employee_id WHERE d.id=$1', [segment.origin.device_id])).rows[0];
    const lines = segment.bytes.toString('utf8').split('\n'); const offsets: number[] = []; let offset = 0;
    for (const line of lines) { offsets.push(offset); offset += line.length + 1; }
    origins = activityFor(readEvidence(segment.bytes, manifest.source).events, undefined).events.map(event => {
      const key = `${event.line}/${event.block ?? 0}`;
      const proven = (event.line <= previousLines ? inherited.get(key) : undefined) ?? known.get(key);
      if (proven) return proven;
      return locatedOrigin({ eventId: digest(JSON.stringify(['material', segment.origin.id, material.id, event.line, event.block ?? 0])),
        snapshotId: segment.origin.id, materialId: material.id, textOffset: offsets[event.line - 1]!,
        line: event.line, block: event.block ?? 0, originLine: event.line, originBlock: event.block ?? 0,
        employeeId: owner.employee_id, employee: owner.name, deviceId: segment.origin.device_id, project: segment.origin.manifest.project,
        context: event.sourceDate ? 'historical' as const : 'unknown-time' as const, sourceDate: event.sourceDate });
    });
    previousLines = lines.length - 1;
    mappings.push({ snapshotId: segment.origin.id, materialId: material.id, deviceId: segment.origin.device_id,
      hash: digest(segment.bytes), byteLength: segment.bytes.length, origins });
  }
  return { original, origins, warning, mappings };
}

/** Only materials already qualified through verified restoration participate.
 * Plain context capture never seeds employee activity or automatic attribution. */
export async function qualifiedMaterialPrefix(q: Query, raw: RawStore, deviceId: string, manifest: Manifest, bytes: Buffer, loadOrigins: LoadOrigins, before?: Date) {
  const rows = await q.query(`SELECT snapshot_id,material_id,hash,byte_length FROM material_qualifications
    WHERE device_id=$1 AND source=$2 AND source_session_id=$3 AND byte_length<=$4 AND ($6::timestamptz IS NULL OR qualified_at<=$6)
    ORDER BY (hash=$5) DESC,qualified_at,snapshot_id,material_id LIMIT 33`, [deviceId, manifest.source, manifest.sourceSessionId, bytes.length, digest(bytes), before ?? null]);
  let readBytes = 0;
  let bounded = rows.rows.length > 32;
  for (const row of rows.rows.slice(0, 32)) {
    if ((readBytes += row.byte_length) > 128 * 1024 * 1024) { bounded = true; break; }
    const original = await raw.read(deviceId, row.hash);
    if (bytes.subarray(0, original.length).equals(original)) return { snapshotId: row.snapshot_id, bytes: original,
      origins: await loadOrigins(row.snapshot_id, row.material_id), warning: rows.rows.length > 32 ? '已核对限定材料前缀，更早未扫描历史可能存在重复。' : null };
  }
  return bounded ? { snapshotId: null, bytes: Buffer.alloc(0), origins: [], warning: '已确认材料的候选校验达到上限，当前原件未确认匹配；保持独立，可能有重复。' } : null;
}
