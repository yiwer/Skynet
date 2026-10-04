import type pg from 'pg';
import { digest, type Database } from './database.js';
import { RawStore } from './raw-store.js';
import { HttpError } from './identities.js';
import { eventOrigins, independentOriginReason } from './provenance.js';
import { readDeliveryObservation } from './delivery-receipts.js';
import { assemblyQuery, assemblyReadQuery, processingQuery, type ProcessingPage, type AssemblyAudit, type AssemblySource, type AssemblySummary } from '../../packages/contracts/assembly.js';
import type { MetricsService } from './metrics.js';
import type { Manifest } from '../../packages/contracts/archive.js';
import type { Provenance } from '../../packages/contracts/provenance.js';
import { inputIntegrityVersion, primaryInputCoverage } from './evidence-integrity.js';

type Query = Pick<Database, 'query'> | Pick<pg.PoolClient, 'query'>;
type Base = Omit<AssemblyAudit, 'version' | 'transport' | 'delivery' | 'nextOffset' | 'integrity'>;
export const assemblyRuleVersion = `assembly-2/origin-1/${inputIntegrityVersion}`;
export async function migrateAssembly(db: Database) {
  const transaction = await db.connect();
  try {
  await transaction.query('BEGIN; SELECT pg_advisory_xact_lock(7402135)');
  await transaction.query(`CREATE TABLE IF NOT EXISTS assembly_transports (
    id bigserial PRIMARY KEY, device_id uuid NOT NULL REFERENCES devices(id), hash text NOT NULL,
    kind text NOT NULL, duplicate boolean NOT NULL, snapshot_id uuid REFERENCES snapshots(id), observed_at timestamptz NOT NULL DEFAULT clock_timestamp());
    CREATE INDEX IF NOT EXISTS assembly_transports_artifact ON assembly_transports(device_id,hash,kind);
    CREATE INDEX IF NOT EXISTS assembly_transports_snapshot ON assembly_transports(snapshot_id);
    CREATE TABLE IF NOT EXISTS assembly_recipes (device_id uuid NOT NULL, hash text NOT NULL, parts jsonb NOT NULL, PRIMARY KEY(device_id,hash));
    CREATE TABLE IF NOT EXISTS assembly_records (snapshot_id uuid PRIMARY KEY REFERENCES snapshots(id), payload jsonb NOT NULL);
    CREATE TABLE IF NOT EXISTS assembly_versions (snapshot_id uuid NOT NULL REFERENCES snapshots(id), version text NOT NULL, payload jsonb NOT NULL,
      PRIMARY KEY(snapshot_id,version));
    CREATE TABLE IF NOT EXISTS processing_observer (id integer PRIMARY KEY CHECK(id=1), started_at timestamptz NOT NULL DEFAULT now());
    INSERT INTO processing_observer(id) VALUES(1) ON CONFLICT DO NOTHING;
    CREATE TABLE IF NOT EXISTS processing_versions(version text PRIMARY KEY,date text NOT NULL,payload jsonb NOT NULL);`);
  await transaction.query('COMMIT');
  } catch (error) { await transaction.query('ROLLBACK'); throw error; } finally { transaction.release(); }
}
export async function observeAssemblyTransport(q: Query, deviceId: string, hash: string, kind: 'chunk' | 'commit', duplicate: boolean, snapshotId?: string) {
  await q.query('INSERT INTO assembly_transports(device_id,hash,kind,duplicate,snapshot_id) VALUES($1,$2,$3,$4,$5)', [deviceId, hash, kind, duplicate, snapshotId ?? null]);
}
export async function recordAssemblyRecipe(q: Query, deviceId: string, hash: string, parts: string[]) {
  await q.query('INSERT INTO assembly_recipes(device_id,hash,parts) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [deviceId, hash, JSON.stringify(parts)]);
}
async function artifactChunks(q: Query, deviceId: string, hash: string): Promise<string[] | null> {
  const rows = (await q.query(`WITH RECURSIVE recipes AS (
    SELECT hash,parts FROM assembly_recipes WHERE device_id=$1 AND hash=$2
    UNION SELECT child.hash,child.parts FROM recipes r CROSS JOIN LATERAL jsonb_array_elements_text(r.parts) part
      JOIN assembly_recipes child ON child.device_id=$1 AND child.hash=part.value WHERE child.hash<>r.hash)
    SELECT hash,parts FROM recipes LIMIT 20001`, [deviceId, hash])).rows;
  if (rows.length > 20000) throw new HttpError(413, '原件分块谱系超过单次读取上限');
  const recipes = new Map(rows.map(row => [row.hash, row.parts as string[]])), result: string[] = [];
  const stack: { hash: string; ancestors: Set<string> }[] = [{ hash, ancestors: new Set() }];
  while (stack.length) {
    const current = stack.pop()!;
    if (current.ancestors.has(current.hash)) throw new HttpError(409, '分块谱系出现循环');
    const parts = recipes.get(current.hash);
    if (!parts || parts.length === 1 && parts[0] === current.hash) result.push(current.hash);
    else { const ancestors = new Set([...current.ancestors, current.hash]); for (const part of parts) stack.push({ hash: part, ancestors }); }
    if (stack.length + result.length > 20000) throw new HttpError(413, '原件分块谱系超过单次读取上限');
  }
  if (!rows.length && !(await q.query("SELECT 1 FROM assembly_transports WHERE device_id=$1 AND hash=$2 AND kind='chunk' LIMIT 1", [deviceId, hash])).rowCount) return null;
  return result;
}
export async function recordAssembly(q: Query, raw: RawStore, snapshotId: string, origin: Base['origin'] = 'commit') {
  const row = (await q.query(`SELECT s.*,d.employee_id,e.name AS employee,a.payload AS previous FROM snapshots s JOIN devices d ON d.id=s.device_id JOIN employees e ON e.id=d.employee_id LEFT JOIN assembly_records a ON a.snapshot_id=s.id WHERE s.id=$1`, [snapshotId])).rows[0];
  if (!row) throw new HttpError(404, '快照不存在');
  const manifest = row.manifest as Manifest, provenance = row.provenance as Provenance;
  const origins = await eventOrigins(q, snapshotId);
  const unique = new Map(origins.map(item => [item.eventId, item]));
  const bytes = await raw.read(row.device_id, row.hash);
  let compactSummaries = 0;
  for (const line of bytes.toString('utf8').split('\n')) {
    try { const item = JSON.parse(line); if (item.isCompactSummary === true || item.type === 'compacted') compactSummaries++; } catch { /* Unreadable original lines remain visible as gaps. */ }
  }
  const coverage = primaryInputCoverage(bytes,manifest.source);
  const sources: AssemblySource[] = [];
  for (const material of [{ ...manifest, name: '主会话原件', role: 'primary', id: null }, ...(manifest.capture?.materials ?? [])]) {
    const chunks = await artifactChunks(q, row.device_id, material.hash);
    sources.push({ name: material.name, role: material.role, materialId: material.id, hash: material.hash, byteLength: material.byteLength,
      chunkCount: chunks ? chunks.length : null, webPath: material.id ? `#${snapshotId}?kind=material&materialId=${material.id}&textOffset=0` : `#${snapshotId}?view=raw` });
  }
  const gaps = [...(manifest.capture?.gaps ?? [])];
  if (coverage.unrecognizedLines > 0) gaps.push({ code: 'unknown-format', reference: `${coverage.unrecognizedLines} 行未解析` });
  const partial = coverage.partialLine || manifest.capture?.partialLine;
  if (partial && !gaps.some(gap => gap.code === 'partial-line')) gaps.push({ code: 'partial-line', reference: '末行待完成' });
  const uncertain = !!provenance.warning && provenance.warning !== independentOriginReason;
  const decision = uncertain ? 'unresolved' : provenance.relation === 'verified-restoration' ? 'restoration' : provenance.relation === 'same-device-continuation' ? 'continuation' : 'independent';
  const payload: Base = { ruleVersion: assemblyRuleVersion, snapshotId, source: manifest.source, sourceSessionId: manifest.sourceSessionId,
    employeeId: row.employee_id, employee: row.employee, project: manifest.project, committedAt: row.committed_at.toISOString(),
    completedAt: row.previous?.completedAt ?? (origin === 'commit' ? new Date().toISOString() : null), origin: row.previous?.origin ?? origin,
    state: gaps.some(gap => gap.code !== 'partial-line') ? 'gap' : partial ? 'assembling' : uncertain ? 'pending-lineage' : 'assembled',
    generation: manifest.capture ? { id: manifest.capture.generation, revision: manifest.capture.revision, change: manifest.capture.change } : null,
    records: { total: origins.length, unique: unique.size, inherited: [...unique.values()].filter(item => item.snapshotId !== snapshotId).length,
      repeated: origins.length - unique.size, compactSummaries },
    lineage: { decision, sourceSnapshotId: provenance.sourceSnapshotId, reason: uncertain ? provenance.warning : null },
    sources, sourceCount: sources.length, gaps, sideLinks: manifest.capture?.lineage ?? [] };
  await q.query(`INSERT INTO assembly_records(snapshot_id,payload) VALUES($1,$2) ON CONFLICT(snapshot_id) DO UPDATE SET payload=EXCLUDED.payload
    WHERE assembly_records.payload->>'ruleVersion' IS DISTINCT FROM EXCLUDED.payload->>'ruleVersion'`, [snapshotId, payload]);
  return payload;
}

export function assemblyService(db: Database, raw: RawStore) {
  const page = (audit: AssemblyAudit, offset: number): AssemblyAudit => ({ ...audit, sources: audit.sources.slice(offset, offset + 20), gaps: audit.gaps.slice(offset, offset + 20),
    sideLinks: audit.sideLinks.slice(offset, offset + 20), nextOffset: Math.max(audit.sources.length, audit.gaps.length, audit.sideLinks.length) > offset + 20 ? offset + 20 : null });
  async function read(snapshotId: string, input: unknown = {}, full = false): Promise<AssemblyAudit> {
    const query = assemblyReadQuery.parse(input);
    if (query.version) {
      const saved = (await db.query('SELECT payload FROM assembly_versions WHERE snapshot_id=$1 AND version=$2', [snapshotId, query.version])).rows[0];
      if (!saved) throw new HttpError(404, '组装版本不存在');
      return full ? saved.payload : page(saved.payload, query.offset);
    }
    if (query.offset) throw new HttpError(400, '后续页需要固定组装版本');
    const row = (await db.query('SELECT s.device_id,a.payload FROM snapshots s LEFT JOIN assembly_records a ON a.snapshot_id=s.id WHERE s.id=$1', [snapshotId])).rows[0];
    if (!row) throw new HttpError(404, '快照不存在');
    const base: Base = row.payload?.ruleVersion === assemblyRuleVersion ? row.payload : await recordAssembly(db, raw, snapshotId, 'reconstructed');
    const hashes = new Set<string>();
    for (const source of base.sources) {
      for (const hash of await artifactChunks(db, row.device_id, source.hash) ?? []) hashes.add(hash);
    }
    const traffic = (await db.query(`SELECT count(*)::int AS requests, count(*) FILTER(WHERE duplicate)::int AS duplicates FROM assembly_transports WHERE device_id=$1 AND hash=ANY($2::text[]) AND kind='chunk'`, [row.device_id, [...hashes]])).rows[0];
    const commits = (await db.query("SELECT count(*)::int AS requests,count(*) FILTER(WHERE duplicate)::int AS replays FROM assembly_transports WHERE snapshot_id=$1 AND kind='commit'", [snapshotId])).rows[0];
    const faults: AssemblyAudit['gaps'] = [];
    for (const source of base.sources) {
      try { if ((await raw.read(row.device_id, source.hash)).length !== source.byteLength) throw new Error('length'); }
      catch { faults.push({ code: 'stored-original-unavailable', reference: source.name }); }
    }
    const payload = { ...base, state: faults.length ? 'gap' as const : base.state, gaps: [...base.gaps, ...faults],
      transport: { chunkRequests: traffic.requests || null, duplicateChunkRequests: traffic.requests ? traffic.duplicates : null, snapshotReplays: commits.requests ? commits.replays : null },
      delivery: await readDeliveryObservation(db, snapshotId), integrity: faults.length ? 'gap' as const : 'verified' as const, nextOffset: null };
    const version = digest(JSON.stringify(payload)), audit: AssemblyAudit = { ...payload, version };
    await db.query('INSERT INTO assembly_versions(snapshot_id,version,payload) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [snapshotId, version, audit]);
    return full ? audit : page(audit, 0);
  }
  async function list(input: unknown = {}) {
    const query = assemblyQuery.parse(input);
    // Bound source traversal; state filtering is done after recording legacy audit facts.
    const rows = (await db.query(`SELECT s.id FROM snapshots s JOIN devices d ON d.id=s.device_id
      WHERE ($1::text IS NULL OR s.source=$1) AND ($2::uuid IS NULL OR d.employee_id=$2)
      AND ($3::date IS NULL OR (s.committed_at AT TIME ZONE 'Asia/Shanghai')::date=$3::date)
      AND ($5::boolean IS FALSE OR NOT EXISTS(SELECT 1 FROM snapshots newer WHERE newer.device_id=s.device_id AND newer.source=s.source AND newer.source_session_id=s.source_session_id
        AND (newer.committed_at,newer.id)>(s.committed_at,s.id)))
      ORDER BY s.committed_at DESC,s.id DESC LIMIT 21 OFFSET $4`, [query.source ?? null, query.employeeId ?? null, query.date ?? null, query.offset, query.currentOnly === 'true'])).rows;
    const audits = await Promise.all(rows.slice(0, 20).map(row => read(row.id)));
    const summaries: AssemblySummary[] = audits.filter(audit => !query.state || audit.state === query.state).map(({ snapshotId, source, employeeId, employee, project, sourceSessionId, completedAt, state, sourceCount, records, version, transport }) =>
      ({ snapshotId, source, employeeId, employee, project, sourceSessionId, completedAt, state, sourceCount, records, version, transport }));
    return { ruleVersion: assemblyRuleVersion, rows: summaries, nextOffset: rows.length > 20 ? query.offset + 20 : null };
  }
  return { read, list, export: (snapshotId: string, input: unknown = {}) => read(snapshotId, input, true) };
}

export function processingService(db: Database, metrics: MetricsService) {
  return async (input: unknown): Promise<ProcessingPage> => {
    const { date, version } = processingQuery.parse(input);
    if (version) {
      const row = (await db.query('SELECT payload FROM processing_versions WHERE version=$1 AND date=$2', [version, date])).rows[0];
      if (!row) throw new HttpError(404, '处理版本不存在'); return row.payload;
    }
    // Coverage uses the same deterministic metric version as reports; its own
    // materialization is counted below as a real metric output, never a raw count.
    const coverage = await metrics.readCoverageMetrics({ date, view: 'day' });
    const day = (column: string) => `(${column} AT TIME ZONE 'Asia/Shanghai')::date=$1::date`;
    const timing = (await db.query(`SELECT count(*) FILTER(WHERE receipt->'timing' IS NOT NULL)::int AS picked,
      count(*) FILTER(WHERE jsonb_typeof(receipt->'timing'->'elapsedMs')='number')::int AS samples,
      percentile_disc(0.95) WITHIN GROUP(ORDER BY (receipt->'timing'->>'elapsedMs')::double precision)
        FILTER(WHERE jsonb_typeof(receipt->'timing'->'elapsedMs')='number') AS p95
      FROM delivery_receipts WHERE ${day('received_at')}`, [date])).rows[0];
    const traffic = (await db.query(`SELECT count(*) FILTER(WHERE kind='chunk')::int AS chunks,
      count(*) FILTER(WHERE duplicate)::int AS duplicates FROM assembly_transports WHERE ${day('observed_at')}`, [date])).rows[0];
    const assembled = (await db.query(`SELECT count(*)::int AS count FROM assembly_records WHERE payload->>'origin'='commit' AND ${day("(payload->>'completedAt')::timestamptz")}`, [date])).rows[0].count;
    const parsed = (await db.query(`SELECT count(DISTINCT e.event_id)::int AS count FROM snapshot_events e JOIN assembly_records a ON a.snapshot_id=e.snapshot_id
      WHERE a.payload->>'origin'='commit' AND ${day("(a.payload->>'completedAt')::timestamptz")}`, [date])).rows[0].count;
    const metricCount = (await db.query(`SELECT count(*)::int AS count FROM metric_revisions WHERE ${day("(payload->>'createdAt')::timestamptz")}`, [date])).rows[0].count;
    const reports = (await db.query(`SELECT count(*)::int AS count FROM daily_report_revisions WHERE ${day('created_at')}`, [date])).rows[0].count;
    const unknown = (await db.query(`SELECT count(*)::int AS count FROM snapshots s WHERE ${day('s.committed_at')} AND NOT EXISTS
      (SELECT 1 FROM delivery_receipts r WHERE r.snapshot_id=s.id AND jsonb_typeof(r.receipt->'timing'->'elapsedMs')='number')`, [date])).rows[0].count;
    const pendingRows = (await db.query(`SELECT COALESCE(a.payload->>'state','unobserved') AS state,
      COALESCE(a.payload->'gaps'->0->>'code',CASE WHEN a.payload->>'state'='pending-lineage' THEN 'lineage-unconfirmed' ELSE 'unobserved' END) AS code,count(*)::int AS count
      FROM (SELECT DISTINCT ON(device_id,source,source_session_id) * FROM snapshots ORDER BY device_id,source,source_session_id,committed_at DESC,id DESC)s
      LEFT JOIN assembly_records a ON a.snapshot_id=s.id WHERE a.payload IS NULL OR a.payload->>'state'<>'assembled' GROUP BY 1,2 ORDER BY 1,2`)).rows;
    const reasons: Record<string, string> = { missing: '缺少关联原件', unreadable: '关联原件无法读取', 'unsafe-path': '关联路径无法安全读取', 'size-limit': '关联原件超过采集上限',
      'unknown-format': '含未识别的原件记录', 'partial-line': '末行待完成', 'history-unavailable': '历史原件不可取得', 'native-mapping-unverified': '原生映射待验证', 'lineage-unconfirmed': '谱系证据不足', unobserved: '尚无组装审计' };
    const pending = pendingRows.map(({ state, code, count }) => ({ state, reason: reasons[code] ?? '原件待核查', count }));
    const queue = (await db.query(`SELECT COALESCE(sum((report->>'pendingSnapshots')::bigint),0)::text AS snapshots,
      COALESCE(sum((report->>'pendingBytes')::bigint),0)::text AS bytes,count(DISTINCT device_id)::int AS devices,max(received_at) AS observed
      FROM device_delivery_health WHERE (report->>'pendingSnapshots')::bigint>0`)).rows[0];
    const observedSince = (await db.query('SELECT started_at FROM processing_observer WHERE id=1')).rows[0].started_at.toISOString();
    const content = { date, timeZone: 'Asia/Shanghai' as const, observedSince, ruleVersion: assemblyRuleVersion,
      stages: [ { key: 'picked', label: '拾取', count: timing.picked, unit: '有采集起点的回执' }, { key: 'received', label: '接收', count: traffic.chunks, unit: '分块请求' },
        { key: 'deduplicated', label: '传输去重', count: traffic.duplicates, unit: '重复分块或提交' }, { key: 'assembled', label: '组装', count: assembled, unit: '快照' },
        { key: 'parsed', label: '解析', count: parsed, unit: '去重记录' }, { key: 'metrics', label: '指标', count: metricCount, unit: '结果版本' }, { key: 'reports', label: '报表', count: reports, unit: '日报版本' } ],
      latency: { measurement: 'collector-monotonic-pickup-to-readable-ack' as const, p95Ms: timing.p95,
        samples: timing.samples, unknown, targetMs: 60000 }, pending,
      backlog: { pendingSnapshots: Number(queue.snapshots), pendingBytes: Number(queue.bytes), devices: queue.devices, observedAt: queue.observed?.toISOString() ?? null },
      tokenCoverage: coverage.sources.map(row => ({ source: row.source, sessions: row.sessions, knownSessions: row.sessions - row.unknownTokenSessions, unknownSessions: row.unknownTokenSessions })),
      catalog: metrics.readMetricCatalog() };
    const key = digest(JSON.stringify(content));
    await db.query('INSERT INTO processing_versions(version,date,payload) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [key, date, { ...content, version: key, createdAt: new Date().toISOString() }]);
    return (await db.query('SELECT payload FROM processing_versions WHERE version=$1', [key])).rows[0].payload;
  };
}
