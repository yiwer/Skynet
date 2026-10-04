import type {CoverageMatrix,CoverageCell} from './coverage.js';
import {fixedWeek} from './fixed-week.js';
import {z} from 'zod';
import {sourceSchema} from './archive.js';
import type {MetricTotals,MetricsScope,MetricDailyPoint} from './metrics.js';
import type {OutputTotals} from './usage-output.js';
import type {PromptReport,PromptFraction} from './prompt-report.js';
import type {WaitReport} from './wait-report.js';
import type {CapabilityCard,CapabilityPeople} from './capability-people.js';

export const teamReportQuerySchema=z.object({period:z.enum(['this-week','last-week','since-enrollment']).default('this-week'),
  week:fixedWeek.optional(),employeeId:z.uuid().optional(),source:sourceSchema.optional(),project:z.string().max(1024).optional(),version:z.string().regex(/^[a-f0-9]{64}$/).optional(),coverageOffset:z.coerce.number().int().min(0).max(3660).optional()}).strict();
export const teamWeeklyQuerySchema=teamReportQuerySchema.omit({period:true}).extend({week:fixedWeek,employeeId:z.uuid()});
export const fixedTeamReportQuerySchema=teamReportQuerySchema.refine(q=>(!q.week&&!q.coverageOffset)||!!q.version,'指定周或后续覆盖日期只可读取固定版本');
export type TeamReportQuery=z.infer<typeof teamReportQuerySchema>;
export type ReportLink={api:string;web:string};
export type TeamCapability=Pick<CapabilityCard,'level'|'index'|'confidence'|'reason'|'coverageIssues'|'assessmentVersion'|'profilePath'>;
export type TeamPerson={employeeId:string;employee:string;capability?:TeamCapability;coverage:CoverageCell['collection'];totals:MetricTotals;outputs:OutputTotals;prompts:{prompts:number;rework:PromptFraction};
  waits:{medianMs:number|null;knownCount:number;unknownCount:number};daily:MetricDailyPoint[]};
export type TeamReport={version:string;algorithmVersion:string;frontierVersion:string;createdAt:string;dataAsOf:string;scope:MetricsScope;
  capability?:Pick<CapabilityPeople,'version'|'selection'>;
  coverage:CoverageMatrix&{dateOffset?:number;nextDateOffset?:number|null;totalDates?:number};usageVersion:string;promptVersion:string;waitReportVersion:string;activeEmployees:{active:number;total:number};totals:MetricTotals;outputs:OutputTotals;
  prompts:PromptReport['kpis'];waits:WaitReport['summary'];daily:(MetricDailyPoint&{outputs:OutputTotals})[];people:TeamPerson[];
  links:Record<'usage'|'prompts'|'waits',ReportLink>;projects:string[];sourceInputsComplete:boolean;unknownReasons:string[]};
