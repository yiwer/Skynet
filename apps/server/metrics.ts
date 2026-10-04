import { digest, type Database } from './database.js';
import { HttpError } from './identities.js';
import type { RawStore } from './raw-store.js';
import type { Manifest, Source } from '../../packages/contracts/archive.js';
import type { Provenance } from '../../packages/contracts/provenance.js';
import { metricsQuerySchema, coverageMetricsQuerySchema, type MetricsQuery, type MetricsPage, type MetricsScope, type MetricTotals, type SessionMetrics, type MetricCatalog } from '../../packages/contracts/metrics.js';
import { statisticsExtractorVersion, type TokenComponents } from '../../packages/native-statistics.js';
import { beijingDate } from '../../packages/contracts/reports.js';
import { monday, addDays } from '../../packages/contracts/work-views.js';
import { inputIntegrityVersion } from './evidence-integrity.js';
import { materialSource } from './material-provenance.js';
import { metricInputBatch, type MetricInputFacts } from './metric-inputs.js';
import { attributionRevisions } from './qualification.js';

const catalogVersion = `recorded-metrics-3/${statisticsExtractorVersion}`;
const definition = '仅统计已验证原件中接入后、按北京时间来源日期归期的活动。eventId 去重；已验证服务器恢复链归为同一会话，未确认副本保持独立。员工和项目沿用每条活动的原始归属。会话数为所选范围内有业务事件的去重会话数，跨日或多人参与的会话不可直接相加；仅有原生 Token 记录的日期保留用量，不增加会话、轮次或调用。轮次、调用和已知 Token 可相加。Token 未知单列，不当作零或参加比值。';
const limits = { snapshots: 20000, events: 100000, rawBytes: 128 * 1024 * 1024, sessions: 10000, exportBytes: 16 * 1024 * 1024 };
const bounded = () => new HttpError(413, '指标范围超过单次计算上限，请缩小日期、员工或项目范围；未返回截断汇总');
function boundedPage<T>(value: T): T {
  if (Buffer.byteLength(JSON.stringify(value)) > 80 * 1024) throw new HttpError(413, '指标响应超过 Web/MCP 共用的 80 KiB 上限，请缩小日期、员工或项目范围；未返回截断汇总');
  return value;
}

export function readMetricCatalog(): MetricCatalog {
  return { version: catalogVersion, timeZone: 'Asia/Shanghai', definitions: [
    { key: 'sessions', label: '会话', definition: '有已确认接入后业务事件的会话；仅有 Token 元数据的日期不增加会话数。相同原生身份续聊及服务器核验的恢复链合并，子会话保持独立。', origin: '原件 · 确定性' },
    { key: 'userTurns', label: '用户轮次', definition: '用户提交的消息；按原件行去重，不包含工具结果、系统消息、压缩摘要或单个完整机器环境封套。混合用户正文保留。', origin: '原件 · 确定性' },
    { key: 'toolCalls', label: '工具调用', definition: '已归属的 Agent 工具请求 block 数；重复上传、确认丢失和恢复复制不增加。', origin: '原件 · 确定性' },
    { key: 'inputTokens', label: '输入 Token', definition: '只使用已支持版本的原生用量。Codex 累计计数取有基线的非负差值，缓存输入是输入子集；Claude 普通输入、缓存读取和缓存写入相加，同 message.id 仅计一次。', origin: '原件 · 确定性' },
    { key: 'outputTokens', label: '输出 Token', definition: '原生记录的输出；推理输出是输出子集，不重复相加。缺失、基线不明、冲突或不支持的来源为未知。', origin: '原件 · 确定性' },
  ], limitations: ['记录用量不是计费账单。', 'knownInputTokens/knownOutputTokens 仅为可确认部分；未知会话另外列出，不以零替代。',
    '只提供确定性基础指标；不推断任务类型、产出、等待、能力分数或名次。', '人员固定按姓名排列；日期按北京时间；不把消息数量或事件区间解释为工时。'] };
}

export async function migrateMetrics(db: Database) {
  await db.query(`CREATE TABLE IF NOT EXISTS metric_revisions (
    version text PRIMARY KEY, scope_key text NOT NULL, revision integer NOT NULL,
    request jsonb NOT NULL, payload jsonb NOT NULL, UNIQUE(scope_key,revision)
  )`);
  await db.query(`CREATE TABLE IF NOT EXISTS metric_input_revisions (
    version text PRIMARY KEY, snapshot_id uuid NOT NULL REFERENCES snapshots(id),
    attribution_revision text NOT NULL, parser_version text NOT NULL, payload jsonb NOT NULL
  )`);
}

type Snapshot = { id: string; device_id: string; employee_id: string; employee: string; source: Source; source_session_id: string;
  manifest: Manifest; hash: string; committed_at: Date; enrolled_at: Date | null; provenance: Provenance | null; attribution_revision: string };
type Event = { event_id: string; snapshot_id: string; employee_id: string; employee: string; device_id: string; source: Source;
  source_session_id: string; project: string; source_date: string; role: string; line: number; block: number; material_id: string | null;
  qualification_revision: string; proof_snapshot_id: string | null };
type Slice = { sessionId: string; employeeId: string; employee: string; source: Source; project: string; sourceSessionId: string;
  snapshotId: string; snapshotIds: Set<string>; date: string; businessEvents: boolean; turns: Set<string>; tools: Set<string>; usage: Map<string, TokenComponents | null>; reasons: Set<string> };
const nativeKey = (device: string, source: Source, session: string) => JSON.stringify([device, source, session]);
const requestSelection = (q: MetricsQuery) => ({ period: q.period, ...(q.period === 'custom' ? { from: q.from, to: q.to } : {}),
  ...(q.employeeId ? { employeeId: q.employeeId } : {}), ...(q.source ? { source: q.source } : {}), ...(q.project !== undefined ? { project: q.project } : {}) });

function total(rows: SessionMetrics[]): MetricTotals {
  const result: MetricTotals = { sessions: new Set(rows.filter(row => row.sessions > 0).map(row => row.sessionId)).size,
    userTurns: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, knownInputTokens: 0, knownOutputTokens: 0,
    unknownTokenSessions: 0, unknownInputSessions: 0, unknownOutputSessions: 0 };
  const inputUnknown = new Set<string>(), outputUnknown = new Set<string>();
  for (const row of rows) {
    result.userTurns += row.userTurns; result.toolCalls += row.toolCalls;
    result.knownInputTokens += row.knownInputTokens; result.knownOutputTokens += row.knownOutputTokens;
    if (row.inputTokens === null) inputUnknown.add(row.sessionId);
    if (row.outputTokens === null) outputUnknown.add(row.sessionId);
  }
  result.unknownInputSessions = inputUnknown.size; result.unknownOutputSessions = outputUnknown.size;
  result.unknownTokenSessions = new Set([...inputUnknown, ...outputUnknown]).size;
  result.inputTokens = inputUnknown.size ? null : result.knownInputTokens;
  result.outputTokens = outputUnknown.size ? null : result.knownOutputTokens;
  for (const value of [result.knownInputTokens, result.knownOutputTokens, result.userTurns, result.toolCalls]) if (!Number.isSafeInteger(value)) throw bounded();
  return result;
}

function summarize(slices: Slice[]): SessionMetrics[] {
  const grouped = new Map<string, Slice[]>();
  for (const slice of slices) {
    const key = JSON.stringify([slice.sessionId, slice.employeeId, slice.source, slice.project]);
    grouped.set(key, [...grouped.get(key) ?? [], slice]);
  }
  return [...grouped.values()].map(group => {
    const first = group[0]!; const values = group.flatMap(slice => [...slice.usage.values()]);
    const reasons = [...new Set(group.flatMap(slice => [...slice.reasons]))].sort();
    if (!values.length) reasons.push('来源未上报可归属的 Token');
    const inputUnknown = reasons.length > 0 || values.some(value => value?.input == null);
    const outputUnknown = reasons.length > 0 || values.some(value => value?.output == null);
    const knownInputTokens = values.reduce((sum, value) => sum + (value?.input ?? 0), 0);
    const knownOutputTokens = values.reduce((sum, value) => sum + (value?.output ?? 0), 0);
    if (!Number.isSafeInteger(knownInputTokens) || !Number.isSafeInteger(knownOutputTokens)) throw bounded();
    const userTurns = new Set(group.flatMap(slice => [...slice.turns])).size, toolCalls = new Set(group.flatMap(slice => [...slice.tools])).size;
    return { sessionId: first.sessionId, employeeId: first.employeeId, employee: first.employee, source: first.source, project: first.project,
      sourceSessionId: first.sourceSessionId, snapshotId: first.snapshotId, snapshotIds: [...new Set(group.flatMap(slice => [...slice.snapshotIds]))].sort(),
      webPath: `#${first.snapshotId}`, dates: [...new Set(group.map(slice => slice.date))].sort(),
      sessions: group.some(slice => slice.businessEvents) ? 1 : 0, userTurns, toolCalls, inputTokens: inputUnknown ? null : knownInputTokens, outputTokens: outputUnknown ? null : knownOutputTokens,
      knownInputTokens, knownOutputTokens, unknownInputSessions: inputUnknown ? 1 : 0, unknownOutputSessions: outputUnknown ? 1 : 0,
      unknownTokenSessions: inputUnknown || outputUnknown ? 1 : 0, sourceInputsComplete: !inputUnknown && !outputUnknown,
      unknownReasons: [...new Set([...reasons, ...(values.some(value => !value) ? ['用量基线或重复记录存在未知/冲突'] : []),
        ...(values.some(value => value && value.input === null) ? ['输入 Token 的原生分项不齐全'] : []),
        ...(values.some(value => value && value.output === null) ? ['输出 Token 未上报'] : [])])] };
  }).sort((a, b) => a.employee.localeCompare(b.employee, 'zh-CN') || a.employeeId.localeCompare(b.employeeId)
    || a.sessionId.localeCompare(b.sessionId) || a.project.localeCompare(b.project));
}

export function metricsService(db: Database, raw: RawStore, clock: () => Date = () => new Date()) {
  async function resolveScope(q: MetricsQuery, client: Pick<Database, 'query'>): Promise<MetricsScope> {
    const today = beijingDate(clock()); let from: string, to: string;
    if (q.period === 'custom') { from = q.from!; to = q.to!; }
    else if (q.period === 'since-enrollment') {
      const row = (await client.query('SELECT min(enrolled_at) AS first FROM devices WHERE ($1::uuid IS NULL OR employee_id=$1)', [q.employeeId ?? null])).rows[0];
      from = row.first ? beijingDate(row.first) : today; to = today;
    } else { from = addDays(monday(today), q.period === 'last-week' ? -7 : 0); to = addDays(from, 6); }
    if (from > to) throw new HttpError(400, '起始日期不能晚于结束日期');
    if ((Date.parse(to) - Date.parse(from)) / 86400000 > 3660) throw bounded();
    if (q.employeeId && !(await client.query('SELECT id FROM employees WHERE id=$1', [q.employeeId])).rowCount) throw new HttpError(404, '员工不存在');
    return { from, to, timeZone: 'Asia/Shanghai', ...(q.employeeId ? { employeeId: q.employeeId } : {}),
      ...(q.source ? { source: q.source } : {}), ...(q.project !== undefined ? { project: q.project } : {}) };
  }

  async function compute(q: MetricsQuery, full = false): Promise<MetricsPage> {
    for (let attempt = 0; ; attempt++) {
      try { return await computeOnce(q, full); }
      catch (error) {
        if (!['40001', '40P01'].includes((error as { code?: string }).code ?? '')) throw error;
        if (attempt >= 2) throw new HttpError(409, '指标输入正在更新，请稍后重试；固定版本仍可读取');
        await new Promise(resolve => setTimeout(resolve, 25 * (attempt + 1)));
      }
    }
  }
  async function computeOnce(q: MetricsQuery, full: boolean): Promise<MetricsPage> {
    const client = await db.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      const scope = await resolveScope(q, client), scopeKey = digest(JSON.stringify(scope));
      const lock = (await client.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,7402138)) AS locked', [scopeKey])).rows[0];
      if (!lock.locked) throw new HttpError(409, '该指标范围正在计算，请稍后重试；固定版本仍可读取');
      const events = (await client.query(`SELECT o.event_id,o.snapshot_id,o.employee_id,e.name AS employee,o.device_id,o.source,
        o.source_session_id,o.project,o.source_date,o.role,o.line,o.block,o.material_id,o.qualification_revision,o.proof_snapshot_id
        FROM effective_event_origins o JOIN employees e ON e.id=o.employee_id
        WHERE o.context='after-enrollment' AND o.source_date BETWEEN $1 AND $2
        AND ($3::uuid IS NULL OR o.employee_id=$3) AND ($4::text IS NULL OR o.source=$4) AND ($5::text IS NULL OR o.project=$5)
        ORDER BY o.event_id LIMIT ${limits.events + 1}`, [scope.from, scope.to, q.employeeId ?? null, q.source ?? null, q.project ?? null])).rows as Event[];
      if (events.length > limits.events) throw bounded();
      // Token metadata does not become a business event, so event dates cannot
      // select its originals. Discover scoped native identities independently,
      // then inspect source timestamps within the same bounded raw-read budget.
      // Preserve every native history: latest manifest labels cannot reassign
      // earlier usage when an employee changes a session's project.
      const discovered = (await client.query(`SELECT DISTINCT s.device_id AS device,s.source,s.source_session_id AS session
        FROM snapshots s JOIN devices d ON d.id=s.device_id
        WHERE ($1::uuid IS NULL OR d.employee_id=$1) AND ($2::text IS NULL OR s.source=$2)
          AND ($3::text IS NULL OR s.manifest->>'project'=$3)
        ORDER BY s.device_id,s.source,s.source_session_id LIMIT ${limits.snapshots + 1}`,
      [q.employeeId ?? null, q.source ?? null, q.project ?? null])).rows as { device: string; source: Source; session: string }[];
      if (discovered.length > limits.snapshots) throw bounded();
      const nativeInputs = [...new Map([...discovered, ...events.map(event =>
        ({ device: event.device_id, source: event.source, session: event.source_session_id }))]
        .map(input => [nativeKey(input.device, input.source, input.session), input])).values()];
      // Metadata is needed to follow verified restoration chains. No native home
      // or employee source file is read: all bytes come from committed raw storage.
      const snapshots = (await client.query(`WITH RECURSIVE selected(id) AS (
        SELECT s.id FROM snapshots s WHERE s.id=ANY($2::uuid[]) OR EXISTS(
          SELECT 1 FROM jsonb_to_recordset($1::jsonb) AS i(device uuid,source text,session text)
          WHERE i.device=s.device_id AND i.source=s.source AND i.session=s.source_session_id)
        UNION
        SELECT p.id FROM selected x JOIN snapshots s ON s.id=x.id JOIN snapshots p ON p.id=(s.provenance->>'sourceSnapshotId')::uuid
          WHERE s.provenance->>'relation' IN ('verified-restoration','same-device-continuation')
      ) SELECT s.*,d.employee_id,d.enrolled_at,e.name AS employee FROM selected x JOIN snapshots s ON s.id=x.id
        JOIN devices d ON d.id=s.device_id JOIN employees e ON e.id=d.employee_id ORDER BY s.committed_at,s.id LIMIT ${limits.snapshots + 1}`,
      [JSON.stringify(nativeInputs), [...new Set(events.map(event => event.snapshot_id))]])).rows as Snapshot[];
      if (snapshots.length > limits.snapshots) throw bounded();
      const revisions = await attributionRevisions(client, snapshots.map(snapshot => snapshot.id));
      for (const snapshot of snapshots) snapshot.attribution_revision = revisions.get(snapshot.id)!;
      const byId = new Map(snapshots.map(s => [s.id, s]));
      const materialRoots = new Map<string, string>();
      const materialNative = new Map<string, string>();
      for (const snapshot of snapshots) if (snapshot.manifest.restoredFrom?.materialId && snapshot.provenance?.relation === 'verified-restoration') {
        const prior = byId.get(snapshot.provenance.sourceSnapshotId!);
        if (!prior) throw new HttpError(409, '会话材料谱系来源缺失');
        const original = await materialSource(client, prior, snapshot.manifest.restoredFrom.materialId);
        const native = nativeKey(original.origin.device_id, prior.source, original.material.sourceSessionId!);
        materialRoots.set(snapshot.id, digest(native)); materialNative.set(snapshot.id, native);
      }
      const roots = new Map<string, string>();
      function identity(record: Snapshot): string {
        const key = nativeKey(record.device_id, record.source, record.source_session_id); const known = roots.get(key); if (known) return known;
        const chain = new Set<string>(); let current = record;
        while (current.provenance?.sourceSnapshotId && current.provenance.relation !== 'unconfirmed') {
          if (chain.has(current.id) || chain.size >= 128) throw new HttpError(409, '会话谱系循环或过长，无法确认指标范围');
          chain.add(current.id); const prior = byId.get(current.provenance.sourceSnapshotId); if (!prior) throw new HttpError(409, '会话谱系来源缺失');
          // Restoring a child material must not merge that child with its parent.
          if (current.manifest.restoredFrom?.materialId) {
            const root = materialRoots.get(current.id); if (!root) break;
            roots.set(key, root); return root;
          }
          if (prior.source_session_id !== current.source_session_id) break;
          current = prior;
        }
        const root = digest(nativeKey(current.device_id, current.source, current.source_session_id)); roots.set(key, root); return root;
      }
      // Prefer the latest provenance for each native identity (later captures can
      // add the validated restoration receipt without changing event ownership).
      const latest = new Map<string, Snapshot>();
      for (const snapshot of snapshots) latest.set(nativeKey(snapshot.device_id, snapshot.source, snapshot.source_session_id), snapshot);
      for (const snapshot of latest.values()) identity(snapshot);
      const slices = new Map<string, Slice>(), relevantNative = new Set(nativeInputs.map(input => nativeKey(input.device, input.source, input.session)));
      const sliceKey = (session: string, employee: string, project: string, date: string) => JSON.stringify([session, employee, project, date]);
      for (const event of events) {
        const native = nativeKey(event.device_id, event.source, event.source_session_id), record = latest.get(native) ?? byId.get(event.snapshot_id)!;
        const session = event.material_id && record.source_session_id !== event.source_session_id ? digest(native) : identity(record);
        const key = sliceKey(session, event.employee_id, event.project, event.source_date);
        let slice = slices.get(key);
        if (!slice) { slice = { sessionId: session, employeeId: event.employee_id, employee: event.employee, source: event.source, project: event.project,
          sourceSessionId: event.source_session_id, snapshotId: event.snapshot_id, snapshotIds: new Set(), date: event.source_date, businessEvents: true, turns: new Set(), tools: new Set(), usage: new Map(), reasons: new Set() }; slices.set(key, slice); }
        if (slices.size > limits.sessions) throw bounded();
        slice.snapshotIds.add(event.snapshot_id);
        if (event.role === 'user') slice.turns.add(JSON.stringify([event.snapshot_id, event.material_id, event.line]));
        if (event.role === 'tool request') slice.tools.add(event.event_id);
        relevantNative.add(native);
        if (event.material_id && !event.proof_snapshot_id) slice.reasons.add('关联材料缺少独立普通来源资格，Token 未知');
      }
      for (const native of relevantNative) {
        let record = latest.get(native); const seen = new Set<string>();
        while (record?.provenance?.sourceSnapshotId && record.provenance.relation !== 'unconfirmed' && !seen.has(record.id)) {
          seen.add(record.id);
          if (materialNative.has(record.id)) { relevantNative.add(materialNative.get(record.id)!); break; }
          const prior = byId.get(record.provenance.sourceSnapshotId);
          if (!prior) break;
          relevantNative.add(nativeKey(prior.device_id, prior.source, prior.source_session_id)); record = prior;
        }
      }
      const relevantSnapshots = snapshots.filter(s => relevantNative.has(nativeKey(s.device_id, s.source, s.source_session_id)));
      // Exact append proofs let one maximal stored original cover its older
      // prefixes. Preserve a carrier at every ownership/project/version change
      // and every rewrite: those boundaries cannot be inferred from byte size.
      const subsumed = new Set<string>(), covering = new Map<string, string>();
      for (const record of relevantSnapshots) {
        const prior = record.provenance?.sourceSnapshotId ? byId.get(record.provenance.sourceSnapshotId) : undefined;
        if (prior && record.provenance?.relation === 'same-device-continuation' && !record.provenance.warning
          && record.device_id === prior.device_id && record.source === prior.source && record.source_session_id === prior.source_session_id
          && record.manifest.project === prior.manifest.project && record.manifest.sourceVersion === prior.manifest.sourceVersion
          && JSON.stringify(record.manifest.restoredFrom) === JSON.stringify(prior.manifest.restoredFrom)) { subsumed.add(prior.id); covering.set(prior.id, record.id); }
      }
      const candidates = relevantSnapshots.filter(s => !subsumed.has(s.id));
      // Zero is valid only when the whole observed history begins here. A later
      // append cannot turn a rewritten generation back into a new native run.
      const baselineProofs = new Map<string, boolean>();
      const firstNative = new Map<string,string>();
      for(const record of snapshots){const key=nativeKey(record.device_id,record.source,record.source_session_id);if(!firstNative.has(key))firstNative.set(key,record.id);}
      function baselineContinuity(record:Snapshot, seen=new Set<string>()):boolean {
        const known=baselineProofs.get(record.id);if(known!==undefined)return known;
        if(seen.has(record.id)||seen.size>=128)return false;seen.add(record.id);
        const capture=record.manifest.capture, prior=record.provenance?.sourceSnapshotId ? byId.get(record.provenance.sourceSnapshotId) : undefined;
        let valid=!record.manifest.restoredFrom && !(capture&&(capture.gaps.length||capture.lineage.length||capture.compacted||capture.partialLine||['rewrite','truncate'].includes(capture.change)));
        if(valid&&prior)valid=record.provenance?.relation==='same-device-continuation'&&!record.provenance.warning
          &&prior.device_id===record.device_id&&prior.source===record.source&&prior.source_session_id===record.source_session_id&&baselineContinuity(prior,seen);
        else if(valid)valid=firstNative.get(nativeKey(record.device_id,record.source,record.source_session_id))===record.id&&(!capture||capture.change==='initial');
        baselineProofs.set(record.id,valid);return valid;
      }
      let totalBytes = 0; const rawInputs: unknown[] = [];
      const rawBuffers = new Map<string, Buffer>();
      const materialized = new Map<string, MetricInputFacts>();
      const inputBatch = await metricInputBatch(client, candidates.map(record => ({ snapshotId: record.id, attributionRevision: record.attribution_revision,
        hash: record.hash, source: record.source, sourceVersion: record.manifest.sourceVersion, manifest: record.manifest, baselineContinuity: baselineContinuity(record) })), full);
      const sliceGroups = new Map<string, Slice[]>();
      for (const slice of slices.values()) {
        const key = JSON.stringify([slice.sessionId, slice.employeeId, slice.project]);
        sliceGroups.set(key, [...sliceGroups.get(key) ?? [], slice]);
      }
      // A native usage occurrence keeps the employee/project of its first
      // committed ordinary source. Later captures cannot reassign it through a
      // changed project label; copies of a restored prefix never enter this map.
      const usageOrigins = new Map<string, { slice?: Slice; value: TokenComponents | null }>();
      const discoveryGaps = new Set<string>(), ownerDiscoveryGaps = new Map<string, { snapshotId: string; reason: string }[]>();
      const gapForOwner = (record: Snapshot, reason: string) => { discoveryGaps.add(reason); const gaps = ownerDiscoveryGaps.get(record.employee_id) ?? []; gaps.push({ snapshotId: record.id, reason }); ownerDiscoveryGaps.set(record.employee_id, gaps); };
      for (const record of candidates) {
        const session = identity(record);
        const groupKey = JSON.stringify([session, record.employee_id, record.manifest.project]);
        const relevant = sliceGroups.get(groupKey) ?? [];
        const ownerSelected = (!q.employeeId || record.employee_id === q.employeeId) && (!q.source || record.source === q.source)
          && (q.project === undefined || record.manifest.project === q.project);
        totalBytes += record.manifest.byteLength; if (totalBytes > limits.rawBytes) throw bounded();
        rawInputs.push([record.id, record.hash, record.manifest.sourceVersion, record.enrolled_at?.toISOString(), record.provenance]);
        let parsed: MetricInputFacts, content: Buffer;
        try {
          content = await raw.read(record.device_id, record.hash);
          parsed = inputBatch.read({ snapshotId: record.id, attributionRevision: record.attribution_revision,
            bytes: content, hash: record.hash, source: record.source, sourceVersion: record.manifest.sourceVersion, manifest: record.manifest, baselineContinuity: baselineContinuity(record) });
        }
        catch (error) {
          // A competing scope can materialize this same input after our
          // repeatable-read snapshot. Retry the whole transaction, never label
          // that serialization conflict as an original-storage gap.
          if (['40001', '40P01'].includes((error as { code?: string }).code ?? '')) throw error;
          for (const slice of relevant) slice.reasons.add('已存档原件不可读取或含无效编码');
          if (ownerSelected) gapForOwner(record, '已存档原件不可读取或含无效编码，无法确认所选日期的 Token');
          continue;
        }
        rawBuffers.set(record.id, content);
        materialized.set(record.id, parsed);
        const reasons = new Set<string>();
        if (!parsed.supported || !record.enrolled_at) reasons.add('来源版本或接入边界未经验证');
        if (latest.get(nativeKey(record.device_id, record.source, record.source_session_id))?.id === record.id
          && (!parsed.complete || !parsed.coverageComplete)) reasons.add('来源原件有缺口，已知部分不代表全部');
        if (record.provenance?.warning && record.provenance.relation !== 'unconfirmed') reasons.add(record.provenance.warning);
        for (const slice of relevant) for (const reason of reasons) slice.reasons.add(reason);
        if (!record.enrolled_at) { if (ownerSelected) gapForOwner(record, '来源接入边界未经验证，无法确认所选日期的 Token'); continue; }
        const prefixLines = record.manifest.restoredFrom ? content.subarray(0, record.manifest.restoredFrom.byteLength).toString('utf8').split('\n').length - 1 : 0;
        for (const item of parsed.usage) {
          if (item.line <= prefixLines || !item.timestamp || Date.parse(item.timestamp) < record.enrolled_at.getTime()) continue;
          const date = beijingDate(new Date(item.timestamp));
          const key = session + '/' + item.key;
          const previous = usageOrigins.get(key);
          if (previous) {
            const same = previous.value === null || item.value === null ? previous.value === item.value
              : (Object.keys(previous.value) as (keyof TokenComponents)[]).every(field => previous.value![field] === item.value![field]);
            if (!same) { previous.value = null; previous.slice?.usage.set(key, null); }
            continue;
          }
          let slice: Slice | undefined;
          if (ownerSelected && date >= scope.from && date <= scope.to) {
            const selectedKey = sliceKey(session, record.employee_id, record.manifest.project, date);
            slice = slices.get(selectedKey);
            if (!slice) {
              slice = { sessionId: session, employeeId: record.employee_id, employee: record.employee, source: record.source, project: record.manifest.project,
                sourceSessionId: record.source_session_id, snapshotId: record.id, snapshotIds: new Set(), date, businessEvents: false,
                turns: new Set(), tools: new Set(), usage: new Map(), reasons: new Set() };
              slices.set(selectedKey, slice); relevant.push(slice); sliceGroups.set(groupKey, relevant);
              if (slices.size > limits.sessions) throw bounded();
            }
            slice.snapshotIds.add(record.id);
            for (const reason of reasons) slice.reasons.add(reason);
            slice.usage.set(key, item.value);
          }
          usageOrigins.set(key, { slice, value: item.value });
        }
      }
      // The evidence reader intentionally preserves compacted text as evidence.
      // A native, explicit summary/meta flag prevents counting that preserved
      // text as a new user submission; never guess from message wording.
      const userSources = new Map<string, Event[]>();
      for (const event of events) if (event.role === 'user') {
        const key = JSON.stringify([event.snapshot_id, event.material_id]); userSources.set(key, [...userSources.get(key) ?? [], event]);
      }
      const excludedTurns = new Set<string>();
      for (const sourceEvents of userSources.values()) {
        const first = sourceEvents[0]!, record = byId.get(first.snapshot_id)!;
        let key = record.id, device = record.device_id, hash = record.hash, length = record.manifest.byteLength;
        if (first.material_id) {
          const source = await materialSource(client, record, first.material_id);
          device = source.origin.device_id; hash = source.material.hash; length = source.material.byteLength; key = `${device}/${hash}`;
        } else { while (covering.has(key)) key = covering.get(key)!; }
        let content = rawBuffers.get(key);
        if (!content) {
          totalBytes += length; if (totalBytes > limits.rawBytes) throw bounded();
          try { content = await raw.read(device, hash); rawBuffers.set(key, content); }
          catch { continue; } // Validated event remains an observed row; completeness is reported separately.
        }
        let facts = materialized.get(key);
        if (!facts) {
          facts = inputBatch.read({ snapshotId: record.id, attributionRevision: record.attribution_revision,
            materialId: first.material_id ?? undefined, bytes: content, hash, source: record.source, sourceVersion: record.manifest.sourceVersion });
          materialized.set(key, facts);
        }
        const excluded = new Set(facts.excludedUserLines);
        for (const event of sourceEvents) {
          if (excluded.has(event.line)) excludedTurns.add(JSON.stringify([event.snapshot_id, event.material_id, event.line]));
        }
      }
      await inputBatch.flush();
      for (const slice of slices.values()) for (const turn of slice.turns) if (excludedTurns.has(turn)) slice.turns.delete(turn);
      for (const slice of slices.values()) if (!slice.usage.size) slice.reasons.add('来源未上报可归属的 Token');
      const selected = [...slices.values()], sessions = summarize(selected); if (sessions.length > limits.sessions) throw bounded();
      const byDate = new Map<string, Slice[]>();
      for (const slice of selected) byDate.set(slice.date, [...byDate.get(slice.date) ?? [], slice]);
      const unknownSessions = new Set(sessions.filter(session => session.inputTokens === null || session.outputTokens === null).map(session => session.sessionId));
      const daily = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, values]) => {
        const rows = summarize(values), included = rows.filter(row => !unknownSessions.has(row.sessionId));
        const excludedSessions = new Set(rows.filter(row => unknownSessions.has(row.sessionId)).map(row => row.sessionId)).size;
        const known = total(included);
        return { date, ...total(rows), tokenTrend: {
          inputTokens: !included.length && excludedSessions ? null : known.knownInputTokens,
          outputTokens: !included.length && excludedSessions ? null : known.knownOutputTokens,
          includedSessions: new Set(included.map(row => row.sessionId)).size, excludedSessions,
        } };
      });
      const byEmployeeDay = new Map<string, Slice[]>();
      for (const slice of selected) { const key = JSON.stringify([slice.employeeId, slice.date]); byEmployeeDay.set(key, [...byEmployeeDay.get(key) ?? [], slice]); }
      const employeeDays = [...byEmployeeDay.values()].map(values => {
        const first = values[0]!, rows = summarize(values), included = rows.filter(row => !unknownSessions.has(row.sessionId)), known = total(included),all=total(rows);
        const excludedSessions = new Set(rows.filter(row => unknownSessions.has(row.sessionId)).map(row => row.sessionId)).size;
        return { employeeId: first.employeeId, date: first.date, activeSessions: all.sessions,userTurns:all.userTurns,toolCalls:all.toolCalls,knownInputTokens:all.knownInputTokens,unknownInputSessions:all.unknownInputSessions,
          inputTokens: !included.length && excludedSessions ? null : known.knownInputTokens, outputTokens: !included.length && excludedSessions ? null : known.knownOutputTokens,
          includedSessions: new Set(included.map(row => row.sessionId)).size, excludedSessions };
      }).sort((a,b) => a.employeeId.localeCompare(b.employeeId) || a.date.localeCompare(b.date));
      const employeeDaily = [...new Set(employeeDays.map(day=>day.employeeId))].map(employeeId=>({employeeId,
        days:employeeDays.filter(day=>day.employeeId===employeeId).map(({employeeId:_id,...day})=>day)}));
      const byEmployee = new Map<string, SessionMetrics[]>();
      for (const session of sessions) byEmployee.set(session.employeeId, [...byEmployee.get(session.employeeId) ?? [], session]);
      let employees: MetricsPage['employees'] = [...new Map(sessions.map(s => [s.employeeId, s.employee])).entries()]
        .sort((a, b) => a[1].localeCompare(b[1], 'zh-CN') || a[0].localeCompare(b[0]))
        .map(([employeeId, employee]) => ({ employeeId, employee, ...total(byEmployee.get(employeeId)!) }));
      const sources = [...new Set(sessions.map(s => s.source))].sort().map(source => ({ source, ...total(sessions.filter(s => s.source === source)) }));
      const unscoped = (await client.query(`SELECT s.id,s.employee_id,s.committed_at,p.complete,p.revision FROM (
        SELECT DISTINCT ON (s.device_id,s.source,s.source_session_id) s.*,d.employee_id FROM snapshots s JOIN devices d ON d.id=s.device_id
        WHERE ($1::uuid IS NULL OR d.employee_id=$1) AND ($2::text IS NULL OR s.source=$2)
          AND ($3::text IS NULL OR s.manifest->>'project'=$3)
        ORDER BY s.device_id,s.source,s.source_session_id,s.committed_at DESC,s.id DESC
        ) s LEFT JOIN snapshot_input_integrity p ON p.snapshot_id=s.id AND p.version=$4
        WHERE s.manifest->'restoredFrom' IS NULL AND p.complete IS NOT TRUE ORDER BY s.id LIMIT ${limits.snapshots + 1}`,
      [q.employeeId ?? null, q.source ?? null, q.project ?? null, inputIntegrityVersion])).rows;
      if (unscoped.length > limits.snapshots) throw bounded();
      const ownerIds = new Set([...employees.map(person => person.employeeId), ...unscoped.map(row => row.employee_id as string), ...ownerDiscoveryGaps.keys()]);
      employees = [...ownerIds].map(employeeId => {
        const mine = sessions.filter(session => session.employeeId === employeeId), unresolved = unscoped.filter(row => row.employee_id === employeeId), failures = ownerDiscoveryGaps.get(employeeId) ?? [];
        const employee = employees.find(person => person.employeeId === employeeId) ?? { employeeId, employee: snapshots.find(row => row.employee_id === employeeId)!.employee, ...total(mine) };
        const unscopedSources = new Set([...unresolved.map(row => row.id), ...failures.map(row => row.snapshotId)]).size;
        const unknownReasons = [...new Set([...mine.flatMap(row => row.unknownReasons), ...failures.map(row => row.reason), ...(unresolved.length ? ['存在来源日期不能确定的原件缺口，范围完整性未知'] : [])])].sort();
        return { ...employee, ...(unscopedSources ? { inputTokens: null, outputTokens: null } : {}), unscopedSources,
          sourceInputsComplete: !unscopedSources && mine.every(row => row.sourceInputsComplete), unknownReasons };
      }).sort((a, b) => a.employee.localeCompare(b.employee, 'zh-CN') || a.employeeId.localeCompare(b.employeeId));
      const unknownReasons = [...new Set([...sessions.flatMap(s => s.unknownReasons), ...discoveryGaps, ...(unscoped.length ? ['存在来源日期不能确定的原件缺口，范围完整性未知'] : [])])].sort();
      const dataAsOf = new Date(Math.max(0, ...candidates.map(s => s.committed_at.getTime()), ...unscoped.map(s => (s.committed_at as Date).getTime()))).toISOString();
      const inputVersion = digest(JSON.stringify([events, rawInputs, unscoped]));
      const totals = total(sessions);
      if (unscoped.length || discoveryGaps.size) { totals.inputTokens = null; totals.outputTokens = null; }
      const content = { scope, totals, sessions, daily, employeeDaily, employees, sources, dataAsOf,
        catalogVersion, definition, sourceInputsComplete: unscoped.length === 0 && discoveryGaps.size === 0 && sessions.every(s => s.sourceInputsComplete), unknownReasons };
      const version = digest(JSON.stringify([content, inputVersion, requestSelection(q)]));
      const existing = (await client.query('SELECT payload FROM metric_revisions WHERE version=$1', [version])).rows[0];
      let payload: MetricsPage;
      if (existing) payload = existing.payload;
      else {
        const revision = Number((await client.query('SELECT COALESCE(max(revision),0)+1 AS n FROM metric_revisions WHERE scope_key=$1', [scopeKey])).rows[0].n);
        payload = { ...content, version, revision, createdAt: clock().toISOString(), nextOffset: null };
        if (Buffer.byteLength(JSON.stringify(payload)) > limits.exportBytes) throw bounded();
        await client.query('INSERT INTO metric_revisions(version,scope_key,revision,request,payload) VALUES($1,$2,$3,$4,$5)', [version, scopeKey, revision, requestSelection(q), payload]);
      }
      await client.query('COMMIT'); return payload;
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async function load(input: unknown): Promise<{ q: MetricsQuery; payload: MetricsPage }> {
    const q = metricsQuerySchema.parse(input);
    if (!q.version) return { q, payload: await compute(q) };
    const row = (await db.query('SELECT request,payload FROM metric_revisions WHERE version=$1', [q.version])).rows[0];
    if (!row) throw new HttpError(404, '固定指标版本不存在');
    if(q.week&&row.payload.scope.from!==q.week)throw new HttpError(409,'指标版本与指定周不一致');
    if (JSON.stringify(row.request) !== JSON.stringify(JSON.parse(JSON.stringify(requestSelection(q))))) {
      // PostgreSQL jsonb does not retain object key order.
      const wanted = requestSelection(q) as Record<string, unknown>, saved = row.request as Record<string, unknown>;
      if (Object.keys(wanted).length !== Object.keys(saved).length || Object.entries(wanted).some(([key, value]) => saved[key] !== value)) throw new HttpError(409, '固定指标版本与请求筛选范围不一致');
    }
    return { q, payload: row.payload };
  }
  async function readMetrics(input: unknown = {}): Promise<MetricsPage> {
    const q = metricsQuerySchema.parse(input);
    if (q.offset > 0 && !q.version) throw new HttpError(400, '后续分页必须指定第一页的固定 version');
    const { payload } = await load(q);
    return boundedPage({ ...payload, sessions: payload.sessions.slice(q.offset, q.offset + 20), nextOffset: q.offset + 20 < payload.sessions.length ? q.offset + 20 : null });
  }
  async function exportMetrics(input: unknown = {}): Promise<MetricsPage> { const { payload } = await load(input); return payload; }
  async function readCoverageMetrics(input: unknown,full=false) {
    const { date, view, ...filters } = coverageMetricsQuerySchema.parse(input);
    const q: MetricsQuery = { period: 'custom', from: view === 'day' ? date : addDays(date, -6), to: date, offset: 0, ...filters };
    const payload = q.version ? (await load(q)).payload : await compute(q,full);
    return boundedPage({ ...payload, sessions: payload.sessions.slice(0, 20), nextOffset: payload.sessions.length > 20 ? 20 : null });
  }
  async function recompute(input: unknown = {}): Promise<MetricsPage> {
    const q = metricsQuerySchema.parse(input); if (q.version || q.offset) throw new HttpError(400, '重算不能指定旧版本或分页位置');
    const payload = await compute(q, true);
    return boundedPage({ ...payload, sessions: payload.sessions.slice(0, 20), nextOffset: payload.sessions.length > 20 ? 20 : null });
  }
  async function readSessionMetrics(sessionId: string, input: unknown = {}) {
    const { payload } = await load(input); const sessions = payload.sessions.filter(s => s.sessionId === sessionId);
    if (!sessions.length) throw new HttpError(404, '所选范围内不存在该会话的指标');
    return boundedPage({ version: payload.version, scope: payload.scope, dataAsOf: payload.dataAsOf, catalogVersion: payload.catalogVersion, definition: payload.definition, sessions, totals: total(sessions) });
  }
  async function readSnapshotMetrics(snapshotId: string, input: unknown = {}) {
    if (!(await db.query('SELECT id FROM snapshots WHERE id=$1', [snapshotId])).rowCount) throw new HttpError(404, '快照不存在');
    const { payload } = await load(input);
    const originals = (await db.query('SELECT DISTINCT o.snapshot_id FROM effective_snapshot_events e JOIN effective_event_origins o ON o.event_id=e.event_id WHERE e.snapshot_id=$1', [snapshotId])).rows;
    const ids = new Set([snapshotId, ...originals.map(r => r.snapshot_id)]);
    const sessions = payload.sessions.filter(s => s.snapshotIds.some(id => ids.has(id)));
    return boundedPage({ version: payload.version, scope: payload.scope, dataAsOf: payload.dataAsOf, catalogVersion: payload.catalogVersion, definition: payload.definition, sessions, totals: total(sessions) });
  }
  return { readMetricCatalog, readMetrics, readSessionMetrics, readSnapshotMetrics, readCoverageMetrics, exportMetrics, recompute };
}
export type MetricsService = ReturnType<typeof metricsService>;
