import { z } from 'zod';
import { sourceSchema, type Source } from './archive.js';
import { reportDate } from './reports.js';

// A device claim about configuration and an observed hook is not an attestation
// that every native trust prompt was accepted or that capture covered a whole day.
export const installationObservationSchema = z.object({
  clients: z.array(z.object({ source: sourceSchema, configured: z.boolean(),
    hostEvent: z.enum(['observed', 'not-observed']) }).strict()).max(3)
    .refine(clients => new Set(clients.map(client => client.source)).size === clients.length),
}).strict();
export const coverageQuerySchema = z.object({ date: reportDate, offset: z.coerce.number().int().min(0).max(100000).default(0) }).strict();
export type CoverageObservation = { deviceId: string; device: string; source: Source | null; date: string;
  firstReceivedAt: string; lastReceivedAt: string; samples: number; gapObserved: boolean;
  configured: boolean | null; hostEvent: 'observed' | 'not-observed' | 'unknown';
  backlogObserved: boolean; faultCodes: string[] };
export type CoverageCell = { employeeId: string; employee: string; date: string;
  activity: 'observed' | 'none-observed'; records: number; sessions: number;
  collection: 'gap-observed' | 'observations-only' | 'unknown';
  analysis: 'ready' | 'unfinished' | 'not-scheduled' | 'unknown';
  configured: 'configured' | 'not-configured' | 'mixed' | 'unknown';
  hostConfirmation: 'observed' | 'pending-confirmation' | 'unknown';
  currentConnection: 'connected' | 'not-connected' | 'unknown' | 'not-applicable';
  firstReceivedAt: string | null; lastReceivedAt: string | null };
export type CoverageMatrix = { selectedDate: string; dates: string[]; rows: { employeeId: string; employee: string; cells: CoverageCell[] }[];
  nextOffset: number | null; definition: string; observationStartedAt: string; checkedAt: string };
export type RecordedTokens = { input: number | null; cachedInput: number | null; cacheWriteInput: number | null;
  output: number | null; reasoningOutput: number | null; total: number | null;
  usageRecords: number; unknownRecords: number; definition: string };
export type StatisticReference = { snapshotId: string; materialId: string | null; line: number; webPath: string;
  kind: 'file' | 'usage'; value: string };
export type WorkStatistics = { employeeId: string; employee: string; date: string; revision: number; version: string;
  records: number; sessions: number; userTurns: number; toolCalls: number; historicalRecords: number; unknownRecords: number;
  files: { observedCount: number; paths: string[]; complete: boolean; unsupportedToolCalls: number };
  tokens: RecordedTokens; intervals: { session: string; from: string; to: string; points: number }[];
  references: StatisticReference[]; nextOffset: number | null; sourceInputsComplete: boolean;
  definition: string; humanWorkHours: null; createdAt: string };
