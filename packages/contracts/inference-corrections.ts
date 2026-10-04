import {z} from 'zod';
import {taskTypes,type InsightCitation} from './session-insights.js';
const base={requestId:z.uuid(),expectedVersion:z.string().regex(/^[a-f0-9]{64}$/),reason:z.string().trim().min(1).max(1000)};
const elements=z.object({goal:z.boolean().nullable(),constraints:z.boolean().nullable(),context:z.boolean().nullable(),acceptance:z.boolean().nullable()}).strict();
export const inferenceCorrectionInput=z.discriminatedUnion('kind',[
  z.object({...base,kind:z.literal('task-type'),value:z.enum(taskTypes)}).strict(),
  z.object({...base,kind:z.literal('prompt-elements'),promptEvent:z.number().int().min(0),value:elements}).strict(),
  z.object({...base,kind:z.literal('rework'),promptEvent:z.number().int().min(0),value:z.boolean().nullable()}).strict(),
]);
export const inferenceCorrectionQuery=z.object({offset:z.coerce.number().int().min(0).max(100000).default(0),version:z.string().regex(/^[a-f0-9]{64}$/).optional()}).strict().refine(q=>!q.offset||!!q.version,'更正历史分页必须固定洞察版本');
export type InferenceCorrection=z.infer<typeof inferenceCorrectionInput>&{id:string;sequence:string;snapshotId:string;eventId:string;targetEventIds:string[];
  actorId:string;actor:string;createdAt:string;insightVersion:string;analysisId:string;previous:typeof taskTypes[number]|z.infer<typeof elements>|boolean|null;evidence:InsightCitation[]};
export type InferenceCorrectionPage={corrections:InferenceCorrection[];nextOffset:number|null;version:string};
