import { deliveryReceiptSchema, type DeliveryObservation } from '../../packages/contracts/delivery.js';
import { digest, type Database } from './database.js';
import { HttpError } from './identities.js';

export async function migrateDeliveryReceipts(db: Database) {
  await db.query(`CREATE TABLE IF NOT EXISTS delivery_receipts (
    device_id uuid NOT NULL, upload_id uuid NOT NULL, snapshot_id uuid NOT NULL REFERENCES snapshots(id),
    receipt jsonb NOT NULL, receipt_hash text NOT NULL, received_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(device_id,upload_id),
    FOREIGN KEY(device_id,upload_id) REFERENCES snapshot_uploads(device_id,upload_id));
    CREATE INDEX IF NOT EXISTS delivery_receipts_snapshot ON delivery_receipts(snapshot_id);`);
}

export async function saveDeliveryReceipt(db: Database, deviceId: string, input: unknown) {
  const receipt = deliveryReceiptSchema.parse(input);
  const binding = (await db.query('SELECT snapshot_id FROM snapshot_uploads WHERE device_id=$1 AND upload_id=$2', [deviceId, receipt.uploadId])).rows[0];
  if (!binding || binding.snapshot_id !== receipt.snapshotId) throw new HttpError(409, '投递记录不属于此设备已确认的上传');
  const hash = digest(JSON.stringify(receipt));
  await db.query(`INSERT INTO delivery_receipts(device_id,upload_id,snapshot_id,receipt,receipt_hash)
    VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [deviceId, receipt.uploadId, receipt.snapshotId, receipt, hash]);
  const saved = (await db.query('SELECT receipt_hash,received_at FROM delivery_receipts WHERE device_id=$1 AND upload_id=$2', [deviceId, receipt.uploadId])).rows[0]!;
  if (saved.receipt_hash !== hash) throw new HttpError(409, '此上传的投递记录已保存，不能改写');
  return { uploadId: receipt.uploadId, snapshotId: receipt.snapshotId, state: 'recorded', receivedAt: saved.received_at.toISOString() };
}

export async function readDeliveryObservation(db: Database, snapshotId: string): Promise<DeliveryObservation> {
  const row = (await db.query(`SELECT count(*)::int AS count,
    COALESCE(sum((receipt->>'disconnectedAttempts')::bigint),0)::text AS attempts,
    min(receipt->>'firstDisconnectedAt') AS first, max(receipt->>'lastDisconnectedAt') AS last,
    min(receipt->>'capturedAt') AS captured, max(receipt->>'acknowledgedAt') AS acknowledged,
    max(received_at) AS received FROM delivery_receipts WHERE snapshot_id=$1`, [snapshotId])).rows[0]!;
  const observation = { receiptCount: row.count, disconnectedAttempts: Number(row.attempts),
    firstDisconnectedAt: row.first, lastDisconnectedAt: row.last, capturedAt: row.captured,
    acknowledgedAt: row.acknowledged, receivedAt: row.received?.toISOString() ?? null };
  return { ...observation, revision: digest(JSON.stringify(observation)) };
}
