import { z } from 'zod';
import { sourceSchema, type Source } from './archive.js';
import { reportDate } from './reports.js';
import type { DeliveryObservation } from './delivery.js';
import type { InsightCitation,SessionInsights } from './session-insights.js';

export const activityTypes = ['session-start','session-end','turn-start','turn-end','prompt','rework','reply','clarification','long-wait','permission-wait','compaction','gap','offline','backfill'] as const;
export const activityLabels: Record<ActivityType,string> = { 'session-start':'会话开始','session-end':'会话结束','turn-start':'本轮开始','turn-end':'本轮结束',prompt:'提问',rework:'返工提问',reply:'Agent 回复',clarification:'Agent 追问','long-wait':'长等待','permission-wait':'权限等待',compaction:'上下文压缩',gap:'采集缺口',offline:'离线',backfill:'补传' };
export type ActivityType = typeof activityTypes[number];
export const activityQuerySchema = z.object({ date: reportDate.optional(), employeeId:z.uuid().optional(),source:sourceSchema.optional(),project:z.string().max(1024).optional(),
  type:z.enum(activityTypes).optional(),version:z.string().regex(/^[a-f0-9]{64}$/).optional(),offset:z.coerce.number().int().min(0).max(100000).default(0),
  section:z.enum(['events','lanes','inputs']).optional(),
}).strict().refine(q=>q.offset===0||!!q.version,'后续页必须固定活动版本');
export type ActivityQuery = z.infer<typeof activityQuerySchema>;
export interface ActivityEvidence { snapshotId:string;line:number;block:number;textOffset:number;parserVersion:string;webPath:string;conversationPath:string|null;kind?:'event'|'raw'|'manifest'|'delivery' }
export interface ActivityEvent { id:string;type:ActivityType;timestamp:string|null;sourceDate:string|null;employeeId:string;employee:string;source:Source;project:string;sessionId:string;snapshotId:string;
  excerpt:string;truncated:boolean;evidence:ActivityEvidence;basis:'recorded'|'inferred'|'derived';backfill:'unknown'|'observed'|'not-observed';analysisVersion:string|null;
  delivery?:DeliveryObservation;durationMs?:number;endedAt?:string;endEvidence?:ActivityEvidence;parallel?:'observed'|'not-observed'|'unknown';inference? :InsightCitation & {version:string}; }
export interface ActivityLane {employeeId:string;employee:string;sessions:{id:string;source:Source;project:string;observedFrom:string;observedTo:string;startBoundary:'observed'|'unknown';endBoundary:'unknown';state:'in-progress'|'waiting-input'|'interrupted'|'unknown';evidence:ActivityEvidence}[];
  points:Pick<ActivityEvent,'id'|'type'|'timestamp'|'sessionId'|'evidence'>[];segments:{id:string;kind:'wait';startedAt:string;endedAt:string;durationInScopeMs:number;evidence:ActivityEvidence}[];}
export interface ActivityPage { version:string;revision:number;algorithmVersion:string;createdAt:string;dataAsOf:string|null;
  scope:{date:string;timeZone:'Asia/Shanghai';employeeId?:string;source?:Source;project?:string;type?:ActivityType};events:ActivityEvent[];total:number;nextOffset:number|null;
  inputs:{snapshotId:string;hash:string;attributionRevision:string;parserVersion:string}[];lanes:ActivityLane[];coverage:{permission:'unknown';sessionEnd:'unknown';unknownTime:number};
  analyses:Pick<SessionInsights,'snapshotId'|'version'|'state'|'analysisVersion'>[];
  nextLaneOffset:number|null;nextInputOffset:number|null;inputCount:number;laneItemCount:number;employeeOrder:{employeeId:string;employee:string}[];waitAlgorithmVersion:string;waitVersion:string;inputVersion:string; }
export const activityLink = (selection:{date:string;employeeId?:string}) => '#activity?'+new URLSearchParams(selection).toString();
