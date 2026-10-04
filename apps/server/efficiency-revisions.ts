import {createHash} from 'node:crypto';
import {digest,type Database} from './database.js';
import {HttpError} from './identities.js';
import type {EfficiencySession,EfficiencySegment,SessionEfficiencyPage} from '../../packages/contracts/session-efficiency.js';

type Header=Omit<SessionEfficiencyPage,'sessions'>;
type Chunk={owner:string;ordinal:number;count:number;bytes:number;hash:string};
type Manifest={format:'efficiency-chunks-1';header:Header;chunks:Chunk[]};
const chunkLimit=64*1024;
const unavailable=()=>new HttpError(503,'会话产效版本存储不完整，请重试或联系维护人员');
const canonical=(value:unknown)=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);

/** Same semantic JSON as the original canonical replacer, without one report-sized string. */
export function efficiencyVersion(content:Record<string,unknown>){
  const hash=createHash('sha256');hash.update('{');
  for(const [index,key]of Object.keys(content).sort((a,b)=>a.localeCompare(b)).entries()){
    if(index)hash.update(',');hash.update(JSON.stringify(key)+':');
    const value=content[key];
    if(Array.isArray(value)){hash.update('[');for(const [i,item]of value.entries()){if(i)hash.update(',');hash.update(canonical(item));}hash.update(']');}
    else hash.update(canonical(value));
  }
  return hash.update('}').digest('hex');
}

export async function migrateEfficiencyRevisions(db:Database){
  await db.query(`CREATE TABLE IF NOT EXISTS efficiency_revision_manifests(version text PRIMARY KEY,request jsonb NOT NULL,manifest jsonb NOT NULL);
    CREATE TABLE IF NOT EXISTS efficiency_revision_chunks(version text NOT NULL REFERENCES efficiency_revision_manifests(version),owner text NOT NULL,ordinal integer NOT NULL,body bytea NOT NULL,PRIMARY KEY(version,owner,ordinal));`);
}

export interface EfficiencyRevision {
  header:Header;
  sessions:EfficiencySession[];
  segments:(sessionId:string,offset:number,limit:number)=>Promise<EfficiencySegment[]>;
  complete:()=>Promise<SessionEfficiencyPage>;
}

export function efficiencyRevisions(db:Database){
  function legacy(value:SessionEfficiencyPage):EfficiencyRevision{
    const {sessions,...header}=value;
    return{header,sessions,segments:async(id,offset,limit)=>sessions.find(row=>row.sessionId===id)?.timing?.segments.slice(offset,offset+limit)??[],complete:async()=>value};
  }
  async function open(version:string,request:Record<string,unknown>):Promise<EfficiencyRevision|null>{
    const old=(await db.query('SELECT request,payload FROM session_efficiency_revisions WHERE version=$1',[version])).rows[0];
    if(old){validateSelection(old.request,request);return legacy(old.payload);}
    const row=(await db.query('SELECT request,manifest FROM efficiency_revision_manifests WHERE version=$1',[version])).rows[0];
    if(!row)return null;validateSelection(row.request,request);
    const manifest:Manifest=row.manifest;if(manifest.format!=='efficiency-chunks-1'||manifest.header.version!==version)throw unavailable();
    async function collection<T>(owner:string,offset=0,limit=Infinity):Promise<T[]>{
      let seen=0;const selected=manifest.chunks.filter(chunk=>{if(chunk.owner!==owner)return false;const start=seen;seen+=chunk.count;return start<offset+limit&&seen>offset;});
      if(!selected.length)return[];
      const rows=(await db.query('SELECT ordinal,body FROM efficiency_revision_chunks WHERE version=$1 AND owner=$2 AND ordinal=ANY($3::int[]) ORDER BY ordinal',[version,owner,selected.map(chunk=>chunk.ordinal)])).rows;
      if(rows.length!==selected.length)throw unavailable();
      const values:T[]=[];
      for(const [index,chunk]of selected.entries()){
        const row=rows[index]!;if(row.ordinal!==chunk.ordinal||row.body.length!==chunk.bytes||digest(row.body)!==chunk.hash)throw unavailable();
        let items:T[];try{items=JSON.parse(row.body.toString('utf8'));}catch{throw unavailable();}
        if(!Array.isArray(items)||items.length!==chunk.count)throw unavailable();values.push(...items);
      }
      const first=manifest.chunks.filter(chunk=>chunk.owner===owner&&chunk.ordinal<selected[0]!.ordinal).reduce((n,chunk)=>n+chunk.count,0);
      return values.slice(offset-first,offset-first+limit);
    }
    const sessions=await collection<EfficiencySession>('sessions');if(sessions.length!==manifest.header.total)throw unavailable();
    const segments=(id:string,offset:number,limit:number)=>collection<EfficiencySegment>('segments:'+id,offset,limit);
    return{header:manifest.header,sessions,segments,complete:async()=>({...manifest.header,sessions:await Promise.all(sessions.map(async row=>row.timing?{...row,timing:{...row.timing,segments:await segments(row.sessionId,0,Infinity)}}:row))})};
  }
  async function save(value:SessionEfficiencyPage,request:Record<string,unknown>){
    const {sessions,...header}=value;const chunks:Chunk[]=[],bodies:Buffer[]=[];
    function pack(owner:string,items:unknown[]){
      let packed:string[]=[],bytes=2,ordinal=0;
      function flush(){if(!packed.length)return;const body=Buffer.from('['+packed.join(',')+']');chunks.push({owner,ordinal:ordinal++,count:packed.length,bytes:body.length,hash:digest(body)});bodies.push(body);packed=[];bytes=2;}
      for(const item of items){const encoded=JSON.stringify(item),size=Buffer.byteLength(encoded);if(size+2>chunkLimit)throw new HttpError(413,'会话产效单项存储超过范围上限：'+owner);
        if(bytes+size+(packed.length?1:0)>chunkLimit)flush();bytes+=size+(packed.length?1:0);packed.push(encoded);}flush();
    }
    pack('sessions',sessions.map(row=>row.timing?{...row,timing:{...row.timing,segments:[]}}:row));
    for(const row of sessions)if(row.timing)pack('segments:'+row.sessionId,row.timing.segments);
    const manifest:Manifest={format:'efficiency-chunks-1',header,chunks};
    const client=await db.connect();try{
      await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,4181))',[value.version]);
      const exists=await client.query('SELECT version FROM efficiency_revision_manifests WHERE version=$1 UNION ALL SELECT version FROM session_efficiency_revisions WHERE version=$1',[value.version]);
      if(!exists.rowCount){
        await client.query('INSERT INTO efficiency_revision_manifests(version,request,manifest) VALUES($1,$2,$3)',[value.version,request,manifest]);
        for(let start=0;start<chunks.length;start+=50){const batch=chunks.slice(start,start+50);
          await client.query('INSERT INTO efficiency_revision_chunks(version,owner,ordinal,body) SELECT $1,owner,ordinal,body FROM unnest($2::text[],$3::int[],$4::bytea[]) AS c(owner,ordinal,body)',[value.version,batch.map(chunk=>chunk.owner),batch.map(chunk=>chunk.ordinal),bodies.slice(start,start+50)]);}
      }
      await client.query('COMMIT');
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
    return (await open(value.version,request))!;
  }
  return{open,save};
}
function validateSelection(actual:Record<string,unknown>,requested:Record<string,unknown>){
  if(Object.keys(actual).length!==Object.keys(requested).length||Object.entries(requested).some(([key,value])=>actual[key]!==value))throw new HttpError(409,'会话产效版本与筛选不一致');
}
