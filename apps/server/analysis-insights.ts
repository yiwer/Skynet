import { analysisInsightsSchema, type InsightOutput, type SessionInferences, type InsightCitation } from '../../packages/contracts/session-insights.js';
import { validateAnalysis, type AnalysisInput } from './analysis.js';
import { conversationContext } from './conversation-trace.js';

export function insightCitations(input:AnalysisInput, citations:InsightOutput['taskType']['citations']):InsightCitation[] {
  if (!citations.length) return [];
  return validateAnalysis(input,{items:[{category:'activity',assessment:'inferred',text:'引用',citations}]})[0]!.citations;
}
export function validateInsights(input:AnalysisInput, value:unknown):SessionInferences {
  const output=analysisInsightsSchema.parse(value);
  if(output.taskType.value!=='unknown'&&!output.taskType.citations.length)throw new Error('Uncited task type');
  const users=input.events.flatMap((event,index)=>event.role==='user'&&!conversationContext(event)?[index]:[]);
  const assistants=input.events.flatMap((event,index)=>event.role==='assistant'?[index]:[]);
  const promptIds=new Set<number>(),replyIds=new Set<number>();
  const prompts=output.prompts.map(prompt=>{
    if(!users.includes(prompt.event)||promptIds.has(prompt.event)||!prompt.citations.some(c=>c.event===prompt.event))throw new Error('Prompt must cite its unique genuine user message');
    promptIds.add(prompt.event);
    return {...prompt,citations:insightCitations(input,prompt.citations),length:Array.from(input.events[prompt.event]!.text).length,first:prompt.event===users[0],complete:true};
  });
  const replies=output.replies.map(reply=>{
    if(!assistants.includes(reply.event)||replyIds.has(reply.event)||!reply.citations.some(c=>c.event===reply.event))throw new Error('Clarification must cite its unique assistant message');
    replyIds.add(reply.event);return {...reply,citations:insightCitations(input,reply.citations),complete:true};
  });
  const outcomes=output.outcomes.map(item=>{
    const citations=insightCitations(input,item.citations);
    let status=item.status;
    if(status==='verified'&&!(citations.length===1&&citations[0]!.role==='tool result'&&item.text===citations[0]!.quote))status=citations.every(c=>['user','assistant'].includes(c.role))?'claimed':'inferred';
    if(status==='claimed'&&!citations.every(c=>['user','assistant'].includes(c.role)))status='inferred';
    return {...item,status,citations,classificationAdjusted:status!==item.status};
  });
  const result:SessionInferences={version:output.version,complete:promptIds.size===users.length&&replyIds.size===assistants.length,
    taskType:{...output.taskType,citations:insightCitations(input,output.taskType.citations)},prompts,replies,outcomes,
    suggestions:output.suggestions.map(item=>({...item,citations:insightCitations(input,item.citations)}))};
  if(Buffer.byteLength(JSON.stringify(result))>60*1024)throw new Error('Session inferences exceed bounded result');
  return result;
}

export function mergeInsights(input:AnalysisInput,parts:SessionInferences[],allStages:boolean):SessionInferences|undefined{
  if(!parts.length)return undefined;
  const uniqueCitations=(citations:InsightCitation[])=>[...new Map(citations.map(c=>[JSON.stringify([c.event,c.textOffset,c.quote]),c])).values()].slice(0,3);
  const mergeBoolean=(values:(boolean|null)[])=>values.every(value=>value===values[0])?values[0]!:null;
  const prompts:SessionInferences['prompts']=[];
  for(const event of [...new Set(parts.flatMap(part=>part.prompts.map(prompt=>prompt.event)))].sort((a,b)=>a-b)){
    const records=parts.flatMap(part=>part.prompts.filter(prompt=>prompt.event===event));const first=records[0]!;
    const complete=records.some(record=>record.complete);
    const elements={...first.elements};
    for(const key of Object.keys(elements) as (keyof typeof elements)[])elements[key]=complete?mergeBoolean(records.map(record=>record.elements[key])):records.some(record=>record.elements[key]===true)?true:null;
    prompts.push({...first,elements,rework:complete?mergeBoolean(records.map(record=>record.rework)):null,complete,citations:uniqueCitations(records.flatMap(record=>record.citations))});
  }
  const replies:SessionInferences['replies']=[];
  for(const event of [...new Set(parts.flatMap(part=>part.replies.map(reply=>reply.event)))].sort((a,b)=>a-b)){
    const records=parts.flatMap(part=>part.replies.filter(reply=>reply.event===event)),first=records[0]!;
    const complete=records.some(record=>record.complete);
    replies.push({...first,complete,clarification:complete?mergeBoolean(records.map(record=>record.clarification)):null,citations:uniqueCitations(records.flatMap(record=>record.citations))});
  }
  const tasks=parts.map(part=>part.taskType).filter(task=>task.value!=='unknown');
  const taskType={value:tasks.length&&tasks.every(task=>task.value===tasks[0]!.value)?tasks[0]!.value:'unknown' as const,citations:uniqueCitations(tasks.flatMap(task=>task.citations))};
  const identity=(item:{text:string;citations:InsightCitation[]})=>JSON.stringify([item.text,item.citations.map(c=>[c.event,c.textOffset,c.quote])]);
  const outcomes=[...new Map(parts.flatMap(part=>part.outcomes).map(item=>[identity(item),item])).values()];
  const suggestions=[...new Map(parts.flatMap(part=>part.suggestions).map(item=>[identity(item),item])).values()].slice(0,4);
  const userCount=input.events.filter(event=>event.role==='user'&&!conversationContext(event)).length;
  const assistantCount=input.events.filter(event=>event.role==='assistant').length;
  const complete=allStages&&prompts.length===userCount&&replies.length===assistantCount&&prompts.every(prompt=>prompt.complete)&&replies.every(reply=>reply.complete);
  return{version:'session-insights-1',complete,taskType,prompts,replies,outcomes,suggestions};
}
