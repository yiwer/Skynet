import {fixedWeek} from './fixed-week.js';
import {z} from 'zod';
import {sourceSchema} from './archive.js';
import type {WaitsScope} from './waits.js';

const version=z.string().regex(/^[a-f0-9]{64}$/);
export const waitReportQuerySchema=z.object({period:z.enum(['this-week','last-week','since-enrollment']).default('this-week'),
  week:fixedWeek.optional(),employeeId:z.uuid().optional(),source:sourceSchema.optional(),project:z.string().max(1024).optional(),version:version.optional(),waitVersion:version.optional()}).strict().refine(q=>!q.week||!!q.version||!!q.waitVersion,'指定周只可读取固定版本');
export type WaitReportQuery=z.infer<typeof waitReportQuerySchema>;
export type WaitFraction={numerator:number;denominator:number;value:number|null};
export type WaitDistribution={count:number;minimumMs:number|null;q1Ms:number|null;medianMs:number|null;q3Ms:number|null;maximumMs:number|null;p90Ms:number|null};
export type WaitReport={version:string;algorithmVersion:string;waitVersion:string;scope:WaitsScope;createdAt:string;dataAsOf:string|null;
  summary:{medianMs:number|null;p90Ms:number|null;knownCount:number;unknownCount:number;longFraction:WaitFraction;parallelFraction:WaitFraction;permissionMedianMs:null};
  heatmap:{weekday:number;hour:number;count:number;medianMs:number|null}[];
  people:({employeeId:string;employee:string;unknownCount:number;parallelFraction:WaitFraction}&WaitDistribution)[];
  permissions:{state:'unknown';requests:never[];suggestions:never[];reason:string};
  unknownReasons:string[];definition:string;
};
