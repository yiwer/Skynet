import { z } from 'zod';
import { hashSchema } from './archive.js';
export const backupObjectSchema=z.object({deviceId:z.uuid(),hash:hashSchema,byteLength:z.number().int().min(0).max(64*1024*1024)}).strict();
export const backupReceiptSchema=z.object({version:z.literal(1),id:z.uuid(),snapshotAt:z.iso.datetime(),completedAt:z.iso.datetime(),
  objects:z.number().int().min(0).max(8192*1000),bytes:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  dumpHash:hashSchema,dumpBytes:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),postgresMajor:z.literal(17),
  schema:z.literal('skynet-server-backup-1'),nodeVersion:z.string().max(32),pgDumpVersion:z.string().max(128),
  failureDomain:z.enum(['same-host','off-host-declared','unknown']),
  pages:z.array(z.object({index:z.number().int().min(0).max(8191),hash:hashSchema,count:z.number().int().min(1).max(1000)}).strict()).max(8192)}).strict();
export type BackupReceipt=z.infer<typeof backupReceiptSchema>;
export const backupCommandSchema=z.discriminatedUnion('action',[
  z.object({action:z.literal('backup'),rawDirectory:z.string().min(1).max(4096),backupDirectory:z.string().min(1).max(4096),failureDomain:z.enum(['same-host','off-host-declared','unknown']).default('unknown')}),
  z.object({action:z.literal('restore'),bundleDirectory:z.string().min(1).max(4096),rawDirectory:z.string().min(1).max(4096)}),
  z.object({action:z.literal('verify'),bundleDirectory:z.string().min(1).max(4096)}),
]);
