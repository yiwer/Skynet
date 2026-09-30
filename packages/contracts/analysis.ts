import { z } from 'zod';
import type { EvidenceLocation } from './search.js';
import type { EventOrigin } from './provenance.js';

export const analysisCategories = ['goal', 'topic', 'activity', 'outcome', 'blocker', 'next', 'uncertainty'] as const;
export const analysisLabels: Record<typeof analysisCategories[number], string> = {
  goal: '目标', topic: '工作主题', activity: '关键活动', outcome: '会话内成果', blocker: '阻塞', next: '待继续事项', uncertainty: '不确定项',
};
export const assessmentLabels = { observed: '记录已观察（工具原文）', claimed: '用户 / Agent 声称', inferred: '模型推断', insufficient: '材料不足' };
export const analysisOutputSchema = z.object({ items: z.array(z.object({
  category: z.enum(analysisCategories), assessment: z.enum(['observed', 'claimed', 'inferred', 'insufficient']),
  text: z.string().min(1).max(512), citations: z.array(z.object({ event: z.number().int().min(0),
    textOffset: z.number().int().min(0), quote: z.string().min(1).max(512) }).strict()).max(3),
}).strict()).max(28) }).strict();
export type AnalysisOutput = z.infer<typeof analysisOutputSchema>;
export type AnalysisItem = Omit<AnalysisOutput['items'][number], 'citations'> & { citations: (AnalysisOutput['items'][number]['citations'][number] & {
  snapshotId: string; location: EvidenceLocation; webPath: string; role: string; origin: EventOrigin | null; context: string;
  inputSnapshotId: string; inputLocation: EvidenceLocation;
})[]; classificationAdjusted: boolean };
export type AnalysisRun = { id: string; snapshotId: string; state: 'queued' | 'running' | 'retry-wait' | 'superseded' | 'succeeded' | 'failed';
  createdAt: string; startedAt: string | null; finishedAt: string | null; error: string | null;
  attempts: number; maxAttempts: number; nextAttemptAt: string; leaseUntil: string | null; deadline: string | null; generation: number;
  trigger: 'manual' | 'incremental' | 'scheduled'; applicable: boolean; desiredSnapshotId: string | null; targetError: string | null;
  actorId: string | null; actorKind: 'user' | 'system';
  attemptHistory: { number: number; state: string; reservedCny: number; requests: number | null; usage: unknown;
    error: string | null; startedAt: string; finishedAt: string | null }[];
  config: { mode: 'qwen-payg' | 'fixture'; model: string; runtimeVersion: string; promptVersion: string; configurationHash: string;
    maxInputBytes: number; maxRequests: number; maxOutputTokens: number; timeoutSeconds: number; reservationCny: number; budgetCny: number; budgetId: string;
    maxAttempts: number; concurrency: number; leaseSeconds: number; retryDelaySeconds: number; autoAnalyzeUpdates: boolean; autoDebounceSeconds: number };
  input: { snapshotId: string; hash: string; parserVersion: string; eventCount: number; source: string; sourceVersion: string;
    coverage: { unrecognizedLines: number; partialLine: boolean; excludedMaterials: number; captureGaps: unknown[]; scope: string } };
  result: { items: AnalysisItem[]; usage: { inputTokens: number | null; outputTokens: number | null; runtimeCostUsd: number | null;
    providerBilledCny: null; requests: number }; fixture: boolean } | null;
};
export type AnalysisPage = { runs: AnalysisRun[]; nextOffset: number | null; availability: {
  ready: boolean; reason: string; mode?: 'qwen-payg' | 'fixture'; model?: string; runtimeVersion?: string;
} };
export type AnalysisOperations = {
  availability: AnalysisPage['availability']; counts: {state: AnalysisRun['state']; count: number}[];
  workers: {id: string; config: AnalysisRun['config']; updatedAt: string; online: boolean}[];
  budgets: {id: string; reservedCny: string}[];
  targets: {id: string; desiredSnapshotId: string; generation: number; configurationHash: string; applicableJobId: string | null; error: string | null}[];
  runs: (AnalysisRun & {resultAvailable: boolean})[]; nextOffset: number | null; providerBilledCny: null; definition: string;
};
