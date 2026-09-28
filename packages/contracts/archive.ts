import { z } from 'zod';

export const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024;
export const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const bounded = z.string().min(1).max(256);
export const sourceSchema = z.enum(['codex-desktop', 'codex-cli', 'claude-code-cli']);
export type Source = z.infer<typeof sourceSchema>;
export const sourceLabel = (source: Source) => ({ 'codex-desktop': 'Codex Desktop', 'codex-cli': 'Codex CLI', 'claude-code-cli': 'Claude Code CLI' })[source];
export const enrollmentSchema = z.object({ installationId: z.uuid(), name: bounded }).strict();
export const manifestSchema = z.object({
  protocolVersion: z.literal(1),
  sourceSessionId: bounded,
  source: sourceSchema,
  sourceVersion: bounded,
  sourceOs: bounded,
  project: z.string().max(1024),
  hash: hashSchema,
  byteLength: z.number().int().min(1).max(MAX_ARTIFACT_BYTES),
  qualifiedAt: z.iso.datetime(),
  capability: z.literal('unverified'),
}).strict();
export type Manifest = z.infer<typeof manifestSchema>;

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
