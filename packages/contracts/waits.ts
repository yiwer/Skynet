import {fixedWeek} from './fixed-week.js';
import { z } from 'zod';
import { sourceSchema, type Source } from './archive.js';

export const waitsQuerySchema = z.object({
  snapshotId: z.uuid().optional(), period: z.enum(['this-week', 'last-week', 'since-enrollment']).default('this-week'),
  week:fixedWeek.optional(), employeeId: z.uuid().optional(), source: sourceSchema.optional(), project: z.string().max(1024).optional(),
  version: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  lines: z.string().regex(/^\d+(,\d+){0,24}$/).optional(),
  contextSnapshotId: z.uuid().optional(),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
}).strict().refine(q=>!q.week||!!q.version,'指定周只可读取固定版本').refine(q => q.offset === 0 || !!q.version, '后续页必须固定版本')
  .refine(q => !q.lines || !!q.snapshotId || !!q.contextSnapshotId, '对话行筛选需要固定原件')
  .refine(q => !q.contextSnapshotId || !!q.version && !!q.lines && !q.snapshotId && !q.employeeId && !q.source && q.project === undefined, '版本内对话标签需要 version 与 lines');
export type WaitsQuery = z.infer<typeof waitsQuerySchema>;
export const waitSections=['intervals','daily','unavailableSources','employees'] as const;
export type WaitSection=typeof waitSections[number];
export const waitsReadingQuerySchema=waitsQuerySchema.safeExtend({section:z.enum(waitSections).optional()})
  .refine(q=>!q.section||!!q.version,'分区读取必须固定版本')
  .refine(q=>!q.section||!q.lines&&!q.contextSnapshotId,'分区不能与对话行混用');
export type WaitsReadingQuery=z.infer<typeof waitsReadingQuerySchema>;
export interface WaitEvidence { snapshotId: string; line: number; block: number; webPath: string; conversationPath: string | null }
export interface ReplyWait {
  id: string; sessionId: string; snapshotId: string; source: Source; employeeId: string; employee: string; project: string;
  turnId: string | null; startedAt: string | null; endedAt: string | null; durationMs: number | null; durationInScopeMs: number | null; long: boolean;
  reason: string | null; start: WaitEvidence | null; end: WaitEvidence; displayLine: number;
  parallel: 'observed' | 'not-observed' | 'unknown'; parallelEvidence: WaitEvidence[];
}
export interface WaitsSummary {
  replyWaitCount: number; unknownReplyWaitCount: number; replyWaitMs: number | null; knownReplyWaitMs: number;
  longWaitCount: number; permissionWaitMs: null; permissionWaitCount: null;
}
export interface WaitsPage {
  unavailableSources?:{snapshotId:string;employeeId:string;employee:string;project:string;reason:'missing'|'unreadable'|'hash-mismatch';evidence:WaitEvidence}[];
  version: string; revision: number; algorithmVersion: string; createdAt: string; dataAsOf: string | null;
  scope: WaitsScope; summary: WaitsSummary; intervals: ReplyWait[]; total: number; nextOffset: number | null;
  daily: { date: string; knownReplyWaitMs: number; unknownReplyWaitCount: number }[];
  replySupport: 'observed' | 'unknown'; permissionSupport: 'unknown'; unknownReasons: string[];
  definition: string;
}
export type WaitEmployee={employeeId:string;employee:string};
export type WaitsReadingPage=WaitsPage&{readingVersion:'wait-page-1';employees:WaitEmployee[];
  pages:Record<WaitSection,{total:number;offset:number;nextOffset:number|null}>};
export type WaitsScope = { activityDate?:string;snapshotId?: string; period?: 'this-week' | 'last-week' | 'since-enrollment'; from?: string; to?: string; timeZone: 'Asia/Shanghai'; employeeId?: string; employeeName?:string; source?: Source; project?: string };
