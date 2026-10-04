import type {Database} from './database.js';
import {HttpError} from './identities.js';
import type {RawStore} from './raw-store.js';
import {waitDataset,waitEvidence,type WaitOriginal} from './wait-dataset.js';
import {materializeWaits} from './wait-revisions.js';
import type {SessionInsights} from '../../packages/contracts/session-insights.js';
import type {UsageSession} from '../../packages/contracts/usage-output.js';
import type {EfficiencySession,EfficiencySegment,EfficiencyQuery} from '../../packages/contracts/session-efficiency.js';
import type {MetricsScope} from '../../packages/contracts/metrics.js';
import type {TurnBoundary} from '../../packages/native/waits.js';
import {addDays} from '../../packages/contracts/work-views.js';
import {primaryInputCoverage} from './evidence-integrity.js';
import {readEvidence} from './evidence.js';

function unionDuration(segments:EfficiencySegment[]){
  const ranges=segments.filter(s=>s.durationMs!==null&&s.startedAt&&s.endedAt).map(s=>[Date.parse(s.startedAt!),Date.parse(s.endedAt!)] as const).sort((a,b)=>a[0]-b[0]);
  let duration=0,start:number|undefined,end=0;
  for(const [a,b]of ranges){if(start===undefined){start=a;end=b;}else if(a<=end)end=Math.max(end,b);else{duration+=end-start;start=a;end=b;}}
  return duration+(start===undefined?0:end-start);
}
function nativeSegments(originals:WaitOriginal[],parts:UsageSession[],scope:MetricsScope,incomplete:Set<string>):EfficiencySegment[]{
  const result:EfficiencySegment[]=[],leaves=new Set(parts.flatMap(p=>p.latestCarrierSnapshotIds));
  const selected=originals.filter(o=>leaves.has(o.record.id)&&parts.some(p=>p.sourceSessionId===o.record.source_session_id));
  const turns=new Map<string,EfficiencySegment>(),rangeStart=Date.parse(scope.from+'T00:00:00+08:00'),rangeEnd=Date.parse(addDays(scope.to,1)+'T00:00:00+08:00');
  for(const original of selected){
    const groups=new Map<string,TurnBoundary[]>(),origins=new Map(original.origins.map(o=>[`${o.line}/${o.block}`,o]));
    for(const boundary of original.facts.boundaries){const key=boundary.turnId??`unknown-${boundary.line}`;if(!groups.has(key))groups.set(key,[]);groups.get(key)!.push(boundary);}
    for(const [id,group]of groups){
      const starts=[...new Map(group.filter(b=>b.kind==='started').map(b=>[b.timestamp,b])).values()],ends=[...new Map(group.filter(b=>b.kind==='completed').map(b=>[b.timestamp,b])).values()];
      const start=starts[0],end=ends[0],first=start??end??group[0]!;
      const prior=original.facts.messages.findLast(message=>message.line<first.line),owner=prior&&origins.get(`${prior.line}/${prior.block??0}`);
      if(!owner||owner.context!=='after-enrollment'||!parts.some(p=>p.employeeId===owner.employeeId&&p.project===owner.project))continue;
      const a=start?.timestamp?Date.parse(start.timestamp):NaN,b=end?.timestamp?Date.parse(end.timestamp):NaN;
      if(Number.isFinite(a)&&a>=rangeEnd||Number.isFinite(b)&&b<rangeStart)continue;
      const valid=!!start?.turnId&&starts.length===1&&ends.length===1&&!group.some(b=>b.kind==='interrupted')&&start.line<end!.line&&Number.isFinite(a)&&Number.isFinite(b)&&b>=a;
      const item:EfficiencySegment={kind:'agent',startedAt:Number.isFinite(a)?new Date(Math.max(a,rangeStart)).toISOString():null,endedAt:valid?new Date(Math.min(b,rangeEnd)).toISOString():null,
        durationMs:valid?Math.max(0,Math.min(b,rangeEnd)-Math.max(a,rangeStart)):null,evidence:[...(start?[waitEvidence(original,start.line,0,true)]:[]),...(end?[waitEvidence(original,end.line,0,true)]:[])],reason:valid?null:'本轮开始、结束或时间边界不完整'};
      const key=JSON.stringify([id,owner.eventId]),existing=turns.get(key);
      if(existing){if(existing.startedAt!==item.startedAt||existing.endedAt!==item.endedAt||existing.durationMs!==item.durationMs){existing.durationMs=null;existing.reason='同一轮次边界存在冲突';}}
      else turns.set(key,item);
    }
    if(incomplete.has(original.record.id)||original.record.manifest.capture?.gaps.length||original.record.manifest.capture?.partialLine||original.record.manifest.capture?.compacted){
      result.push({kind:'gap',startedAt:null,endedAt:null,durationMs:null,evidence:[waitEvidence(original,1,0,true)],reason:'原件有未识别记录、采集缺口或压缩，未提供缺口起止时间'});
    }
  }
  result.push(...turns.values());
  if(!turns.size)result.push({kind:'agent',startedAt:null,endedAt:null,durationMs:null,evidence:[],reason:'来源没有可配对的原生轮次边界'});
  return result;
}

/** Bind native segments to exactly the usage report's selected originals and
 * insight attribution. Other sessions remain frozen parallel-activity evidence. */
export async function efficiencyTiming(db:Database,raw:RawStore,sessions:EfficiencySession[],groups:Map<string,UsageSession[]>,views:Map<string,SessionInsights>,scope:MetricsScope,q:EfficiencyQuery,full:boolean,clock:()=>Date){
  const client=await db.connect();
  try{
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    const people=[...new Set(sessions.flatMap(s=>s.employees.map(e=>e.employeeId)))],sourceIds=new Set(views.keys()),sessionIds=new Set(sessions.map(s=>s.sessionId));
    const incomplete=new Set<string>();
    const dataset=people.length?await waitDataset(client,raw,full,people,(record,bytes)=>{
      if(sourceIds.has(record.id)&&!primaryInputCoverage(bytes,record.source,readEvidence(bytes,record.source)).complete)incomplete.add(record.id);
    }):[];
    const originals=dataset.filter(o=>!sessionIds.has(o.sessionId)||sourceIds.has(o.record.id));
    for(const [id,view]of views){const original=originals.find(o=>o.record.id===id);if(!original||original.record.hash!==view.input.hash||original.revision!==view.input.attributionRevision)throw new HttpError(409,'产效原件归属已更新，请重新读取');}
    const waiting=await materializeWaits(client,originals,{...scope,period:q.period},clock);
    for(const row of sessions){
      const parts=groups.get(row.sessionId)!,segments=nativeSegments(originals.filter(o=>o.sessionId===row.sessionId),parts,scope,incomplete);
      const replies=waiting.intervals.filter(w=>w.sessionId===row.sessionId&&parts.some(p=>p.employeeId===w.employeeId&&p.project===w.project));
      const rangeStart=Date.parse(scope.from+'T00:00:00+08:00'),rangeEnd=Date.parse(addDays(scope.to,1)+'T00:00:00+08:00');
      for(const wait of replies)segments.push({kind:'reply',startedAt:wait.startedAt&&wait.durationMs!==null?new Date(Math.max(Date.parse(wait.startedAt),rangeStart)).toISOString():wait.startedAt,
        endedAt:wait.endedAt&&wait.durationMs!==null?new Date(Math.min(Date.parse(wait.endedAt),rangeEnd)).toISOString():wait.endedAt,durationMs:wait.durationInScopeMs,evidence:[...(wait.start?[wait.start]:[]),wait.end],reason:wait.reason});
      segments.sort((a,b)=>(a.startedAt??'9999').localeCompare(b.startedAt??'9999')||a.kind.localeCompare(b.kind));
      const activeMs=segments.some(s=>s.durationMs===null)?null:unionDuration(segments);
      row.timing={waitVersion:waiting.version,knownAgentMs:unionDuration(segments.filter(s=>s.kind==='agent')),knownReplyMs:replies.reduce((n,w)=>n+(w.durationInScopeMs??0),0),activeMs,permissionMs:null,
        waitFraction:{numerator:null,denominator:activeMs,value:null},segments};
      row.webPath+=(row.webPath.includes('?')?'&':'?')+'waitVersion='+waiting.version;
      for(const segment of segments)for(const evidence of segment.evidence)if(evidence.conversationPath&&!evidence.conversationPath.includes('waitVersion='))evidence.conversationPath+='&waitVersion='+waiting.version;
    }
    await client.query('COMMIT');return waiting.dataAsOf;
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
