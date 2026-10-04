import {digest,type Database} from './database.js';
import {HttpError} from './identities.js';
import type {usageOutputService} from './usage-output.js';
import type {sessionInsightsService} from './session-insights.js';
import {promptReportQuerySchema,type PromptReport,type PromptReportQuery,type PromptFraction} from '../../packages/contracts/prompt-report.js';
import type {RecordedMessage} from '../../packages/contracts/message-facts.js';
import {promptFactors} from './prompt-factors.js';

const algorithmVersion='prompt-report-1';
const fraction=(numerator:number,denominator:number,unknown:number):PromptFraction=>({numerator,denominator,unknown,value:denominator?numerator/denominator:null});
const median=(values:number[])=>{const sorted=[...values].sort((a,b)=>a-b),n=sorted.length;return !n?null:n%2?sorted[Math.floor(n/2)]!:(sorted[n/2-1]!+sorted[n/2]!)/2;};
const selection=({version:_version,usageVersion:_usage,week:_week,...scope}:PromptReportQuery)=>scope;
export async function migratePromptReports(db:Database){await db.query('CREATE TABLE IF NOT EXISTS prompt_report_revisions(version text PRIMARY KEY,request jsonb NOT NULL,payload jsonb NOT NULL)');}
export function promptReportService(db:Database,usage:ReturnType<typeof usageOutputService>,insights:ReturnType<typeof sessionInsightsService>){
  async function compute(q:PromptReportQuery,full=false):Promise<PromptReport>{
    const scope=selection(q);
    const source=await usage.complete({...scope,...(q.usageVersion?{version:q.usageVersion,...(q.week?{week:q.week}:{})}:{})},{full});
    const rows=source.sessions.filter(row=>row.selected),keys=[...new Map(rows.flatMap(row=>row.insightVersions).map(key=>[key.version,key])).values()];
    const views=await insights.readVersions(keys),facts=await insights.readMessageFacts(views);
    const bySnapshot=new Map(facts.map(value=>[value.snapshotId,value])),messages=new Map<string,RecordedMessage>();
    for(const row of rows)for(const key of row.insightVersions)for(const message of bySnapshot.get(key.snapshotId)?.messages??[]){
      if(message.context!=='after-enrollment'||message.employeeId!==row.employeeId||message.project!==row.project||message.source!==row.source||message.sourceSessionId!==row.sourceSessionId
        ||!row.snapshotIds.includes(message.originalSnapshotId)||!message.sourceDate||message.sourceDate<source.scope.from||message.sourceDate>source.scope.to)continue;
      messages.set(message.id,message);
    }
    const prompts=[...messages.values()].filter(message=>message.role==='user'),known=prompts.map(prompt=>prompt.length),unknown=Math.max(0,source.totals.userTurns-prompts.length);
    const latest=new Set(rows.flatMap(row=>row.latestCarrierSnapshotIds)),sourceInputsComplete=unknown===0&&facts.filter(value=>latest.has(value.snapshotId)).every(value=>value.complete);
    const factors=promptFactors(rows,views,[...messages.values()],[...new Map(facts.flatMap(value=>value.messages).map(message=>[message.id,message])).values()]);
    const includeUnknown=(value:PromptFraction)=>({...value,unknown:value.unknown+unknown});
    const kpis={prompts:source.totals.userTurns,sessions:source.totals.sessions,medianLength:{value:sourceInputsComplete?median(known):null,knownMedian:median(known),knownCount:known.length,unknownCount:unknown},
      context:includeUnknown(factors.context),rework:includeUnknown(factors.rework(factors.prompts)),cleanSessions:factors.cleanSessions,clarification:includeUnknown(factors.clarification)};
    const bounds:[[number,number|null,string],...Array<[number,number|null,string]>]=[[0,15,'≤15 字'],[16,30,'16–30 字'],[31,60,'31–60 字'],[61,120,'61–120 字'],[121,null,'>120 字']];
    const lengths=bounds.map(([minimum,maximum,label])=>{const items=factors.prompts.filter(prompt=>prompt.length>=minimum&&(maximum===null||prompt.length<=maximum));return {label,minimum,maximum,count:items.length,rework:factors.rework(items)};});
    const content={algorithmVersion,usageVersion:source.version,createdAt:source.createdAt,dataAsOf:source.dataAsOf,scope:source.scope,kpis,lengths,
      employees:source.employees.map(row=>{const items=factors.prompts.filter(prompt=>prompt.employeeId===row.employeeId),elements=factors.elements(items),missing=Math.max(0,row.userTurns-items.length);for(const element of Object.values(elements))element.unknown+=missing;const taskMix=factors.taskMix(items);taskMix.find(item=>item.taskType==='unknown')!.prompts+=missing;return {employeeId:row.employeeId,employee:row.employee,prompts:row.userTurns,rework:{...factors.rework(items),unknown:factors.rework(items).unknown+missing},elements,taskMix};}),
      contextComparison:factors.contextComparison,examples:factors.examples,suggestions:factors.suggestions,projects:[...new Set(rows.map(row=>row.project))].sort(),
      sourceInputsComplete,unknownReasons:sourceInputsComplete?[]:['部分原件未完整解析，提示词范围可能不完整']};
    const version=digest(JSON.stringify(content)),report={version,...content};
    if(Buffer.byteLength(JSON.stringify(report))>80*1024)throw new HttpError(413,'提示词报表超过单次范围，请缩小筛选');
    await db.query('INSERT INTO prompt_report_revisions(version,request,payload) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[version,scope,report]);return report;
  }
  async function read(input:unknown,full=false):Promise<PromptReport>{const q=promptReportQuerySchema.parse(input);
    if(full&&(q.version||q.usageVersion))throw new HttpError(400,'重算不能指定旧版本');
    if(!q.version)return compute(q,full);
    const row=(await db.query('SELECT request,payload FROM prompt_report_revisions WHERE version=$1',[q.version])).rows[0];if(!row)throw new HttpError(404,'提示词报表版本不存在');
    if(q.week&&row.payload.scope.from!==q.week)throw new HttpError(409,'提示词版本与指定周不一致');
    const selected=selection(q);if(Object.keys(selected).length!==Object.keys(row.request).length||Object.entries(selected).some(([key,value])=>row.request[key]!==value))throw new HttpError(409,'提示词报表版本与范围不一致');
    if(q.usageVersion&&row.payload.usageVersion!==q.usageVersion)throw new HttpError(409,'提示词报表来源版本不一致');return row.payload;
  }
  return {read,recompute:(input:unknown)=>read(input,true)};
}
