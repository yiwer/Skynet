import { randomUUID } from 'node:crypto';
import { digest, type Database } from './database.js';
import { RawStore } from './raw-store.js';
import { HttpError } from './identities.js';
import { manifestSchema, type Manifest } from '../../packages/contracts/archive.js';

export function archiveWriter(db: Database, raw: RawStore) {
  return async (owner: { id: string; enrolled_at: Date | null }, input: Manifest, uploadId?: string) => {
    // A client cannot choose the historical boundary. Fingerprint only the
    // canonical server-owned manifest, independent of append/full transport.
    const manifest = manifestSchema.parse({ ...input, enrolledAt: owner.enrolled_at?.toISOString() });
    const manifestHash = digest(JSON.stringify(manifest));
    const transaction = await db.connect();
    try {
      await transaction.query('BEGIN');
      if (uploadId) {
        // Serializes concurrent attempts for this device/key without exposing a
        // reservation before the snapshot and binding commit together.
        await transaction.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`${owner.id}/${uploadId}`]);
        const existing = await transaction.query('SELECT manifest_hash FROM snapshot_uploads WHERE device_id=$1 AND upload_id=$2', [owner.id, uploadId]);
        if (existing.rows[0] && existing.rows[0].manifest_hash !== manifestHash) throw new HttpError(409, '上传键已绑定不同内容；原已提交快照保持不变');
      }
      for (const artifact of [manifest, ...(manifest.capture?.materials ?? [])]) {
        const stored = await transaction.query('SELECT byte_length FROM chunks WHERE device_id=$1 AND hash=$2', [owner.id, artifact.hash]);
        if (!stored.rows[0] || stored.rows[0].byte_length !== artifact.byteLength) throw new HttpError(409, '原件尚未持久化或长度不匹配');
        if ((await raw.read(owner.id, artifact.hash)).length !== artifact.byteLength) throw new HttpError(409, '原件长度不匹配');
      }
      const result = await transaction.query(`INSERT INTO snapshots(id,device_id,source_session_id,manifest_hash,manifest,hash)
        VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(device_id,source,source_session_id,manifest_hash)
        DO UPDATE SET manifest_hash=EXCLUDED.manifest_hash RETURNING id, committed_at`,
      [randomUUID(), owner.id, manifest.sourceSessionId, manifestHash, manifest, manifest.hash]);
      const record = result.rows[0];
      if (uploadId) await transaction.query(`INSERT INTO snapshot_uploads(device_id,upload_id,manifest_hash,snapshot_id)
        VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [owner.id, uploadId, manifestHash, record.id]);
      await transaction.query('COMMIT');
      return { snapshotId: record.id, state: 'committed', hash: manifest.hash, byteLength: manifest.byteLength,
        committedAt: record.committed_at, backup: 'single-copy', ...(uploadId ? { uploadId } : {}) };
    } catch (error) { await transaction.query('ROLLBACK'); throw error; }
    finally { transaction.release(); }
  };
}
