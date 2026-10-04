import { digest, type Database } from './database.js';
import { HttpError } from './identities.js';
import type { MetricsService } from './metrics.js';
import type { sessionInsightsService } from './session-insights.js';
import { metricsQuerySchema, type MetricsQuery, type MetricTotals, type SessionMetrics } from '../../packages/contracts/metrics.js';
import type { OutputAmount, OutputTotals, UsageOutputPage, UsageSession } from '../../packages/contracts/usage-output.js';
import type { FactContribution, SessionInsights } from '../../packages/contracts/session-insights.js';

const catalogVersion = 'usage-output-2';
const kinds = ['verified', 'claimed', 'codeChanges', 'tests', 'commits'] as const;
type Kind = typeof kinds[number];
const selection = ({ version: _v, offset: _o, ...scope }: MetricsQuery) => scope;
const emptyAmount = (): OutputAmount => ({ value: 0, known: 0, unknownSessions: 0, added: 0, removed: 0, passed: 0, failed: 0 });
const emptyOutputs = (): OutputTotals => Object.fromEntries(kinds.map(kind => [kind, emptyAmount()])) as OutputTotals;
function totals(rows: SessionMetrics[]): MetricTotals {
  const inputUnknown = new Set(rows.filter(row => row.inputTokens === null).map(row => row.sessionId));
  const outputUnknown = new Set(rows.filter(row => row.outputTokens === null).map(row => row.sessionId));
  const sum = (key: 'userTurns'|'toolCalls'|'knownInputTokens'|'knownOutputTokens') => rows.reduce((n, row) => n + row[key], 0);
  return { sessions: new Set(rows.filter(row => row.sessions).map(row => row.sessionId)).size, userTurns: sum('userTurns'), toolCalls: sum('toolCalls'),
    knownInputTokens: sum('knownInputTokens'), knownOutputTokens: sum('knownOutputTokens'), inputTokens: inputUnknown.size ? null : sum('knownInputTokens'),
    outputTokens: outputUnknown.size ? null : sum('knownOutputTokens'), unknownInputSessions: inputUnknown.size, unknownOutputSessions: outputUnknown.size,
    unknownTokenSessions: new Set([...inputUnknown, ...outputUnknown]).size };
}
function outputTotals(rows: Pick<UsageSession, 'sessionId' | 'outputs'>[]): OutputTotals {
  const result = emptyOutputs();
  for (const kind of kinds) {
    const amount = result[kind];
    for (const row of rows) for (const field of ['known','added','removed','passed','failed'] as const) amount[field] += row.outputs[kind][field];
    amount.unknownSessions = new Set(rows.filter(row => row.outputs[kind].value === null).map(row => row.sessionId)).size;
    amount.value = amount.unknownSessions ? null : amount.known;
  }
  return result;
}
export async function migrateUsageOutput(db: Database) {
  await db.query(`CREATE TABLE IF NOT EXISTS usage_output_revisions(version text PRIMARY KEY,scope_key text NOT NULL,revision integer NOT NULL,
    request jsonb NOT NULL,payload jsonb NOT NULL,UNIQUE(scope_key,revision))`);
}
export function usageOutputService(db: Database, metrics: MetricsService, insights: ReturnType<typeof sessionInsightsService>) {
  async function compute(q: MetricsQuery, full = false): Promise<UsageOutputPage> {
    const metricQuery = { ...q, employeeId: undefined, version: undefined, offset: 0 };
    const metricHead = full ? await metrics.recompute(metricQuery) : await metrics.readMetrics(metricQuery);
    const metric = await metrics.exportMetrics({ ...metricQuery, version: metricHead.version });
    const ids = [...new Set(metric.sessions.flatMap(row => row.snapshotIds))];
    // Include every carrier of the selected native histories. Old rewrite inputs
    // remain evidence; continuations and verified copies share contribution IDs.
    const carriers = ids.length ? (await db.query(`WITH carrying AS MATERIALIZED (SELECT DISTINCT se.snapshot_id FROM effective_snapshot_events se
      JOIN effective_event_origins o ON o.event_id=se.event_id WHERE o.snapshot_id=ANY($1::uuid[]))
      SELECT s.id,s.device_id,s.source,s.source_session_id,s.committed_at,s.provenance,s.manifest->'restoredFrom'->>'materialId' AS restored_material_id FROM snapshots s
      WHERE s.id IN (SELECT snapshot_id FROM carrying) OR EXISTS(SELECT 1 FROM snapshots base WHERE base.id=ANY($1::uuid[]) AND base.device_id=s.device_id
        AND base.source=s.source AND base.source_session_id=s.source_session_id)
      ORDER BY s.committed_at,s.id LIMIT 20001`, [ids])).rows : [];
    if (carriers.length > 20000) throw new HttpError(413, '产出范围超过原件数量上限');
    const views = await insights.readMany(carriers.map(carrier => carrier.id), { full });
    const eventIds = [...new Set(views.flatMap(view => [...Object.values(view.facts).flatMap(fact => fact.contributions.map(item => item.eventId)),
      ...view.inferences?.outcomes.flatMap(outcome => outcome.citations.flatMap(cite => cite.origin ? [cite.origin.eventId] : [])) ?? []]))];
    const origins = new Map<string, any>(eventIds.length ? (await db.query(`SELECT event_id,employee_id,source_date,project,snapshot_id,context,source,source_session_id
      FROM effective_event_origins WHERE event_id=ANY($1::text[])`, [eventIds])).rows.map(row => [row.event_id, row]) : []);
    const mappings = carriers.length ? (await db.query(`SELECT DISTINCT se.snapshot_id,o.snapshot_id AS original,o.source,o.source_session_id FROM effective_snapshot_events se
      JOIN effective_event_origins o ON o.event_id=se.event_id WHERE se.snapshot_id=ANY($1::uuid[])`, [carriers.map(row => row.id)])).rows : [];
    const carrierOrigins = new Map<string, Set<string>>();
    const originKey=(snapshotId:string,source:string,sessionId:string)=>JSON.stringify([snapshotId,source,sessionId]);
    for (const map of mappings) { const set = carrierOrigins.get(map.snapshot_id) ?? new Set(); set.add(originKey(map.original,map.source,map.source_session_id)); carrierOrigins.set(map.snapshot_id, set); }
    const byCarrier = new Map(carriers.map(carrier => [carrier.id,carrier]));
    const newest = new Map(carriers.map(carrier => [JSON.stringify([carrier.device_id,carrier.source,carrier.source_session_id]),carrier.id]));
    const leaves = new Set<string>(newest.values());
    for (const id of newest.values()) {
      let carrier=byCarrier.get(id); const visited=new Set<string>();
      while(carrier?.provenance?.sourceSnapshotId && carrier.provenance.relation !== 'unconfirmed') {
        if(carrier.restored_material_id)break;
        const parent=carrier.provenance.sourceSnapshotId; if(visited.has(parent)||visited.size>=128)throw new HttpError(409,'会话谱系循环或过长');visited.add(parent);
        if(byCarrier.get(parent)?.source_session_id!==carrier.source_session_id)break;
        leaves.delete(parent);carrier=byCarrier.get(parent);
      }
    }
    const rows: UsageSession[] = metric.sessions.map(row => ({ ...row, selected: !q.employeeId || row.employeeId === q.employeeId, outputs: emptyOutputs(), insightVersions: [], latestCarrierSnapshotIds: [] }));
    const rowViews = rows.map(row => views.filter(view => row.snapshotIds.some(id => carrierOrigins.get(view.snapshotId)?.has(originKey(id,row.source,row.sourceSessionId)))));
    for (const [index, row] of rows.entries()) {
      const inputs = rowViews[index]!;
      row.insightVersions = inputs.map(view => ({ snapshotId: view.snapshotId, version: view.version }));
      row.latestCarrierSnapshotIds=inputs.filter(view=>leaves.has(view.snapshotId)).map(view=>view.snapshotId);
      const target=inputs.findLast(view=>row.latestCarrierSnapshotIds.includes(view.snapshotId));
      if(target)row.webPath=`#${target.snapshotId}?insightVersion=${target.version}`;
      // The latest observation for each native carrier determines completeness;
      // superseded partial observations must not poison a complete continuation.
      const latest = new Map(inputs.filter(view=>leaves.has(view.snapshotId)).map(view=>[view.snapshotId,view]));
      for (const kind of kinds) {
        const complete = latest.size > 0 && [...latest.values()].every(view => kind === 'verified' || kind === 'claimed' ? view.metrics[kind] !== null : view.facts[kind].complete);
        if (!complete) { row.outputs[kind].value = null; row.outputs[kind].unknownSessions = 1; }
      }
    }
    const contributions = new Map<string, { kind: Kind; fact: FactContribution }>();
    for (const view of views) {
      for (const kind of ['codeChanges','tests','commits'] as const) for (const fact of view.facts[kind].contributions) contributions.set(`${kind}/${fact.eventId}`, { kind, fact });
      for (const outcome of view.inferences?.outcomes ?? []) {
        if (outcome.status === 'inferred') continue;
        const citations = outcome.citations.filter(cite => cite.origin && cite.context === 'after-enrollment');
        const employees = new Set(citations.map(cite => cite.origin!.employeeId)), dates = new Set(citations.map(cite => cite.origin!.sourceDate)), projects=new Set(citations.map(cite=>cite.origin!.project));
        if (citations.length !== outcome.citations.length || !citations.length || employees.size !== 1 || dates.size !== 1 || dates.has(null) || projects.size !== 1) {
          if(outcome.citations.some(cite=>cite.context==='after-enrollment'||cite.context==='unknown-time'))for(const [index,row] of rows.entries())if(rowViews[index]!.some(input=>input.snapshotId===view.snapshotId)){
            row.outputs[outcome.status].value=null;row.outputs[outcome.status].unknownSessions=1;
          }
          continue;
        }
        const origin = citations[0]!.origin!;
        const key = JSON.stringify(citations.map(cite => [cite.origin!.eventId,cite.textOffset,cite.quote]).sort());
        contributions.set(`${outcome.status}/${key}`, { kind: outcome.status, fact: { eventId: origin.eventId, employeeId: origin.employeeId,
          sourceDate: origin.sourceDate, snapshotId: origin.snapshotId, value: 1 } });
      }
    }
    const scopedRows = new Map<string,UsageSession>();
    const datedOutputs = new Map<UsageSession, Map<string, OutputTotals>>();
    const dateOutput = (row: UsageSession, date: string) => {
      let days = datedOutputs.get(row); if (!days) { days = new Map(); datedOutputs.set(row, days); }
      let value = days.get(date); if (!value) {
        value = emptyOutputs();
        for (const kind of kinds) if (row.outputs[kind].value === null) { value[kind].value = null; value[kind].unknownSessions = 1; }
        days.set(date, value);
      }
      return value;
    };
    for(const row of rows)for(const snapshotId of row.snapshotIds)scopedRows.set(JSON.stringify([row.employeeId,row.project,snapshotId,row.source,row.sourceSessionId]),row);
    for (const row of rows) for (const date of row.dates) dateOutput(row, date);
    for (const { kind, fact } of contributions.values()) {
      const origin = origins.get(fact.eventId);
      if (!origin || origin.context !== 'after-enrollment' || !origin.source_date || origin.source_date < metric.scope.from || origin.source_date > metric.scope.to) continue;
      const row = scopedRows.get(JSON.stringify([origin.employee_id,origin.project,origin.snapshot_id,origin.source,origin.source_session_id]));
      if (!row) continue;
      const amount = row.outputs[kind]; amount.known += fact.value;
      for (const field of ['added','removed','passed','failed'] as const) amount[field] += fact[field] ?? 0;
      const daily = dateOutput(row, origin.source_date)[kind]; daily.known += fact.value;
      for (const field of ['added','removed','passed','failed'] as const) daily[field] += fact[field] ?? 0;
    }
    for (const row of rows) for (const kind of kinds) if (row.outputs[kind].value !== null) row.outputs[kind].value = row.outputs[kind].known;
    const selected = rows.filter(row => row.selected);
    for (const days of datedOutputs.values()) for (const value of days.values()) for (const kind of kinds) if (value[kind].value !== null) value[kind].value = value[kind].known;
    const dailyOutputs = (mine: UsageSession[], date: string) => outputTotals(mine.flatMap(row => {
      const outputs = datedOutputs.get(row)?.get(date); return outputs ? [{ sessionId: row.sessionId, outputs }] : [];
    }));
    const employees = metric.employees.filter(person => !q.employeeId || person.employeeId === q.employeeId).map(person => {
      const mine = selected.filter(row => row.employeeId === person.employeeId);
      return { ...person, activeDates: metric.employeeDaily?.find(series=>series.employeeId===person.employeeId)?.days.filter(day=>day.activeSessions>0).map(day=>day.date)??[], outputs: outputTotals(mine), agents: metric.sources.map(({ source }) => ({ source, ...totals(mine.filter(row => row.source === source)) })),
        daily: (metric.employeeDaily?.find(series => series.employeeId === person.employeeId)?.days ?? []).map(day => ({ ...day, outputs: { verified: dailyOutputs(mine, day.date).verified } })) };
    });
    const content = { metricVersion: metric.version, catalogVersion, scope: { ...metric.scope, ...(q.employeeId ? { employeeId: q.employeeId } : {}) },
      totals: q.employeeId ? totals(selected) : metric.totals, outputs: outputTotals(selected), employees,
      daily: q.employeeId ? employees[0]?.daily ?? [] : metric.daily.map(day=>({date:day.date,activeSessions:day.sessions,...(day.tokenTrend??{inputTokens:day.inputTokens,outputTokens:day.outputTokens,includedSessions:day.sessions-day.unknownTokenSessions,excludedSessions:day.unknownTokenSessions}),outputs:{verified:dailyOutputs(selected,day.date).verified}})), sessions: rows, nextOffset: null,
      sourceInputsComplete: metric.sourceInputsComplete, unknownReasons: metric.unknownReasons, dataAsOf: metric.dataAsOf };
    const version = digest(JSON.stringify(content)), request = selection(q), scopeKey = digest(JSON.stringify(request));
    const client = await db.connect();
    try {
      await client.query('BEGIN; SELECT pg_advisory_xact_lock(7402140)');
      const old = (await client.query('SELECT payload FROM usage_output_revisions WHERE version=$1', [version])).rows[0];
      if (old) { await client.query('COMMIT'); return old.payload; }
      const revision = Number((await client.query('SELECT COALESCE(max(revision),0)+1 AS n FROM usage_output_revisions WHERE scope_key=$1', [scopeKey])).rows[0].n);
      const payload: UsageOutputPage = { ...content, version, revision, createdAt: new Date().toISOString() };
      if (Buffer.byteLength(JSON.stringify(payload)) > 16 * 1024 * 1024) throw new HttpError(413, '产出导出超过范围上限');
      await client.query('INSERT INTO usage_output_revisions(version,scope_key,revision,request,payload) VALUES($1,$2,$3,$4,$5)', [version, scopeKey, revision, request, payload]);
      await client.query('COMMIT'); return payload;
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async function load(input: unknown = {}, full = false) {
    const q = metricsQuerySchema.parse(input);
    if (full && (q.version || q.offset)) throw new HttpError(400, '重算不能指定旧版本或分页');
    if (!q.version) return { q, payload: await compute(q, full) };
    const record = (await db.query('SELECT request,payload FROM usage_output_revisions WHERE version=$1', [q.version])).rows[0];
    if (!record) throw new HttpError(404, '产出版本不存在');
    const wanted = selection(q);
    if (Object.keys(record.request).length !== Object.keys(wanted).length || Object.entries(wanted).some(([key, value]) => record.request[key] !== value)) throw new HttpError(409, '产出版本与筛选不一致');
    return { q, payload: record.payload as UsageOutputPage };
  }
  async function read(input: unknown = {}, full = false) {
    const q = metricsQuerySchema.parse(input);
    if (q.offset && !q.version) throw new HttpError(400, '后续分页需要固定版本');
    const { payload } = await load(q, full);
    const result = { ...payload, sessions: payload.sessions.slice(q.offset, q.offset + 20), nextOffset: payload.sessions.length > q.offset + 20 ? q.offset + 20 : null };
    if (Buffer.byteLength(JSON.stringify(result)) > 80 * 1024) throw new HttpError(413, '产出响应超过范围上限，请缩小筛选');
    return result;
  }
  return { read, recompute: (input: unknown) => read(input, true), export: async (input: unknown) => (await load(input)).payload };
}
