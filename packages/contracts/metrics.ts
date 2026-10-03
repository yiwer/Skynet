import { z } from 'zod';
import { sourceSchema, type Source } from './archive.js';
import { reportDate } from './reports.js';

export const metricsQuerySchema = z.object({
  period: z.enum(['this-week', 'last-week', 'since-enrollment', 'custom']).default('this-week'),
  from: reportDate.optional(), to: reportDate.optional(), employeeId: z.uuid().optional(),
  source: sourceSchema.optional(), project: z.string().max(1024).optional(),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
  version: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict().refine(q => q.period !== 'custom' || !!q.from && !!q.to, '自定义范围必须提供起止日期');
export type MetricsQuery = z.infer<typeof metricsQuerySchema>;
export type MetricsScope = { from: string; to: string; timeZone: 'Asia/Shanghai'; employeeId?: string; source?: Source; project?: string };
export type MetricTotals = { sessions: number; userTurns: number; toolCalls: number;
  inputTokens: number | null; outputTokens: number | null; knownInputTokens: number; knownOutputTokens: number;
  unknownTokenSessions: number; unknownInputSessions: number; unknownOutputSessions: number };
export type SessionMetrics = MetricTotals & { sessionId: string; employeeId: string; employee: string; source: Source;
  project: string; sourceSessionId: string; snapshotId: string; snapshotIds: string[]; webPath: string; dates: string[];
  sourceInputsComplete: boolean; unknownReasons: string[] };
export type MetricCatalog = { version: string; timeZone: 'Asia/Shanghai'; definitions: { key: string; label: string; definition: string; origin: '原件 · 确定性' }[];
  limitations: string[] };
export type MetricsPage = { version: string; revision: number; scope: MetricsScope; dataAsOf: string; createdAt: string;
  totals: MetricTotals; sessions: SessionMetrics[]; nextOffset: number | null;
  daily: ({ date: string } & MetricTotals)[];
  employees: ({ employeeId: string; employee: string } & MetricTotals)[];
  sources: ({ source: Source } & MetricTotals)[];
  catalogVersion: string; definition: string; sourceInputsComplete: boolean; unknownReasons: string[] };
