import { z } from 'zod';
import type { AnalysisItem } from './analysis.js';

export const reportDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00+08:00`);
  return Number.isFinite(date.getTime()) && beijingDate(date) === value;
}, '无效的北京时间日期');
export function beijingDate(now = new Date()) { return new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10); }
export function previousDate(date: string) { return beijingDate(new Date(new Date(`${date}T00:00:00+08:00`).getTime() - 86400_000)); }
// The public schedule is enqueue time, never a promise that model work is finished.
export function dueReportDate(now = new Date()) {
  return new Date(now.getTime() + 8 * 3600_000).getUTCHours() >= 9 ? previousDate(beijingDate(now)) : null;
}
export type DailyItem = AnalysisItem & { project: string; theme: string; themeAssociation: 'topic-record' | 'inferred-single-topic' | 'unassigned'; analysisId: string;
  activityEventIds: string[]; backgroundCitations: AnalysisItem['citations']; fixture: boolean };
export type DailyReport = { employeeId: string; employee: string; date: string; timeZone: 'Asia/Shanghai';
  revision: number; version: string | null; state: 'not-scheduled' | 'queued' | 'waiting-analysis' | 'ready' | 'partial' | 'unavailable';
  createdAt: string | null; items: DailyItem[]; nextOffset: number | null;
  statistics: { records: number; userTurns: number; toolCalls: number; historicalRecords: number; unknownRecords: number;
    files: null; tokens: null; activityIntervals: null; humanWorkHours: null; definition: string } | null;
  coverage: { messages: string[]; inputs: { snapshotId: string; hash: string; analysisId: string | null; state: string }[];
    originalEventIdsSample: string[]; originalEventCount: number; originalEventHash: string;
    eligibleInputsComplete: boolean; dailyDeviceCoverage: 'unknown'; fixture: boolean } | null;
};
