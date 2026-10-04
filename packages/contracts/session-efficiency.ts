import {z} from 'zod';
import {sourceSchema,type Source} from './archive.js';
import type {MetricsScope} from './metrics.js';
import type {taskTypes,InsightCitation} from './session-insights.js';
import type {WaitEvidence} from './waits.js';

export const efficiencyQuerySchema=z.object({
  period:z.enum(['this-week','last-week','since-enrollment']).default('this-week'),employeeId:z.uuid().optional(),source:sourceSchema.optional(),project:z.string().max(1024).optional(),
  version:z.string().regex(/^[a-f0-9]{64}$/).optional(),offset:z.coerce.number().int().min(0).max(100000).default(0),
  sort:z.enum(['date','tokens','prompts','code','verified','efficiency','rework']).default('date'),direction:z.enum(['asc','desc']).default('desc'),
  reviewOnly:z.enum(['true','false']).default('false'),
  sessionId:z.string().regex(/^[a-f0-9]{64}$/).optional(),segmentOffset:z.coerce.number().int().min(0).max(100000).default(0),
}).strict().refine(q=>!q.offset||!!q.version,'后续分页必须固定版本')
  .refine(q=>!q.sessionId||!!q.version&&!q.offset,'会话分段必须指定固定版本且不混用会话页码')
  .refine(q=>!q.segmentOffset||!!q.sessionId,'分段页码必须指定会话');
export type EfficiencyQuery=z.infer<typeof efficiencyQuerySchema>;
export type EfficiencyRatio={numerator:number|null;denominator:number|null;value:number|null};
export type EfficiencySegment={kind:'agent'|'reply'|'permission'|'gap';startedAt:string|null;endedAt:string|null;durationMs:number|null;evidence:WaitEvidence[];reason:string|null};
export type EfficiencyTiming={waitVersion:string;knownAgentMs:number;knownReplyMs:number;activeMs:number|null;permissionMs:null;waitFraction:EfficiencyRatio;segments:EfficiencySegment[];segmentTotal:number;nextSegmentOffset:number|null};
export type EfficiencySession={sessionId:string;snapshotId:string;sourceSessionId:string;source:Source;projects:string[];employees:{employeeId:string;employee:string}[];
  correctionIds?:string[];
  dates:string[];webPath:string;tokens:number|null;knownTokens:number;userTurns:number;toolCalls:number;verified:number|null;claimed:number|null;codeChanges:number|null;
  efficiency:EfficiencyRatio;codeOutput:EfficiencyRatio;taskType:typeof taskTypes[number];taskEvidence:InsightCitation[];rework:number|null;reworkEvidence:InsightCitation[];reviewReasons:string[];
  inputVersions:{snapshotId:string;version:string}[];timing?:EfficiencyTiming};
export type EfficiencyDistribution={taskType:typeof taskTypes[number];count:number;unknownCount:number;median:number|null;minimum:number|null;maximum:number|null;points:{value:number;count:number}[]};
export type SessionEfficiencyPage={version:string;algorithmVersion:string;usageVersion:string;metricVersion:string;scope:MetricsScope;createdAt:string;dataAsOf:string;
  total:number;reviewCount:number;tokenP75:number|null;sessions:EfficiencySession[];distributions:EfficiencyDistribution[];nextOffset:number|null;filteredTotal:number;definition:string};
