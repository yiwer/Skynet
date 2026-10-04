import { z } from 'zod';
import { assessmentPeriod, assessmentPreset, type CapabilityAssessment } from './assessment.js';
import type { UsageEmployee } from './usage-output.js';
import type { EfficiencySession, EfficiencyTiming } from './session-efficiency.js';
import type { ActivityEvent } from './activity.js';
import type { DailyItem, DailyReport } from './reports.js';

export const profileQuery = z.object({ period: assessmentPeriod.optional(), preset: assessmentPreset.optional(),
  version: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict();
export type CapabilityProfile = {
  version: string; algorithmVersion: string; generatedAt: string; frontierVersion: string;
  employeeId: string; employee: string; range: CapabilityAssessment['range'];
  assessment: CapabilityAssessment;
  header: { deviceCount: number; enrolledAt: string | null; lastSyncedAt: string | null;
    devices: { id: string; name: string; active: boolean; enrolledAt: string | null; lastSyncedAt: string | null }[] };
  kpis: Omit<UsageEmployee, 'employeeId' | 'employee' | 'daily' | 'agents' | 'activeDates'> & { activeDays: number };
  usage: { version: string; metricVersion: string; daily: UsageEmployee['daily']; agents: UsageEmployee['agents'] };
  references: { efficiency: { version: string; metricVersion: string; path: string } };
  sessions: (Pick<EfficiencySession, 'sessionId' | 'snapshotId' | 'source' | 'sourceSessionId' | 'projects' | 'dates' | 'tokens' | 'knownTokens' | 'userTurns' | 'toolCalls' | 'verified' | 'codeChanges' | 'efficiency' | 'rework' | 'taskType' | 'webPath'> & { waitFraction: EfficiencyTiming['waitFraction'] | null })[];
  taskDistribution: { taskType: EfficiencySession['taskType']; sessions: number }[];
  work: { reports: { id: string; kind: 'daily' | 'weekly'; from: string; to: string; version: string | null; revision: number; state: DailyReport['state']; refreshPending: boolean; path: string }[];
    items: { id: string; date: string; item: DailyItem; reportIds: string[] }[] };
  recentActivity: { events: ActivityEvent[]; references: { date: string; version: string; path: string }[]; hasEarlier: boolean };
};
