import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { connect, migrate } from '../server/database.js';
import { migrateAnalysis } from '../server/analysis.js';
import { publicConfig, readAnalysisConfig } from './config.js';
import { NativeAnalysisFailure, verifyRuntime } from './native.js';
import { verifyQoderRuntime } from './qodercn.js';
import { analysisQueue, type ClaimedAnalysis } from './queue.js';
import { executeAnalysis } from './execute.js';

if (!process.env.DATABASE_URL || !process.env.SKYNET_ANALYSIS_CONFIG) throw new Error('Dedicated analysis configuration and DATABASE_URL required');
const config = await readAnalysisConfig(process.env.SKYNET_ANALYSIS_CONFIG); await (config.mode==='qoder-cn'?verifyQoderRuntime(config):verifyRuntime(config));
const db = connect(process.env.DATABASE_URL); await migrate(db); await migrateAnalysis(db);
const shutdown = new AbortController(); const workerId = randomUUID(); const queue = analysisQueue(db, config, workerId);
process.once('SIGTERM', () => shutdown.abort()); process.once('SIGINT', () => shutdown.abort());
const heartbeat = async () => db.query(`INSERT INTO analysis_workers(id,config) VALUES($1,$2)
  ON CONFLICT(id) DO UPDATE SET config=EXCLUDED.config,updated_at=now()`, [workerId, publicConfig(config)]);
await heartbeat();
let heartbeatPending: Promise<unknown> | undefined;
const timer = globalThis.setInterval(() => {
  if (!heartbeatPending) heartbeatPending = heartbeat().catch(() => shutdown.abort()).finally(() => { heartbeatPending = undefined; });
}, 3000);
console.log(`Skynet analysis worker ready (${config.mode}; ${config.mode==='qoder-cn'?'Qoder CN':'Claude Code'} ${config.runtimeVersion})`);
const running = new Set<Promise<void>>();
async function run(job: ClaimedAnalysis) {
  const lost = new AbortController();
  let renewing = false;
  const leaseTimer = globalThis.setInterval(() => {
    if (renewing) return; renewing = true;
    void queue.renew(job).then(owned => { if (!owned) lost.abort(); }).catch(() => lost.abort()).finally(() => { renewing = false; });
  }, Math.max(500, Math.floor(config.leaseSeconds * 1000 / 3)));
  try {
    const result = await executeAnalysis(config, job.input, AbortSignal.any([shutdown.signal, lost.signal, AbortSignal.timeout(config.timeoutSeconds * 1000)]), () => queue.allowForward(job));
    await queue.finish(job, result);
  } catch (error) {
    const message = '分析失败或中断：模型、超时、限额或原句证据未通过；未发布结论。提供商用量未知，预算预留保留。';
    await queue.finish(job, null, message, error instanceof NativeAnalysisFailure ? error.requests : undefined);
  } finally { clearInterval(leaseTimer); }
}
try {
  while (!shutdown.signal.aborted) {
    if (running.size < config.concurrency) {
      const job = await queue.claim();
      if (job) { const task = run(job).catch(() => { shutdown.abort(); console.error('Analysis persistence unavailable; leases and unknown reservations retained'); });
        running.add(task); void task.finally(() => running.delete(task)); continue; }
    }
    try { await setTimeout(500, undefined, { signal: shutdown.signal }); } catch {}
  }
} finally {
  clearInterval(timer); await heartbeatPending; await Promise.allSettled([...running]);
  await db.query('DELETE FROM analysis_workers WHERE id=$1', [workerId]); await db.end();
}
