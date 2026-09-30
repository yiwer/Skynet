import { backupCommandSchema } from '../../packages/contracts/server-backup.js';
// Private operator connection only. Never print URI, credentials, PG stderr or host paths.
const chunks:Buffer[]=[];let bytes=0;
try{
  for await(const part of process.stdin){bytes+=part.length;if(bytes>65536)throw new Error('input-overlimit');chunks.push(part);}
  const input=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));
  const command=backupCommandSchema.parse(JSON.parse(input));
  const {backupArchive,restoreArchive,reconcileBackups}=await import('./server-backup.js');
  const {verifyBundle}=await import('./backup-files.js');
  if(command.action==='verify'){const {receipt}=await verifyBundle(command.bundleDirectory);console.log(JSON.stringify({state:'verified',receipt}));}
  else{
    if(!process.env.DATABASE_URL)throw new Error('missing-private-connection');
    const result=command.action==='backup'?await backupArchive(process.env.DATABASE_URL,command):command.action==='reconcile'?await reconcileBackups(process.env.DATABASE_URL,command):await restoreArchive(process.env.DATABASE_URL,command);
    console.log(JSON.stringify(result));
  }
}catch{console.error(JSON.stringify({code:'backup-operation-failed',error:'备份或恢复未完成；原件与上次成功记录保留，请维护者检查私有操作环境。'}));process.exitCode=1;}
