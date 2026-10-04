import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import type {QueryResult,QueryResultRow} from 'pg';
import type {FastifyReply,FastifyRequest} from 'fastify';
import type {Database} from './database.js';

export interface ReportReader {
  query<T extends QueryResultRow=any>(text:string,values?:unknown[]):Promise<QueryResult<T>>;
}
export type ReportDownload={version:string;byteLength:number;sha256:string;body:AsyncIterable<Buffer>;close:()=>Promise<void>};

/** Resolve/materialize current input before calling this boundary. The provider
 * opens one fixed revision and supplies a repeatable, bounded JSON generator. */
export async function prepareReportDownload(db:Database,prepare:(reader:ReportReader)=>Promise<{version:string;json:()=>AsyncIterable<Buffer>}>):Promise<ReportDownload>{
  const client=await db.connect(),active=new Set<Promise<unknown>>();let closing=false,closed:Promise<void>|undefined;
  const reader:ReportReader={query:async(text,values)=>{
    if(closing)throw new Error('Report download is closed');
    const query=client.query(text,values);active.add(query);
    try{return await query;}finally{active.delete(query);}
  }};
  const close=()=>closed??=(async()=>{closing=true;
    try{await Promise.allSettled([...active]);await client.query('ROLLBACK');}finally{client.release();}
  })();
  try{
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const revision=await prepare(reader),hash=createHash('sha256');let byteLength=0;
    // Verify every persisted part before sending a successful response. The
    // second pass sees the same immutable revision in this transaction snapshot.
    for await(const part of revision.json()){hash.update(part);byteLength+=part.length;}
    const sha256=hash.digest('hex');
    async function* body(){try{for await(const part of revision.json()){
      if(closing)throw new Error('Report download is closed');yield part;
    }}finally{await close();}}
    return{version:revision.version,byteLength,sha256,body:body(),close};
  }catch(error){await close();throw error;}
}

/** One transport owner for completion, errors and client disconnects. */
export async function sendReportDownload(request:FastifyRequest,reply:FastifyReply,value:ReportDownload,prefix:string){
  if(request.raw.aborted||reply.raw.destroyed){await value.close();return reply;}
  const stream=Readable.from(value.body,{objectMode:false,highWaterMark:64*1024});
  reply.raw.once('close',()=>{stream.destroy();void value.close().catch(error=>request.log.error(error,'Report download cleanup failed'));});
  return reply.type('application/json; charset=utf-8')
    .header('Content-Disposition',`attachment; filename="${prefix}-${value.version}.json"`)
    .header('ETag',`"${value.version}"`).header('X-Skynet-Content-SHA256',value.sha256)
    .header('Content-Length',value.byteLength).send(stream);
}
