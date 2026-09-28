import { HttpError } from './identities.js';

// Derived immutable values only. A restart drops the cache; it is never an archive ACK.
// Coalesce the same computation and bound both retained bytes and simultaneous new work.
export class QueryCache<T> {
  private values = new Map<string, { value: T; bytes: number; until: number }>();
  private pending = new Map<string, Promise<T>>();
  private bytes = 0;
  constructor(private budget: number, private estimate: (value: T) => number) {}
  async get(key: string, compute: () => Promise<T>): Promise<T> {
    const now = Date.now();
    for (const [id, value] of this.values) if (value.until < now) { this.values.delete(id); this.bytes -= value.bytes; }
    const hit = this.values.get(key);
    if (hit) { this.values.delete(key); this.values.set(key, hit); return hit.value; }
    const pending = this.pending.get(key); if (pending) return pending;
    if (this.pending.size >= 1) throw new HttpError(503, '已有大型查询正在准备，请稍后重试；采集继续运行');
    const work = compute().then(value => {
      const bytes = this.estimate(value);
      if (bytes <= this.budget) {
        for (const [id, prior] of this.values) {
          if (this.bytes + bytes <= this.budget) break;
          this.values.delete(id); this.bytes -= prior.bytes;
        }
        this.values.set(key, { value, bytes, until: Date.now() + 300_000 }); this.bytes += bytes;
      }
      return value;
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, work); return work;
  }
}
