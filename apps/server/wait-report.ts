import {digest,type Database} from './database.js';
import {HttpError} from './identities.js';
import type {waitsService} from './waits.js';
import type {ReplyWait,WaitsPage} from '../../packages/contracts/waits.js';
import {waitReportQuerySchema,type WaitReport,type WaitReportQuery,type WaitDistribution} from '../../packages/contracts/wait-report.js';

const algorithmVersion='wait-report-1';
const definition='只统计有可信结束与回复时间的完整等待区间；中位数取中间值（偶数取均值），P90取排序后第ceil(0.9×样本数)项。长等待为至少600秒。比例同时保留分子与已知样本分母，未知不补零。热力图按等待起点的北京时间星期与小时归组，跨日区间只出现一次；按日时长另见等待记录。并行只表示其他会话来源事件。等待不等于怠工，不用于考勤；权限建议仅供审阅，不修改宿主权限。';
const fraction=(numerator:number,denominator:number)=>({numerator,denominator,value:denominator?numerator/denominator:null});
export function waitDistribution(values:number[]):WaitDistribution {
  const sorted=[...values].sort((a,b)=>a-b),n=sorted.length;
  const quantile=(q:number)=>{if(!n)return null;const position=(n-1)*q,lo=Math.floor(position);return sorted[lo]!+(sorted[Math.ceil(position)]!-sorted[lo]!)*(position-lo);};
  return {count:n,minimumMs:sorted[0]??null,q1Ms:quantile(.25),medianMs:quantile(.5),q3Ms:quantile(.75),maximumMs:sorted.at(-1)??null,p90Ms:n?sorted[Math.ceil(n*.9)-1]!:null};
}
export function summarizeWaits(input:WaitsPage):Omit<WaitReport,'version'> {
  const known=input.intervals.filter(row=>row.durationMs!==null),overall=waitDistribution(known.map(row=>row.durationMs!));
  const parallel=(rows:ReplyWait[])=>{const observed=rows.filter(row=>row.parallel!=='unknown');return fraction(observed.filter(row=>row.parallel==='observed').length,observed.length);};
  const people=new Map<string,{employee:string;rows:ReplyWait[]}>(),bins=Array.from({length:168},()=>[] as number[]);
  for(const row of input.intervals){if(!people.has(row.employeeId))people.set(row.employeeId,{employee:row.employee,rows:[]});people.get(row.employeeId)!.rows.push(row);
    if(row.durationMs!==null&&row.startedAt){const local=new Date(Date.parse(row.startedAt)+8*3600000),weekday=(local.getUTCDay()+6)%7;bins[weekday*24+local.getUTCHours()]!.push(row.durationMs);}}
  return {algorithmVersion,waitVersion:input.version,scope:input.scope,createdAt:input.createdAt,dataAsOf:input.dataAsOf,
    summary:{medianMs:overall.medianMs,p90Ms:overall.p90Ms,knownCount:known.length,unknownCount:input.intervals.length-known.length,
      longFraction:fraction(known.filter(row=>row.long).length,known.length),parallelFraction:parallel(input.intervals),permissionMedianMs:null},
    heatmap:bins.map((values,index)=>({weekday:Math.floor(index/24),hour:index%24,count:values.length,medianMs:waitDistribution(values).medianMs})),
    people:[...people.entries()].map(([employeeId,{employee,rows}])=>({employeeId,employee,unknownCount:rows.filter(row=>row.durationMs===null).length,
      ...waitDistribution(rows.filter(row=>row.durationMs!==null).map(row=>row.durationMs!)),parallelFraction:parallel(rows)})).sort((a,b)=>a.employee.localeCompare(b.employee,'zh-CN')||a.employeeId.localeCompare(b.employeeId)),
    permissions:{state:'unknown',requests:[],suggestions:[],reason:'来源尚未提供可配对的权限请求与批准或拒绝记录'},unknownReasons:input.unknownReasons,definition};
}
export async function migrateWaitReports(db:Database){await db.query('CREATE TABLE IF NOT EXISTS wait_report_revisions(version text PRIMARY KEY,payload jsonb NOT NULL)');}
export function waitReportService(db:Database,waits:ReturnType<typeof waitsService>){
  const selection=(q:WaitReportQuery)=>({period:q.period,...(q.employeeId?{employeeId:q.employeeId}:{}),...(q.source?{source:q.source}:{}),...(q.project!==undefined?{project:q.project}:{})});
  async function read(input:unknown,range?:{from:string;to:string},full=false):Promise<WaitReport>{
    const q=waitReportQuerySchema.parse(input);
    if(q.version){const row=(await db.query('SELECT payload FROM wait_report_revisions WHERE version=$1',[q.version])).rows[0];if(!row)throw new HttpError(404,'等待报表版本不存在');
      const value:WaitReport=row.payload;if(q.week&&value.scope.from!==q.week)throw new HttpError(400,'等待报表版本与指定周不一致');for(const key of ['period','employeeId','source','project'] as const)if(value.scope[key]!==selection(q)[key])throw new HttpError(400,'等待报表版本不属于当前范围');
      if(q.waitVersion&&q.waitVersion!==value.waitVersion)throw new HttpError(400,'等待来源版本不匹配');return value;}
    const source=range?await waits.forScope(selection(q),range,full):await waits.complete({...selection(q),...(q.waitVersion?{version:q.waitVersion,...(q.week?{week:q.week}:{})}:{})},{full}),content=summarizeWaits(source);
    const version=digest(JSON.stringify(content,(_,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))):value)),value:WaitReport={version,...content};
    if(Buffer.byteLength(JSON.stringify(value))>80*1024)throw new HttpError(413,'等待报表范围过大，请缩小员工范围');
    await db.query('INSERT INTO wait_report_revisions(version,payload) VALUES($1,$2) ON CONFLICT DO NOTHING',[version,value]);return value;
  }
  return {read,forScope:(input:unknown,range:{from:string;to:string},full=false)=>read(input,range,full)};
}
