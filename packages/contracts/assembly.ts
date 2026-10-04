import { z } from 'zod';
import { sourceSchema, type Source } from './archive.js';
import { reportDate } from './reports.js';
import type { DeliveryObservation } from './delivery.js';
import type { MetricCatalog } from './metrics.js';

export const assemblyState = z.enum(['assembled', 'assembling', 'gap', 'pending-lineage']);
export const assemblyQuery = z.object({ state: assemblyState.optional(), source: sourceSchema.optional(), employeeId: z.uuid().optional(),
  date: reportDate.optional(), currentOnly: z.enum(['true', 'false']).default('false'), offset: z.coerce.number().int().min(0).max(100000).default(0) }).strict();
export const assemblyReadQuery = z.object({ version: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  offset: z.coerce.number().int().min(0).max(100000).default(0) }).strict();
export type AssemblySource = { name: string; role: string; materialId: string | null; hash: string; byteLength: number; chunkCount: number | null; webPath: string };
export type AssemblyAudit = {
  version: string; ruleVersion: string; snapshotId: string; source: Source; employeeId: string; employee: string; project: string; sourceSessionId: string;
  committedAt: string; completedAt: string | null; origin: 'commit' | 'reconstructed'; state: z.infer<typeof assemblyState>;
  generation: { id: string; revision: number; change: string } | null;
  records: { total: number; unique: number; inherited: number; repeated: number; compactSummaries: number };
  lineage: { decision: 'independent' | 'continuation' | 'restoration' | 'unresolved'; sourceSnapshotId: string | null; reason: string | null };
  transport: { chunkRequests: number | null; duplicateChunkRequests: number | null; snapshotReplays: number | null };
  sources: AssemblySource[]; sourceCount: number; gaps: { code: string; reference: string }[];
  sideLinks: { relation: string; sessionId: string; materialId?: string }[];
  delivery: DeliveryObservation; nextOffset: number | null; integrity: 'verified' | 'gap';
};
export type AssemblySummary = Pick<AssemblyAudit, 'snapshotId' | 'source' | 'employeeId' | 'employee' | 'project' | 'sourceSessionId' | 'completedAt' | 'state' | 'sourceCount' | 'records' | 'version' | 'transport'>;
export const processingQuery = z.object({ date: reportDate, version: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict();
export type ProcessingPage = { version: string; date: string; timeZone: 'Asia/Shanghai'; createdAt: string; observedSince: string; ruleVersion: string;
  stages: { key: string; label: string; count: number; unit: string }[];
  latency: { measurement: 'collector-monotonic-pickup-to-readable-ack'; p95Ms: number | null; samples: number; unknown: number; targetMs: number };
  backlog: { pendingSnapshots: number; pendingBytes: number; devices: number; observedAt: string | null };
  pending: { state: string; reason: string; count: number }[];
  tokenCoverage: { source: Source; sessions: number; knownSessions: number; unknownSessions: number }[]; catalog: MetricCatalog };
