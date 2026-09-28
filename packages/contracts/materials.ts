import { z } from 'zod';

export const CHUNK_BYTES = 8 * 1024 * 1024;
export const ARTIFACT_BYTES = 64 * 1024 * 1024;
export const COLLECTION_BYTES = 128 * 1024 * 1024;
const sha = z.string().regex(/^[a-f0-9]{64}$/);
export const materialNameSchema = z.string().min(1).max(768).refine(value => value.split('/').every(part =>
  /^[^\u0000-\u001f<>:"\\|?*]+$/.test(part) && !/[. ]$/.test(part) && part !== '.' && part !== '..'
  && !/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)|^\.?(?:auth|credentials?|settings|config)(?:\.|$)|^\.env(?:\.|$)/i.test(part)), 'Unsafe material name');
export const materialSchema = z.object({
  id: sha, role: z.enum(['subagent', 'parent-transcript', 'child-transcript', 'previous-transcript', 'tool-result', 'attachment', 'checkpoint']),
  name: materialNameSchema, placement: z.enum(['claude-session', 'claude-config', 'claude-temp', 'codex-rollout', 'codex-attachments', 'portable']),
  sourceSessionId: z.string().min(1).max(256).optional(), hash: sha, byteLength: z.number().int().min(0).max(ARTIFACT_BYTES),
  mediaType: z.enum(['jsonl', 'text', 'json', 'binary']),
}).strict();
export const gapSchema = z.object({ code: z.enum(['missing', 'unreadable', 'unsafe-path', 'size-limit', 'unknown-format', 'partial-line', 'history-unavailable', 'native-mapping-unverified']), reference: z.string().max(1024) }).strict();
export const lineageSchema = z.object({ relation: z.enum(['parent', 'child', 'fork-parent', 'history-base']), sessionId: z.string().min(1).max(256), materialId: sha.optional(),
  endOrdinalExclusive: z.number().int().min(0).optional(), endByteOffset: z.number().int().min(0).optional() }).strict();
export const captureSchema = z.object({
  generation: sha, revision: z.number().int().positive(), change: z.enum(['initial', 'append', 'rewrite', 'truncate', 'materials']),
  previousSnapshotId: z.uuid().optional(), materials: z.array(materialSchema).max(128), gaps: z.array(gapSchema).max(256),
  lineage: z.array(lineageSchema).max(128), compacted: z.boolean(), partialLine: z.boolean(),
}).strict().refine(value => new Set(value.materials.map(material => material.id)).size === value.materials.length, 'Duplicate material identity');
export const assembleSchema = z.object({ hash: sha, byteLength: z.number().int().min(0).max(ARTIFACT_BYTES),
  chunks: z.array(z.object({ hash: sha, byteLength: z.number().int().min(1).max(CHUNK_BYTES) }).strict()).max(8),
}).strict().refine(value => value.chunks.reduce((n, chunk) => n + chunk.byteLength, 0) === value.byteLength, 'Chunk lengths do not match artifact');
export type Material = z.infer<typeof materialSchema>;
export type Gap = z.infer<typeof gapSchema>;
export type Lineage = z.infer<typeof lineageSchema>;
export type Capture = z.infer<typeof captureSchema>;
