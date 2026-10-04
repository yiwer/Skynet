import { z } from 'zod';
export const assessmentPeriod = z.enum(['this-week', 'last-week', 'since-enrollment']);
export type AssessmentPeriod = z.infer<typeof assessmentPeriod>;
export const assessmentPreset = z.enum(['默认', '重产出', '重质量']);
export type AssessmentPreset = z.infer<typeof assessmentPreset>;
export const assessmentQuery = z.object({ version: z.string().regex(/^[a-f0-9]{64}$/).optional(), inputOffset: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  period: assessmentPeriod.optional(), preset: assessmentPreset.optional() }).strict();
export const assessmentHistoryQuery = z.object({ period: assessmentPeriod.optional(), preset: assessmentPreset.optional(), cursor: z.string().max(2048).optional() }).strict();
export const dimKeys = ['adopt', 'prompt', 'iter', 'verify', 'output', 'flow'] as const;
export type DimKey = typeof dimKeys[number];
export type MetricScore = { key: string; label: string; value: number | null; anchor: [number, number]; score: number | null;
  samples: number; minimum: number; state: 'scored' | 'insufficient' | 'unknown'; unit: 'ratio' | 'number' | 'minutes' | 'multiple';
  evidence: { snapshotId: string; webPath: string; quote?: string }[]; evidenceCount: number; reason: string | null };
export type CapabilityAssessment = {
  version: string; employeeId: string; employee: string; period: string; preset: AssessmentPreset; modelVersion: string;
  selection?: { period: z.infer<typeof assessmentPeriod>; preset: AssessmentPreset };
  inputs: { metricsVersion: string; usageVersion: string; analysisVersions: string[]; insightVersions: string[]; baselineVersion: string; waitsVersion: string; coverageVersion: string; frontierVersion?: string };
  inputPage: { offset: number; analysisCount: number; insightCount: number; nextOffset: number | null };
  range: { from: string | null; to: string; timeZone: 'Asia/Shanghai'; empty?: boolean };
  index: number | null; margin: number | null; confidence: '高' | '中' | '低'; level: '较好' | '一般' | '需提升' | '待定';
  dims: Record<DimKey, { label: string; score: number | null; weight: number; effectiveWeight: number; teamMedian: number | null; metrics: MetricScore[] }>;
  strengths: DimKey[]; priorities: DimKey[]; tips: { dim: DimKey; text: string }[]; reason: string;
  sample: { sessions: number; prompts: number; activeDays: number; workdays: number; unknownTokenSessions: number };
  coverageIssues: string[]; generatedAt: string;
  representatives: { best: { snapshotId: string; webPath: string } | null; rework: { snapshotId: string; webPath: string } | null };
};
export type AssessmentHistoryPage = { items: Pick<CapabilityAssessment, 'version' | 'employeeId' | 'period' | 'preset' | 'selection' | 'range' | 'index' | 'level' | 'confidence' | 'generatedAt' | 'modelVersion'>[];
  total: number; nextCursor: string | null };
