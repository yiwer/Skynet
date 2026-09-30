import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { connect, migrate } from '../server/database.js';
import { migrateAnalysis, validateAnalysis, type AnalysisInput } from '../server/analysis.js';
import { publicConfig, readAnalysisConfig } from './config.js';
import { runNativeAnalysis, verifyRuntime } from './native.js';

if (!process.env.DATABASE_URL || !process.env.SKYNET_ANALYSIS_CONFIG) throw new Error('Dedicated analysis configuration and DATABASE_URL required');
const config = await readAnalysisConfig(process.env.SKYNET_ANALYSIS_CONFIG);
await verifyRuntime(config);
const db = connect(process.env.DATABASE_URL); await migrate(db); await migrateAnalysis(db);
const shutdown = new AbortController();
process.once('SIGTERM', () => shutdown.abort()); process.once('SIGINT', () => shutdown.abort());
const workerId = randomUUID();
const heartbeat = async () => db.query(`INSERT INTO analysis_workers(id,config) VALUES($1,$2)
  ON CONFLICT(id) DO UPDATE SET config=EXCLUDED.config,updated_at=now()`, [workerId, publicConfig(config)]);
await heartbeat();
const timer = globalThis.setInterval(() => { void heartbeat().catch(() => shutdown.abort()); }, 3000);
console.log(`Skynet analysis worker ready (${config.mode}; Claude Code ${config.runtimeVersion})`);
try {
  while (!shutdown.signal.aborted) {
    const client = await db.connect(); let job: { id: string; run_token: string; input: AnalysisInput } | undefined;
    try {
      await client.query('BEGIN'); await client.query('SELECT pg_advisory_xact_lock(7402123)');
      await client.query(`UPDATE analysis_jobs SET state='failed',error='运行中断或超时；用量未知，预算预留保留',finished_at=now()
        WHERE state='running' AND deadline < now()`);
      await client.query(`UPDATE analysis_jobs SET state='failed',error='原运行配置已离线；未调用模型，请按当前配置重新发起',finished_at=now()
        WHERE state='queued' AND created_at < now()-interval '30 seconds'
        AND NOT EXISTS(SELECT 1 FROM analysis_workers w WHERE w.updated_at > now()-interval '15 seconds'
          AND w.config->>'configurationHash'=analysis_jobs.config->>'configurationHash')`);
      const running = await client.query("SELECT id FROM analysis_jobs WHERE state='running' LIMIT 1");
      if (!running.rows.length) {
        const next = await client.query(`SELECT id,input FROM analysis_jobs WHERE state='queued' AND config->>'configurationHash'=$1 ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`, [config.configurationHash]);
        if (next.rows[0]) {
          await client.query('INSERT INTO analysis_budgets(id) VALUES($1) ON CONFLICT DO NOTHING', [config.budgetId]);
          const reservation = await client.query(`UPDATE analysis_budgets SET reserved_cny=reserved_cny+$2 WHERE id=$1 AND reserved_cny+$2 <= $3 RETURNING id`,
            [config.budgetId, config.reservationCny, config.budgetCny]);
          if (!reservation.rows.length) await client.query("UPDATE analysis_jobs SET state='failed',error='配置预算已用尽；未调用模型',finished_at=now() WHERE id=$1", [next.rows[0].id]);
          else {
            job = { ...next.rows[0], run_token: randomUUID() };
            await client.query(`UPDATE analysis_jobs SET state='running',run_token=$2,started_at=now(),deadline=now()+$3*interval '1 second' WHERE id=$1`,
              [job!.id, job!.run_token, config.timeoutSeconds + 10]);
          }
        }
      }
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    if (!job) { try { await setTimeout(500, undefined, { signal: shutdown.signal }); } catch {} continue; }
    try {
      const result = await runNativeAnalysis(config, job.input, AbortSignal.any([shutdown.signal, AbortSignal.timeout(config.timeoutSeconds * 1000)]));
      const items = validateAnalysis(job.input, result.output);
      await db.query(`UPDATE analysis_jobs SET state='succeeded',result=$3,finished_at=now() WHERE id=$1 AND run_token=$2 AND state='running' AND deadline > now()`,
        [job.id, job.run_token, { items, usage: result.usage, fixture: config.mode === 'fixture' }]);
    } catch {
      await db.query(`UPDATE analysis_jobs SET state='failed',error='分析失败：运行时、模型、资源限额或原句证据校验未通过；没有发布结论。用量未知，预算预留保留。',finished_at=now()
        WHERE id=$1 AND run_token=$2 AND state='running'`, [job.id, job.run_token]);
    }
  }
} finally { clearInterval(timer); await db.query('DELETE FROM analysis_workers WHERE id=$1', [workerId]); await db.end(); }
