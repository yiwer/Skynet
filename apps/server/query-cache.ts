import { HttpError } from './identities.js';

// Derived immutable values only. A restart drops the cache; it is never an archive ACK.
// Coalesce the same computation and bound both retained bytes and simultaneous new work.
export class QueryCache<T> {
  private values = new Map<string, { value: T; bytes: number; until: number }>();
  private pending = new Map<string, Promise<T>>();
  private waiting: Array<() => void> = [];
  private running = false;
  private bytes = 0;
  constructor(private budget: number, private estimate: (value: T) => number) {}
  async get(key: string, compute: () => Promise<T>): Promise<T> {
    const now = Date.now();
    for (const [id, value] of this.values) if (value.until < now) { this.values.delete(id); this.bytes -= value.bytes; }
    const hit = this.values.get(key);
    if (hit) { this.values.delete(key); this.values.set(key, hit); return hit.value; }
    const pending = this.pending.get(key); if (pending) return pending;
    if (this.running && this.waiting.length >= 8) throw new HttpError(503, '查询等待队列已满，请稍后重试；采集继续运行');
    const work = (async () => {
      // Admit one computation and eight different waiting keys. Waiting work
      // has not read or parsed its archive yet; same-key callers share it.
      await new Promise<void>(resolve => {
        if (this.running) this.waiting.push(resolve);
        else { this.running = true; resolve(); }
      });
      try {
        const value = await compute();
        const bytes = this.estimate(value);
        if (bytes <= this.budget) {
          for (const [id, prior] of this.values) {
            if (this.bytes + bytes <= this.budget) break;
            this.values.delete(id); this.bytes -= prior.bytes;
          }
          this.values.set(key, { value, bytes, until: Date.now() + 300_000 }); this.bytes += bytes;
        }
        return value;
      } finally {
        this.pending.delete(key);
        const next = this.waiting.shift();
        if (next) next(); else this.running = false;
      }
    })();
    this.pending.set(key, work); return work;
  }
}
