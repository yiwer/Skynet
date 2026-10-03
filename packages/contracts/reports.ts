import { z } from 'zod';
import type { AnalysisItem } from './analysis.js';
import type {WorkStatistics,RecordedTokens} from './coverage.js';

export type FrozenStatisticReference={employeeId:string;date:string;revision:number;version:string};
export type FrozenStatisticSummary={files:Pick<WorkStatistics['files'],'observedCount'|'complete'|'unsupportedToolCalls'>|null;
  tokens:Pick<RecordedTokens,'total'|'input'|'output'|'cachedInput'|'cacheWriteInput'|'reasoningOutput'>|null;
  activityIntervalCount:number|null;sourceInputsComplete:boolean};

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
export type DailyItem = AnalysisItem & { project: string;originalProject?:string;projectCorrectionId?:string; theme: string; themeAssociation: 'topic-record' | 'inferred-single-topic' | 'unassigned' | 'manual-correction'; analysisId: string;originalTheme?:string;correctionId?:string;
  activityEventIds: string[]; backgroundCitations: AnalysisItem['citations']; fixture: boolean };
const correctionBase={requestId:z.uuid(),expectedRevision:z.number().int().min(1),reason:z.string().trim().min(1).max(1000)};
export const correctionInput = z.discriminatedUnion('kind',[
  z.object({...correctionBase,kind:z.literal('note'),note:z.string().trim().min(1).max(2000)}).strict(),
  z.object({...correctionBase,kind:z.literal('theme'),theme:z.string().trim().min(1).max(500),eventIds:z.array(z.string().min(1).max(128)).min(1).max(50)}).strict(),
  z.object({...correctionBase,kind:z.literal('project'),project:z.string().trim().max(1024),eventIds:z.array(z.string().min(1).max(128)).min(1).max(50)}).strict(),
  z.object({...correctionBase,kind:z.literal('reanalyze')}).strict()
]);
export type ReportCorrection = z.infer<typeof correctionInput> & {id:string;sequence:number;actorId:string;actor:string;createdAt:string};
export type DailyReport = { employeeId: string; employee: string; date: string; timeZone: 'Asia/Shanghai';
  revision: number; version: string | null; state: 'not-scheduled' | 'queued' | 'waiting-analysis' | 'ready' | 'partial' | 'unavailable';
  createdAt: string | null; items: DailyItem[]; nextOffset: number | null;
  refreshPending: boolean;
  corrections?: ReportCorrection[];
  correctionCount?: number;
  statistics: { records: number; userTurns: number; toolCalls: number; historicalRecords: number; unknownRecords: number;
    files: Pick<WorkStatistics['files'],'observedCount'|'complete'|'unsupportedToolCalls'>|null; tokens: RecordedTokens|null;
    activityIntervals: WorkStatistics['intervals']|null; sourceInputsComplete?:boolean; humanWorkHours: null; definition: string } | null;
  coverage: { messages: string[]; qualificationRevision?: string;sourceRevision?:string; inputs: { snapshotId: string; hash: string; analysisId: string | null; state: string;
      applicable?: boolean; generation?: number; configurationHash?: string; parserVersion?: string;
      attributionRevision?: string;
      processingScope?: { version: string; complete: boolean; aggregation: string; omittedFindings: number;
        extractedRanges: number; failedRanges: number; skippedRanges: number } }[];
    originalEventIdsSample: string[]; originalEventCount: number; originalEventHash: string; originalEventHashComplete: boolean;
    projectStatistics?: { project: string; records: number; userTurns: number; toolCalls: number }[];
    projectStatisticsComplete?: boolean;
    workStatistics?:FrozenStatisticReference;
    eligibleInputsComplete: boolean; dailyDeviceCoverage: 'unknown'; fixture: boolean } | null;
};
