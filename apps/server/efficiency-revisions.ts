import {createHash} from 'node:crypto';
import {digest,type Database} from './database.js';
import {HttpError} from './identities.js';
import {prepareReportDownload,type ReportReader} from './report-download.js';
import type {EfficiencySession,EfficiencySegment,EfficiencyDistribution,SessionEfficiencyPage} from '../../packages/contracts/session-efficiency.js';

type Header=Omit<SessionEfficiencyPage,'sessions'>;
type Chunk={owner:string;ordinal:number;count:number;bytes:number;hash:string};
type Manifest={format:'efficiency-chunks-1';header:Header;chunks:Chunk[]}|{format:'efficiency-chunks-2';header:Header};

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
    CREATE TABLE IF NOT EXISTS efficiency_revision_chunks(version text NOT NULL REFERENCES efficiency_revision_manifests(version),owner text NOT NULL,ordinal integer NOT NULL,body bytea NOT NULL,PRIMARY KEY(version,owner,ordinal));
    ALTER TABLE efficiency_revision_chunks ADD COLUMN IF NOT EXISTS item_count integer;
    ALTER TABLE efficiency_revision_chunks ADD COLUMN IF NOT EXISTS byte_length integer;
    ALTER TABLE efficiency_revision_chunks ADD COLUMN IF NOT EXISTS sha256 text;`);
}

export interface EfficiencyRevision {
  header:Header;
  sessions:EfficiencySession[];
  segments:(sessionId:string,offset:number,limit:number)=>Promise<EfficiencySegment[]>;
  complete:()=>Promise<SessionEfficiencyPage>;
  json:()=>AsyncGenerator<Buffer>;
}

function* jsonParts(value:unknown):Generator<string>{
  if(Array.isArray(value)){yield '[';for(const [index,item]of value.entries()){if(index)yield ',';yield* jsonParts(item);}yield ']';}
  else if(value&&typeof value==='object'){yield '{';const entries=Object.entries(value).filter(([,item])=>item!==undefined).sort(([a],[b])=>a.localeCompare(b));
    for(const [index,[key,item]]of entries.entries()){if(index)yield ',';yield JSON.stringify(key)+':';yield* jsonParts(item);}yield '}';}
  else yield JSON.stringify(value)??'null';
}
async function* encoded(parts:AsyncIterable<string>|Iterable<string>):AsyncGenerator<Buffer>{
  let chunks:Buffer[]=[],length=0;
  for await(const part of parts){const bytes=Buffer.from(part);if(length+bytes.length>chunkLimit&&length){yield Buffer.concat(chunks,length);chunks=[];length=0;}
    for(let at=0;at<bytes.length;at+=chunkLimit){const piece=bytes.subarray(at,at+chunkLimit);chunks.push(piece);length+=piece.length;if(length>=chunkLimit){yield Buffer.concat(chunks,length);chunks=[];length=0;}}}
  if(length)yield Buffer.concat(chunks,length);
}

export function efficiencyRevisions(db:Database){
  function legacy(value:SessionEfficiencyPage):EfficiencyRevision{
    const {sessions,...header}=value;
    return{header,sessions,segments:async(id,offset,limit)=>sessions.find(row=>row.sessionId===id)?.timing?.segments.slice(offset,offset+limit)??[],complete:async()=>value,json:()=>encoded(jsonParts(value))};
  }
  async function open(version:string,request:Record<string,unknown>,reader:ReportReader=db):Promise<EfficiencyRevision|null>{
    const old=(await reader.query('SELECT request,payload FROM session_efficiency_revisions WHERE version=$1',[version])).rows[0];
    if(old){validateSelection(old.request,request);return legacy(old.payload);}
    const row=(await reader.query('SELECT request,manifest FROM efficiency_revision_manifests WHERE version=$1',[version])).rows[0];
    if(!row)return null;validateSelection(row.request,request);
    const manifest:Manifest=row.manifest;if(!['efficiency-chunks-1','efficiency-chunks-2'].includes(manifest.format)||manifest.header.version!==version)throw unavailable();
    const chunks:Chunk[]=manifest.format==='efficiency-chunks-1'?manifest.chunks:(await reader.query(
      'SELECT owner,ordinal,item_count AS count,byte_length AS bytes,sha256 AS hash FROM efficiency_revision_chunks WHERE version=$1 ORDER BY owner,ordinal',[version])).rows;
    for(const chunk of chunks)if(!Number.isInteger(chunk.count)||chunk.count<1||!Number.isInteger(chunk.bytes)||chunk.bytes<2||chunk.bytes>chunkLimit||!/^\w{64}$/.test(chunk.hash))throw unavailable();
    const byOwner=new Map<string,Chunk[]>();for(const chunk of chunks){const list=byOwner.get(chunk.owner)??[];
      if(chunk.ordinal!==list.length)throw unavailable();list.push(chunk);byOwner.set(chunk.owner,list);}
    async function collection<T>(owner:string,offset=0,limit=Infinity):Promise<T[]>{
      let seen=0;const selected=(byOwner.get(owner)??[]).filter(chunk=>{const start=seen;seen+=chunk.count;return start<offset+limit&&seen>offset;});
      if(!selected.length)return[];
      const rows=(await reader.query('SELECT ordinal,body FROM efficiency_revision_chunks WHERE version=$1 AND owner=$2 AND ordinal=ANY($3::int[]) ORDER BY ordinal',[version,owner,selected.map(chunk=>chunk.ordinal)])).rows;
      if(rows.length!==selected.length)throw unavailable();
      const values:T[]=[];
      for(const [index,chunk]of selected.entries()){
        const row=rows[index]!;if(row.ordinal!==chunk.ordinal||row.body.length!==chunk.bytes||digest(row.body)!==chunk.hash)throw unavailable();
        let items:T[];try{items=JSON.parse(row.body.toString('utf8'));}catch{throw unavailable();}
        if(!Array.isArray(items)||items.length!==chunk.count)throw unavailable();values.push(...items);
      }
      const first=(byOwner.get(owner)??[]).filter(chunk=>chunk.ordinal<selected[0]!.ordinal).reduce((n,chunk)=>n+chunk.count,0);
      return values.slice(offset-first,offset-first+limit);
    }
    const sessions=await collection<EfficiencySession>('sessions');if(sessions.length!==manifest.header.total)throw unavailable();
    for(const session of sessions)if(session.timing&&(byOwner.get('segments:'+session.sessionId)??[]).reduce((n,chunk)=>n+chunk.count,0)!==session.timing.segmentTotal)throw unavailable();
    const header={...manifest.header};
    if(manifest.format==='efficiency-chunks-2'){
      const points=await collection<{taskType:EfficiencyDistribution['taskType'];point:EfficiencyDistribution['points'][number]}>('distributionPoints');
      header.distributions=header.distributions.map(row=>({...row,points:points.filter(item=>item.taskType===row.taskType).map(item=>item.point)}));
      if(header.distributions.some(row=>row.points.reduce((n,point)=>n+point.count,0)!==row.count))throw unavailable();
    }
    const segments=(id:string,offset:number,limit:number)=>collection<EfficiencySegment>('segments:'+id,offset,limit);
    async function* parts():AsyncGenerator<string>{
      yield '{';for(const [index,key]of [...Object.keys(header),'sessions'].sort((a,b)=>a.localeCompare(b)).entries()){
        if(index)yield ',';yield JSON.stringify(key)+':';
        if(key!=='sessions'){yield* jsonParts(header[key as keyof Header]);continue;}
        yield '[';for(const [number,session]of sessions.entries()){
          if(number)yield ',';yield '{';for(const [fieldIndex,field]of Object.keys(session).sort((a,b)=>a.localeCompare(b)).entries()){
            if(fieldIndex)yield ',';yield JSON.stringify(field)+':';
            if(field!=='timing'||!session.timing){yield* jsonParts(session[field as keyof EfficiencySession]);continue;}
            yield '{';for(const [timingIndex,timingKey]of Object.keys(session.timing).sort((a,b)=>a.localeCompare(b)).entries()){
              if(timingIndex)yield ',';yield JSON.stringify(timingKey)+':';
              if(timingKey!=='segments'){yield* jsonParts(session.timing[timingKey as keyof typeof session.timing]);continue;}
              yield '[';let offset=0;
              for(const chunk of byOwner.get('segments:'+session.sessionId)??[]){
                const items=await segments(session.sessionId,offset,chunk.count);for(const item of items){if(offset++)yield ',';yield* jsonParts(item);}}
              yield ']';
            }yield '}';
          }yield '}';
        }yield ']';
      }yield '}';
    }
    return{header,sessions,segments,json:()=>encoded(parts()),complete:async()=>({...header,sessions:await Promise.all(sessions.map(async row=>row.timing?{...row,timing:{...row.timing,segments:await segments(row.sessionId,0,Infinity)}}:row))})};
  }
  async function save(value:SessionEfficiencyPage,request:Record<string,unknown>){
    const {sessions,...header}=value;const chunks:Chunk[]=[],bodies:Buffer[]=[];
    function pack(owner:string,items:unknown[]){
      let packed:string[]=[],bytes=2,ordinal=0;
      function flush(){if(!packed.length)return;const body=Buffer.from('['+packed.join(',')+']');chunks.push({owner,ordinal:ordinal++,count:packed.length,bytes:body.length,hash:digest(body)});bodies.push(body);packed=[];bytes=2;}
      for(const [index,item]of items.entries()){const encoded=JSON.stringify(item),size=Buffer.byteLength(encoded);if(size+2>chunkLimit)throw new HttpError(413,'会话产效单项存储超过范围上限：'+value.version+'/'+owner+'/'+index);
        if(bytes+size+(packed.length?1:0)>chunkLimit)flush();bytes+=size+(packed.length?1:0);packed.push(encoded);}flush();
    }
    pack('sessions',sessions.map(row=>row.timing?{...row,timing:{...row.timing,segments:[]}}:row));
    for(const row of sessions)if(row.timing)pack('segments:'+row.sessionId,row.timing.segments);
    pack('distributionPoints',header.distributions.flatMap(row=>row.points.map(point=>({taskType:row.taskType,point}))));
    const manifest:Manifest={format:'efficiency-chunks-2',header:{...header,distributions:header.distributions.map(row=>({...row,points:[]}))}};
    const client=await db.connect();try{
      await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,4181))',[value.version]);
      const exists=await client.query('SELECT version FROM efficiency_revision_manifests WHERE version=$1 UNION ALL SELECT version FROM session_efficiency_revisions WHERE version=$1',[value.version]);
      if(!exists.rowCount){
        await client.query('INSERT INTO efficiency_revision_manifests(version,request,manifest) VALUES($1,$2,$3)',[value.version,request,manifest]);
        for(let start=0;start<chunks.length;start+=50){const batch=chunks.slice(start,start+50);
          await client.query('INSERT INTO efficiency_revision_chunks(version,owner,ordinal,body,item_count,byte_length,sha256) SELECT $1,owner,ordinal,body,count,bytes,hash FROM unnest($2::text[],$3::int[],$4::bytea[],$5::int[],$6::int[],$7::text[]) AS c(owner,ordinal,body,count,bytes,hash)',[value.version,batch.map(chunk=>chunk.owner),batch.map(chunk=>chunk.ordinal),bodies.slice(start,start+50),batch.map(chunk=>chunk.count),batch.map(chunk=>chunk.bytes),batch.map(chunk=>chunk.hash)]);}
      }
      await client.query('COMMIT');
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
    return (await open(value.version,request))!;
  }
  const download=(version:string,request:Record<string,unknown>)=>prepareReportDownload(db,async reader=>{
    const revision=await open(version,request,reader);if(!revision)throw new HttpError(404,'会话产效版本不存在');
    return{version,json:revision.json};
  });
  return{open,save,download};
}
function validateSelection(actual:Record<string,unknown>,requested:Record<string,unknown>){
  if(Object.keys(actual).length!==Object.keys(requested).length||Object.entries(requested).some(([key,value])=>actual[key]!==value))throw new HttpError(409,'会话产效版本与筛选不一致');
}
