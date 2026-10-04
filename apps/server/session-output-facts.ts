import type { AnalysisInput } from './analysis.js';
import { insightCitations } from './analysis-insights.js';
import type { SessionInsights, RecordedFact } from '../../packages/contracts/session-insights.js';

export const outputFactsVersion='recorded-output-2';
type Call={id:string;name:string;args:Record<string,unknown>|null;text:string;event:number};
type Result={id:string;text:string;event:number;error:boolean};
const lines=(text:string)=>text===''?0:text.replace(/\r\n/g,'\n').replace(/\n$/,'').split('\n').length;
const object=(value:unknown):Record<string,unknown>|null=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;
const asText=(value:unknown):string|null=>typeof value==='string'?value:null;
function args(text:string){try{return object(JSON.parse(text));}catch{return null;}}
function testSummary(raw:string):{total:number;passed:number;failed:number}|null{
  const text=raw.replace(/\x1b\[[0-9;]*m/g,'');
  if([...text.matchAll(/^# tests \d+\r?$/gm)].length>1||[...text.matchAll(/^Tests:\s+/gm)].length>1||[...text.matchAll(/^\s*Tests\s+[^\r\n]+\(\d+\)\s*$/gm)].length>1)return null;
  const total=/^# tests (\d+)\r?$/m.exec(text),passed=/^# pass (\d+)\r?$/m.exec(text),failed=/^# fail (\d+)\r?$/m.exec(text);
  let result:{total:number;passed:number;failed:number}|null=null;
  if(total&&passed&&failed)result={total:Number(total[1]),passed:Number(passed[1]),failed:Number(failed[1])};
  else{
    const jest=/^Tests:\s+([^\r\n]+)$/m.exec(text)?.[1];
    const vitest=/^\s*Tests\s+([^\r\n]+)\((\d+)\)\s*$/m.exec(text);
    const pytest=/^(?:=+\s*)?((?:\d+ (?:passed|failed|skipped|xfailed|xpassed|errors?|deselected|warnings?)(?:, )?)+) in \d+(?:\.\d+)?s(?:\s*=+)?\s*$/m.exec(text)?.[1];
    const counts=(summary:string)=>Object.fromEntries([...summary.matchAll(/(\d+) (passed|failed|skipped|xfailed|xpassed|errors?|total)/g)].map(match=>[match[2]!,Number(match[1])]));
    if(jest){const values=counts(jest);if(values.total!==undefined)result={total:values.total,passed:values.passed??0,failed:values.failed??0};}
    else if(vitest){const values=counts(vitest[1]!);result={total:Number(vitest[2]),passed:values.passed??0,failed:values.failed??0};}
    else if(pytest){const values=counts(pytest);result={total:Object.values(values).reduce((sum,value)=>sum+value,0),passed:values.passed??0,failed:(values.failed??0)+(values.error??0)+(values.errors??0)};}
  }
  return result&&Object.values(result).every(value=>Number.isSafeInteger(value)&&value>=0)&&result.passed+result.failed<=result.total?result:null;
}

// Only native tool envelopes are inspected. User/assistant prose is never an output counter.
export function recordedOutputFacts(bytes:Buffer,input:AnalysisInput):SessionInsights['facts'] {
  const supported=input.source==='claude-code-cli'?input.sourceVersion==='2.1.281':input.source==='codex-cli'&&['0.157.1','0.160.0'].includes(input.sourceVersion);
  const complete=supported&&!input.coverage.unrecognizedLines&&!input.coverage.partialLine&&!input.coverage.excludedMaterials&&!input.coverage.captureGaps.length&&input.events.every(event=>event.context==='after-enrollment'||event.context==='historical');
  const unknown=():RecordedFact=>({value:complete?0:null,complete,evidence:[],contributions:[],scope:'after-enrollment'});
  const facts={codeChanges:unknown(),tests:unknown(),commits:unknown()};
  if(!supported)return facts;
  const calls:Call[]=[],results:Result[]=[];
  const eventAt=new Map(input.events.map((event,index)=>[`${event.line}/${event.block??0}`,index]));
  for(const [index,line]of bytes.toString('utf8').split('\n').slice(0,-1).entries()){
    let row:any;try{row=JSON.parse(line);}catch{continue;}
    if(row.type==='response_item'){
      const p=row.payload,event=eventAt.get(`${index+1}/0`);if(event===undefined||!p)continue;
      if(['function_call','custom_tool_call'].includes(p.type)&&typeof p.call_id==='string')calls.push({id:p.call_id,name:p.name,args:p.type==='function_call'?args(p.arguments):null,text:p.type==='custom_tool_call'?p.input:p.arguments,event});
      if(['function_call_output','custom_tool_call_output'].includes(p.type)&&typeof p.call_id==='string'&&typeof p.output==='string')results.push({id:p.call_id,text:p.output,event,error:false});
    }
    if(['user','assistant'].includes(row.type)&&Array.isArray(row.message?.content))for(const [block,p]of row.message.content.entries()){
      const event=eventAt.get(`${index+1}/${block}`);if(event===undefined)continue;
      if(p.type==='tool_use')calls.push({id:p.id,name:p.name,args:object(p.input),text:JSON.stringify(p.input),event});
      if(p.type==='tool_result'&&typeof p.content==='string')results.push({id:p.tool_use_id,text:p.content,event,error:p.is_error===true});
    }
  }
  const callCount=new Map<string,number>(),resultCount=new Map<string,number>();
  for(const call of calls)callCount.set(call.id,(callCount.get(call.id)??0)+1);
  for(const result of results)resultCount.set(result.id,(resultCount.get(result.id)??0)+1);
  const seen=new Set<string>();
  const citation=(event:number)=>insightCitations(input,[{event,textOffset:0,quote:input.events[event]!.text.slice(0,512)}])[0]!;
  const add=(fact:RecordedFact,value:number,call:Call,result:Result,extra:{added?:number;removed?:number;passed?:number;failed?:number}={})=>{
    fact.value=(fact.value??0)+value;
    fact.evidence.push(citation(call.event),citation(result.event));
    const origin=input.events[call.event]!.origin!;
    fact.contributions.push({eventId:origin.eventId,employeeId:origin.employeeId,sourceDate:origin.sourceDate,snapshotId:origin.snapshotId,value,...extra});
  };
  const uncertain=new Set<keyof typeof facts>();
  for(const call of calls){
    const origin=input.events[call.event]!.origin;const identity=origin?.eventId??`${input.snapshotId}/${call.event}`;
    if(seen.has(identity))continue;seen.add(identity);
    if(input.events[call.event]!.context==='historical')continue;
    const result=callCount.get(call.id)===1&&resultCount.get(call.id)===1?results.find(r=>r.id===call.id):undefined;
    const name=call.name?.split('.').at(-1);
    if(!['apply_patch','Edit','Write','Read','exec_command','shell','shell_command','Bash'].includes(name??'')){
      uncertain.add('codeChanges');uncertain.add('tests');uncertain.add('commits');continue;
    }
    const execution=['exec_command','shell','shell_command','Bash'].includes(name??'');
    const command=asText(call.args?.cmd)??asText(call.args?.command);
    const code=['apply_patch','Edit','Write'].includes(name??'');
    const test=execution&&command!==null&&/^(?:node --test\b|npm (?:run )?test\b|npx (?:vitest|jest)\b|pytest\b|python -m pytest\b)/.test(command.trim());
    const commit=execution&&command!==null&&/^git commit(?:\s|$)/.test(command.trim());
    if(!origin||input.events[call.event]!.context!=='after-enrollment'||!result||result.event<=call.event||input.events[result.event]!.context!=='after-enrollment'||input.events[result.event]!.origin?.employeeId!==origin.employeeId){if(code)uncertain.add('codeChanges');if(test)uncertain.add('tests');if(commit)uncertain.add('commits');continue;}
    if(code){
      let added:number|undefined,removed:number|undefined;
      if(name==='apply_patch'&&!result.error&&/^Success\. Updated the following files:/m.test(result.text)&&call.text.startsWith('*** Begin Patch\n')&&/\n\*\*\* End Patch\n?$/.test(call.text)){
        const patch=call.text.split('\n');added=patch.filter(line=>line.startsWith('+')).length;removed=patch.filter(line=>line.startsWith('-')).length;
        // Delete File omits old bytes; those deleted lines are unknowable from this command.
        if(patch.some(line=>line.startsWith('*** Delete File:')))uncertain.add('codeChanges');
      }else if(name==='Edit'&&!result.error&&typeof call.args?.old_string==='string'&&typeof call.args.new_string==='string'&&call.args.replace_all!==true&&/successfully|has been updated/i.test(result.text)){
        added=lines(call.args.new_string);removed=lines(call.args.old_string);
      }else if(name==='Write'&&!result.error&&typeof call.args?.content==='string'&&/^File created successfully at:/i.test(result.text)){
        added=lines(call.args.content);removed=0;
      }else uncertain.add('codeChanges');
      if(added!==undefined&&removed!==undefined&&(!uncertain.has('codeChanges')||added+removed>0)){add(facts.codeChanges,added+removed,call,result,{added,removed});facts.codeChanges.added=(facts.codeChanges.added??0)+added;facts.codeChanges.removed=(facts.codeChanges.removed??0)+removed;}
    }
    if(test){
      const summary=testSummary(result.text);
      if(summary){
        add(facts.tests,summary.total,call,result,{passed:summary.passed,failed:summary.failed});facts.tests.passed=(facts.tests.passed??0)+summary.passed;facts.tests.failed=(facts.tests.failed??0)+summary.failed;
      }else uncertain.add('tests');
    }
    if(commit){
      if(!result.error&&!/[\r\n;&|]/.test(command!)&&[...result.text.matchAll(/^\[[^\]\r\n]+ [0-9a-f]{7,40}\] .+/gm)].length===1)add(facts.commits,1,call,result);
      else uncertain.add('commits');
    }
  }
  for(const key of uncertain){facts[key].complete=false;if(!facts[key].contributions.length)facts[key].value=null;}
  // Bound public evidence separately from counts; incomplete evidence is explicit.
  for(const fact of Object.values(facts))if(fact.evidence.length>24){fact.evidence=fact.evidence.slice(0,24);fact.complete=false;}
  return facts;
}
