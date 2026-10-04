import {fixedWeek} from './fixed-week.js';
import {z} from 'zod';
import {sourceSchema} from './archive.js';
import type {MetricTotals,MetricsScope,MetricDailyPoint} from './metrics.js';
import type {OutputTotals} from './usage-output.js';
import type {PromptReport,PromptFraction} from './prompt-report.js';
import type {WaitReport} from './wait-report.js';

export const teamReportQuerySchema=z.object({period:z.enum(['this-week','last-week','since-enrollment']).default('this-week'),
  week:fixedWeek.optional(),employeeId:z.uuid().optional(),source:sourceSchema.optional(),project:z.string().max(1024).optional(),version:z.string().regex(/^[a-f0-9]{64}$/).optional()}).strict();
export const teamWeeklyQuerySchema=teamReportQuerySchema.omit({period:true}).extend({week:fixedWeek,employeeId:z.uuid()});
export const fixedTeamReportQuerySchema=teamReportQuerySchema.refine(q=>!q.week||!!q.version,'指定周只可读取固定版本');
export type TeamReportQuery=z.infer<typeof teamReportQuerySchema>;
export type ReportLink={api:string;web:string};
export type TeamPerson={employeeId:string;employee:string;totals:MetricTotals;outputs:OutputTotals;prompts:{prompts:number;rework:PromptFraction};
  waits:{medianMs:number|null;knownCount:number;unknownCount:number};daily:MetricDailyPoint[]};
export type TeamReport={version:string;algorithmVersion:string;frontierVersion:string;createdAt:string;dataAsOf:string;scope:MetricsScope;
  usageVersion:string;promptVersion:string;waitReportVersion:string;activeEmployees:{active:number;total:number};totals:MetricTotals;outputs:OutputTotals;
  prompts:PromptReport['kpis'];waits:WaitReport['summary'];daily:MetricDailyPoint[];people:TeamPerson[];
  links:Record<'usage'|'prompts'|'waits',ReportLink>;projects:string[];sourceInputsComplete:boolean;unknownReasons:string[]};
