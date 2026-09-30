import pg from 'pg';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir,open,rename,readdir,unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { backupObjectSchema,backupReceiptSchema,type BackupReceipt } from '../../packages/contracts/server-backup.js';
import { migrateServerOperations } from './server-operations.js';
import { atomicJson,syncDirectory,directory,inside,hashFile,jsonFile,copyObject,pagePath,verifyBundle } from './backup-files.js';
const execute=promisify(execFile);
const pool=(url:string)=>new pg.Pool({connectionString:url,max:3,connectionTimeoutMillis:5000,query_timeout:60000});
function connectionEnvironment(url:string){
  const value=new URL(url);if(!['postgres:','postgresql:'].includes(value.protocol))throw new Error('unsupported-connection');
  return {...process.env,PGHOST:value.hostname,PGPORT:value.port||'5432',PGDATABASE:decodeURIComponent(value.pathname.slice(1)),
    PGUSER:decodeURIComponent(value.username),PGPASSWORD:decodeURIComponent(value.password),PGCONNECT_TIMEOUT:'5',
    PGSSLMODE:value.searchParams.get('sslmode')??'prefer'};
}
async function pgTool(name:'pg_dump'|'pg_restore',args:string[],url:string){
  return execute(name,args,{env:connectionEnvironment(url),windowsHide:true,timeout:900000,maxBuffer:1024*1024});
}
const objectRow=(row:{device_id:string;hash:string;byte_length:number})=>backupObjectSchema.parse({deviceId:row.device_id,hash:row.hash,byteLength:row.byte_length});
type BackupStages={stage?:(phase:'dump-completed'|'before-publication'|'after-publication'|'restore-dump-loaded')=>void|Promise<void>};
export async function backupArchive(url:string,options:{rawDirectory:string;backupDirectory:string;failureDomain?:BackupReceipt['failureDomain']},observer:BackupStages={}){
  const db=pool(url),id=randomUUID();let locked=false,transaction=false;
  const client=await db.connect().catch(async error=>{await db.end();throw error;});
  try{
    const raw=await directory(options.rawDirectory),destination=await directory(options.backupDirectory,true);
    if(inside(raw,destination)||inside(destination,raw))throw new Error('overlapping-backup-paths');
    await migrateServerOperations(db);
    locked=(await client.query('SELECT pg_try_advisory_lock(7402133) AS owned')).rows[0].owned;
    if(!locked)throw new Error('backup-already-running');
    await db.query("INSERT INTO server_backups(id,state) VALUES($1,'in-progress')",[id]);
    const pending=join(destination,`.pending-${id}`),final=join(destination,id);
    await mkdir(pending,{mode:0o700});await mkdir(join(pending,'objects'),{mode:0o700});await mkdir(join(pending,'pages'),{mode:0o700});
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');transaction=true;
    await client.query("SET LOCAL statement_timeout='60s'");
    const scope=(await client.query("SELECT pg_export_snapshot() AS snapshot,to_char(transaction_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS at,current_setting('server_version_num')::int AS version")).rows[0];
    if(Math.trunc(scope.version/10000)!==17)throw new Error('unsupported-postgres-major');
    await db.query('UPDATE server_backups SET snapshot_at=$2 WHERE id=$1',[id,scope.at]);
    const dumpFile=join(pending,'database.dump'),deadline=Date.now()+900000;
    // Dump and enumeration import exactly the same still-open exporter view.
    await pgTool('pg_dump',['--format=custom',`--snapshot=${scope.snapshot}`,'--lock-wait-timeout=5000',`--file=${dumpFile}`],url);
    await observer.stage?.('dump-completed');
    const dumpHandle=await open(dumpFile,'r+');try{await dumpHandle.sync();}finally{await dumpHandle.close();}
    const dump=await hashFile(dumpFile);const version=(await execute('pg_dump',['--version'],{windowsHide:true,timeout:5000,maxBuffer:8192})).stdout.trim();
    let cursorDevice:string|null=null,cursorHash:string|null=null,objects=0,bytes=0;const pages:BackupReceipt['pages']=[];
    for(;;){
      if(Date.now()>deadline)throw new Error('backup-duration-limit');
      const rows:{device_id:string;hash:string;byte_length:number}[]=(await client.query(`SELECT device_id,hash,byte_length FROM chunks WHERE $1::uuid IS NULL OR(device_id,hash)>($1::uuid,$2::text) ORDER BY device_id,hash LIMIT 1000`,[cursorDevice,cursorHash])).rows;
      if(!rows.length)break;if(pages.length===8192)throw new Error('manifest-page-limit');
      const page:ReturnType<typeof objectRow>[]=rows.map(objectRow);
      for(const item of page){await copyObject(raw,join(pending,'objects'),item);objects++;bytes+=item.byteLength;if(!Number.isSafeInteger(bytes))throw new Error('byte-count-limit');}
      const index=pages.length;await atomicJson(pagePath(pending,index),page);const hashed=await hashFile(pagePath(pending,index),512*1024);
      pages.push({index,hash:hashed.hash,count:page.length});cursorDevice=page.at(-1)!.deviceId;cursorHash=page.at(-1)!.hash;
      if(rows.length<1000)break;
    }
    const receipt=backupReceiptSchema.parse({version:1,id,snapshotAt:scope.at,completedAt:new Date().toISOString(),objects,bytes,dumpHash:dump.hash,dumpBytes:dump.bytes,
      postgresMajor:17,schema:'skynet-server-backup-1',nodeVersion:process.version,pgDumpVersion:version,failureDomain:options.failureDomain??'unknown',pages});
    await syncDirectory(join(pending,'pages'));await syncDirectory(join(pending,'objects'));
    await atomicJson(join(pending,'complete.json'),receipt);await syncDirectory(pending);
    await observer.stage?.('before-publication');
    await rename(pending,final);await syncDirectory(destination);
    await atomicJson(join(final,'published.json'),{version:1,id:receipt.id,dumpHash:receipt.dumpHash});
    await observer.stage?.('after-publication');
    await db.query("UPDATE server_backups SET state='completed',receipt=$2,finished_at=$3,error=NULL WHERE id=$1",[id,receipt,receipt.completedAt]);
    return {state:'completed',receipt};
  }catch(error){if(locked)await db.query("UPDATE server_backups SET state='failed',finished_at=now(),error='backup-failed' WHERE id=$1 AND state<>'completed'",[id]).catch(()=>undefined);throw error;}
  finally{if(transaction)await client.query('ROLLBACK').catch(()=>undefined);if(locked)await client.query('SELECT pg_advisory_unlock(7402133)').catch(()=>undefined);client.release();await db.end();}
}

export async function restoreArchive(url:string,options:{bundleDirectory:string;rawDirectory:string},observer:BackupStages={}){
  const verified=await verifyBundle(options.bundleDirectory),{receipt}=verified,db=pool(url);
  try{
    const target=await directory(options.rawDirectory,true);
    if(inside(verified.root,target)||inside(target,verified.root))throw new Error('overlapping-restore-paths');
    if((await readdir(target)).length)throw new Error('nonempty-raw-target');
    const version=(await db.query("SELECT current_setting('server_version_num')::int AS value")).rows[0].value;
    if(Math.trunc(version/10000)!==17)throw new Error('unsupported-postgres-major');
    const existing=(await db.query(`WITH user_namespaces AS(SELECT oid,nspname FROM pg_namespace
        WHERE nspname NOT IN('pg_catalog','information_schema') AND nspname NOT LIKE 'pg_toast%' AND nspname NOT LIKE 'pg_temp%')
      SELECT((SELECT count(*) FROM pg_class WHERE relnamespace IN(SELECT oid FROM user_namespaces))
        +(SELECT count(*) FROM pg_type WHERE typnamespace IN(SELECT oid FROM user_namespaces))
        +(SELECT count(*) FROM pg_proc WHERE pronamespace IN(SELECT oid FROM user_namespaces))
        +(SELECT count(*) FROM user_namespaces WHERE nspname<>'public')
        +(SELECT count(*) FROM pg_extension WHERE extname<>'plpgsql'))::int AS count`)).rows[0].count;
    if(existing!==0)throw new Error('nonempty-database-target');
    // Persist this fence before touching either restore target. Startup checks it
    // before migrations, including the dump-complete / old-lease-fence window.
    await atomicJson(join(target,'.skynet-restore-pending.json'),{version:1,backupId:receipt.id});
    for(const page of receipt.pages){const entries=(await jsonFile(pagePath(verified.root,page.index),512*1024)) as ReturnType<typeof objectRow>[];
      for(const object of entries)await copyObject(join(verified.root,'objects'),target,object);}
    await syncDirectory(target);
    await pgTool('pg_restore',['--single-transaction','--no-owner','--no-acl',`--dbname=${connectionEnvironment(url).PGDATABASE}`,join(verified.root,'database.dump')],url);
    await observer.stage?.('restore-dump-loaded');
    // Compare ALL restored chunk identities/lengths, not merely main manifest counts.
    let device:string|null=null,hash:string|null=null;
    for(const page of receipt.pages){
      const expected=(await jsonFile(pagePath(verified.root,page.index),512*1024)) as ReturnType<typeof objectRow>[];
      const rows=(await db.query(`SELECT device_id,hash,byte_length FROM chunks WHERE $1::uuid IS NULL OR(device_id,hash)>($1::uuid,$2::text) ORDER BY device_id,hash LIMIT $3`,[device,hash,expected.length])).rows.map(objectRow);
      if(JSON.stringify(rows)!==JSON.stringify(expected))throw new Error('restored-inventory-mismatch');device=expected.at(-1)!.deviceId;hash=expected.at(-1)!.hash;
    }
    const extra=(await db.query('SELECT count(*)::int AS count FROM chunks WHERE $1::uuid IS NULL OR(device_id,hash)>($1::uuid,$2::text)',[device,hash])).rows[0].count;
    if(extra!==0)throw new Error('restored-extra-objects');
    const client=await db.connect();const drill=randomUUID();
    try{
      await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(7402123)');await client.query("SELECT set_config('skynet.analysis_protocol','3',true)");
      await client.query(`UPDATE analysis_attempts SET state='lost',finished_at=now(),error='服务器恢复使旧运行声明失效；请求和未知预留保留' WHERE state='running';
        UPDATE analysis_jobs SET state=CASE WHEN attempts<max_attempts THEN 'retry-wait' ELSE 'failed' END,
          run_token=NULL,worker_id=NULL,lease_until=NULL,finished_at=now(),next_attempt_at=now()+interval '3 seconds',
          error='服务器恢复使旧声明失效；提供商用量未知，预留保留' WHERE state='running';
        UPDATE analysis_workers SET updated_at='1970-01-01T00:00:00Z';
        UPDATE device_health SET live_valid=false;
        UPDATE server_backups SET state='interrupted',finished_at=now(),error='backup-interrupted' WHERE state='in-progress'`);
      await client.query(`INSERT INTO server_backups(id,state,started_at,snapshot_at,finished_at,receipt) VALUES($1,'completed',$2,$2,$3,$4)
        ON CONFLICT(id) DO UPDATE SET state='completed',snapshot_at=EXCLUDED.snapshot_at,finished_at=EXCLUDED.finished_at,receipt=EXCLUDED.receipt,error=NULL`,[receipt.id,receipt.snapshotAt,receipt.completedAt,receipt]);
      await client.query('INSERT INTO server_restore_drills(id,backup_id,receipt) VALUES($1,$2,$3)',[drill,receipt.id,{version:1,verification:'integrity-only',dumpHash:receipt.dumpHash}]);
      await client.query('COMMIT');
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
    await atomicJson(join(target,'.skynet-restored.json'),{version:1,backupId:receipt.id,drillId:drill,verifiedAt:new Date().toISOString(),verification:'integrity-only'});
    await unlink(join(target,'.skynet-restore-pending.json'));await syncDirectory(target);
    return {state:'restored',backupId:receipt.id,drillId:drill,verification:'integrity-only'};
  }finally{await db.end();}
}

/** Offline operator reconciliation. The shared backup lock proves no current
 * writer is mistaken for an interrupted dump captured in an older SQL view. */
export async function reconcileBackups(url:string,options:{backupDirectory:string;after?:string}){
  const root=await directory(options.backupDirectory),db=pool(url);let locked=false;
  const client=await db.connect().catch(async error=>{await db.end();throw error;});
  try{
    await migrateServerOperations(db);locked=(await client.query('SELECT pg_try_advisory_lock(7402133) AS owned')).rows[0].owned;
    if(!locked)throw new Error('backup-already-running');
    const names=await readdir(root);if(names.length>100000)throw new Error('backup-directory-entry-limit');
    const candidates=names.filter(name=>z.uuid().safeParse(name).success&&(!options.after||name>options.after)).sort(),batch=candidates.slice(0,32);
    let imported=0,unchanged=0,rejected=0;
    for(const name of batch){
      try{
        const {receipt}=await verifyBundle(join(root,name));if(receipt.id!==name)throw new Error('backup-directory-identity');
        const old=(await db.query('SELECT state,receipt=$2::jsonb AS identical FROM server_backups WHERE id=$1',[receipt.id,receipt])).rows[0];
        if(old?.state==='completed'){if(!old.identical)throw new Error('conflicting-backup-receipt');unchanged++;continue;}
        const result=await db.query(`INSERT INTO server_backups(id,state,started_at,snapshot_at,finished_at,receipt) VALUES($1,'completed',$2,$2,$3,$4)
          ON CONFLICT(id) DO UPDATE SET state='completed',snapshot_at=EXCLUDED.snapshot_at,finished_at=EXCLUDED.finished_at,receipt=EXCLUDED.receipt,error=NULL
          WHERE server_backups.receipt IS NULL OR server_backups.receipt=EXCLUDED.receipt`,[receipt.id,receipt.snapshotAt,receipt.completedAt,receipt]);
        if(result.rowCount!==1)throw new Error('conflicting-backup-receipt');imported++;
      }catch{rejected++;}
    }
    await db.query("UPDATE server_backups SET state='interrupted',finished_at=now(),error='backup-interrupted' WHERE state='in-progress'");
    return {state:'reconciled',imported,unchanged,rejected,nextAfter:candidates.length>batch.length?batch.at(-1)!:null};
  }finally{if(locked)await client.query('SELECT pg_advisory_unlock(7402133)').catch(()=>undefined);client.release();await db.end();}
}
