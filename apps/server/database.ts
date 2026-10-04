import pg from 'pg';
import { createHash, randomBytes } from 'node:crypto';

export const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export const newCredential = () => randomBytes(32).toString('base64url');
export const connect = (connectionString: string) => new pg.Pool({ connectionString, max: 8 });
export type Database = ReturnType<typeof connect>;

const baseMigration = `
    CREATE TABLE IF NOT EXISTS employees (
      id uuid PRIMARY KEY, name text NOT NULL, reader_hash text UNIQUE NOT NULL,
      enrollment_hash text UNIQUE NOT NULL, active boolean NOT NULL DEFAULT true
    );
    CREATE TABLE IF NOT EXISTS devices (
      id uuid PRIMARY KEY, employee_id uuid NOT NULL REFERENCES employees(id),
      installation_id uuid NOT NULL, name text NOT NULL, credential_hash text UNIQUE NOT NULL,
      active boolean NOT NULL DEFAULT true, UNIQUE(employee_id, installation_id)
    );
    ALTER TABLE employees ADD COLUMN IF NOT EXISTS can_manage_identities boolean NOT NULL DEFAULT false;
    CREATE TABLE IF NOT EXISTS identity_audit (
      id uuid PRIMARY KEY, actor_id uuid NOT NULL REFERENCES employees(id),
      employee_id uuid NOT NULL REFERENCES employees(id), device_id uuid REFERENCES devices(id),
      action text NOT NULL CHECK(action IN ('disable-employee','disable-device')),
      occurred_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS identity_audit_time ON identity_audit(occurred_at DESC,id DESC);
    CREATE TABLE IF NOT EXISTS chunks (
      device_id uuid NOT NULL REFERENCES devices(id), hash text NOT NULL,
      byte_length integer NOT NULL, PRIMARY KEY(device_id, hash)
    );
    CREATE TABLE IF NOT EXISTS snapshots (
      id uuid PRIMARY KEY, device_id uuid NOT NULL REFERENCES devices(id),
      source_session_id text NOT NULL, manifest_hash text NOT NULL, manifest jsonb NOT NULL,
      hash text NOT NULL, committed_at timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY(device_id, hash) REFERENCES chunks(device_id, hash),
      UNIQUE(device_id, source_session_id, manifest_hash)
    );
    -- Old devices have no trustworthy registration instant. Keep that boundary unknown.
    ALTER TABLE devices ADD COLUMN IF NOT EXISTS enrolled_at timestamptz;
    ALTER TABLE devices ALTER COLUMN enrolled_at SET DEFAULT now();
    CREATE TABLE IF NOT EXISTS device_health (
      device_id uuid PRIMARY KEY REFERENCES devices(id), received_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS device_delivery_health (
      device_id uuid NOT NULL REFERENCES devices(id), source text NOT NULL,
      report jsonb NOT NULL, received_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(device_id,source)
    );
    CREATE TABLE IF NOT EXISTS device_capture_health (
      device_id uuid NOT NULL REFERENCES devices(id), source text NOT NULL,
      report jsonb NOT NULL, received_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(device_id,source)
    );
    CREATE TABLE IF NOT EXISTS capture_faults (
      device_id uuid NOT NULL REFERENCES devices(id), source text NOT NULL, id uuid NOT NULL,
      session_id text, report jsonb NOT NULL, received_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(device_id,source,id)
    );
    CREATE INDEX IF NOT EXISTS capture_faults_session ON capture_faults(device_id,source,session_id);
    ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS source text GENERATED ALWAYS AS (manifest->>'source') STORED;
    CREATE UNIQUE INDEX IF NOT EXISTS snapshots_source_identity ON snapshots(device_id,source,source_session_id,manifest_hash);
    CREATE INDEX IF NOT EXISTS snapshots_source_hash ON snapshots(device_id,source,source_session_id,hash);
    CREATE INDEX IF NOT EXISTS snapshots_current_native_scope ON snapshots(device_id,source,source_session_id,committed_at DESC,id DESC);
    CREATE TABLE IF NOT EXISTS snapshot_uploads (
      device_id uuid NOT NULL REFERENCES devices(id), upload_id uuid NOT NULL,
      manifest_hash text NOT NULL, snapshot_id uuid NOT NULL REFERENCES snapshots(id),
      PRIMARY KEY(device_id,upload_id)
    );
    ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS provenance jsonb;
    CREATE TABLE IF NOT EXISTS archive_event_origins (
      event_id text PRIMARY KEY, snapshot_id uuid NOT NULL REFERENCES snapshots(id),
      line integer NOT NULL, block integer NOT NULL,
      employee_id uuid NOT NULL REFERENCES employees(id), device_id uuid NOT NULL REFERENCES devices(id),
      project text NOT NULL, source text NOT NULL, source_session_id text NOT NULL,
      role text NOT NULL, timestamp text, source_date text, context text NOT NULL
    );
    CREATE TABLE IF NOT EXISTS snapshot_events (
      snapshot_id uuid NOT NULL REFERENCES snapshots(id), line integer NOT NULL, block integer NOT NULL,
      event_id text NOT NULL REFERENCES archive_event_origins(event_id),
      PRIMARY KEY(snapshot_id,line,block)
    );
    CREATE INDEX IF NOT EXISTS archive_event_owner_day ON archive_event_origins(employee_id,source_date);
    ALTER TABLE archive_event_origins ADD COLUMN IF NOT EXISTS material_id text;
    ALTER TABLE archive_event_origins ADD COLUMN IF NOT EXISTS text_offset integer NOT NULL DEFAULT 0;
    CREATE TABLE IF NOT EXISTS material_qualifications (
      snapshot_id uuid NOT NULL REFERENCES snapshots(id), material_id text NOT NULL,
      device_id uuid NOT NULL REFERENCES devices(id), source text NOT NULL, source_session_id text NOT NULL,
      hash text NOT NULL, byte_length integer NOT NULL, qualified_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(snapshot_id,material_id)
    );
    CREATE INDEX IF NOT EXISTS material_qualification_source ON material_qualifications(device_id,source,source_session_id,qualified_at);
    CREATE INDEX IF NOT EXISTS material_qualification_hash ON material_qualifications(device_id,source,source_session_id,hash);
    CREATE TABLE IF NOT EXISTS material_events (
      snapshot_id uuid NOT NULL REFERENCES snapshots(id), material_id text NOT NULL,
      line integer NOT NULL, block integer NOT NULL, event_id text NOT NULL REFERENCES archive_event_origins(event_id),
      PRIMARY KEY(snapshot_id,material_id,line,block)
    );
    CREATE TABLE IF NOT EXISTS native_event_occurrences (
      device_id uuid NOT NULL REFERENCES devices(id), source text NOT NULL, source_session_id text NOT NULL,
      occurrence_hash text NOT NULL, event_id text NOT NULL REFERENCES archive_event_origins(event_id),
      PRIMARY KEY(device_id,source,source_session_id,occurrence_hash)
    );
    CREATE TABLE IF NOT EXISTS event_qualifications (
      revision bigserial PRIMARY KEY,event_id text NOT NULL REFERENCES archive_event_origins(event_id),
      proof_snapshot_id uuid NOT NULL REFERENCES snapshots(id),proof_line integer NOT NULL,proof_block integer NOT NULL,
      context text NOT NULL CHECK(context IN ('historical','after-enrollment','unknown-time','unknown-enrollment')),
      enrolled_at timestamptz NOT NULL,record_hash text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(event_id,proof_snapshot_id)
    );
    CREATE INDEX IF NOT EXISTS event_qualification_latest ON event_qualifications(event_id,revision DESC);
    CREATE TABLE IF NOT EXISTS event_integrity (
      revision bigserial PRIMARY KEY,event_id text NOT NULL REFERENCES archive_event_origins(event_id),
      version text NOT NULL,valid boolean NOT NULL,record_hash text,reason text,
      checked_at timestamptz NOT NULL DEFAULT now(),UNIQUE(event_id,version)
    );
    CREATE TABLE IF NOT EXISTS event_origin_overrides (
      revision bigserial PRIMARY KEY,snapshot_id uuid NOT NULL REFERENCES snapshots(id),line integer NOT NULL,block integer NOT NULL,
      version text NOT NULL,event_id text REFERENCES archive_event_origins(event_id),record_hash text,reason text,
      created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(snapshot_id,line,block,version)
    );
    CREATE INDEX IF NOT EXISTS event_integrity_invalid ON event_integrity(event_id)
      WHERE version='original-utf8-1' AND NOT valid;
    CREATE OR REPLACE VIEW effective_snapshot_events AS SELECT s.snapshot_id,s.line,s.block,COALESCE(v.event_id,s.event_id) AS event_id
      FROM snapshot_events s LEFT JOIN event_origin_overrides v ON v.snapshot_id=s.snapshot_id AND v.line=s.line AND v.block=s.block AND v.version='original-utf8-1';
    CREATE TABLE IF NOT EXISTS qualification_reconcile (
      id integer PRIMARY KEY CHECK(id=1),cutoff timestamptz NOT NULL DEFAULT now(),
      last_committed_at timestamptz,last_snapshot_id uuid,complete boolean NOT NULL DEFAULT false,last_error text
    );
    ALTER TABLE qualification_reconcile ADD COLUMN IF NOT EXISTS last_error text;
    INSERT INTO qualification_reconcile(id) VALUES(1) ON CONFLICT DO NOTHING;
    CREATE TABLE IF NOT EXISTS qualification_reconcile_gaps (
      snapshot_id uuid PRIMARY KEY REFERENCES snapshots(id),reason text NOT NULL
    );
    ALTER TABLE qualification_reconcile_gaps ADD COLUMN IF NOT EXISTS revision bigserial;
    CREATE TABLE IF NOT EXISTS snapshot_input_integrity (
      revision bigserial PRIMARY KEY,snapshot_id uuid NOT NULL REFERENCES snapshots(id),version text NOT NULL,
      complete boolean NOT NULL,unrecognized_lines integer NOT NULL,partial_line boolean NOT NULL,
      checked_at timestamptz NOT NULL DEFAULT now(),UNIQUE(snapshot_id,version)
    );
    -- Keep ordinary and qualified origins disjoint. Resolving the latest proof
    -- as a set avoids one ordered qualification lookup for every archived event.
    CREATE OR REPLACE VIEW effective_event_origins AS
      SELECT o.event_id,o.snapshot_id,o.line,o.block,o.employee_id,o.device_id,o.project,
        o.source,o.source_session_id,o.role,o.timestamp,o.source_date,o.context,o.material_id,o.text_offset,
        o.context AS base_context,0::bigint AS qualification_revision,NULL::uuid AS proof_snapshot_id,
        NULL::integer AS proof_line,NULL::integer AS proof_block,NULL::timestamptz AS proof_enrolled_at
      FROM archive_event_origins o
      WHERE NOT EXISTS(SELECT 1 FROM event_qualifications c WHERE c.event_id=o.event_id)
        AND EXISTS(SELECT 1 FROM event_integrity i WHERE i.event_id=o.event_id AND i.version='original-utf8-1' AND i.valid)
      UNION ALL
      SELECT o.event_id,o.snapshot_id,o.line,o.block,o.employee_id,o.device_id,o.project,
        o.source,o.source_session_id,o.role,o.timestamp,o.source_date,c.context,o.material_id,o.text_offset,
        o.context AS base_context,c.revision AS qualification_revision,c.proof_snapshot_id,c.proof_line,c.proof_block,c.enrolled_at AS proof_enrolled_at
      FROM archive_event_origins o JOIN (SELECT DISTINCT ON(event_id) * FROM event_qualifications ORDER BY event_id,revision DESC)c ON c.event_id=o.event_id
      WHERE EXISTS(SELECT 1 FROM event_integrity i WHERE i.event_id=o.event_id AND i.version='original-utf8-1' AND i.valid);
  `;

export async function migrate(db: Database) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(7402104)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())');
    const version = digest(baseMigration);
    const applied = await client.query('SELECT 1 FROM schema_migrations WHERE version=$1', [version]);
    // Provisioning runs against a live server. Even no-op ALTER statements take
    // exclusive locks and can deadlock with background reads of related tables.
    if (!applied.rowCount) {
      await client.query(baseMigration);
      await client.query('INSERT INTO schema_migrations(version) VALUES($1)', [version]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
