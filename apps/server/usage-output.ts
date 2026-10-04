import { digest, type Database } from './database.js';
import { HttpError } from './identities.js';
import type { MetricsService } from './metrics.js';
import type { sessionInsightsService } from './session-insights.js';
import { metricsQuerySchema, type MetricsQuery, type MetricTotals, type SessionMetrics } from '../../packages/contracts/metrics.js';
import type { OutputAmount, OutputTotals, UsageOutputPage, UsageSession } from '../../packages/contracts/usage-output.js';
import type { FactContribution, SessionInsights } from '../../packages/contracts/session-insights.js';

const catalogVersion = 'usage-output-1';
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
function outputTotals(rows: UsageSession[]): OutputTotals {
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
    const carriers = ids.length ? (await db.query(`SELECT s.id,s.device_id,s.source,s.source_session_id,s.committed_at FROM snapshots s
      WHERE EXISTS(SELECT 1 FROM snapshots base WHERE base.id=ANY($1::uuid[]) AND base.device_id=s.device_id
        AND base.source=s.source AND base.source_session_id=s.source_session_id)
      ORDER BY s.committed_at,s.id LIMIT 20001`, [ids])).rows : [];
    if (carriers.length > 20000) throw new HttpError(413, '产出范围超过原件数量上限');
    const views: SessionInsights[] = [];
    for (const carrier of carriers) views.push(await insights.read(carrier.id));
    const eventIds = [...new Set(views.flatMap(view => [...Object.values(view.facts).flatMap(fact => fact.contributions.map(item => item.eventId)),
      ...view.inferences?.outcomes.flatMap(outcome => outcome.citations.flatMap(cite => cite.origin ? [cite.origin.eventId] : [])) ?? []]))];
    const origins = new Map<string, any>(eventIds.length ? (await db.query(`SELECT event_id,employee_id,source_date,project,snapshot_id,context
      FROM effective_event_origins WHERE event_id=ANY($1::text[])`, [eventIds])).rows.map(row => [row.event_id, row]) : []);
    const mappings = carriers.length ? (await db.query(`SELECT DISTINCT se.snapshot_id,o.snapshot_id AS original FROM effective_snapshot_events se
      JOIN effective_event_origins o ON o.event_id=se.event_id WHERE se.snapshot_id=ANY($1::uuid[])`, [carriers.map(row => row.id)])).rows : [];
    const carrierOrigins = new Map<string, Set<string>>();
    for (const map of mappings) { const set = carrierOrigins.get(map.snapshot_id) ?? new Set(); set.add(map.original); carrierOrigins.set(map.snapshot_id, set); }
    const rows: UsageSession[] = metric.sessions.map(row => ({ ...row, selected: !q.employeeId || row.employeeId === q.employeeId, outputs: emptyOutputs(), insightVersions: [] }));
    const rowViews = rows.map(row => views.filter(view => row.snapshotIds.some(id => carrierOrigins.get(view.snapshotId)?.has(id))));
    for (const [index, row] of rows.entries()) {
      const inputs = rowViews[index]!;
      row.insightVersions = inputs.map(view => ({ snapshotId: view.snapshotId, version: view.version }));
      // The latest observation for each native carrier determines completeness;
      // superseded partial observations must not poison a complete continuation.
      const latest = new Map<string, SessionInsights>();
      for (const view of inputs) { const c = carriers.find(carrier => carrier.id === view.snapshotId)!; latest.set(JSON.stringify([c.device_id,c.source,c.source_session_id]), view); }
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
        if (citations.length !== outcome.citations.length || !citations.length) continue;
        const employees = new Set(citations.map(cite => cite.origin!.employeeId)), dates = new Set(citations.map(cite => cite.origin!.sourceDate));
        if (employees.size !== 1 || dates.size !== 1) continue;
        const origin = citations[0]!.origin!;
        const key = JSON.stringify(citations.map(cite => [cite.origin!.eventId,cite.textOffset,cite.quote]).sort());
        contributions.set(`${outcome.status}/${key}`, { kind: outcome.status, fact: { eventId: origin.eventId, employeeId: origin.employeeId,
          sourceDate: origin.sourceDate, snapshotId: origin.snapshotId, value: 1 } });
      }
    }
    for (const { kind, fact } of contributions.values()) {
      const origin = origins.get(fact.eventId);
      if (!origin || origin.context !== 'after-enrollment' || !origin.source_date || origin.source_date < metric.scope.from || origin.source_date > metric.scope.to) continue;
      const row = rows.find(row => row.employeeId === origin.employee_id && row.project === origin.project && row.snapshotIds.includes(origin.snapshot_id));
      if (!row) continue;
      const amount = row.outputs[kind]; amount.known += fact.value;
      for (const field of ['added','removed','passed','failed'] as const) amount[field] += fact[field] ?? 0;
    }
    for (const row of rows) for (const kind of kinds) if (row.outputs[kind].value !== null) row.outputs[kind].value = row.outputs[kind].known;
    const selected = rows.filter(row => row.selected);
    const employees = metric.employees.filter(person => !q.employeeId || person.employeeId === q.employeeId).map(person => {
      const mine = selected.filter(row => row.employeeId === person.employeeId);
      return { ...person, outputs: outputTotals(mine), agents: metric.sources.map(({ source }) => ({ source, ...totals(mine.filter(row => row.source === source)) })),
        daily: metric.employeeDaily?.filter(day => day.employeeId === person.employeeId).map(({ employeeId: _id, employee: _name, ...day }) => day) ?? [] };
    });
    const content = { metricVersion: metric.version, catalogVersion, scope: { ...metric.scope, ...(q.employeeId ? { employeeId: q.employeeId } : {}) },
      totals: q.employeeId ? totals(selected) : metric.totals, outputs: outputTotals(selected), employees,
      daily: q.employeeId ? employees[0]?.daily ?? [] : metric.daily, sessions: rows, nextOffset: null,
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
