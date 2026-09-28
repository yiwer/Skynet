import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { digest, type Database } from './database.js';

export class HttpError extends Error { constructor(public statusCode: number, message: string) { super(message); } }
export const credential = (authorization?: string) => {
  if (!authorization?.startsWith('Bearer ') || authorization.length > 256) throw new HttpError(401, '请提供有效凭据');
  return authorization.slice(7);
};
export type ReaderIdentity = { id: string; name: string; canManageIdentities: boolean };

// Credentials authorize requests, not a cached login session. Archive visibility stays shared.
export function identities(db: Database) {
  async function reader(authorization?: string, client: Database | PoolClient = db, lock = false): Promise<ReaderIdentity> {
    const result = await client.query(`SELECT id,name,can_manage_identities AS "canManageIdentities" FROM employees
      WHERE reader_hash=$1 AND active${lock ? ' FOR SHARE' : ''}`, [digest(credential(authorization))]);
    if (!result.rows[0]) throw new HttpError(401, '读取凭据无效或已停用');
    return result.rows[0];
  }
  async function device(authorization?: string): Promise<{ id: string; employee_id: string }> {
    const result = await db.query(`SELECT d.id,d.employee_id FROM devices d JOIN employees e ON e.id=d.employee_id
      WHERE d.credential_hash=$1 AND d.active AND e.active`, [digest(credential(authorization))]);
    if (!result.rows[0]) throw new HttpError(401, '设备凭据无效或已停用');
    return result.rows[0];
  }
  async function manager(authorization?: string, client: Database | PoolClient = db, lock = false) {
    const identity = await reader(authorization, client, lock);
    if (!identity.canManageIdentities) throw new HttpError(403, '此读取身份没有账号与设备维护权限');
    return identity;
  }
  async function list(authorization: string | undefined, offset: number) {
    await manager(authorization);
    const result = await db.query(`SELECT id,name,active,can_manage_identities AS "canManageIdentities"
      FROM employees ORDER BY name,id LIMIT 51 OFFSET $1`, [offset]);
    const employees = result.rows.slice(0, 50);
    const devices = await db.query(`SELECT id,name,employee_id AS "employeeId",active FROM devices
      WHERE employee_id=ANY($1::uuid[]) ORDER BY name,id`, [employees.map(item => item.id)]);
    return { employees: employees.map(employee => ({ ...employee,
      devices: devices.rows.filter(item => item.employeeId === employee.id).map(device => ({ ...device, effectiveActive: employee.active && device.active })) })),
      nextOffset: result.rows.length > 50 ? offset + 50 : null };
  }
  async function audit(authorization: string | undefined, offset: number) {
    await manager(authorization);
    const result = await db.query(`SELECT a.id,a.action,a.occurred_at AS "occurredAt",a.actor_id AS "actorId",actor.name AS "actorName",
      a.employee_id AS "employeeId",employee.name AS "employeeName",a.device_id AS "deviceId",device.name AS "deviceName"
      FROM identity_audit a JOIN employees actor ON actor.id=a.actor_id JOIN employees employee ON employee.id=a.employee_id
      LEFT JOIN devices device ON device.id=a.device_id ORDER BY a.occurred_at DESC,a.id DESC LIMIT 51 OFFSET $1`, [offset]);
    return { events: result.rows.slice(0, 50), nextOffset: result.rows.length > 50 ? offset + 50 : null };
  }
  async function disable(authorization: string | undefined, kind: 'employee' | 'device', id: string) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const actor = await manager(authorization, client, true);
      const result = kind === 'employee'
        ? await client.query('SELECT id,active,id AS employee_id FROM employees WHERE id=$1 FOR UPDATE', [id])
        : await client.query('SELECT id,active,employee_id FROM devices WHERE id=$1 FOR UPDATE', [id]);
      const target = result.rows[0];
      if (!target) throw new HttpError(404, '未找到账号或设备');
      if (target.active) {
        if (kind === 'employee') await client.query('UPDATE employees SET active=false WHERE id=$1', [id]);
        else await client.query('UPDATE devices SET active=false WHERE id=$1', [id]);
        await client.query('INSERT INTO identity_audit(id,actor_id,employee_id,device_id,action) VALUES($1,$2,$3,$4,$5)',
          [randomUUID(), actor.id, target.employee_id, kind === 'device' ? id : null, `disable-${kind}`]);
      }
      await client.query('COMMIT');
      return { id, kind, active: false, changed: target.active };
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  return { reader, device, manager, list, audit, disable };
}
