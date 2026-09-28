import pg from 'pg';
import { createHash, randomBytes } from 'node:crypto';

export const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export const newCredential = () => randomBytes(32).toString('base64url');
export const connect = (connectionString: string) => new pg.Pool({ connectionString, max: 8 });
export type Database = ReturnType<typeof connect>;

export async function migrate(db: Database) {
  // A single transactional initial migration. Never changes an existing column silently.
  await db.query(`
    BEGIN;
    SELECT pg_advisory_xact_lock(7402104);
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
    ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS source text GENERATED ALWAYS AS (manifest->>'source') STORED;
    CREATE UNIQUE INDEX IF NOT EXISTS snapshots_source_identity ON snapshots(device_id,source,source_session_id,manifest_hash);
    COMMIT;
  `);
}
