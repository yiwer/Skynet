import { z } from 'zod';
import { sourceSchema, type SessionSummary } from './archive.js';

export const searchSchema = z.object({
  content: z.string().trim().max(160).default(''),
  employee: z.string().trim().max(256).default(''),
  project: z.string().trim().max(1024).default(''),
  projectState: z.enum(['all', 'unclassified']).default('all'),
  source: sourceSchema.optional(),
  from: z.iso.date().optional(), to: z.iso.date().optional(),
  history: z.enum(['latest', 'all']).default('latest'),
  cursor: z.string().max(1024).optional(),
  limit: z.number().int().min(1).max(10).default(5),
}).refine(value => !value.from || !value.to || value.from <= value.to, '起始日期不得晚于结束日期');
export type SearchInput = z.input<typeof searchSchema>;
export const locationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('event'), offset: z.number().int().min(0), textOffset: z.number().int().min(0).default(0),
    line: z.number().int().min(1).optional(), block: z.number().int().min(0).optional(), parserVersion: z.string().max(128).optional() }),
  z.object({ kind: z.literal('raw'), line: z.number().int().min(1), textOffset: z.number().int().min(0).default(0) }),
  z.object({ kind: z.literal('material'), materialId: z.string().max(256), textOffset: z.number().int().min(0).default(0) }),
]);
export type EvidenceLocation = z.infer<typeof locationSchema>;
export type SearchHit = SessionSummary & { generation: string | null; revision: number | null; location: EvidenceLocation | null;
  line: number | null; block: number | null; sourceDate: string | null; excerpt: string; matchLength: number; webPath: string };
export type SearchPage = { hits: SearchHit[]; nextCursor: string | null; scanned: number; complete: boolean; boundary: string; scope: string };

export function evidenceLink(snapshotId: string, location?: EvidenceLocation | null) {
  return `#${snapshotId}${location ? `?${new URLSearchParams(Object.entries(location).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]))}` : ''}`;
}
