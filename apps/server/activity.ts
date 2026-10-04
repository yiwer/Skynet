import { digest,type Database } from './database.js';
import { HttpError } from './identities.js';
import type { RawStore } from './raw-store.js';
import { waitDataset } from './wait-dataset.js';
import { activityOriginal,activityRecords,type ActivityOriginal } from './activity-records.js';
import type { DeliveryObservation } from '../../packages/contracts/delivery.js';
import type { sessionInsightsService } from './session-insights.js';
import { activityQuerySchema,type ActivityQuery,type ActivityPage } from '../../packages/contracts/activity.js';
import { beijingDate } from '../../packages/contracts/reports.js';
import { waitAlgorithmVersion } from './wait-inputs.js';
import { materializeWaits } from './wait-revisions.js';

function lanePage(lanes:ActivityPage['lanes'],offset:number){
  const page:ActivityPage['lanes']=[];let position=0;
  for(const lane of lanes){
    const sliced={employeeId:lane.employeeId,employee:lane.employee,sessions:[] as typeof lane.sessions,points:[] as typeof lane.points,segments:[] as typeof lane.segments};
    let included=false;
    for(const key of ['sessions','points','segments'] as const){
      const start=Math.max(0,offset-position),end=Math.max(0,offset+25-position);
      Object.assign(sliced,{[key]:lane[key].slice(start,end)});if(end>start&&start<lane[key].length)included=true;position+=lane[key].length;
    }
    if(!lane.sessions.length&&!lane.points.length&&!lane.segments.length){included=position>=offset&&position<offset+25;position++;}
    if(included)page.push(sliced);
  }
  return {lanes:page,total:position,next:offset+25<position?offset+25:null};
}

export async function migrateActivity(db:Database){
  await db.query(`CREATE TABLE IF NOT EXISTS activity_revisions(version text PRIMARY KEY,scope_key text NOT NULL,revision integer NOT NULL,payload jsonb NOT NULL,UNIQUE(scope_key,revision));`);
}
export function activityService(db:Database,raw:RawStore,insights:ReturnType<typeof sessionInsightsService>,clock:()=>Date=()=>new Date()){
  async function compute(q:ActivityQuery,full:boolean):Promise<ActivityPage>{
    const client=await db.connect();
    try{
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      const scope:ActivityPage['scope']={date:q.date??beijingDate(clock()),timeZone:'Asia/Shanghai',...(q.employeeId?{employeeId:q.employeeId}:{}),...(q.source?{source:q.source}:{}),...(q.project!==undefined?{project:q.project}:{}),...(q.type?{type:q.type}:{})};
      const scopeKey=digest(JSON.stringify(scope));
      if(!(await client.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,3901)) AS locked',[scopeKey])).rows[0].locked)throw new HttpError(409,'活动记录正在计算，请稍后重试');
      if(q.employeeId&&!(await client.query('SELECT 1 FROM employees WHERE id=$1',[q.employeeId])).rowCount)throw new HttpError(404,'员工不存在');
      const evidence=new Map<string,ActivityOriginal>();
      const originals=await waitDataset(client,raw,full,q.employeeId?[q.employeeId]:null,(record,bytes)=>{evidence.set(record.id,activityOriginal(bytes,record.source));});
      const receipts=(await client.query(`SELECT snapshot_id,count(*)::int AS count,COALESCE(sum((receipt->>'disconnectedAttempts')::bigint),0)::text AS attempts,
        min(receipt->>'firstDisconnectedAt') AS first,max(receipt->>'lastDisconnectedAt') AS last,min(receipt->>'capturedAt') AS captured,
        max(receipt->>'acknowledgedAt') AS acknowledged,max(received_at) AS received FROM delivery_receipts WHERE snapshot_id=ANY($1::uuid[]) GROUP BY snapshot_id`,[originals.map(o=>o.record.id)])).rows;
      const delivery=new Map<string,DeliveryObservation>(receipts.map(row=>{const observation={receiptCount:row.count,disconnectedAttempts:Number(row.attempts),firstDisconnectedAt:row.first,lastDisconnectedAt:row.last,capturedAt:row.captured,acknowledgedAt:row.acknowledged,receivedAt:row.received?.toISOString()??null};return [row.snapshot_id,{...observation,revision:digest(JSON.stringify(observation))}];}));
      const latest=[...new Map(originals.map(original=>[original.sessionId,original])).values()].filter(original=>(!q.source||original.record.source===q.source)&&original.origins.some(origin=>origin.context==='after-enrollment'&&origin.sourceDate===scope.date&&(!q.employeeId||origin.employeeId===q.employeeId)&&(q.project===undefined||origin.project===q.project)));
      const views=await insights.readMany(latest.map(original=>original.record.id),{full});
      for(const [index,view] of views.entries()){const original=latest[index]!;if(view.input.hash!==original.record.hash||view.input.attributionRevision!==original.revision||original.unavailable!==view.sourceAvailability?.reason)throw new HttpError(409,'活动原件归属或可用性已更新，请重新读取');}
      const waiting=await materializeWaits(client,originals,{timeZone:'Asia/Shanghai',activityDate:scope.date,from:scope.date,to:scope.date,...(scope.employeeId?{employeeId:scope.employeeId}:{}),...(scope.source?{source:scope.source}:{}),...(scope.project!==undefined?{project:scope.project}:{})},clock);
      const records=activityRecords(originals,evidence,delivery,scope,views,waiting.intervals);
      // The existing conversation reader accepts a fixed waiting revision. Every
      // activity jump keeps that revision even after a late parallel upload.
      const pinned=new Set<object>();const pin=(evidence:{conversationPath:string|null})=>{if(!pinned.has(evidence)&&evidence.conversationPath)evidence.conversationPath+='&waitVersion='+waiting.version;pinned.add(evidence);};
      for(const event of records.events){pin(event.evidence);if(event.endEvidence)pin(event.endEvidence);}
      for(const lane of records.lanes){for(const session of lane.sessions)pin(session.evidence);for(const point of lane.points)pin(point.evidence);for(const segment of lane.segments)pin(segment.evidence);}
      const inputs=originals.map(o=>({snapshotId:o.record.id,hash:o.record.hash,attributionRevision:o.revision,parserVersion:o.facts.parserVersion,...(o.unavailable?{unavailable:o.unavailable}:{})}));
      const dataAsOf=[...originals.map(original=>original.record.committed_at.toISOString()),...receipts.map(receipt=>receipt.received?.toISOString()).filter(Boolean)].sort().at(-1)??null;
      const content={scope,...records,total:records.events.length,nextOffset:null,algorithmVersion:'activity-2',dataAsOf,
        inputs,analyses:views.map(({snapshotId,version,state,analysisVersion})=>({snapshotId,version,state,analysisVersion})),nextLaneOffset:null,nextInputOffset:null,
        inputCount:inputs.length,laneItemCount:lanePage(records.lanes,0).total,employeeOrder:records.lanes.map(({employeeId,employee})=>({employeeId,employee})),waitAlgorithmVersion,waitVersion:waiting.version,inputVersion:digest(JSON.stringify(inputs))};
      const version=digest(JSON.stringify(content));
      const existing=(await client.query('SELECT payload FROM activity_revisions WHERE version=$1',[version])).rows[0];
      if(existing){await client.query('COMMIT');return existing.payload;}
      const revision=Number((await client.query('SELECT COALESCE(MAX(revision),0)+1 AS next FROM activity_revisions WHERE scope_key=$1',[scopeKey])).rows[0].next);
      const value:ActivityPage={...content,version,revision,createdAt:clock().toISOString()};
      if(Buffer.byteLength(JSON.stringify(value))>16*1024*1024)throw new HttpError(413,'活动范围超过单次计算上限');
      await client.query('INSERT INTO activity_revisions(version,scope_key,revision,payload) VALUES($1,$2,$3,$4)',[version,scopeKey,revision,value]);
      await client.query('COMMIT');return value;
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  async function read(input:unknown,full=false,exporting=false){
    const q=activityQuerySchema.parse(input);let result:ActivityPage;
    if(q.version){
      if(full)throw new HttpError(400,'固定活动版本不能重算');
      const row=(await db.query('SELECT payload FROM activity_revisions WHERE version=$1',[q.version])).rows[0];if(!row)throw new HttpError(404,'活动记录版本不存在');result=row.payload;
      for(const key of ['date','employeeId','source','project','type'] as const)if(q[key]!==undefined&&q[key]!==result.scope[key]||key!=='date'&&q[key]!==result.scope[key])throw new HttpError(400,'活动版本不属于当前范围');
    }else{
      for(let attempt=0;;attempt++)try{result=await compute(q,full);break;}catch(error){if(!['40001','40P01'].includes((error as {code?:string}).code??''))throw error;if(attempt>=2)throw new HttpError(409,'活动来源正在更新，请稍后重试');}
    }
    if(exporting)return result;
    const section=q.section??'events',lanes=lanePage(result.lanes,section==='lanes'?q.offset:0),inputOffset=section==='inputs'?q.offset:0;
    const nextInputOffset=inputOffset+25<Math.max(result.inputs.length,result.analyses.length)?inputOffset+25:null;
    const page:ActivityPage={...result,events:section==='events'?result.events.slice(q.offset,q.offset+25):[],lanes:section==='inputs'?[]:lanes.lanes,
      inputs:section==='lanes'?[]:result.inputs.slice(inputOffset,inputOffset+25),analyses:section==='lanes'?[]:result.analyses.slice(inputOffset,inputOffset+25),
      nextLaneOffset:lanes.next,nextInputOffset,nextOffset:section==='lanes'?lanes.next:section==='inputs'?nextInputOffset:q.offset+25<result.total?q.offset+25:null};
    if(Buffer.byteLength(JSON.stringify(page))>80*1024)throw new HttpError(413,'此活动页超出响应上限，请缩小员工或项目范围');
    return page;
  }
  return {read,recompute:(input:unknown)=>read(input,true),export:(input:unknown)=>read(input,false,true)};
}
