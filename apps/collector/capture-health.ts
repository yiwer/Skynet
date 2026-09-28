import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicJson } from '../../packages/filesystem.js';
import { captureHealthSchema, type CaptureFault, type CaptureHealth } from '../../packages/contracts/capture-health.js';

// A running worker can report a full disk without pretending a failed local write
// succeeded. This bounded memory survives sweeps, not process death or lost power.
const running = new Map<string, CaptureHealth>();
export class CaptureMonitor {
  private seen = new Set<string>();
  private constructor(private state: string, private report: CaptureHealth) {}
  static async open(state: string) {
    let report = running.get(state);
    if (!report) {
      try { report = captureHealthSchema.parse(JSON.parse(await readFile(join(state, 'capture-health.json'), 'utf8'))); }
      catch (error) {
        report = { checkedAt: new Date().toISOString(), observation: 'no-host-event', locallyPersisted: false, faults: [] };
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          const monitor = new CaptureMonitor(state, report); monitor.fail(error); return monitor;
        }
      }
    }
    return new CaptureMonitor(state, report);
  }
  observe() { this.report.observation = 'host-event-observed'; }
  fail(error: unknown, sessionId?: string, explicit?: CaptureFault['code']) {
    const code = (error as NodeJS.ErrnoException)?.code;
    const kind = explicit ?? (code === 'ENOSPC' || code === 'EDQUOT' ? 'storage-full'
      : code === 'EACCES' || code === 'EPERM' || code === 'EROFS' ? 'permission-denied'
        : code === 'ENOENT' ? 'source-missing' : String((error as Error)?.message).includes('queue quota') ? 'queue-limit' : 'capture-unavailable');
    const key = `${sessionId ?? ''}:${kind}`; this.seen.add(key);
    const now = new Date().toISOString();
    let fault = this.report.faults.find(item => item.code === kind && item.sessionId === sessionId && !item.recoveredAt);
    if (!fault) {
      if (this.report.faults.length >= 127) {
        fault = this.report.faults.find(item => item.code === 'diagnostic-limit');
        if (!fault) this.report.faults.push({ id: randomUUID(), code: 'diagnostic-limit', scope: 'source', firstObservedAt: now, lastObservedAt: now, recoveredAt: null, coverage: 'unverified-range' });
        return;
      }
      fault = { id: randomUUID(), code: kind, scope: sessionId ? 'session' : 'source', sessionId,
        firstObservedAt: now, lastObservedAt: now, recoveredAt: null, coverage: 'unverified-range' };
      this.report.faults.push(fault);
    }
    fault.lastObservedAt = now;
  }
  recover(sessionId?: string) {
    for (const fault of this.report.faults) if (fault.sessionId === sessionId && !fault.recoveredAt
      && !['hook-unobserved', 'diagnostic-limit'].includes(fault.code) && !this.seen.has(`${sessionId ?? ''}:${fault.code}`)) fault.recoveredAt = new Date().toISOString();
  }
  async save() {
    this.report.checkedAt = new Date().toISOString(); this.report.locallyPersisted = true;
    try { await atomicJson(join(this.state, 'capture-health.json'), this.report); }
    catch (error) { this.report.locallyPersisted = false; this.fail(error); }
    running.set(this.state, this.report);
    return this.report;
  }
}
