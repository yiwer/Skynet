import { z } from 'zod';
import type { AnalysisItem } from './analysis.js';
import type { NativeTurnState } from '../native/turn-state.js';
export const taskTypes = ['implementation','fix','investigation','refactor','test','operations','documentation','unknown'] as const;
export const taskTypeLabels: Record<typeof taskTypes[number],string> = { implementation:'实现',fix:'修复',investigation:'排查',refactor:'重构',test:'测试',operations:'运维',documentation:'整理',unknown:'未知' };
export const promptElementLabels = { goal:'目标',constraints:'约束',context:'上下文',acceptance:'验收标准' };
export const insightCitationSchema = z.object({ event:z.number().int().min(0),textOffset:z.number().int().min(0),quote:z.string().min(1).max(512) }).strict();
const citations = z.array(insightCitationSchema).min(1).max(3);
export const analysisInsightsSchema = z.object({ version:z.literal('session-insights-1'),
  taskType:z.object({value:z.enum(taskTypes),citations:z.array(insightCitationSchema).max(3)}).strict(),
  prompts:z.array(z.object({event:z.number().int().min(0),elements:z.object({goal:z.boolean().nullable(),constraints:z.boolean().nullable(),context:z.boolean().nullable(),acceptance:z.boolean().nullable()}).strict(),rework:z.boolean().nullable(),citations}).strict()).max(128),
  replies:z.array(z.object({event:z.number().int().min(0),clarification:z.boolean().nullable(),citations}).strict()).max(128),
  outcomes:z.array(z.object({status:z.enum(['verified','claimed','inferred']),text:z.string().min(1).max(512),citations}).strict()).max(28),
  suggestions:z.array(z.object({text:z.string().min(1).max(512),citations}).strict()).max(4),
}).strict();
export type InsightOutput = z.infer<typeof analysisInsightsSchema>;
export type InsightCitation = AnalysisItem['citations'][number];
type Cited<T> = Omit<T,'citations'> & {citations:InsightCitation[]};
export type SessionInferences = {
  version:'session-insights-1'; complete:boolean;
  taskType:Cited<InsightOutput['taskType']> & {correctionId?:string};
  prompts:(Cited<InsightOutput['prompts'][number]> & {length:number;first:boolean;complete:boolean;corrections?:{elements?:string;rework?:string}})[];
  replies:(Cited<InsightOutput['replies'][number]> & {complete:boolean})[];
  outcomes:(Cited<InsightOutput['outcomes'][number]> & {classificationAdjusted:boolean})[];
  suggestions:Cited<InsightOutput['suggestions'][number]>[];
};
export type FactContribution = {eventId:string;employeeId:string;sourceDate:string|null;snapshotId:string;value:number;added?:number;removed?:number;passed?:number;failed?:number};
export type RecordedFact = {value:number|null;complete:boolean;evidence:InsightCitation[];contributions:FactContribution[];scope:'after-enrollment';added?:number;removed?:number;passed?:number;failed?:number};
export const sessionInsightsQuery = z.object({ analysisId: z.uuid().optional(),version:z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict();
export type SessionInsights = {
  sourceAvailability?: { state:'unavailable'; reason:'missing'|'unreadable'|'hash-mismatch' };
  corrections?:{version:string;appliedIds:string[];pendingIds:string[]};
  version: string; factsVersion:string; snapshotId: string; state: 'unavailable'|'pending'|'failed'|'legacy'|'stale'|'partial'|'complete';
  messageFactsVersion?:string;
  messageHistoryComplete?:boolean;
  analysisVersion: { id: string; generation: number; prompt: string; configuration: string; applicable: boolean } | null;
  input: { hash: string; parserVersion: string; attributionRevision: string };
  metrics: { verified: number|null; claimed: number|null; rework: number|null; clarifications: number|null };
  inferences:SessionInferences|null;
  sourceState?: { version: 'native-turn-state-1'; turn: NativeTurnState };
  facts: Record<'codeChanges'|'tests'|'commits', RecordedFact>;
};
