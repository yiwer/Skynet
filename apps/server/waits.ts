import { digest, type Database } from './database.js';
import { HttpError } from './identities.js';
import type { RawStore } from './raw-store.js';
import { waitAlgorithmVersion } from './wait-inputs.js';
import { waitDataset, waitEvidence, waitBounded, type WaitOriginal } from './wait-dataset.js';
import { waitsQuerySchema, type WaitsQuery, type WaitsPage, type ReplyWait, type WaitsScope } from '../../packages/contracts/waits.js';
import { beijingDate } from '../../packages/contracts/reports.js';
import { monday, addDays } from '../../packages/contracts/work-views.js';

const definition = '原生本轮结束至下一条真实用户消息；末尾空闲不计，满 10 分钟为长等待。并行仅表示同一员工在区间内有其他逻辑会话活动（含其他项目和 Agent），边界相邻不算。按北京时间拆日，重叠会话分别保留，不换算工时。权限请求与决定缺少来源时单列未知。';
const selection = (q: WaitsQuery): Partial<WaitsScope> => ({ ...(q.snapshotId ? { snapshotId: q.snapshotId } : { period: q.period }),
  ...(q.employeeId ? { employeeId: q.employeeId } : {}), ...(q.source ? { source: q.source } : {}), ...(q.project !== undefined ? { project: q.project } : {}) });
type Activity = { employeeId: string; sessionId: string; timestamp: number; evidence: ReplyWait['end'] };
function parallelLookup(events: Activity[]) {
  const employees = new Map<string, { rows: Activity[]; nextSession: number[] }>();
  for (const event of events) {
    if (!employees.has(event.employeeId)) employees.set(event.employeeId, { rows: [], nextSession: [] });
    employees.get(event.employeeId)!.rows.push(event);
  }
  for (const { rows, nextSession } of employees.values()) {
    rows.sort((a, b) => a.timestamp - b.timestamp);
    for (let index = rows.length - 1; index >= 0; index--) nextSession[index] = rows[index]?.sessionId === rows[index + 1]?.sessionId ? nextSession[index + 1]! : index + 1;
  }
  return (wait: ReplyWait) => {
    const index = employees.get(wait.employeeId); if (!index) return [];
    const { rows, nextSession } = index, start = Date.parse(wait.startedAt!), end = Date.parse(wait.endedAt!);
    let lo = 0, hi = rows.length;
    while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if (rows[mid]!.timestamp <= start) lo = mid + 1; else hi = mid; }
    const found: ReplyWait['end'][] = [];
    // Skip whole same-session runs, including verified restore prefixes. Work per
    // wait is logarithmic plus at most three retained foreign evidence points.
    while (lo < rows.length && rows[lo]!.timestamp < end && found.length < 3) {
      if (rows[lo]!.sessionId === wait.sessionId) lo = nextSession[lo]!;
      else { found.push(rows[lo]!.evidence); lo++; }
    }
    return found;
  };
}
export async function migrateWaits(db: Database) {
  await db.query(`CREATE TABLE IF NOT EXISTS wait_input_revisions(version text PRIMARY KEY,snapshot_id uuid NOT NULL REFERENCES snapshots(id),payload jsonb NOT NULL);
    CREATE TABLE IF NOT EXISTS wait_revisions(version text PRIMARY KEY,scope_key text NOT NULL,revision integer NOT NULL,payload jsonb NOT NULL,UNIQUE(scope_key,revision));`);
}
export function waitsService(db: Database, raw: RawStore, clock: () => Date = () => new Date()) {
  async function computeOnce(q: WaitsQuery, full: boolean): Promise<WaitsPage> {
    const client = await db.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      const scope: WaitsScope = { timeZone: 'Asia/Shanghai', ...(q.snapshotId ? { snapshotId: q.snapshotId } : { period: q.period }),
        ...(q.employeeId ? { employeeId: q.employeeId } : {}), ...(q.source ? { source: q.source } : {}), ...(q.project !== undefined ? { project: q.project } : {}) };
      if (!q.snapshotId) {
        const today = beijingDate(clock());
        if (q.period === 'since-enrollment') {
          const first = (await client.query('SELECT min(enrolled_at) AS first FROM devices WHERE ($1::uuid IS NULL OR employee_id=$1)', [q.employeeId ?? null])).rows[0].first;
          scope.from = first ? beijingDate(first) : today; scope.to = today;
        } else { scope.from = addDays(monday(today), q.period === 'last-week' ? -7 : 0); scope.to = addDays(scope.from, 6); }
        if (Date.parse(scope.to!) - Date.parse(scope.from!) > 3660 * 86400_000) throw waitBounded();
      }
      const scopeKey = digest(JSON.stringify(scope));
      const lock = (await client.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,3701)) AS locked', [scopeKey])).rows[0];
      if (!lock.locked) throw new HttpError(409, '等待记录正在计算，请稍后重试');
      let employees: string[] | null = q.employeeId ? [q.employeeId] : null;
      if (q.snapshotId && !employees) employees = (await client.query(`SELECT d.employee_id FROM snapshots s JOIN devices d ON d.id=s.device_id WHERE s.id=$1
        UNION SELECT o.employee_id FROM effective_snapshot_events se JOIN effective_event_origins o ON o.event_id=se.event_id WHERE se.snapshot_id=$1`, [q.snapshotId])).rows.map(row => row.employee_id);
      const originals = await waitDataset(client, raw, full, employees);
      if (q.snapshotId && !originals.some(original => original.record.id === q.snapshotId)) throw new HttpError(404, '未找到会话原件');
      if (q.employeeId && !(await client.query('SELECT id FROM employees WHERE id=$1', [q.employeeId])).rowCount) throw new HttpError(404, '员工不存在');
      const rangeStart = scope.from ? Date.parse(scope.from + 'T00:00:00+08:00') : -Infinity;
      const rangeEnd = scope.to ? Date.parse(addDays(scope.to, 1) + 'T00:00:00+08:00') : Infinity;
      const candidates = new Map<string, ReplyWait>(), selected = new Set<WaitOriginal>();
      const activity = new Map<string, Activity>();
      for (const original of originals) {
        const { record, facts, sessionId } = original;
        const origins = new Map(original.origins.map(origin => [`${origin.line}/${origin.block}`, origin]));
        for (const message of facts.messages) {
          const origin = origins.get(`${message.line}/${message.block ?? 0}`), timestamp = message.timestamp ? Date.parse(message.timestamp) : NaN;
          if (origin?.context === 'after-enrollment' && Number.isFinite(timestamp) && !activity.has(origin.eventId)) {
            activity.set(origin.eventId, { employeeId: origin.employeeId, sessionId, timestamp, evidence: waitEvidence(original, message.line, message.block ?? 0) });
          }
        }
        if (q.snapshotId && record.id !== q.snapshotId || q.source && record.source !== q.source) continue;
        const owned = original.origins.filter(origin => origin.context === 'after-enrollment' && (!q.employeeId || origin.employeeId === q.employeeId)
          && (q.project === undefined || origin.project === q.project) && (q.snapshotId || origin.sourceDate! >= scope.from! && origin.sourceDate! <= scope.to!));
        if (q.snapshotId || owned.length) selected.add(original);
        for (const pair of facts.pairs) {
          const end = origins.get(`${pair.end.line}/${pair.end.block ?? 0}`);
          if (!end || end.context === 'historical' || q.employeeId && end.employeeId !== q.employeeId || q.project !== undefined && end.project !== q.project) continue;
          let lo = 0, hi = facts.messages.length; const boundaryLine = pair.start?.line ?? pair.end.line;
          while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if (facts.messages[mid]!.line < boundaryLine) lo = mid + 1; else hi = mid; }
          const prior = facts.messages[lo - 1];
          const before = prior && origins.get(`${prior.line}/${prior.block ?? 0}`);
          const ownerMatches = before?.context === 'after-enrollment' && before.employeeId === end.employeeId;
          const startedAt = pair.start?.timestamp ?? null, endedAt = pair.end.timestamp;
          const elapsed = startedAt && endedAt ? Date.parse(endedAt) - Date.parse(startedAt) : NaN;
          const valid = !!pair.start?.turnId && ownerMatches && end.context === 'after-enrollment' && Number.isSafeInteger(elapsed) && elapsed >= 0;
          const start = startedAt ? Date.parse(startedAt) : NaN, finish = endedAt ? Date.parse(endedAt) : NaN;
          if (!q.snapshotId && (valid ? finish < rangeStart || start >= rangeEnd
            : Number.isFinite(finish) ? finish < rangeStart || finish >= rangeEnd : !(start >= rangeStart && start < rangeEnd) && !owned.length)) continue;
          selected.add(original);
          const id = digest(JSON.stringify([end.eventId]));
          const item: ReplyWait = { id, sessionId, snapshotId: record.id, source: record.source, employeeId: end.employeeId, employee: end.employee, project: end.project,
            turnId: pair.start?.turnId ?? null, startedAt, endedAt, durationMs: valid ? elapsed : null,
            durationInScopeMs: valid ? Math.max(0, Math.min(finish, rangeEnd) - Math.max(start, rangeStart)) : null, long: valid && elapsed >= 600_000,
            reason: valid ? null : '缺少可确认的本轮结束、时间或同一员工归属', start: pair.start ? waitEvidence(original, pair.start.line, 0, true) : null,
            end: waitEvidence(original, pair.end.line, pair.end.block ?? 0), displayLine: pair.end.line, parallel: 'unknown', parallelEvidence: [] };
          const priorItem = candidates.get(id);
          if (!priorItem) candidates.set(id, item);
          else if (priorItem.startedAt !== item.startedAt || priorItem.endedAt !== item.endedAt || priorItem.turnId !== item.turnId) {
            priorItem.durationMs = null; priorItem.durationInScopeMs = null; priorItem.long = false; priorItem.reason = '同一用户消息之前的轮次边界存在冲突';
          }
        }
      }
      const intervals = [...candidates.values()].sort((a, b) => (a.endedAt ?? '').localeCompare(b.endedAt ?? '') || a.id.localeCompare(b.id));
      const parallelFor = parallelLookup([...activity.values()]);
      for (const interval of intervals) if (interval.durationMs !== null) {
        const parallel = parallelFor(interval);
        interval.parallel = parallel.length ? 'observed' : 'not-observed'; interval.parallelEvidence = parallel;
      }
      const replySupport = [...selected].some(original => original.facts.boundaries.some(boundary => boundary.kind === 'completed' && boundary.turnId && boundary.timestamp)) ? 'observed' as const : 'unknown' as const;
      const unknownReasons = [...new Set([...selected].flatMap(({ record, facts }) => [
        ...(!facts.boundaries.some(boundary => boundary.kind === 'completed' && boundary.turnId && boundary.timestamp) ? ['部分来源未记录可识别的本轮结束'] : []),
        ...(record.manifest.capture?.partialLine || record.manifest.capture?.gaps.length || record.manifest.capture?.compacted ? ['来源材料存在压缩或采集缺口'] : [])]))];
      if (!selected.size) unknownReasons.push('尚无所选范围的来源材料');
      const known = intervals.filter(interval => interval.durationMs !== null), unknown = intervals.length - known.length;
      const knownReplyWaitMs = known.reduce((sum, interval) => sum + interval.durationInScopeMs!, 0);
      if (!Number.isSafeInteger(knownReplyWaitMs)) throw waitBounded();
      const days = new Map<string, { date: string; knownReplyWaitMs: number; unknownReplyWaitCount: number }>();
      const day = (date: string) => { if (!days.has(date)) days.set(date, { date, knownReplyWaitMs: 0, unknownReplyWaitCount: 0 }); return days.get(date)!; };
      for (const interval of intervals) {
        if (interval.durationMs === null) { if (interval.endedAt) day(beijingDate(new Date(interval.endedAt))).unknownReplyWaitCount++; continue; }
        let start = Math.max(Date.parse(interval.startedAt!), rangeStart); const end = Math.min(Date.parse(interval.endedAt!), rangeEnd);
        while (start < end) {
          const date = beijingDate(new Date(start)), next = Date.parse(addDays(date, 1) + 'T00:00:00+08:00');
          day(date).knownReplyWaitMs += Math.min(next, end) - start; start = next;
          if (days.size > 3661) throw waitBounded();
        }
      }
      const content = { scope, algorithmVersion: waitAlgorithmVersion, summary: { replyWaitCount: known.length, unknownReplyWaitCount: unknown,
        replyWaitMs: unknown || unknownReasons.length ? null : knownReplyWaitMs, knownReplyWaitMs, longWaitCount: known.filter(interval => interval.long).length,
        permissionWaitMs: null, permissionWaitCount: null }, intervals, total: intervals.length, nextOffset: null,
        daily: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)), replySupport, permissionSupport: 'unknown' as const, unknownReasons, definition,
        dataAsOf: originals.at(-1)?.record.committed_at.toISOString() ?? null };
      const version = digest(JSON.stringify([content, originals.map(original => [original.record.id, original.record.hash, original.revision, original.sessionId])]));
      const saved = (await client.query('SELECT payload FROM wait_revisions WHERE version=$1', [version])).rows[0];
      if (saved) { await client.query('COMMIT'); return saved.payload; }
      const next = Number((await client.query('SELECT COALESCE(MAX(revision),0)+1 AS next FROM wait_revisions WHERE scope_key=$1', [scopeKey])).rows[0].next);
      const payload: WaitsPage = { ...content, version, revision: next, createdAt: clock().toISOString() };
      await client.query('INSERT INTO wait_revisions(version,scope_key,revision,payload) VALUES($1,$2,$3,$4)', [version, scopeKey, next, payload]);
      await client.query('COMMIT'); return payload;
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async function compute(q: WaitsQuery, full: boolean) {
    for (let attempt = 0; ; attempt++) try { return await computeOnce(q, full); }
    catch (error) {
      if (!['40001', '40P01'].includes((error as { code?: string }).code ?? '')) throw error;
      if (attempt >= 2) throw new HttpError(409, '等待来源正在更新，请稍后重试');
    }
  }
  async function read(input: unknown, full = false, exporting = false) {
    const q = waitsQuerySchema.parse(input); let result: WaitsPage;
    if (q.version) {
      if (full) throw new HttpError(400, '重算请使用当前范围，固定版本保持不变');
      const row = (await db.query('SELECT payload FROM wait_revisions WHERE version=$1', [q.version])).rows[0];
      if (!row) throw new HttpError(404, '等待记录版本不存在');
      result = row.payload;
      // Fixed dates remain readable after the week rolls over; compare selection,
      // not the newly resolved current date window.
      const requested = selection(q);
      if (!q.contextSnapshotId) for (const key of ['snapshotId', 'period', 'employeeId', 'source', 'project'] as const) if (requested[key] !== result.scope[key]) throw new HttpError(400, '等待记录版本不属于当前范围');
    } else result = await compute(q, full);
    const lines = q.lines ? new Set(q.lines.split(',').map(Number)) : null;
    const page = exporting ? result : { ...result,
      intervals: lines ? result.intervals.filter(interval => lines.has(interval.displayLine) && (!q.contextSnapshotId || interval.snapshotId === q.contextSnapshotId)) : result.intervals.slice(q.offset, q.offset + 25),
      nextOffset: lines ? null : q.offset + 25 < result.total ? q.offset + 25 : null };
    if (Buffer.byteLength(JSON.stringify(page)) > (exporting ? 16 * 1024 * 1024 : 80 * 1024)) throw waitBounded();
    return page;
  }
  return { read, recompute: (input: unknown) => read(input, true), export: (input: unknown) => read(input, false, true) };
}
