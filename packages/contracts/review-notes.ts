import { z } from 'zod';

export const reviewNotesQuery = z.object({ cursor: z.string().min(1).max(512).optional() }).strict();
export const appendReviewNote = z.object({
  requestId: z.uuid(), assessmentVersion: z.string().regex(/^[a-f0-9]{64}$/),
  text: z.string().trim().min(1).max(2000).refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)),
}).strict();
export type ReviewNote = {
  id: string; employeeId: string; author: { id: string; name: string };
  assessmentVersion: string; text: string; createdAt: string;
};
export type ReviewNotesPage = { employeeId: string; notes: ReviewNote[]; count: number; nextCursor: string | null };
