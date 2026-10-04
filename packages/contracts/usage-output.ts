import type { MetricTotals, MetricsPage, SessionMetrics, MetricDailyPoint } from './metrics.js';
import type { Source } from './archive.js';

export type OutputAmount = { value: number | null; known: number; unknownSessions: number; added: number; removed: number; passed: number; failed: number };
export type OutputTotals = Record<'verified'|'claimed'|'codeChanges'|'tests'|'commits', OutputAmount>;
export type UsageSession = SessionMetrics & { selected: boolean; outputs: OutputTotals; latestCarrierSnapshotIds: string[]; insightVersions: { snapshotId: string; version: string }[] };
export type UsageEmployee = MetricTotals & { employeeId: string; employee: string; activeDates: string[]; outputs: OutputTotals;
  agents: ({ source: Source } & MetricTotals)[]; daily: MetricDailyPoint[] };
export type UsageOutputPage = { version: string; revision: number; metricVersion: string; catalogVersion: string;
  createdAt: string; dataAsOf: string; scope: MetricsPage['scope']; totals: MetricTotals; outputs: OutputTotals;
  employees: UsageEmployee[]; daily: MetricDailyPoint[]; dailyOutputs?:{date:string;outputs:OutputTotals}[]; sessions: UsageSession[]; nextOffset: number | null;
  sourceInputsComplete: boolean; unknownReasons: string[] };
