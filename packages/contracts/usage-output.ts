import type { MetricTotals, MetricsPage, SessionMetrics, MetricDailyPoint } from './metrics.js';
import type { Source } from './archive.js';
import { z } from 'zod';
import { metricsQuerySchema } from './metrics.js';

export type OutputAmount = { value: number | null; known: number; unknownSessions: number; added: number; removed: number; passed: number; failed: number };
export type OutputTotals = Record<'verified'|'claimed'|'codeChanges'|'tests'|'commits', OutputAmount>;
export type UsageDailyPoint = MetricDailyPoint & { outputs?: Pick<OutputTotals, 'verified'> };
export type UsageSession = SessionMetrics & { selected: boolean; outputs: OutputTotals; latestCarrierSnapshotIds: string[]; insightVersions: { snapshotId: string; version: string }[] };
export type UsageEmployee = MetricTotals & { employeeId: string; employee: string; activeDates: string[]; outputs: OutputTotals; sourceInputsComplete?: boolean; unknownReasons?: string[]; unscopedSources?: number;
  agents: ({ source: Source } & MetricTotals)[]; daily: UsageDailyPoint[] };
export type UsageOutputPage = { version: string; revision: number; metricVersion: string; catalogVersion: string;
  createdAt: string; dataAsOf: string; scope: MetricsPage['scope']; totals: MetricTotals; outputs: OutputTotals;
  employees: UsageEmployee[]; daily: UsageDailyPoint[]; dailyOutputs?:{date:string;outputs:OutputTotals}[]; sessions: UsageSession[]; nextOffset: number | null;
  sourceInputsComplete: boolean; unknownReasons: string[] };

export const usageSections=['sessions','employees','daily','dailyOutputs','employeeDaily','employeeActiveDates','employeeUnknownReasons','unknownReasons'] as const;
export type UsageSection=typeof usageSections[number];
export const usageQuerySchema=metricsQuerySchema.safeExtend({section:z.enum(usageSections).optional()})
  .refine(q=>!q.section&&!q.offset||!!q.version,'产出分区分页必须固定版本');
export type UsageQuery=z.infer<typeof usageQuerySchema>;
export type UsageEmployeeSummary=Omit<UsageEmployee,'daily'|'activeDates'|'unknownReasons'>;
/** Totals describe the full revision. Only pages describes collection coverage. */
export type UsageReadingPage=Omit<UsageOutputPage,'employees'> & {
  readingVersion:'usage-page-1';
  employees:UsageEmployeeSummary[];
  employeeDaily:({employeeId:string}&UsageDailyPoint)[];
  employeeActiveDates:{employeeId:string;date:string}[];
  employeeUnknownReasons:{employeeId:string;reason:string}[];
  pages:Record<UsageSection,{total:number;offset:number;nextOffset:number|null}>;
};
