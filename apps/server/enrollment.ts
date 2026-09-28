import { randomUUID, timingSafeEqual } from 'node:crypto';
import { digest, newCredential, type Database } from './database.js';
import { credential, HttpError } from './identities.js';
import { enrollmentSchema } from '../../packages/contracts/archive.js';

export async function enrollDevice(db: Database, authorization: string | undefined, body: unknown) {
  const input = enrollmentSchema.parse(body);
  const transaction = await db.connect();
  try {
    await transaction.query('BEGIN');
    const employee = await transaction.query('SELECT id FROM employees WHERE enrollment_hash=$1 AND active FOR SHARE', [digest(credential(authorization))]);
    if (!employee.rows[0]) throw new HttpError(401, '接入授权值无效或已停用');
    const employeeId = employee.rows[0].id;
    const token = input.deviceCredential ?? newCredential();
    const created = await transaction.query(`INSERT INTO devices(id,employee_id,installation_id,name,credential_hash)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(employee_id,installation_id) DO NOTHING RETURNING id,enrolled_at`,
    [randomUUID(), employeeId, input.installationId, input.name, digest(token)]);
    let record = created.rows[0];
    if (!record) {
      const existing = (await transaction.query('SELECT id,enrolled_at,active,credential_hash FROM devices WHERE employee_id=$1 AND installation_id=$2 FOR SHARE', [employeeId, input.installationId])).rows[0];
      if (!existing?.active) throw new HttpError(403, '该设备已停用；重复接入不能恢复它');
      if (!input.deviceCredential || !timingSafeEqual(Buffer.from(existing.credential_hash), Buffer.from(digest(token)))) {
        throw new HttpError(409, '该安装已绑定；需要原设备凭据才能恢复确认');
      }
      record = existing;
    }
    await transaction.query('COMMIT');
    return { deviceId: record.id, deviceCredential: token, employeeId, enrolledAt: record.enrolled_at?.toISOString() };
  } catch (error) { await transaction.query('ROLLBACK'); throw error; }
  finally { transaction.release(); }
}
