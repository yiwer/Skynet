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
