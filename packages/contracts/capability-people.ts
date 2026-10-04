import { z } from 'zod';
import type { CapabilityAssessment, DimKey } from './assessment.js';
import type { OutputTotals } from './usage-output.js';

export const capabilityLevels = ['较好', '一般', '需提升', '待定'] as const;
export const peopleQuery = z.object({
  period: z.enum(['this-week', 'last-week', 'since-enrollment']).optional(),
  preset: z.enum(['默认', '重产出', '重质量']).optional(),
  version: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
}).strict().refine(q => !q.offset || !!q.version, '后续分页必须固定版本');
export type PeopleQuery = z.infer<typeof peopleQuery>;
export type CapabilityCard = Pick<CapabilityAssessment, 'employeeId' | 'employee' | 'index' | 'margin' | 'confidence' | 'level' | 'reason' | 'sample' | 'range' | 'coverageIssues'> & {
  assessmentVersion: string; profilePath: string;
  dims: Record<DimKey, Pick<CapabilityAssessment['dims'][DimKey], 'label' | 'score'>>;
  verified: OutputTotals['verified'];
  rework: { numerator: number | null; denominator: number; value: number | null };
};
export type CapabilityPeople = {
  version: string; modelVersion: string; frontierVersion: string; usageVersion: string; baselineVersion: string;
  selection: { period: NonNullable<PeopleQuery['period']>; preset: NonNullable<PeopleQuery['preset']> };
  groups: { level: typeof capabilityLevels[number]; count: number }[];
  total: number; employees: CapabilityCard[]; nextOffset: number | null; generatedAt: string;
};
