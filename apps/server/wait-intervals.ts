import { digest } from './database.js';
import { waitEvidence,unavailableOwners,type WaitOriginal } from './wait-dataset.js';
import type { ReplyWait,WaitsScope } from '../../packages/contracts/waits.js';
import { addDays } from '../../packages/contracts/work-views.js';

type Activity = { employeeId: string; sessionId: string; timestamp: number; original: WaitOriginal; line: number; block: number };
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
      else { const row = rows[lo]!; found.push(waitEvidence(row.original, row.line, row.block)); lo++; }
    }
    return found;
  };
}

/** Shared immutable source calculation for waiting reports and activity lanes. */
export function waitIntervals(originals:WaitOriginal[],scope:WaitsScope){
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
      activity.set(origin.eventId, { employeeId: origin.employeeId, sessionId, timestamp, original, line: message.line, block: message.block ?? 0 });
    }
  }
  if (scope.snapshotId && record.id !== scope.snapshotId || scope.source && record.source !== scope.source) continue;
  if(original.unavailable){if(unavailableOwners(original,scope).length||scope.snapshotId)selected.add(original);continue;}
  const owned = original.origins.filter(origin => origin.context === 'after-enrollment' && (!scope.employeeId || origin.employeeId === scope.employeeId)
    && (scope.project === undefined || origin.project === scope.project) && (scope.snapshotId || origin.sourceDate! >= scope.from! && origin.sourceDate! <= scope.to!));
  if (scope.snapshotId || owned.length) selected.add(original);
  for (const pair of facts.pairs) {
    const end = origins.get(`${pair.end.line}/${pair.end.block ?? 0}`);
    if (!end || end.context === 'historical' || scope.employeeId && end.employeeId !== scope.employeeId || scope.project !== undefined && end.project !== scope.project) continue;
    let lo = 0, hi = facts.messages.length; const boundaryLine = pair.start?.line ?? pair.end.line;
    while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if (facts.messages[mid]!.line < boundaryLine) lo = mid + 1; else hi = mid; }
    const prior = facts.messages[lo - 1];
    const before = prior && origins.get(`${prior.line}/${prior.block ?? 0}`);
    const ownerMatches = before?.context === 'after-enrollment' && before.employeeId === end.employeeId;
    const startedAt = pair.start?.timestamp ?? null, endedAt = pair.end.timestamp;
    const elapsed = startedAt && endedAt ? Date.parse(endedAt) - Date.parse(startedAt) : NaN;
    const valid = !!pair.start?.turnId && ownerMatches && end.context === 'after-enrollment' && Number.isSafeInteger(elapsed) && elapsed >= 0;
    const start = startedAt ? Date.parse(startedAt) : NaN, finish = endedAt ? Date.parse(endedAt) : NaN;
    if (!scope.snapshotId && (valid ? finish < rangeStart || start >= rangeEnd
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
const unavailableSessions = new Map<string, Set<string>>();
for (const original of originals) for (const owner of unavailableOwners(original)) {
  let sessions = unavailableSessions.get(owner.employeeId);
  if (!sessions) unavailableSessions.set(owner.employeeId, sessions = new Set());
  sessions.add(original.sessionId);
}
for (const interval of intervals) if (interval.durationMs !== null) {
  const parallel = parallelFor(interval);
  const unavailable = unavailableSessions.get(interval.employeeId);
  interval.parallel = parallel.length ? 'observed' : unavailable && (unavailable.size > 1 || !unavailable.has(interval.sessionId)) ? 'unknown' : 'not-observed'; interval.parallelEvidence = parallel;
}
return {intervals,selected,rangeStart,rangeEnd};
}
