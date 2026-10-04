import {coverageService,coverageFrontier} from './team-coverage.js';
import {digest,type Database} from './database.js';
import {HttpError} from './identities.js';
import type {usageOutputService} from './usage-output.js';
import type {promptReportService} from './prompt-report.js';
import type {waitReportService} from './wait-report.js';
import type {capabilityPeopleService} from './capability-people.js';
import {consistentReportingInputs} from './reporting-frontier.js';
import {fixedTeamReportQuerySchema,teamWeeklyQuerySchema,type TeamReport,type TeamReportQuery} from '../../packages/contracts/team-report.js';
import type {MetricTotals} from '../../packages/contracts/metrics.js';
import type {OutputTotals} from '../../packages/contracts/usage-output.js';
import {addDays} from '../../packages/contracts/work-views.js';

const scope=({version:_v,coverageOffset:_offset,...rest}:TeamReportQuery)=>rest;
const emptyTotals=():MetricTotals=>({sessions:0,userTurns:0,toolCalls:0,inputTokens:0,outputTokens:0,knownInputTokens:0,knownOutputTokens:0,unknownTokenSessions:0,unknownInputSessions:0,unknownOutputSessions:0});
const emptyOutputs=():OutputTotals=>Object.fromEntries(['verified','claimed','codeChanges','tests','commits'].map(kind=>[kind,{value:0,known:0,unknownSessions:0,added:0,removed:0,passed:0,failed:0}])) as OutputTotals;
const canonical=(value:unknown):string=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
export async function migrateTeamReports(db:Database){await db.query('CREATE TABLE IF NOT EXISTS team_report_revisions(version text PRIMARY KEY,request jsonb NOT NULL,payload jsonb NOT NULL)');}
export function teamReportService(db:Database,usage:ReturnType<typeof usageOutputService>,prompts:ReturnType<typeof promptReportService>,waits:ReturnType<typeof waitReportService>,capabilities:ReturnType<typeof capabilityPeopleService>,clock:()=>Date=()=>new Date()){
  // Persist one complete input version; page only its coverage viewport, never
  // independently recompute a date window against newer source material.
  function page(value:TeamReport,offset=0):TeamReport{
    const total=value.coverage.dates.length;if(offset>=total&&offset>0)throw new HttpError(400,'覆盖日期分页超出范围');
    const end=total-offset,dates=value.coverage.dates.slice(Math.max(0,end-7),end),selected=new Set(dates);
    const result={...value,coverage:{...value.coverage,selectedDate:dates.at(-1)??value.coverage.selectedDate,dates,
      dateOffset:offset,totalDates:total,nextDateOffset:offset+7<total?offset+7:null,
      rows:value.coverage.rows.map(row=>({...row,cells:row.cells.filter(cell=>selected.has(cell.date))}))},
      people:value.people.map(person=>({...person,daily:person.daily.filter(day=>selected.has(day.date))}))};
    if(Buffer.byteLength(JSON.stringify(result))>80*1024)throw new HttpError(413,'团队视图范围过大，请缩小筛选');return result;
  }
  async function compute(q:TeamReportQuery,full=false):Promise<TeamReport>{const query=scope(q);if(full&&q.version)throw new HttpError(400,'重算不能指定旧版本');
    if(q.version){const row=(await db.query('SELECT request,payload FROM team_report_revisions WHERE version=$1',[q.version])).rows[0];if(!row)throw new HttpError(404,'团队视图版本不存在');if(canonical(row.request)!==canonical(query))throw new HttpError(409,'团队视图版本与范围不一致');return row.payload;}
    const fixed=await consistentReportingInputs(db,clock,async()=>{
      const {week,...selection}=query;
      const head=full&&!week?await usage.recompute(selection):null;
      const source=week?await usage.readWeek(week,{employeeId:q.employeeId,source:q.source,project:q.project},full):await usage.export({...selection,...(head?{version:head.version}:{})}),prompt=await prompts.read({...query,usageVersion:source.version}),wait=await waits.forScope(selection,source.scope,full);
      const people=(await db.query('SELECT id,name FROM employees WHERE ($1::uuid IS NULL OR id=$1) ORDER BY name,id',[q.employeeId??null])).rows;
      const coverage=await coverageService(db,clock).matrix(source.scope.to,0,source.scope,1000);if(coverage.nextOffset!==null)throw new HttpError(413,'团队员工范围过大');
      // Activity filters never redefine the since-enrollment capability model.
      // Freeze one complete directory, then project selected employees from it.
      const capability=week?undefined:await capabilities.export({period:'since-enrollment',preset:'默认'},full);
      return {source,prompt,wait,people,coverage,capability};
    },client=>coverageFrontier(client,clock));
    const {source,prompt,wait}=fixed;
    const dates:string[]=[];for(let date=source.scope.from;date<=source.scope.to;date=addDays(date,1)){if(dates.length>=3660)throw new HttpError(413,'团队日期范围过长');dates.push(date);}
    const daily=dates.map(date=>({...source.daily.find(day=>day.date===date)??{date,activeSessions:0,inputTokens:null,outputTokens:null,includedSessions:0,excludedSessions:0,userTurns:0,toolCalls:0,knownInputTokens:0,unknownInputSessions:0},outputs:source.dailyOutputs?.find(day=>day.date===date)?.outputs??emptyOutputs()}));
    const people=fixed.people.map(person=>{const row=source.employees.find(item=>item.employeeId===person.id),p=prompt.employees.find(item=>item.employeeId===person.id),w=wait.people.find(item=>item.employeeId===person.id);
      const cells=fixed.coverage.rows.find(row=>row.employeeId===person.id)?.cells??[],coverage:typeof cells[number]['collection']=cells.some(cell=>cell.collection==='gap-observed')?'gap-observed':cells.some(cell=>cell.collection==='observations-only')?'observations-only':'unknown';
      const card=fixed.capability?.employees.find(item=>item.employeeId===person.id);
      const capability=card?{level:card.level,index:card.index,confidence:card.confidence,reason:card.reason,coverageIssues:card.coverageIssues,assessmentVersion:card.assessmentVersion,profilePath:card.profilePath}:undefined;
      return {coverage,...(capability?{capability}:{}),employeeId:person.id as string,employee:person.name as string,totals:row?Object.fromEntries(Object.keys(emptyTotals()).map(key=>[key,row[key as keyof MetricTotals]])) as MetricTotals:emptyTotals(),outputs:row?.outputs??emptyOutputs(),
        prompts:{prompts:p?.prompts??0,rework:p?.rework??{numerator:0,denominator:0,unknown:0,value:null}},waits:{medianMs:w?.medianMs??null,knownCount:w?.count??0,unknownCount:w?.unknownCount??0},daily:dates.map(date=>row?.daily.find(day=>day.date===date)??{date,activeSessions:0,inputTokens:null,outputTokens:null,includedSessions:0,excludedSessions:0,userTurns:0,toolCalls:0,knownInputTokens:0,unknownInputSessions:0})};}).sort((a,b)=>a.employee.localeCompare(b.employee,'zh-CN')||a.employeeId.localeCompare(b.employeeId));
    const link=(api:string,web:string,version:string)=>{const args=new URLSearchParams({...query,version});return {api:api+'?'+args,web:web+'?'+args};};
    const content={algorithmVersion:'team-report-2',coverage:fixed.coverage,frontierVersion:fixed.frontierVersion,dataAsOf:source.dataAsOf,scope:source.scope,
      ...(fixed.capability?{capability:{version:fixed.capability.version,selection:fixed.capability.selection}}:{}),
      usageVersion:source.version,promptVersion:prompt.version,waitReportVersion:wait.version,activeEmployees:{active:people.filter(person=>person.totals.sessions>0).length,total:people.length},
      totals:source.totals,outputs:source.outputs,prompts:prompt.kpis,waits:wait.summary,daily,people,
      links:{usage:link('/api/usage-output','#metrics',source.version),prompts:link('/api/prompt-report','#prompts',prompt.version),waits:{...link('/api/wait-report','#waits',wait.version),web:link('/api/waits','#waits',wait.waitVersion).web}},
      projects:prompt.projects,sourceInputsComplete:source.sourceInputsComplete&&prompt.sourceInputsComplete,unknownReasons:[...new Set([...source.unknownReasons,...prompt.unknownReasons,...wait.unknownReasons])].sort()};
    const version=digest(canonical({...content,coverage:{...content.coverage,checkedAt:undefined}})),old=(await db.query('SELECT payload FROM team_report_revisions WHERE version=$1',[version])).rows[0];if(old)return old.payload;
    const result={version,createdAt:clock().toISOString(),...content};if(Buffer.byteLength(JSON.stringify(result))>16*1024*1024)throw new HttpError(413,'团队视图范围过大，请缩小筛选');
    await db.query('INSERT INTO team_report_revisions(version,request,payload) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[version,query,result]);return result;
  }
  async function read(q:TeamReportQuery,full=false){return page(await compute(q,full),q.coverageOffset);}
  return {read:(input:unknown)=>read(fixedTeamReportQuerySchema.parse(input)),recompute:(input:unknown)=>read(fixedTeamReportQuerySchema.parse(input),true),weeklyRecompute:(input:unknown)=>read({period:'this-week',...teamWeeklyQuerySchema.parse(input)},true),weekly:(input:unknown)=>read({period:'this-week',...teamWeeklyQuerySchema.parse(input)})};
}
