import { z } from 'zod';
import { ARTIFACT_BYTES, captureSchema, COLLECTION_BYTES } from './materials.js';

export const MAX_ARTIFACT_BYTES = ARTIFACT_BYTES;
export const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const bounded = z.string().min(1).max(256);
export const sourceSchema = z.enum(['codex-desktop', 'codex-cli', 'claude-code-cli']);
export type Source = z.infer<typeof sourceSchema>;
export const sourceLabel = (source: Source) => ({ 'codex-desktop': 'Codex Desktop', 'codex-cli': 'Codex CLI', 'claude-code-cli': 'Claude Code CLI' })[source];
export const enrollmentSchema = z.object({ installationId: z.uuid(), name: bounded,
  // Generated and privately persisted by the installer before its first request.
  deviceCredential: z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional() }).strict();
// A receipt is a claim, never an ownership grant. The server verifies its immutable
// source snapshot and the exact native prefix before carrying event origins forward.
export const restoredFromSchema = z.object({ snapshotId: z.uuid(), hash: hashSchema,
  byteLength: z.number().int().positive().max(MAX_ARTIFACT_BYTES), materialId: hashSchema.optional() }).strict();
export const manifestSchema = z.object({
  protocolVersion: z.literal(1),
  sourceSessionId: bounded,
  source: sourceSchema,
  sourceVersion: bounded,
  sourceOs: bounded,
  project: z.string().max(1024),
  hash: hashSchema,
  byteLength: z.number().int().min(0).max(MAX_ARTIFACT_BYTES),
  qualifiedAt: z.iso.datetime(),
  // Set by the server from device enrollment; absent on pre-migration snapshots.
  enrolledAt: z.iso.datetime().optional(),
  capability: z.literal('unverified'),
  capture: captureSchema.optional(),
  restoredFrom: restoredFromSchema.optional(),
}).strict().refine(value => value.byteLength + (value.capture?.materials.reduce((n, material) => n + material.byteLength, 0) ?? 0) <= COLLECTION_BYTES, 'Capture exceeds the collection size limit');
export type Manifest = z.infer<typeof manifestSchema>;

export const appendSnapshotSchema = z.object({
  manifest: manifestSchema,
  baseSnapshotId: z.uuid(), baseHash: hashSchema,
  baseByteLength: z.number().int().min(1).max(MAX_ARTIFACT_BYTES),
  appendHash: hashSchema, appendByteLength: z.number().int().min(1).max(MAX_ARTIFACT_BYTES),
}).strict();

const sourceTimestampSchema = z.iso.datetime({ offset: true });
export function sourceTimestamp(value: unknown): string | null {
  const parsed = sourceTimestampSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

// Native host input is an unstable external contract; preserve raw artifacts independently.
export const hostEventSchema = z.object({
  hook_event_name: z.enum(['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'Stop', 'SessionEnd']),
  session_id: bounded,
  transcript_path: z.string().min(1).max(4096),
  cwd: z.string().max(4096).optional(),
}).passthrough();

export interface EvidenceLine {
  line: number;
  block?: number;
  role: string;
  text: string;
  timestamp: string | null;
}
export interface SessionSummary {
  id: string;
  employeeId: string;
  employee: string;
  source_session_id: string;
  project: string;
  committed_at: string;
  hash: string;
  byte_length: number;
  source_version: string;
  source_os: string;
  source: Source;
}
