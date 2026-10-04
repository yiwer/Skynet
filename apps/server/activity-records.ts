import { digest } from './database.js';
import { readEvidence } from './evidence.js';
import { waitIntervals } from './wait-intervals.js';
import { unavailableOwners,type WaitOriginal } from './wait-dataset.js';
import { sourceTimestamp,type Source } from '../../packages/contracts/archive.js';
import { completeOriginalLines } from '../../packages/native/raw-lines.js';
import { readNativeTurnState } from '../../packages/native/turn-state.js';
import { conversationLink } from '../../packages/contracts/conversation.js';
import { evidenceLink } from '../../packages/contracts/search.js';
import { beijingDate } from '../../packages/contracts/reports.js';
import { addDays } from '../../packages/contracts/work-views.js';
import type { DeliveryObservation } from '../../packages/contracts/delivery.js';
import type { ActivityEvent,ActivityEvidence,ActivityPage,ActivityType,ActivityLane } from '../../packages/contracts/activity.js';
import type { SessionInsights } from '../../packages/contracts/session-insights.js';
import { primaryInputCoverage } from './evidence-integrity.js';
import type { ReplyWait } from '../../packages/contracts/waits.js';

export function activityOriginal(bytes:Buffer,source:Source){
  const evidence=readEvidence(bytes,source),markers:{type:ActivityType;line:number;timestamp:string|null;text:string;sessionId?:string}[]=[];
  for(const {line,text} of completeOriginalLines(bytes)){
    if(!text?.trim())continue;
    let row:any;try{row=JSON.parse(text);}catch{continue;}
    if(row.type==='session_meta'&&typeof row.payload?.id==='string')markers.push({type:'session-start',line,timestamp:sourceTimestamp(row.payload.timestamp??row.timestamp),text,sessionId:row.payload.id});
    if(row.type==='compacted'||row.type==='system'&&row.subtype==='compact_boundary')markers.push({type:'compaction',line,timestamp:sourceTimestamp(row.timestamp),text});
  }
  const coverage=primaryInputCoverage(bytes,source,evidence);
  // Compaction rows are known activity metadata even where the business-message
  // parser deliberately excludes their replacement context from activity counts.
  coverage.unrecognizedLines=Math.max(0,coverage.unrecognizedLines-markers.filter(marker=>marker.type==='compaction').length);
  return {evidence,markers,coverage,turn:readNativeTurnState(bytes,source)};
}
export type ActivityOriginal=ReturnType<typeof activityOriginal>;
export function activityEvidence(original:WaitOriginal,line:number,block=0,raw=false):ActivityEvidence{
  const location={line,block,textOffset:0,parserVersion:original.facts.parserVersion},snapshotId=original.record.id;
  return {snapshotId,...location,kind:raw?'raw':'event',webPath:evidenceLink(snapshotId,raw?{kind:'raw',line,textOffset:0}:{kind:'event',offset:0,...location}),conversationPath:raw?null:conversationLink(snapshotId,location)};
}
const excerpt=(text:string)=>{const chars=[...text];return {excerpt:chars.slice(0,160).join('')+(chars.length>160?'…':''),truncated:chars.length>160};};
export function activityRecords(originals:WaitOriginal[],details:Map<string,ActivityOriginal>,delivery:Map<string,DeliveryObservation>,scope:ActivityPage['scope'],insights:SessionInsights[]=[],recordedWaits?:ReplyWait[]){
  const events=new Map<string,ActivityEvent>();
  const latest=new Set([...new Map(originals.map(original=>[original.sessionId,original.record.id])).values()]);
  const unknownTimes=new Set<string>();
  const unavailableSources=new Set<string>();
  const dayStart=Date.parse(scope.date+'T00:00:00+08:00'),dayEnd=Date.parse(addDays(scope.date,1)+'T00:00:00+08:00');
  const inDay=(timestamp:string|null)=>timestamp!==null&&Date.parse(timestamp)>=dayStart&&Date.parse(timestamp)<dayEnd;
  const matches=(origin:Pick<WaitOriginal['origins'][number],'context'|'employeeId'|'project'>)=>origin.context==='after-enrollment'&&(!scope.employeeId||origin.employeeId===scope.employeeId)&&(scope.project===undefined||origin.project===scope.project);
  const backfill=(snapshotId:string)=>{const receipt=delivery.get(snapshotId);return receipt?receipt.disconnectedAttempts>0?'observed' as const:'not-observed' as const:'unknown' as const;};
  const add=(event:ActivityEvent)=>{if(!events.has(event.id))events.set(event.id,event);};
  for(const original of originals){
    const {record,facts,sessionId}=original,detail=details.get(record.id)!;
    if(scope.source&&scope.source!==record.source)continue;
    if(original.unavailable){
      const owners=unavailableOwners(original,scope);if(owners.length)unavailableSources.add(record.id);
      for(const owner of owners)add({employeeId:owner.employeeId,employee:owner.employee,project:owner.project,source:record.source,sessionId,snapshotId:record.id,
        id:digest(JSON.stringify([record.id,'source-unavailable',owner.employeeId,owner.project,original.unavailable])),type:'gap',timestamp:null,sourceDate:null,
        excerpt:'原件不可读取；活动内容与来源日期未知',truncated:false,basis:'recorded',backfill:backfill(record.id),analysisVersion:null,
        evidence:{...activityEvidence(original,1,0,true),kind:'manifest',webPath:`#${record.id}?view=timeline`}});
      continue;
    }
    const origins=new Map(original.origins.map(origin=>[`${origin.line}/${origin.block}`,origin]));
    const content=new Map(detail.evidence.events.map(event=>[`${event.line}/${event.block??0}`,event]));
    const owned=original.origins.filter(matches);
    const base=(origin:Pick<WaitOriginal['origins'][number],'employeeId'|'employee'|'project'|'snapshotId'>)=>({employeeId:origin.employeeId,employee:origin.employee,source:record.source,project:origin.project,sessionId,snapshotId:record.id,backfill:backfill(origin.snapshotId),analysisVersion:null});
    for(const message of facts.messages){
      if(!['user','assistant'].includes(message.role))continue;
      const origin=origins.get(`${message.line}/${message.block??0}`),text=content.get(`${message.line}/${message.block??0}`)?.text;
      if(!origin||!matches(origin)||origin.sourceDate!==scope.date||text===undefined)continue;
      add({...base(origin),id:origin.eventId,type:message.role==='user'?'prompt':'reply',timestamp:message.timestamp,sourceDate:origin.sourceDate,...excerpt(text),basis:'recorded',evidence:activityEvidence(original,message.line,message.block??0)});
    }
    if(latest.has(record.id)){
      for(const origin of original.origins)if(origin.context!=='historical'&&!origin.sourceDate&&(!scope.employeeId||origin.employeeId===scope.employeeId)&&(scope.project===undefined||origin.project===scope.project))unknownTimes.add(origin.eventId);
      const gaps=[...(record.manifest.capture?.gaps??[])];
      if(detail.coverage.partialLine&&!gaps.some(gap=>gap.code==='partial-line'))gaps.push({code:'partial-line',reference:'原件末行未完成'});
      if(detail.coverage.unrecognizedLines&&!gaps.some(gap=>gap.code==='unknown-format'))gaps.push({code:'unknown-format',reference:`${detail.coverage.unrecognizedLines} 行来源尚未识别`});
      const owner=owned.find(origin=>origin.sourceDate===scope.date)??original.origins.find(origin=>!origin.sourceDate&&origin.context!=='historical'&&(!scope.employeeId||origin.employeeId===scope.employeeId)&&(scope.project===undefined||origin.project===scope.project));
      if(owner)for(const gap of gaps){
        add({...base(owner),id:digest(JSON.stringify([record.id,'gap',gap])),type:'gap',timestamp:null,sourceDate:null,...excerpt(gap.reference),basis:'recorded',
          evidence:{...activityEvidence(original,1,0,true),webPath:`#${record.id}?view=timeline`,kind:'manifest'}});
      }
    }
    for(const boundary of facts.boundaries){
      if(!boundary.turnId||!inDay(boundary.timestamp)||boundary.kind==='interrupted')continue;
      const prior=[...original.origins].reverse().find(origin=>origin.line<boundary.line);
      if(!prior||!matches(prior))continue;
      const type=boundary.kind==='started'?'turn-start':'turn-end';
      add({...base(prior),id:digest(JSON.stringify([sessionId,type,boundary.turnId,boundary.timestamp])),type,timestamp:boundary.timestamp,sourceDate:beijingDate(new Date(boundary.timestamp!)),excerpt:boundary.kind==='started'?'本轮开始':'本轮结束',truncated:false,basis:'recorded',evidence:activityEvidence(original,boundary.line,0,true)});
    }
    for(const marker of detail.markers){
      if(!inDay(marker.timestamp))continue;
      if(marker.type==='session-start'&&(record.manifest.restoredFrom||marker.sessionId!==record.source_session_id||!record.manifest.enrolledAt||Date.parse(marker.timestamp!)<Date.parse(record.manifest.enrolledAt)))continue;
      const owner=marker.type==='session-start'?original.origins.find(origin=>origin.line>=marker.line)??{employeeId:record.employee_id,employee:record.employee,project:record.manifest.project,snapshotId:record.id,context:'after-enrollment' as const}:[...original.origins].reverse().find(origin=>origin.line<marker.line);
      if(!owner||!matches(owner))continue;
      add({...base(owner),id:digest(JSON.stringify([sessionId,marker.type,marker.timestamp,marker.text])),type:marker.type,timestamp:marker.timestamp,sourceDate:beijingDate(new Date(marker.timestamp!)),...excerpt(marker.text),basis:'recorded',evidence:activityEvidence(original,marker.line,0,true)});
    }
    const receipt=delivery.get(record.id),owner=owned.find(origin=>origin.snapshotId===record.id);
    if(receipt?.disconnectedAttempts&&owner){
      for(const [type,timestamp] of [['offline',receipt.firstDisconnectedAt],['backfill',receipt.acknowledgedAt]] as const){
        if(!inDay(timestamp)||!record.manifest.enrolledAt||Date.parse(timestamp!)<Date.parse(record.manifest.enrolledAt))continue;
        add({...base(owner),id:digest(JSON.stringify([record.id,type,receipt.revision])),type,timestamp,sourceDate:beijingDate(new Date(timestamp!)),excerpt:type==='offline'?'采集器记录连接中断':'连接恢复后投递确认',truncated:false,basis:'recorded',backfill:'observed',delivery:receipt,evidence:{...activityEvidence(original,owner.line,owner.block),kind:'delivery',conversationPath:null,webPath:`#${record.id}?view=timeline`}});
      }
    }
  }
  const waits=recordedWaits??waitIntervals(originals,{...scope,from:scope.date,to:scope.date}).intervals;
  for(const wait of waits){
    if(!wait.long||!wait.start||!wait.startedAt||!wait.endedAt)continue;
    const original=originals.find(original=>original.record.id===wait.snapshotId)!;
    add({id:digest('activity-wait:'+wait.id),type:'long-wait',timestamp:wait.startedAt,sourceDate:beijingDate(new Date(wait.startedAt)),employeeId:wait.employeeId,employee:wait.employee,source:wait.source,project:wait.project,sessionId:wait.sessionId,snapshotId:wait.snapshotId,
      excerpt:'等待下一条用户消息',truncated:false,basis:'derived',backfill:backfill(wait.snapshotId),analysisVersion:null,durationMs:wait.durationMs!,endedAt:wait.endedAt,parallel:wait.parallel,
      evidence:activityEvidence(original,wait.start.line,wait.start.block,true),endEvidence:activityEvidence(original,wait.end.line,wait.end.block)});
  }
  for(const view of insights){
    if(!view.analysisVersion?.applicable||!view.inferences||!['complete','partial'].includes(view.state))continue;
    for(const [items,type,role] of [[view.inferences.prompts,'rework','user'],[view.inferences.replies,'clarification','assistant']] as const){
      for(const item of items){
        const yes=type==='rework'?'rework' in item&&item.rework===true&&!item.first:'clarification' in item&&item.clarification===true;
        if(!item.complete||!yes)continue;
        const citation=item.citations.find(citation=>citation.event===item.event&&citation.role===role&&citation.origin?.context==='after-enrollment');
        if(!citation?.origin)continue;const event=events.get(citation.origin.eventId);if(!event)continue;
        event.type=type;event.basis='inferred';event.analysisVersion=view.analysisVersion.id;event.inference={...citation,version:view.version};
      }
    }
  }
  const list=[...events.values()].filter(event=>!scope.type||event.type===scope.type).sort((a,b)=>Number(!a.timestamp)-Number(!b.timestamp)||(a.timestamp??'').localeCompare(b.timestamp??'')||a.employee.localeCompare(b.employee,'zh-CN')||Number(a.basis==='derived')-Number(b.basis==='derived')||a.evidence.line-b.evidence.line||a.id.localeCompare(b.id));
  const lanes=new Map<string,ActivityLane>();
  for(const event of list){
    if(!lanes.has(event.employeeId))lanes.set(event.employeeId,{employeeId:event.employeeId,employee:event.employee,sessions:[],points:[],segments:[]});
    const lane=lanes.get(event.employeeId)!;
    if(event.type==='prompt'||event.type==='rework')lane.points.push({id:event.id,type:event.type,timestamp:event.timestamp,sessionId:event.sessionId,evidence:event.evidence});
    if(event.type==='long-wait')lane.segments.push({id:event.id,kind:'wait',startedAt:event.timestamp!,endedAt:event.endedAt!,durationInScopeMs:Math.min(Date.parse(event.endedAt!),dayEnd)-Math.max(Date.parse(event.timestamp!),dayStart),evidence:event.endEvidence!});
    if(!event.timestamp||!inDay(event.timestamp)||['offline','backfill','long-wait'].includes(event.type))continue;
    let session=lane.sessions.find(session=>session.id===event.sessionId);
    if(!session){const latest=originals.filter(original=>original.sessionId===event.sessionId).at(-1)!;
      session={id:event.sessionId,source:event.source,project:event.project,observedFrom:event.timestamp,observedTo:event.timestamp,startBoundary:'unknown',endBoundary:'unknown',state:details.get(latest.record.id)?.turn.state??'unknown',evidence:event.evidence};lane.sessions.push(session);}
    if(event.timestamp<session.observedFrom)session.observedFrom=event.timestamp;if(event.timestamp>session.observedTo)session.observedTo=event.timestamp;
    if(event.type==='session-start')session.startBoundary='observed';
  }
  return {events:list,lanes:[...lanes.values()].sort((a,b)=>a.employee.localeCompare(b.employee,'zh-CN')||a.employeeId.localeCompare(b.employeeId)),coverage:{permission:'unknown' as const,sessionEnd:'unknown' as const,unknownTime:unknownTimes.size,unavailableSources:unavailableSources.size}};
}
