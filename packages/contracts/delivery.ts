import { z } from 'zod';

export const deliveryFailureSchema = z.object({
  at: z.iso.datetime(), kind: z.enum(['disconnected', 'rate-limited', 'credentials-rejected', 'server-unavailable', 'request-rejected', 'invalid-ack', 'local-data']),
  status: z.number().int().min(100).max(599).optional(),
}).strict();
export const deliveryHealthSchema = z.object({
  pendingSnapshots: z.number().int().min(0), pendingBytes: z.number().int().min(0),
  oldestPendingAt: z.iso.datetime().nullable(), lastSuccessAt: z.iso.datetime().nullable(),
  attempts: z.number().int().min(0), nextAttemptAt: z.iso.datetime().nullable(),
  lastFailure: deliveryFailureSchema.nullable(), lastRejection: deliveryFailureSchema.nullable(),
  quotaBytes: z.number().int().positive(), quotaSnapshots: z.number().int().positive(), quotaBlocked: z.boolean(),
}).strict();
export type DeliveryHealth = z.infer<typeof deliveryHealthSchema>;
export type DeliveryFailure = z.infer<typeof deliveryFailureSchema>;

// Observations from an authenticated collector, separate from immutable source bytes.
// Client timestamps are not a server-measured end-to-end latency.
export const deliveryReceiptSchema = z.object({
  uploadId: z.uuid(), snapshotId: z.uuid(), capturedAt: z.iso.datetime().max(64), acknowledgedAt: z.iso.datetime().max(64),
  disconnectedAttempts: z.number().int().min(0).max(1_000_000_000),
  firstDisconnectedAt: z.iso.datetime().max(64).nullable(), lastDisconnectedAt: z.iso.datetime().max(64).nullable(),
  timing: z.object({ measurement: z.literal('collector-monotonic-pickup-to-readable-ack'),
    pickupStartedAt: z.iso.datetime(), elapsedMs: z.number().finite().min(0).max(31_536_000_000).nullable() }).strict().optional(),
}).strict().refine(value => value.disconnectedAttempts === 0
  ? value.firstDisconnectedAt === null && value.lastDisconnectedAt === null
  : value.firstDisconnectedAt !== null && value.lastDisconnectedAt !== null, 'Disconnect observations must be consistent');
export type DeliveryReceipt = z.infer<typeof deliveryReceiptSchema>;
export interface DeliveryObservation {
  revision: string; receiptCount: number; disconnectedAttempts: number;
  firstDisconnectedAt: string | null; lastDisconnectedAt: string | null;
  capturedAt: string | null; acknowledgedAt: string | null; receivedAt: string | null;
}
