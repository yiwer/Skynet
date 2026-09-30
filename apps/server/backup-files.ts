import { createReadStream } from 'node:fs';
import { mkdir,open,lstat,readFile,realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join,resolve,relative,isAbsolute,dirname } from 'node:path';
import { z } from 'zod';
import { atomicJson,syncDirectory } from '../../packages/filesystem.js';
import { backupObjectSchema,backupReceiptSchema,type BackupReceipt } from '../../packages/contracts/server-backup.js';

export function inside(root:string,path:string){const part=relative(resolve(root),resolve(path));return part===''||(!part.startsWith('..')&&!isAbsolute(part));}
export async function directory(path:string,create=false){if(create)await mkdir(path,{recursive:true,mode:0o700});const info=await lstat(path);if(!info.isDirectory()||info.isSymbolicLink())throw new Error('unsafe-directory');return realpath(path);}
export async function hashFile(path:string,maxBytes=Number.MAX_SAFE_INTEGER){
  const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>maxBytes)throw new Error('unsafe-or-overlimit-file');
  const hash=createHash('sha256');let bytes=0;for await(const part of createReadStream(path)){bytes+=part.length;if(bytes>maxBytes)throw new Error('overlimit-file');hash.update(part);}
  return {hash:hash.digest('hex'),bytes};
}
export async function jsonFile(path:string,maxBytes:number){const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>maxBytes)throw new Error('unsafe-json-file');return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readFile(path)));}
export async function assertRestoreReady(rawDirectory:string){
  try{await lstat(join(rawDirectory,'.skynet-restore-pending.json'));}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}
  throw new Error('服务器恢复尚未完成；请维护者检查私有恢复目标，服务未启动');
}
export async function copyObject(root:string,destination:string,object:z.infer<typeof backupObjectSchema>){
  backupObjectSchema.parse(object);
  const source=join(root,object.deviceId,object.hash);const parent=await directory(dirname(source));if(!inside(root,parent))throw new Error('escaped-object-directory');
  const verified=await hashFile(source,64*1024*1024);if(verified.hash!==object.hash||verified.bytes!==object.byteLength)throw new Error('object-integrity');
  const targetDirectory=await directory(join(destination,object.deviceId),true),target=join(targetDirectory,object.hash);
  if(!inside(destination,targetDirectory))throw new Error('escaped-target-directory');
  const handle=await open(target,'wx',0o600);const hash=createHash('sha256');let bytes=0;
  try{for await(const part of createReadStream(source)){bytes+=part.length;if(bytes>object.byteLength)throw new Error('object-grew');hash.update(part);await handle.writeFile(part);}await handle.sync();}
  finally{await handle.close();}
  if(bytes!==object.byteLength||hash.digest('hex')!==object.hash)throw new Error('object-changed');
  await syncDirectory(targetDirectory);await syncDirectory(destination);
}
export const pagePath=(root:string,index:number)=>join(root,'pages',String(index).padStart(8,'0')+'.json');
export async function verifyBundle(input:string):Promise<{root:string;receipt:BackupReceipt}> {
  const root=await directory(input);const receipt=backupReceiptSchema.parse(await jsonFile(join(root,'complete.json'),1024*1024));
  if(root.endsWith(`.pending-${receipt.id}`))throw new Error('bundle-not-published');
  // A bind mount can hide the host's pending basename. Create this marker only
  // after rename and parent fsync, so completion survives that aliasing.
  const published=z.object({version:z.literal(1),id:z.uuid(),dumpHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(await jsonFile(join(root,'published.json'),1024));
  if(published.id!==receipt.id||published.dumpHash!==receipt.dumpHash)throw new Error('publication-marker-mismatch');
  const dump=await hashFile(join(root,'database.dump'));if(dump.hash!==receipt.dumpHash||dump.bytes!==receipt.dumpBytes)throw new Error('dump-integrity');
  let objects=0,bytes=0,previous='';
  const objectRoot=await directory(join(root,'objects'));
  const pagesRoot=await directory(join(root,'pages'));if(!inside(root,pagesRoot))throw new Error('pages-directory-escape');
  for(const [index,page]of receipt.pages.entries()){
    if(page.index!==index)throw new Error('page-sequence');const file=pagePath(root,index),hash=await hashFile(file,512*1024);if(hash.hash!==page.hash)throw new Error('page-integrity');
    const entries=z.array(backupObjectSchema).min(1).max(1000).parse(await jsonFile(file,512*1024));if(entries.length!==page.count)throw new Error('page-count');
    for(const object of entries){const key=`${object.deviceId}/${object.hash}`;if(key<=previous)throw new Error('object-sequence');previous=key;
      const parent=await directory(join(objectRoot,object.deviceId));if(!inside(objectRoot,parent))throw new Error('object-directory-escape');
      const raw=await hashFile(join(parent,object.hash),64*1024*1024);if(raw.hash!==object.hash||raw.bytes!==object.byteLength)throw new Error('object-integrity');objects++;bytes+=raw.bytes;
    }
  }
  if(objects!==receipt.objects||bytes!==receipt.bytes)throw new Error('bundle-count');
  return {root,receipt};
}
export {atomicJson,syncDirectory};
