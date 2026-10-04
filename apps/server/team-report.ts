import {digest,type Database} from './database.js';
import {HttpError} from './identities.js';
import type {usageOutputService} from './usage-output.js';
import type {promptReportService} from './prompt-report.js';
import type {waitReportService} from './wait-report.js';
import {consistentReportingInputs} from './reporting-frontier.js';
import {fixedTeamReportQuerySchema,teamWeeklyQuerySchema,type TeamReport,type TeamReportQuery} from '../../packages/contracts/team-report.js';
import type {MetricTotals} from '../../packages/contracts/metrics.js';
import type {OutputTotals} from '../../packages/contracts/usage-output.js';
import {addDays} from '../../packages/contracts/work-views.js';

const scope=({version:_v,...rest}:TeamReportQuery)=>rest;
const emptyTotals=():MetricTotals=>({sessions:0,userTurns:0,toolCalls:0,inputTokens:0,outputTokens:0,knownInputTokens:0,knownOutputTokens:0,unknownTokenSessions:0,unknownInputSessions:0,unknownOutputSessions:0});
const emptyOutputs=():OutputTotals=>Object.fromEntries(['verified','claimed','codeChanges','tests','commits'].map(kind=>[kind,{value:0,known:0,unknownSessions:0,added:0,removed:0,passed:0,failed:0}])) as OutputTotals;
const canonical=(value:unknown):string=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
export async function migrateTeamReports(db:Database){await db.query('CREATE TABLE IF NOT EXISTS team_report_revisions(version text PRIMARY KEY,request jsonb NOT NULL,payload jsonb NOT NULL)');}
export function teamReportService(db:Database,usage:ReturnType<typeof usageOutputService>,prompts:ReturnType<typeof promptReportService>,waits:ReturnType<typeof waitReportService>,clock:()=>Date=()=>new Date()){
  async function compute(q:TeamReportQuery):Promise<TeamReport>{const query=scope(q);
    if(q.version){const row=(await db.query('SELECT request,payload FROM team_report_revisions WHERE version=$1',[q.version])).rows[0];if(!row)throw new HttpError(404,'团队视图版本不存在');if(canonical(row.request)!==canonical(query))throw new HttpError(409,'团队视图版本与范围不一致');return row.payload;}
    const fixed=await consistentReportingInputs(db,clock,async()=>{
      const {week,...selection}=query;
      const source=week?await usage.readWeek(week,{employeeId:q.employeeId,source:q.source,project:q.project}):await usage.export(selection),prompt=await prompts.read({...query,usageVersion:source.version}),wait=await waits.forScope(selection,source.scope);
      const people=(await db.query('SELECT id,name FROM employees WHERE ($1::uuid IS NULL OR id=$1) ORDER BY name,id',[q.employeeId??null])).rows;
      return {source,prompt,wait,people};
    });
    const {source,prompt,wait}=fixed;
    const dates:string[]=[];for(let date=source.scope.from;date<=source.scope.to;date=addDays(date,1)){if(dates.length>=3660)throw new HttpError(413,'团队日期范围过长');dates.push(date);}
    const daily=dates.map(date=>source.daily.find(day=>day.date===date)??{date,activeSessions:0,inputTokens:0,outputTokens:0,includedSessions:0,excludedSessions:0});
    const people=fixed.people.map(person=>{const row=source.employees.find(item=>item.employeeId===person.id),p=prompt.employees.find(item=>item.employeeId===person.id),w=wait.people.find(item=>item.employeeId===person.id);
      return {employeeId:person.id as string,employee:person.name as string,totals:row?Object.fromEntries(Object.keys(emptyTotals()).map(key=>[key,row[key as keyof MetricTotals]])) as MetricTotals:emptyTotals(),outputs:row?.outputs??emptyOutputs(),
        prompts:{prompts:p?.prompts??0,rework:p?.rework??{numerator:0,denominator:0,unknown:0,value:null}},waits:{medianMs:w?.medianMs??null,knownCount:w?.count??0,unknownCount:w?.unknownCount??0},daily:dates.map(date=>row?.daily.find(day=>day.date===date)??{date,activeSessions:0,inputTokens:0,outputTokens:0,includedSessions:0,excludedSessions:0})};}).sort((a,b)=>a.employee.localeCompare(b.employee,'zh-CN')||a.employeeId.localeCompare(b.employeeId));
    const link=(api:string,web:string,version:string)=>{const args=new URLSearchParams({...query,version});return {api:api+'?'+args,web:web+'?'+args};};
    const content={algorithmVersion:'team-report-1',frontierVersion:fixed.frontierVersion,dataAsOf:source.dataAsOf,scope:source.scope,
      usageVersion:source.version,promptVersion:prompt.version,waitReportVersion:wait.version,activeEmployees:{active:people.filter(person=>person.totals.sessions>0).length,total:people.length},
      totals:source.totals,outputs:source.outputs,prompts:prompt.kpis,waits:wait.summary,daily,people,
      links:{usage:link('/api/usage-output','#metrics',source.version),prompts:link('/api/prompt-report','#prompts',prompt.version),waits:{...link('/api/wait-report','#waits',wait.version),web:link('/api/waits','#waits',wait.waitVersion).web}},
      projects:prompt.projects,sourceInputsComplete:source.sourceInputsComplete&&prompt.sourceInputsComplete,unknownReasons:[...new Set([...source.unknownReasons,...prompt.unknownReasons,...wait.unknownReasons])].sort()};
    const version=digest(canonical(content)),old=(await db.query('SELECT payload FROM team_report_revisions WHERE version=$1',[version])).rows[0];if(old)return old.payload;
    const result={version,createdAt:clock().toISOString(),...content};if(Buffer.byteLength(JSON.stringify(result))>80*1024)throw new HttpError(413,'团队视图范围过大，请缩小筛选');
    await db.query('INSERT INTO team_report_revisions(version,request,payload) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[version,query,result]);return result;
  }
  return {read:(input:unknown)=>compute(fixedTeamReportQuerySchema.parse(input)),weekly:(input:unknown)=>compute({period:'this-week',...teamWeeklyQuerySchema.parse(input)})};
}
