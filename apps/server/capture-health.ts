import type { Database } from './database.js';
import type { CaptureHealth } from '../../packages/contracts/capture-health.js';

export async function saveCaptureHealth(db: Database, deviceId: string, source: string, report: CaptureHealth) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { faults, ...summary } = report;
    await client.query(`INSERT INTO device_capture_health(device_id,source,report) VALUES($1,$2,$3)
      ON CONFLICT(device_id,source) DO UPDATE SET report=EXCLUDED.report,received_at=now()`, [deviceId, source, summary]);
    for (const fault of faults) await client.query(`INSERT INTO capture_faults(device_id,source,id,session_id,report) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(device_id,source,id) DO UPDATE SET report=EXCLUDED.report,received_at=now()`, [deviceId, source, fault.id, fault.sessionId ?? null, fault]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

export async function readCaptureHealth(db: Database, deviceId: string, source: string, sessionId?: string, offset = 0) {
  const reports = await db.query(`SELECT report,received_at AS "receivedAt" FROM device_capture_health WHERE device_id=$1 AND source=$2`, [deviceId, source]);
  const faults = await db.query(`SELECT report,received_at AS "receivedAt",count(*) OVER() AS total FROM capture_faults
    WHERE device_id=$1 AND source=$2 AND ($3::text IS NULL OR session_id IS NULL OR session_id=$3)
    ORDER BY report->>'firstObservedAt' DESC,id DESC LIMIT 6 OFFSET $4`, [deviceId, source, sessionId ?? null, offset]);
  return { source, ...reports.rows[0], faults: faults.rows.slice(0, 5).map(({ report, receivedAt }) => ({ ...report, receivedAt })),
    total: Number(faults.rows[0]?.total ?? 0), nextOffset: faults.rows.length > 5 ? offset + 5 : null,
    notice: '这是设备后续报告的采集覆盖，不修改已提交原件。故障恢复不证明故障期间材料完整；没有报告也不等于没有活动。' };
}
