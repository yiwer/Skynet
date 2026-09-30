import { z } from 'zod';
import { beijingDate, reportDate, type DailyItem, type DailyReport } from './reports.js';

export function addDays(date: string, days: number) { return beijingDate(new Date(new Date(`${date}T00:00:00+08:00`).getTime() + days * 86400_000)); }
export function monday(date: string) { const day = new Date(`${date}T00:00:00Z`).getUTCDay(); return addDays(date, -(day + 6) % 7); }
export const weekDate = reportDate.refine(date => monday(date) === date, '周起始日期必须是北京时间周一');
// On restart after Monday, retain the most recent due week. 09:00 is enqueue time.
export function dueWeek(now = new Date()) {
  const date = beijingDate(now); const start = monday(date);
  const beforeMondayNine = date === start && new Date(now.getTime() + 8 * 3600_000).getUTCHours() < 9;
  return addDays(start, beforeMondayNine ? -14 : -7);
}
export const workViewQuery = z.object({ kind: z.enum(['weekly', 'project']), subject: z.string().max(4096),
  from: reportDate, to: reportDate, offset: z.coerce.number().int().min(0).max(100000).default(0),
  revision: z.coerce.number().int().min(1).optional() }).strict();
export type WorkViewSelection = Pick<z.infer<typeof workViewQuery>, 'kind' | 'subject' | 'from' | 'to'>;
export type WorkViewItem = DailyItem & { employeeId: string; employee: string; sourceDate: string; dailyRevision: number; dailyVersion: string; dailyPath: string;
  continuation: 'inferred-theme-match' | 'unassigned' };
export type WorkView = WorkViewSelection & { subjectLabel: string; timeZone: 'Asia/Shanghai'; revision: number; version: string | null; createdAt: string | null;
  state: DailyReport['state']; refreshPending: boolean; items: WorkViewItem[]; nextOffset: number | null;
  participants: { employeeId: string; employee: string; dates: string[] }[];
  statistics: { records: number | null; userTurns: number | null; toolCalls: number | null; complete: boolean; files: null; tokens: null; activityIntervals: null; humanWorkHours: null; definition: string } | null;
  coverage: { messages: string[]; fixture: boolean; complete: boolean; omittedItems: number; boundedInputs: boolean;
    days: { employeeId: string; employee: string; date: string; state: string; revision: number; version: string | null; dailyPath: string;
      originalEventHash: string | null; originalEventCount: number | null; qualificationRevision: string | null; expectedQualificationRevision: string; eligibleInputsComplete: boolean }[] } | null };
export function dailyPath(employeeId: string, date: string, revision: number) {
  return `#daily?${new URLSearchParams({ employeeId, date, ...(revision ? { revision: String(revision) } : {}) })}`;
}
