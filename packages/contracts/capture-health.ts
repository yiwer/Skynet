import { z } from 'zod';

export const captureFaultSchema = z.object({
  id: z.uuid(), code: z.enum(['storage-full', 'permission-denied', 'source-missing', 'queue-limit', 'capture-unavailable', 'hook-unobserved', 'diagnostic-limit']),
  scope: z.enum(['source', 'session']), sessionId: z.string().min(1).max(256).optional(),
  firstObservedAt: z.iso.datetime(), lastObservedAt: z.iso.datetime(), recoveredAt: z.iso.datetime().nullable(),
  // A later readable file cannot prove what disappeared during a failed observation.
  coverage: z.literal('unverified-range'),
}).strict().refine(value => (value.scope === 'session') === Boolean(value.sessionId), 'Session scope requires a native session identity');
export const captureHealthSchema = z.object({
  checkedAt: z.iso.datetime(), observation: z.enum(['no-host-event', 'host-event-observed']),
  locallyPersisted: z.boolean(), faults: z.array(captureFaultSchema).max(128),
}).strict();
export type CaptureFault = z.infer<typeof captureFaultSchema>;
export type CaptureHealth = z.infer<typeof captureHealthSchema>;
export const captureRepair: Record<CaptureFault['code'], string> = {
  'storage-full': '释放采集状态目录所在磁盘空间；保留未确认队列与原件，后台将自动重试。',
  'permission-denied': '恢复当前用户读取原件、读写私有采集目录的权限，勿开放给其他用户。',
  'source-missing': '恢复原路径的会话原件后自动重试；无法找回的故障范围继续标为未核实。',
  'queue-limit': '恢复服务器交付并检查待确认配额；不要删除未确认队列。',
  'capture-unavailable': '检查本机 skynet status 的采集错误和原件格式；修复后后台自动重试。',
  'hook-unobserved': '检查宿主 hooks、必要信任与本地存储；该时段可能有未登记会话，不能保证自动找回。',
  'diagnostic-limit': '本机详细故障数已达上限；已保存范围继续保留，更多故障合并为来源缺口，请检查设备。',
};
