import { statfs } from 'node:fs/promises';
import type { Database } from './database.js';
import type { ServerOperations } from '../../packages/contracts/server-operations.js';
import { backupReceiptSchema } from '../../packages/contracts/server-backup.js';

export async function migrateServerOperations(db: Database) {
  const client=await db.connect();
  try {
    await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(7402132)');
    await client.query(`CREATE TABLE IF NOT EXISTS server_backups(id uuid PRIMARY KEY,state text NOT NULL,
      started_at timestamptz NOT NULL DEFAULT now(),snapshot_at timestamptz,finished_at timestamptz,receipt jsonb,error text);
      CREATE TABLE IF NOT EXISTS server_restore_drills(id uuid PRIMARY KEY,backup_id uuid NOT NULL,
      verified_at timestamptz NOT NULL DEFAULT now(),receipt jsonb NOT NULL);`);
    await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
const safeNumber=(value:unknown)=>{
  if(value===null||value===undefined)return null;
  const number=Number(value);return Number.isSafeInteger(number)&&number>=0?number:null;
};
export function serverOperations(db:Database,rawDirectory:string){
  return {read:async():Promise<ServerOperations>=>{
    const inventory=(await db.query(`WITH referenced AS(SELECT device_id,hash FROM snapshots UNION
      SELECT s.device_id,m->>'hash' FROM snapshots s CROSS JOIN LATERAL
      jsonb_array_elements(COALESCE(s.manifest->'capture'->'materials','[]'::jsonb)) m)
      SELECT count(*) AS objects,COALESCE(sum(c.byte_length),0) AS bytes,count(*) FILTER(WHERE r.hash IS NULL) AS staged
      FROM chunks c LEFT JOIN referenced r ON r.device_id=c.device_id AND r.hash=c.hash`)).rows[0];
    let filesystemBytes:number|null=null,freeBytes:number|null=null,capacityError:string|null=null;
    try{const info=await statfs(rawDirectory,{bigint:true});filesystemBytes=safeNumber(info.blocks*info.bsize);freeBytes=safeNumber(info.bavail*info.bsize);
      if(filesystemBytes===null||freeBytes===null)capacityError='容量超过精确数值范围，保持未知';
    }catch{capacityError='原件文件系统容量暂不可读，保持未知';}
    const latest=(await db.query("SELECT id,receipt FROM server_backups WHERE state='completed' ORDER BY finished_at DESC,id DESC LIMIT 1")).rows[0];
    const receipt=latest?backupReceiptSchema.safeParse(latest.receipt):undefined;
    const attempt=(await db.query(`SELECT id,state,started_at AS "startedAt",finished_at AS "finishedAt",error FROM server_backups ORDER BY started_at DESC,id DESC LIMIT 1`)).rows[0];
    const restore=(await db.query('SELECT id,backup_id AS "backupId",verified_at AS "verifiedAt" FROM server_restore_drills ORDER BY verified_at DESC,id DESC LIMIT 1')).rows[0];
    return {observedAt:new Date().toISOString(),storage:{committedObjects:safeNumber(inventory.objects),committedBytes:safeNumber(inventory.bytes),stagedObjects:safeNumber(inventory.staged),filesystemBytes,freeBytes,capacityError,automaticDeletion:false},
      latestBackup:latest&&receipt?.success&&receipt.data.id===latest.id?{id:latest.id,snapshotAt:receipt.data.snapshotAt,completedAt:receipt.data.completedAt,objects:receipt.data.objects,bytes:receipt.data.bytes,dumpHash:receipt.data.dumpHash,failureDomain:receipt.data.failureDomain,verification:'bundle-integrity',scope:'database-and-all-committed-chunks'}:null,
      latestRestore:restore?{id:restore.id,backupId:restore.backupId,verifiedAt:restore.verifiedAt.toISOString(),scope:'database-and-all-committed-chunks',verification:'integrity-only'}:null,
      latestAttempt:attempt?{id:attempt.id,state:['in-progress','completed','failed','interrupted'].includes(attempt.state)?attempt.state:'unknown',
        startedAt:attempt.startedAt.toISOString(),finishedAt:attempt.finishedAt?.toISOString()??null,
        error:attempt.error?({'backup-failed':'备份未完成；上次成功记录保留','backup-interrupted':'旧备份过程已中断；不代表当前正在运行'}[attempt.error as string]??'备份状态需维护者核查；详细原因仅见私有日志'):null}:null,reception:'single-copy'};
  }};
}
export type ServerOperationsService=ReturnType<typeof serverOperations>;
