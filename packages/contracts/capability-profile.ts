import { z } from 'zod';
import { assessmentPeriod, assessmentPreset, type CapabilityAssessment } from './assessment.js';
import type { UsageEmployee } from './usage-output.js';

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
};
