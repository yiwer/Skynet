import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { Database } from '../server/database.js';
import type { AnalysisConfig } from './config.js';
import type { AnalysisInput } from '../server/analysis.js';
import type { AnalysisRun } from '../../packages/contracts/analysis.js';
import { attributionRevisionSql } from '../server/qualification.js';

export async function analysisTransaction<T>(db: Database, operation: (client: PoolClient) => Promise<T>, lockOrigins = false): Promise<T> {
  const client = await db.connect();
  try { await client.query('BEGIN');
    // Only request preparation couples origin revision and target/job creation.
    // Acquire archive before queue; archive writers never acquire the queue lock.
    if(lockOrigins)await client.query('SELECT pg_advisory_xact_lock(7402119)');
    await client.query('SELECT pg_advisory_xact_lock(7402123)');
    await client.query("SELECT set_config('skynet.analysis_protocol','3',true)");
    const value = await operation(client); await client.query('COMMIT'); return value;
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}
export async function migrateQueue(client: PoolClient) {
  await client.query(`CREATE TABLE IF NOT EXISTS analysis_targets(id uuid PRIMARY KEY,device_id uuid NOT NULL REFERENCES devices(id),
    source text NOT NULL,source_session_id text NOT NULL,desired_snapshot_id uuid NOT NULL REFERENCES snapshots(id),
    generation integer NOT NULL DEFAULT 1,config_hash text NOT NULL,actor_id uuid NOT NULL REFERENCES employees(id),
    applicable_job_id uuid,updated_at timestamptz NOT NULL DEFAULT now(),error text,
    UNIQUE(device_id,source,source_session_id));
    ALTER TABLE analysis_jobs ADD COLUMN IF NOT EXISTS target_id uuid REFERENCES analysis_targets(id);
    ALTER TABLE analysis_jobs ADD COLUMN IF NOT EXISTS target_generation integer NOT NULL DEFAULT 0;
    ALTER TABLE analysis_jobs ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
    ALTER TABLE analysis_jobs ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 1;
    ALTER TABLE analysis_jobs ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now();
    ALTER TABLE analysis_jobs ADD COLUMN IF NOT EXISTS lease_until timestamptz;
    ALTER TABLE analysis_jobs ADD COLUMN IF NOT EXISTS worker_id text;
    ALTER TABLE analysis_jobs ADD COLUMN IF NOT EXISTS trigger text NOT NULL DEFAULT 'manual';
    ALTER TABLE analysis_targets ADD COLUMN IF NOT EXISTS parser_version text NOT NULL DEFAULT 'unknown';
    ALTER TABLE analysis_targets ADD COLUMN IF NOT EXISTS attribution_revision bigint NOT NULL DEFAULT 0;
    CREATE TABLE IF NOT EXISTS analysis_attempts(id uuid PRIMARY KEY,job_id uuid NOT NULL REFERENCES analysis_jobs(id),
      number integer NOT NULL,run_token uuid NOT NULL UNIQUE,worker_id text NOT NULL,state text NOT NULL,
      reserved_cny numeric NOT NULL,requests integer,usage jsonb,error text,started_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz,
      UNIQUE(job_id,number));
    CREATE TABLE IF NOT EXISTS analysis_actions(id uuid PRIMARY KEY,job_id uuid NOT NULL REFERENCES analysis_jobs(id),
      actor_id uuid NOT NULL REFERENCES employees(id),action text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
    CREATE INDEX IF NOT EXISTS analysis_due ON analysis_jobs(next_attempt_at,created_at) WHERE state IN ('queued','retry-wait');`);
  for (const table of ['analysis_jobs', 'analysis_targets', 'analysis_actions']) {
    await client.query(`ALTER TABLE ${table} ALTER COLUMN actor_id DROP NOT NULL;
      ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS actor_kind text NOT NULL DEFAULT 'user'`);
  }
  await client.query(`UPDATE analysis_jobs SET state='superseded',error='旧队列协议的未运行任务已过期；请以当前版本发起',finished_at=now()
    WHERE target_id IS NULL AND state IN ('queued','retry-wait');
    CREATE OR REPLACE FUNCTION guard_analysis_protocol() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF OLD.target_id IS NOT NULL AND (NEW.state IS DISTINCT FROM OLD.state OR NEW.run_token IS DISTINCT FROM OLD.run_token
        OR NEW.attempts IS DISTINCT FROM OLD.attempts) AND COALESCE(current_setting('skynet.analysis_protocol',true),'')<>'3' THEN
        RAISE EXCEPTION 'Analysis queue protocol mismatch; current jobs unchanged';
      END IF;
      RETURN NEW;
    END $$;
    DROP TRIGGER IF EXISTS analysis_protocol_guard ON analysis_jobs;
    CREATE TRIGGER analysis_protocol_guard BEFORE UPDATE ON analysis_jobs FOR EACH ROW EXECUTE FUNCTION guard_analysis_protocol();`);
}

// A read also reconciles expired leases: no missing worker leaves running status forever.
export async function sweepQueue(client: PoolClient) {
  await client.query(`WITH changed AS (
    SELECT t.id,s.id AS snapshot_id,${attributionRevisionSql('s.id')} AS attribution_revision FROM analysis_targets t JOIN LATERAL(
      SELECT id FROM snapshots WHERE device_id=t.device_id AND source=t.source AND source_session_id=t.source_session_id
      ORDER BY committed_at DESC,id DESC LIMIT 1) s ON true WHERE t.desired_snapshot_id<>s.id OR t.attribution_revision<>${attributionRevisionSql('s.id')})
    UPDATE analysis_targets t SET desired_snapshot_id=c.snapshot_id,attribution_revision=c.attribution_revision,generation=generation+1,applicable_job_id=NULL,updated_at=now(),error=NULL
    FROM changed c WHERE t.id=c.id`);
  await client.query(`UPDATE analysis_jobs j SET state='superseded',error='输入或配置版本已过期；未追加模型调用',finished_at=now()
    WHERE state IN ('queued','retry-wait') AND EXISTS(SELECT 1 FROM analysis_targets t WHERE t.id=j.target_id AND t.generation<>j.target_generation)`);
  await client.query(`UPDATE analysis_attempts a SET state='lost',finished_at=now(),error='租约失效；提供商用量未知，预留保留'
    FROM analysis_jobs j WHERE a.job_id=j.id AND a.run_token=j.run_token AND a.state='running'
      AND j.state='running' AND (j.lease_until<now() OR j.deadline<now())`);
  await client.query(`UPDATE analysis_jobs j SET state=CASE WHEN attempts<max_attempts AND EXISTS(
      SELECT 1 FROM analysis_targets t WHERE t.id=j.target_id AND t.generation=j.target_generation) THEN 'retry-wait' ELSE 'failed' END,
    error='运行中断或租约失效；用量未知，预留保留；按有限次数重试',run_token=NULL,worker_id=NULL,lease_until=NULL,
    next_attempt_at=now()+COALESCE((config->>'retryDelaySeconds')::integer,3)*interval '1 second',finished_at=now()
    WHERE state='running' AND (lease_until<now() OR deadline<now())`);
  await client.query(`UPDATE analysis_jobs SET state='failed',error='原配置已离线；未追加模型调用，请恢复相同配置或发起新版本',finished_at=now()
    WHERE state IN ('queued','retry-wait') AND created_at<now()-interval '30 seconds'
    AND NOT EXISTS(SELECT 1 FROM analysis_workers w WHERE w.updated_at>now()-interval '15 seconds'
      AND w.config->>'configurationHash'=analysis_jobs.config->>'configurationHash')`);
}

export const analysisProjection = `j.id,j.snapshot_id AS "snapshotId",j.state,j.config,j.input-'events' AS input,j.result,j.error,
  j.created_at AS "createdAt",j.started_at AS "startedAt",j.finished_at AS "finishedAt",j.attempts,j.max_attempts AS "maxAttempts",
  j.next_attempt_at AS "nextAttemptAt",j.lease_until AS "leaseUntil",j.deadline,j.target_generation AS generation,j.trigger,
  j.actor_id AS "actorId",j.actor_kind AS "actorKind",
  COALESCE((SELECT applicable_job_id=j.id AND desired_snapshot_id=j.snapshot_id AND config_hash=j.config->>'configurationHash'
    AND generation=j.target_generation AND parser_version=j.input->>'parserVersion'
    AND attribution_revision=COALESCE((j.input->>'attributionRevision')::bigint,0)
    AND attribution_revision=${attributionRevisionSql('j.snapshot_id')} FROM analysis_targets WHERE id=j.target_id),false) AS applicable,
  (SELECT desired_snapshot_id FROM analysis_targets WHERE id=j.target_id) AS "desiredSnapshotId",
  (SELECT error FROM analysis_targets WHERE id=j.target_id) AS "targetError",
  COALESCE((SELECT jsonb_agg(jsonb_build_object('number',number,'state',state,'reservedCny',reserved_cny,'requests',requests,'usage',usage,'error',error,
    'startedAt',started_at,'finishedAt',finished_at) ORDER BY number) FROM analysis_attempts WHERE job_id=j.id),'[]'::jsonb) AS "attemptHistory"`;

export type ClaimedAnalysis = { id: string; run_token: string; input: AnalysisInput; attempts: number; target_generation: number };
export function analysisQueue(db: Database, config: AnalysisConfig, workerId: string) {
  async function claim(): Promise<ClaimedAnalysis | null> {
    return analysisTransaction(db, async client => {
      await sweepQueue(client);
      const active = await client.query("SELECT DISTINCT config->>'configurationHash' AS hash FROM analysis_workers WHERE updated_at>now()-interval '15 seconds'");
      if (active.rows.length !== 1 || active.rows[0].hash !== config.configurationHash) return null;
      const running = await client.query("SELECT count(*)::int AS count FROM analysis_jobs WHERE state='running'");
      if (running.rows[0].count >= config.concurrency) return null;
      const selected = await client.query(`SELECT j.* FROM analysis_jobs j LEFT JOIN analysis_targets t ON t.id=j.target_id
        WHERE j.state IN ('queued','retry-wait') AND j.next_attempt_at<=now() AND j.attempts<j.max_attempts
          AND j.config->>'configurationHash'=$1 ORDER BY (j.target_generation=t.generation) DESC,j.created_at,j.id LIMIT 1 FOR UPDATE OF j SKIP LOCKED`, [config.configurationHash]);
      if (!selected.rows[0]) return null;
      const job = selected.rows[0]; const token = randomUUID();
      await client.query('INSERT INTO analysis_budgets(id) VALUES($1) ON CONFLICT DO NOTHING', [config.budgetId]);
      const reserved = await client.query(`UPDATE analysis_budgets SET reserved_cny=reserved_cny+$2 WHERE id=$1 AND reserved_cny+$2<=$3 RETURNING id`,
        [config.budgetId, config.reservationCny, config.budgetCny]);
      if (!reserved.rows.length) {
        await client.query("UPDATE analysis_jobs SET state='failed',error='预算已耗尽；未追加模型调用，已有未知预留保留',finished_at=now() WHERE id=$1", [job.id]); return null;
      }
      await client.query(`UPDATE analysis_jobs SET state='running',attempts=attempts+1,run_token=$2,worker_id=$3,lease_until=now()+$4*interval '1 second',
        deadline=now()+$5*interval '1 second',started_at=now(),finished_at=NULL,error=NULL WHERE id=$1`, [job.id, token, workerId, config.leaseSeconds, config.timeoutSeconds + 5]);
      await client.query(`INSERT INTO analysis_attempts(id,job_id,number,run_token,worker_id,state,reserved_cny)
        VALUES($1,$2,$3,$4,$5,'running',$6)`, [randomUUID(), job.id, job.attempts + 1, token, workerId, config.reservationCny]);
      return { ...job, run_token: token, attempts: job.attempts + 1 };
    });
  }
  async function renew(job: ClaimedAnalysis) {
    const row = await db.query(`UPDATE analysis_jobs SET lease_until=LEAST(deadline,now()+$4*interval '1 second')
      WHERE id=$1 AND run_token=$2 AND worker_id=$3 AND state='running' AND lease_until>now() AND deadline>now() RETURNING id`,
      [job.id, job.run_token, workerId, config.leaseSeconds]);
    return row.rows.length === 1;
  }
  async function allowForward(job: ClaimedAnalysis) {
    return analysisTransaction(db, async client => {
      const row = await client.query(`UPDATE analysis_attempts a SET requests=COALESCE(requests,0)+1 FROM analysis_jobs j
        WHERE a.run_token=$1 AND a.job_id=j.id AND j.run_token=a.run_token AND j.worker_id=$2 AND j.state='running'
        AND j.lease_until>now() AND j.deadline>now() AND a.state='running' AND COALESCE(a.requests,0)<$3
        AND COALESCE((j.input->>'attributionRevision')::bigint,0)=${attributionRevisionSql('j.snapshot_id')}
        AND EXISTS(SELECT 1 FROM analysis_targets t WHERE t.id=j.target_id AND t.generation=j.target_generation) RETURNING a.id`,
        [job.run_token, workerId, config.maxRequests]);
      return row.rows.length === 1;
    });
  }
  async function finish(job: ClaimedAnalysis, result: AnalysisRun['result'], failure?: string, failureRequests?: number) {
    return analysisTransaction(db, async client => {
      await sweepQueue(client);
      const owned = await client.query("SELECT id,attempts,max_attempts,EXISTS(SELECT 1 FROM analysis_targets t WHERE t.id=j.target_id AND t.generation=j.target_generation) AS current FROM analysis_jobs j WHERE id=$1 AND run_token=$2 AND worker_id=$3 AND state='running' AND lease_until>now() AND deadline>now() FOR UPDATE", [job.id, job.run_token, workerId]);
      if (!owned.rows.length) return false;
      const retry = !result && owned.rows[0].attempts < owned.rows[0].max_attempts && owned.rows[0].current;
      await client.query(`UPDATE analysis_attempts SET state=$2,requests=COALESCE(requests,$3),usage=$4,error=$5,finished_at=now() WHERE run_token=$1 AND state='running'`,
        [job.run_token, result ? 'succeeded' : 'failed', result?.usage.requests ?? failureRequests ?? null, result?.usage ?? null, failure ?? null]);
      await client.query(`UPDATE analysis_jobs SET state=$3,result=$4,error=$5,finished_at=now(),lease_until=NULL,worker_id=NULL,run_token=NULL,
        next_attempt_at=now()+$6*interval '1 second' WHERE id=$1 AND run_token=$2`,
        [job.id, job.run_token, result ? 'succeeded' : retry ? 'retry-wait' : 'failed', result, failure ?? null, Math.min(30, config.retryDelaySeconds * 2 ** (job.attempts - 1))]);
      if (result) await client.query(`UPDATE analysis_targets SET applicable_job_id=$1,error=NULL WHERE id=(SELECT target_id FROM analysis_jobs WHERE id=$1)
        AND desired_snapshot_id=$2 AND generation=$3 AND config_hash=$4`, [job.id, job.input.snapshotId, job.target_generation, config.configurationHash]);
      return true;
    });
  }
  return { claim, renew, finish, allowForward };
}
