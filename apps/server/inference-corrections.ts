import type {PoolClient} from 'pg';
import {isDeepStrictEqual} from 'node:util';
import {digest,type Database} from './database.js';
import {HttpError,identities} from './identities.js';
import {inferenceCorrectionInput,inferenceCorrectionQuery,type InferenceCorrection,type InferenceCorrectionPage} from '../../packages/contracts/inference-corrections.js';
import type {SessionInsights} from '../../packages/contracts/session-insights.js';
import type {MessageFacts} from '../../packages/contracts/message-facts.js';
import type {sessionInsightsService} from './session-insights.js';

export async function migrateInferenceCorrections(db:Database){await db.query(`CREATE TABLE IF NOT EXISTS inference_corrections(
  id uuid PRIMARY KEY,sequence bigserial UNIQUE NOT NULL,snapshot_id uuid NOT NULL REFERENCES snapshots(id),event_id text NOT NULL,
  actor_id uuid NOT NULL REFERENCES employees(id),created_at timestamptz NOT NULL DEFAULT now(),payload jsonb NOT NULL);
  CREATE INDEX IF NOT EXISTS inference_correction_event ON inference_corrections(event_id,sequence DESC);
  CREATE TABLE IF NOT EXISTS inference_correction_views(version text PRIMARY KEY,correction_ids uuid[] NOT NULL)`);}

export async function inferenceCorrectionRows(client:PoolClient|Database,snapshotIds:string[]){
  const rows=(await client.query(`SELECT DISTINCT se.snapshot_id,c.sequence,c.payload FROM effective_snapshot_events se
    JOIN inference_corrections c ON c.event_id=se.event_id WHERE se.snapshot_id=ANY($1::uuid[]) ORDER BY c.sequence LIMIT 200001`,[snapshotIds])).rows;
  if(rows.length>200000)throw new HttpError(413,'推断更正关联超过范围上限');
  const result=new Map<string,InferenceCorrection[]>();
  for(const row of rows){const list=result.get(row.snapshot_id)??[];list.push(row.payload);result.set(row.snapshot_id,list);}
  return result;
}
const correctionVersion=(rows:InferenceCorrection[])=>digest(JSON.stringify(['inference-corrections-1',rows.map(row=>row.id)]));
export async function saveCorrectionViews(client:PoolClient,groups:Map<string,InferenceCorrection[]>){
  const values=[...groups.values()].map(rows=>({version:correctionVersion(rows),ids:rows.map(row=>row.id)}));
  if(values.length)await client.query(`INSERT INTO inference_correction_views(version,correction_ids)
    SELECT version,ids FROM jsonb_to_recordset($1::jsonb) AS x(version text,ids uuid[]) ON CONFLICT DO NOTHING`,[JSON.stringify(values)]);
}
function nativeRework(view:SessionInsights,messages:MessageFacts):number|null{
  const users=messages.messages.filter(message=>message.role==='user');
  if(!messages.complete||users.some(message=>message.first===null))return null;
  const followups=users.filter(message=>message.first===false).map(message=>{
    const blocks=message.eventIds.map(id=>{
      const entries=view.inferences!.prompts.filter(prompt=>prompt.citations.some(cite=>cite.event===prompt.event&&cite.origin?.eventId===id));
      return entries.length&&entries.every(prompt=>prompt.complete&&prompt.rework===entries[0]!.rework)?entries[0]!.rework:null;
    });
    return blocks.some(value=>value===true)?true:blocks.length&&blocks.every(value=>value===false)?false:null;
  });
  return followups.some(value=>value===null)?null:followups.filter(Boolean).length;
}
export function applyInferenceCorrections(view:SessionInsights,rows:InferenceCorrection[],messages:MessageFacts):SessionInsights{
  if(!rows.length)return view;
  const latest=new Map<string,InferenceCorrection>();for(const row of rows)latest.set(row.kind==='task-type'?row.kind:row.kind+'/'+row.eventId,row);
  const current=[...latest.values()],value=structuredClone(view),appliedIds:string[]=[],pendingIds:string[]=[];
  for(const row of current){
    let applied=false;
    if(value.inferences){
      if(row.kind==='task-type'){value.inferences.taskType.value=row.value;value.inferences.taskType.correctionId=row.id;applied=true;}
      else for(const prompt of value.inferences.prompts){
        if(!prompt.citations.some(cite=>cite.event===prompt.event&&cite.role==='user'&&cite.origin&&row.targetEventIds.includes(cite.origin.eventId)))continue;
        prompt.corrections??={};
        if(row.kind==='prompt-elements'){prompt.elements={...row.value};prompt.corrections.elements=row.id;}else{prompt.rework=row.value;prompt.corrections.rework=row.id;}
        applied=true;
      }
    }
    (applied?appliedIds:pendingIds).push(row.id);
  }
  if(value.state==='complete'&&value.inferences)value.metrics.rework=nativeRework(value,messages);
  const version=correctionVersion(rows);
  value.corrections={version,appliedIds,pendingIds};value.version=digest(JSON.stringify([view.version,version]));return value;
}
export function inferenceCorrectionsService(db:Database,insights:ReturnType<typeof sessionInsightsService>){
  async function history(snapshotId:string,input:unknown={}):Promise<InferenceCorrectionPage>{
    const q=inferenceCorrectionQuery.parse(input),view=await insights.read(snapshotId,q.version?{version:q.version}:{});
    const rows=view.corrections?(await db.query(`SELECT c.payload FROM inference_correction_views v JOIN inference_corrections c ON c.id=ANY(v.correction_ids)
      WHERE v.version=$1 ORDER BY c.sequence DESC LIMIT 21 OFFSET $2`,[view.corrections.version,q.offset])).rows:[];
    const corrections:InferenceCorrection[]=[];let bytes=1024;
    for(const row of rows.slice(0,20)){const size=Buffer.byteLength(JSON.stringify(row.payload));if(corrections.length&&bytes+size>48*1024)break;corrections.push(row.payload);bytes+=size;}
    return {corrections,nextOffset:rows.length>corrections.length?q.offset+corrections.length:null,version:view.version};
  }
  async function correct(snapshotId:string,authorization:string|undefined,value:unknown){
    const input=inferenceCorrectionInput.parse(value),client=await db.connect();
    try{
      await client.query('BEGIN; SELECT pg_advisory_xact_lock(7402151)');
      const actor=await identities(db).reader(authorization,client,true);
      const previous=(await client.query('SELECT payload FROM inference_corrections WHERE id=$1',[input.requestId])).rows[0]?.payload as InferenceCorrection|undefined;
      if(previous){if(previous.actorId!==actor.id||previous.snapshotId!==snapshotId||!isDeepStrictEqual(Object.fromEntries(Object.keys(input).map(key=>[key,previous[key as keyof InferenceCorrection]])),input))throw new HttpError(409,'更正操作标识已用于其他内容');await client.query('COMMIT');return {correction:previous,created:false};}
      const view=await insights.read(snapshotId);
      if(view.version!==input.expectedVersion)throw new HttpError(409,'会话洞察已有新版，请刷新后提交更正');
      if(!view.inferences||!view.analysisVersion)throw new HttpError(409,'当前没有可更正的分析推断');
      const messages=(await insights.readMessageFacts([view]))[0]!;
      const prompt=input.kind==='task-type'?null:view.inferences.prompts.find(prompt=>prompt.event===input.promptEvent);
      if(input.kind!=='task-type'&&!prompt)throw new HttpError(422,'所选提示词不属于此分析');
      const selfId=prompt?.citations.find(cite=>cite.event===prompt.event&&cite.role==='user'&&cite.origin)?.origin?.eventId;
      const message=messages.messages.find(message=>message.role==='user'&&(input.kind==='task-type'||!!selfId&&message.eventIds.includes(selfId)));
      const eventId=message?.eventIds[0],targetEventIds=message?.eventIds??[];
      const evidence=prompt?.citations??view.inferences.taskType.citations;
      if(!eventId||!evidence.length)throw new HttpError(422,'缺少可关联的原始分析证据');
      const row=(await client.query(`INSERT INTO inference_corrections(id,snapshot_id,event_id,actor_id,payload) VALUES($1,$2,$3,$4,'{}') RETURNING sequence::text,created_at`,[input.requestId,snapshotId,eventId,actor.id])).rows[0];
      const correction:InferenceCorrection={...input,id:input.requestId,sequence:row.sequence,snapshotId,eventId,targetEventIds,actorId:actor.id,actor:actor.name,createdAt:row.created_at.toISOString(),
        insightVersion:view.version,analysisId:view.analysisVersion.id,previous:input.kind==='task-type'?view.inferences.taskType.value:input.kind==='prompt-elements'?prompt!.elements:prompt!.rework,evidence};
      await client.query('UPDATE inference_corrections SET payload=$2 WHERE id=$1',[input.requestId,correction]);
      await client.query('COMMIT');return {correction,created:true};
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  return {correct,history};
}
