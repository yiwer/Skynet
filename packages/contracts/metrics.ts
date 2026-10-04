import {fixedWeek} from './fixed-week.js';
import { z } from 'zod';
import { sourceSchema, type Source } from './archive.js';
import { reportDate } from './reports.js';

export const legacyMetricsQuerySchema = z.object({
  period: z.enum(['this-week', 'last-week', 'since-enrollment', 'custom']).default('this-week'),
  week:fixedWeek.optional(), from: reportDate.optional(), to: reportDate.optional(), employeeId: z.uuid().optional(),
  source: sourceSchema.optional(), project: z.string().max(1024).optional(),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
  version: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict().refine(q => q.period === 'custom' ? !!q.from && !!q.to : q.from === undefined && q.to === undefined, '日期仅用于读取旧固定版本');
export const metricsQuerySchema = legacyMetricsQuerySchema.refine(q => q.period !== 'custom' || !!q.version,
  '报表仅支持本周、上周与接入至今；旧自定义范围只可读取固定版本').refine(q=>!q.week||!!q.version,'指定周只可读取固定版本');
export const coverageMetricsQuerySchema = z.object({
  date: reportDate, view: z.enum(['day', 'week']).default('week'),
  employeeId: z.uuid().optional(), source: sourceSchema.optional(), project: z.string().max(1024).optional(),
  version: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict();
export type MetricsQuery = z.infer<typeof metricsQuerySchema>;
export type MetricsScope = { from: string; to: string; timeZone: 'Asia/Shanghai'; employeeId?: string; source?: Source; project?: string };
export type MetricTotals = { sessions: number; userTurns: number; toolCalls: number;
  inputTokens: number | null; outputTokens: number | null; knownInputTokens: number; knownOutputTokens: number;
  unknownTokenSessions: number; unknownInputSessions: number; unknownOutputSessions: number };
export type MetricTokenTrend = { inputTokens: number | null; outputTokens: number | null; includedSessions: number; excludedSessions: number };
export type MetricDailyPoint = { date: string; activeSessions: number; userTurns?:number; toolCalls?:number; knownInputTokens?:number; unknownInputSessions?:number } & MetricTokenTrend;
export type SessionMetrics = MetricTotals & { sessionId: string; employeeId: string; employee: string; source: Source;
  project: string; sourceSessionId: string; snapshotId: string; snapshotIds: string[]; webPath: string; dates: string[];
  sourceInputsComplete: boolean; unknownReasons: string[] };
export type MetricCatalog = { version: string; timeZone: 'Asia/Shanghai'; definitions: { key: string; label: string; definition: string; origin: '原件 · 确定性' }[];
  limitations: string[] };
export type MetricsPage = { version: string; revision: number; scope: MetricsScope; dataAsOf: string; createdAt: string;
  totals: MetricTotals; sessions: SessionMetrics[]; nextOffset: number | null;
  daily: ({ date: string; tokenTrend?: MetricTokenTrend } & MetricTotals)[];
  employeeDaily?: { employeeId: string; days: MetricDailyPoint[] }[];
  employees: ({ employeeId: string; employee: string } & MetricTotals)[];
  sources: ({ source: Source } & MetricTotals)[];
  catalogVersion: string; definition: string; sourceInputsComplete: boolean; unknownReasons: string[] };
