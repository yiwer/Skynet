import type { EvidenceLine } from './contracts/archive.js';

export type ActivityContext = 'historical' | 'after-enrollment' | 'unknown-time' | 'unknown-enrollment';
export interface ActivityEvent extends EvidenceLine { context: ActivityContext; sourceDate: string | null }
export interface ActivityCounts { records: number; userTurns: number; toolCalls: number }
export interface ActivitySummary {
  timeZone: 'Asia/Shanghai';
  enrolledAt: string | null;
  sourceFrom: string | null;
  sourceTo: string | null;
  historicalRecords: number;
  unknownTimeRecords: number;
  unknownEnrollmentRecords: number;
  today: { date: string; counts: ActivityCounts | null };
  days: { date: string; historicalRecords: number; afterEnrollment: ActivityCounts }[];
}

// Source timestamps already carry an explicit offset. The calendar boundary is always Beijing.
export function beijingDate(value: string | Date) {
  return new Date(new Date(value).getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
const emptyCounts = (): ActivityCounts => ({ records: 0, userTurns: 0, toolCalls: 0 });
function count(counts: ActivityCounts, event: EvidenceLine, seenUserLines: Set<number>) {
  counts.records++;
  if (event.role === 'user' && !seenUserLines.has(event.line)) { counts.userTurns++; seenUserLines.add(event.line); }
  if (event.role === 'tool request') counts.toolCalls++;
}

/** Derived reading only: never changes source timestamps or the archived bytes. */
export function activityFor(events: EvidenceLine[], enrolledAt: string | undefined, today = beijingDate(new Date())) {
  const boundary = enrolledAt ? Date.parse(enrolledAt) : null;
  const days = new Map<string, ActivitySummary['days'][number]>();
  const userLines = new Map<string, Set<number>>();
  const summary: ActivitySummary = {
    timeZone: 'Asia/Shanghai', enrolledAt: enrolledAt ?? null, sourceFrom: null, sourceTo: null,
    historicalRecords: 0, unknownTimeRecords: 0, unknownEnrollmentRecords: 0,
    today: { date: today, counts: boundary === null ? null : emptyCounts() }, days: [],
  };
  let first = Infinity; let last = -Infinity;
  const classified: ActivityEvent[] = events.map(event => {
    const timestamp = event.timestamp === null ? NaN : Date.parse(event.timestamp);
    if (!Number.isFinite(timestamp)) {
      summary.unknownTimeRecords++;
      return { ...event, timestamp: null, context: 'unknown-time', sourceDate: null };
    }
    const sourceDate = beijingDate(event.timestamp!);
    if (timestamp < first) { first = timestamp; summary.sourceFrom = event.timestamp; }
    if (timestamp > last) { last = timestamp; summary.sourceTo = event.timestamp; }
    if (boundary === null) {
      summary.unknownEnrollmentRecords++;
      return { ...event, context: 'unknown-enrollment', sourceDate };
    }
    let day = days.get(sourceDate);
    if (!day) { day = { date: sourceDate, historicalRecords: 0, afterEnrollment: emptyCounts() }; days.set(sourceDate, day); userLines.set(sourceDate, new Set()); }
    const historical = timestamp < boundary;
    if (historical) { summary.historicalRecords++; day.historicalRecords++; }
    else {
      count(day.afterEnrollment, event, userLines.get(sourceDate)!);
    }
    return { ...event, context: historical ? 'historical' : 'after-enrollment', sourceDate };
  });
  summary.days = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
  if (boundary !== null) summary.today.counts = { ...(days.get(today)?.afterEnrollment ?? emptyCounts()) };
  return { events: classified, activity: summary };
}
