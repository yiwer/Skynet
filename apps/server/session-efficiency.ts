import {digest,type Database} from './database.js';
import {HttpError} from './identities.js';
import type {usageOutputService} from './usage-output.js';
import type {UsageSession} from '../../packages/contracts/usage-output.js';
import type {sessionInsightsService} from './session-insights.js';
import {taskTypes,type SessionInsights} from '../../packages/contracts/session-insights.js';
import type {MetricsScope} from '../../packages/contracts/metrics.js';
import type {RawStore} from './raw-store.js';
import {efficiencyTiming} from './efficiency-timing.js';
import {promptFactors} from './prompt-factors.js';
import type {RecordedMessage} from '../../packages/contracts/message-facts.js';
import {efficiencyQuerySchema,type EfficiencyQuery,type EfficiencySession,type SessionEfficiencyPage} from '../../packages/contracts/session-efficiency.js';

const algorithmVersion='session-efficiency-1';
const definition='产效比 = 已验证结果 ÷ 百万 Token；代码产出 = 代码变更行 ÷ 百万 Token。Token 使用已知输入与输出之和，未知或零分母不计算比值。只在同类任务之间参考；任务类型与返工为模型推断。P75 按所选范围 Token 已知的逻辑会话使用线性插值，同一会话的归属分片先合计。';
const selection=(q:EfficiencyQuery)=>({period:q.period,...(q.employeeId?{employeeId:q.employeeId}:{}),...(q.source?{source:q.source}:{}),...(q.project!==undefined?{project:q.project}:{})});
const ratio=(numerator:number|null,denominator:number|null)=>({numerator,denominator,value:numerator!==null&&denominator!==null&&denominator>0?numerator/denominator*1e6:null});
function quantile(values:number[],q:number){if(!values.length)return null;const sorted=[...values].sort((a,b)=>a-b),p=(sorted.length-1)*q,lo=Math.floor(p);return sorted[lo]!+(sorted[Math.ceil(p)]!-sorted[lo]!)*(p-lo);}
function combine(rows:UsageSession[]):EfficiencySession{
  const first=rows[0]!,sum=(key:'userTurns'|'toolCalls'|'knownInputTokens'|'knownOutputTokens')=>rows.reduce((n,row)=>n+row[key],0);
  const amount=(key:'verified'|'claimed'|'codeChanges')=>rows.some(row=>row.outputs[key].value===null)?null:rows.reduce((n,row)=>n+row.outputs[key].known,0);
  const tokens=rows.some(row=>row.inputTokens===null||row.outputTokens===null)?null:sum('knownInputTokens')+sum('knownOutputTokens');
  const verified=amount('verified'),codeChanges=amount('codeChanges');
  return{sessionId:first.sessionId,snapshotId:first.snapshotId,sourceSessionId:first.sourceSessionId,source:first.source,
    projects:[...new Set(rows.map(row=>row.project))],employees:[...new Map(rows.map(row=>[row.employeeId,{employeeId:row.employeeId,employee:row.employee}])).values()].sort((a,b)=>a.employee.localeCompare(b.employee,'zh-CN')||a.employeeId.localeCompare(b.employeeId)),
    dates:[...new Set(rows.flatMap(row=>row.dates))].sort(),webPath:first.webPath,tokens,knownTokens:sum('knownInputTokens')+sum('knownOutputTokens'),userTurns:sum('userTurns'),toolCalls:sum('toolCalls'),verified,claimed:amount('claimed'),codeChanges,
    efficiency:ratio(verified,tokens),codeOutput:ratio(codeChanges,tokens),taskType:'unknown',taskEvidence:[],rework:null,reworkEvidence:[],reviewReasons:[],
    inputVersions:[...new Map(rows.flatMap(row=>row.insightVersions).map(input=>[input.snapshotId+'/'+input.version,input])).values()]};
}
function applyInferences(row:EfficiencySession,parts:UsageSession[],views:Map<string,SessionInsights>,scope:MetricsScope,messages:RecordedMessage[]){
  const latest=[...new Set(parts.flatMap(part=>part.latestCarrierSnapshotIds))].map(id=>views.get(id));
  const complete=latest.length>0&&latest.every(view=>view?.state==='complete'&&view.inferences?.complete);
  const types=new Set(latest.map(view=>view?.inferences?.taskType.value??'unknown'));
  if(complete&&types.size===1){row.taskType=[...types][0]!;row.taskEvidence=latest.flatMap(view=>view!.inferences!.taskType.citations).slice(0,3);}
  if(!complete)return;
  const selected=messages.filter(m=>m.context==='after-enrollment'&&m.sourceDate&&m.sourceDate>=scope.from&&m.sourceDate<=scope.to);
  const inputs=row.inputVersions.map(key=>views.get(key.snapshotId)!).filter(Boolean);
  const prompts=promptFactors(parts,inputs,selected,messages).prompts;
  if(latest.some(view=>view?.messageHistoryComplete!==true)||prompts.length!==row.userTurns||prompts.some(prompt=>prompt.first===null))return;
  const nonfirst=prompts.filter(prompt=>!prompt.first);
  if(nonfirst.some(prompt=>prompt.rework===null))return;
  row.rework=nonfirst.filter(prompt=>prompt.rework).length;
  row.reworkEvidence=nonfirst.filter(prompt=>prompt.rework).flatMap(prompt=>prompt.citations).slice(0,3);
}
export async function migrateSessionEfficiency(db:Database){await db.query('CREATE TABLE IF NOT EXISTS session_efficiency_revisions(version text PRIMARY KEY,request jsonb NOT NULL,payload jsonb NOT NULL)');}
export function sessionEfficiencyService(db:Database,usage:ReturnType<typeof usageOutputService>,insights:ReturnType<typeof sessionInsightsService>,raw:RawStore,clock:()=>Date=()=>new Date()){
  async function load(input:unknown,full=false):Promise<{q:EfficiencyQuery;value:SessionEfficiencyPage}>{
    const q=efficiencyQuerySchema.parse(input),request=selection(q);
    if(full&&(q.version||q.offset||q.sessionId||q.segmentOffset))throw new HttpError(400,'重算不能指定固定版本或分页');
    if(q.version){const row=(await db.query('SELECT request,payload FROM session_efficiency_revisions WHERE version=$1',[q.version])).rows[0];if(!row)throw new HttpError(404,'会话产效版本不存在');
      if(Object.keys(row.request).length!==Object.keys(request).length||Object.entries(request).some(([key,value])=>row.request[key]!==value))throw new HttpError(409,'会话产效版本与筛选不一致');return{q,value:row.payload};}
    const head=full?await usage.recompute(request):null,source=await usage.export({...request,...(head?{version:head.version}:{})});
    const grouped=new Map<string,UsageSession[]>();for(const row of source.sessions.filter(row=>row.selected&&row.sessions)){if(!grouped.has(row.sessionId))grouped.set(row.sessionId,[]);grouped.get(row.sessionId)!.push(row);}
    const sessions=[...grouped.values()].map(combine).sort((a,b)=>(b.dates.at(-1)??'').localeCompare(a.dates.at(-1)??'')||a.sessionId.localeCompare(b.sessionId)),tokenP75=quantile(sessions.flatMap(row=>row.tokens===null?[]:[row.tokens]),.75);
    const inputs=[...new Map(sessions.flatMap(row=>row.inputVersions).map(input=>[input.snapshotId+'/'+input.version,input])).values()];
    const views=new Map((await insights.readVersions(inputs)).map(view=>[view.snapshotId,view]));
    const messages=[...new Map((await insights.readMessageFacts([...views.values()])).flatMap(fact=>fact.messages).map(message=>[message.id,message])).values()],bySource=new Map<string,RecordedMessage[]>();
    for(const message of messages){const key=JSON.stringify([message.source,message.sourceSessionId]);if(!bySource.has(key))bySource.set(key,[]);bySource.get(key)!.push(message);}
    for(const row of sessions){const parts=grouped.get(row.sessionId)!,keys=[...new Set(parts.map(part=>JSON.stringify([part.source,part.sourceSessionId])))];
      applyInferences(row,parts,views,source.scope,keys.flatMap(key=>bySource.get(key)??[]));}
    const timingAsOf=await efficiencyTiming(db,raw,sessions,grouped,views,source.scope,q,full,clock);
    for(const row of sessions){if(row.tokens!==null&&tokenP75!==null&&row.tokens>tokenP75&&row.verified===0)row.reviewReasons.push('Token 高于 P75 且没有已验证结果');
      if(row.claimed!==null&&row.verified!==null&&row.claimed>row.verified)row.reviewReasons.push('声称多于已验证');
      if(row.rework!==null&&row.rework>=2)row.reviewReasons.push(`返工 ${row.rework} 次`);}
    const distributions=taskTypes.flatMap(taskType=>{const members=sessions.filter(row=>row.taskType===taskType);if(!members.length)return[];
      const values=members.flatMap(row=>taskType!=='unknown'&&row.efficiency.value!==null?[row.efficiency.value]:[]),points=new Map<number,number>();
      for(const value of values)points.set(value,(points.get(value)??0)+1);
      return[{taskType,count:values.length,unknownCount:members.length-values.length,median:quantile(values,.5),minimum:values.length?Math.min(...values):null,maximum:values.length?Math.max(...values):null,points:[...points].sort((a,b)=>a[0]-b[0]).map(([value,count])=>({value,count}))}];});
    const content={algorithmVersion,usageVersion:source.version,metricVersion:source.metricVersion,scope:source.scope,createdAt:source.createdAt,dataAsOf:timingAsOf&&timingAsOf>source.dataAsOf?timingAsOf:source.dataAsOf,
      total:sessions.length,reviewCount:sessions.filter(row=>row.reviewReasons.length).length,tokenP75,sessions,distributions,nextOffset:null,filteredTotal:sessions.length,definition};
    // PostgreSQL jsonb and a fresh projection can order object keys differently.
    // Their identical semantic content must retain the same public revision.
    const version=digest(JSON.stringify(content,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)
      ?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))):value)),value:SessionEfficiencyPage={version,...content};
    if(Buffer.byteLength(JSON.stringify(value))>16*1024*1024)throw new HttpError(413,'会话产效导出超过范围上限');
    await db.query('INSERT INTO session_efficiency_revisions(version,request,payload) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[version,request,value]);return{q,value};
  }
  async function read(input:unknown,full=false){const {q,value}=await load(input,full);let sessions=value.sessions.filter(row=>q.reviewOnly!=='true'||row.reviewReasons.length);
    const get=(row:EfficiencySession)=>q.sort==='date'?row.dates.at(-1)??'':q.sort==='prompts'?row.userTurns:q.sort==='code'?row.codeChanges:q.sort==='efficiency'?row.efficiency.value:row[q.sort];
    sessions=[...sessions].sort((a,b)=>{const x=get(a),y=get(b);if(x===null)return y===null?a.sessionId.localeCompare(b.sessionId):1;if(y===null)return-1;return(x<y?-1:x>y?1:0)*(q.direction==='asc'?1:-1)||a.sessionId.localeCompare(b.sessionId);});
    const selected=q.sessionId?value.sessions.filter(row=>row.sessionId===q.sessionId):sessions.slice(q.offset,q.offset+20);
    if(q.sessionId&&!selected.length)throw new HttpError(404,'该固定版本没有所选会话');
    const result={...value,sessions:selected.map(row=>{if(!row.timing)return row;const offset=q.sessionId?q.segmentOffset:0,limit=q.sessionId?20:5;
      return {...row,timing:{...row.timing,segments:row.timing.segments.slice(offset,offset+limit),segmentTotal:row.timing.segments.length,nextSegmentOffset:row.timing.segments.length>offset+limit?offset+limit:null}};}),
      filteredTotal:q.sessionId?1:sessions.length,nextOffset:!q.sessionId&&sessions.length>q.offset+20?q.offset+20:null};
    if(Buffer.byteLength(JSON.stringify(result))>80*1024)throw new HttpError(413,'会话产效响应超过范围上限，请缩小筛选');return result;}
  return{read,recompute:(input:unknown)=>read(input,true),export:async(input:unknown)=>(await load(input)).value};
}
