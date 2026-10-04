import type {UsageSession} from '../../packages/contracts/usage-output.js';
import type {RecordedMessage} from '../../packages/contracts/message-facts.js';
import {taskTypes,type SessionInsights,type SessionInferences,type InsightCitation,type promptElementLabels} from '../../packages/contracts/session-insights.js';
import type {PromptFraction,PromptExample,PromptSuggestion} from '../../packages/contracts/prompt-report.js';
export const fraction=(numerator:number,denominator:number,unknown:number):PromptFraction=>({numerator,denominator,unknown,value:denominator?numerator/denominator:null});
const keys=['goal','constraints','context','acceptance'] as const;
type Elements=Record<keyof typeof promptElementLabels,boolean|null>;
type Prompt=RecordedMessage&{sessionId:string;elements:Elements;rework:boolean|null;citations:InsightCitation[];analysisVersions:string[];correctionIds:string[];task:typeof taskTypes[number];clarifications:number|null;clarificationCitations:InsightCitation[]};
const votes=(values:(boolean|null)[])=>values.length&&values.every(value=>value===values[0])?values[0]!:null;
// Different text blocks belong to one native message. Any positive block proves presence;
// absence requires every block to have a complete negative observation.
const blocks=(values:(boolean|null)[])=>values.some(v=>v===true)?true:values.length&&values.every(v=>v===false)?false:null;
const uniqueCites=(cites:InsightCitation[])=>[...new Map(cites.map(c=>[JSON.stringify([c.origin?.eventId,c.textOffset,c.quote]),c])).values()].slice(0,3);
export function promptFactors(rows:UsageSession[],views:SessionInsights[],messages:RecordedMessage[],allMessages:RecordedMessage[]){
  const byVersion=new Map(views.map(view=>[view.version,view])),byMessage=new Map(allMessages.map(message=>[message.id,message]));
  const groups=new Map<string,UsageSession[]>();for(const row of rows)groups.set(row.sessionId,[...groups.get(row.sessionId)??[],row]);
  const prompts:Prompt[]=[],sessionCompleteness=new Map<string,boolean>();const suggestions:PromptSuggestion[]=[];
  for(const [sessionId,group] of groups){
    const ids=new Set(group.flatMap(row=>row.latestCarrierSnapshotIds)),inputs=[...new Map(group.flatMap(row=>row.insightVersions).map(key=>[key.version,byVersion.get(key.version)!])).values()];
    const leaves=inputs.filter(view=>ids.has(view.snapshotId)),complete=leaves.length>0&&leaves.every(view=>view.state==='complete'&&view.inferences?.complete);
    const eligible=(message:RecordedMessage)=>group.some(row=>message.employeeId===row.employeeId&&message.project===row.project&&message.source===row.source&&message.sourceSessionId===row.sourceSessionId&&row.snapshotIds.includes(message.originalSnapshotId));
    const selected=messages.filter(eligible),current=allMessages.filter(message=>group.some(row=>message.source===row.source&&message.sourceSessionId===row.sourceSessionId&&row.snapshotIds.includes(message.originalSnapshotId)));
    const promptEntries=new Map<string,SessionInferences['prompts']>(),replyEntries=new Map<string,SessionInferences['replies']>();
    if(complete)for(const view of leaves){
      for(const prompt of view.inferences!.prompts){const self=prompt.citations.find(c=>c.event===prompt.event)?.origin;if(self)promptEntries.set(self.eventId,[...promptEntries.get(self.eventId)??[],prompt]);}
      for(const reply of view.inferences!.replies){const self=reply.citations.find(c=>c.event===reply.event)?.origin;if(self)replyEntries.set(self.eventId,[...replyEntries.get(self.eventId)??[],reply]);}
    }
    const taskValues=new Set(leaves.map(view=>view.state==='complete'?view.inferences?.taskType.value??'unknown':'unknown')),task=taskValues.size===1?[...taskValues][0]!:'unknown';
    function model(message:RecordedMessage){const records=message.eventIds.map(id=>promptEntries.get(id)??[]);const elements=Object.fromEntries(keys.map(key=>[key,blocks(records.map(entries=>votes(entries.map(entry=>entry.complete?entry.elements[key]:null))))])) as Elements;
      return {elements,rework:blocks(records.map(entries=>votes(entries.map(entry=>entry.complete?entry.rework:null)))),citations:uniqueCites(records.flatMap(entries=>entries.flatMap(entry=>entry.citations.filter(c=>c.event===entry.event)))),analysisVersions:leaves.flatMap(v=>v.analysisVersion?[v.analysisVersion.id]:[]),correctionIds:[...new Set(records.flatMap(entries=>entries.flatMap(entry=>Object.values(entry.corrections??{}))))]};}
    for(const message of selected.filter(m=>m.role==='user')){
      const replies=current.filter(reply=>reply.role==='assistant'&&reply.previousPromptId===message.id);
      const clarifications=replies.map(reply=>blocks(reply.eventIds.map(id=>votes((replyEntries.get(id)??[]).map(entry=>entry.complete?entry.clarification:null)))));
      prompts.push({...message,sessionId,...model(message),task,clarifications:complete&&clarifications.length&&clarifications.every(v=>v!==null)?clarifications.filter(Boolean).length:null,
        clarificationCitations:uniqueCites(replies.flatMap(reply=>reply.eventIds.flatMap(id=>(replyEntries.get(id)??[]).flatMap(entry=>entry.citations.filter(c=>c.event===entry.event)))))});
    }
    sessionCompleteness.set(sessionId,complete&&selected.filter(m=>m.role==='user').length===group.reduce((sum,row)=>sum+row.userTurns,0));
    // A scoped subsequent prompt may refer to the previous prompt outside its date/owner
    // filter; that context is used only as a predecessor, never as a new scoped count.
    for(const message of current.filter(m=>m.role==='user'))if(!prompts.some(p=>p.id===message.id)&&selected.some(m=>m.previousPromptId===message.id)){
      byMessage.set(message.id,{...message,...model(message)});
    }
    if(complete)for(const view of leaves)for(const suggestion of view.inferences!.suggestions){
      const owners=new Set(suggestion.citations.map(c=>c.origin?.employeeId));if(owners.size!==1)continue;const employeeId=[...owners][0];
      const owner=group.find(row=>row.employeeId===employeeId);if(!owner||!suggestion.citations.length||!suggestion.citations.every(c=>selected.some(message=>message.context==='after-enrollment'&&message.eventIds.includes(c.origin?.eventId??''))))continue;
      suggestions.push({employeeId:owner.employeeId,employee:owner.employee,text:suggestion.text,citations:suggestion.citations,analysisVersions:view.analysisVersion?[view.analysisVersion.id]:[]});
    }
  }
  const dedup=[...new Map(prompts.map(p=>[p.id,p])).values()],nonFirst=dedup.filter(p=>p.first!==true);
  const boolFraction=(values:(boolean|null)[])=>fraction(values.filter(v=>v===true).length,values.filter(v=>v!==null).length,values.filter(v=>v===null).length);
  const rework=(items:Prompt[])=>boolFraction(items.filter(p=>p.first!==true).map(p=>p.first===false?p.rework:null));
  const clean=[...groups.keys()].map(id=>{const relevant=dedup.filter(p=>p.sessionId===id);if(!sessionCompleteness.get(id)||relevant.some(p=>p.first===null||p.first===false&&p.rework===null))return null;return !relevant.some(p=>p.first===false&&p.rework===true);});
  const withContext:(boolean|null)[]=[],withoutContext:(boolean|null)[]=[],positive:PromptExample[]=[],negative:PromptExample[]=[];let unknownPairs=0;
  for(const next of nonFirst){const previous=dedup.find(p=>p.id===next.previousPromptId)??byMessage.get(next.previousPromptId??'') as Prompt|undefined;
    if(next.first!==false||!previous||!('elements'in previous)||previous.elements.context===null){unknownPairs++;continue;}
    (previous.elements.context?withContext:withoutContext).push(next.rework);
  }
  for(const previous of dedup){const next=dedup.filter(p=>p.previousPromptId===previous.id&&p.first===false);if(next.length!==1||next[0]!.rework===null||!previous.citations.length||!next[0]!.citations.length||Object.values(previous.elements).some(v=>v===null))continue;
    const present=keys.filter(key=>previous.elements[key]),example:PromptExample={employeeId:previous.employeeId,employee:rows.find(row=>row.employeeId===previous.employeeId)!.employee,messageId:previous.id,citations:previous.citations,followingCitations:next[0]!.citations,elements:present,analysisVersions:[...new Set([...previous.analysisVersions,...next[0]!.analysisVersions])]};
    const correctionIds=[...new Set([...previous.correctionIds,...next[0]!.correctionIds])];if(correctionIds.length)example.correctionIds=correctionIds;
    if(present.length>=3&&!next[0]!.rework)positive.push(example);if(present.length<4&&next[0]!.rework)negative.push(example);
  }
  return {prompts:dedup,rework,context:boolFraction(dedup.map(p=>p.elements.context)),cleanSessions:boolFraction(clean),
    clarification:fraction(dedup.reduce((sum,p)=>sum+(p.clarifications??0),0),dedup.filter(p=>p.clarifications!==null).length,dedup.filter(p=>p.clarifications===null).length),
    elements:(items:Prompt[])=>Object.fromEntries(keys.map(key=>[key,boolFraction(items.map(p=>p.elements[key]))])) as Record<keyof Elements,PromptFraction>,
    taskMix:(items:Prompt[])=>taskTypes.map(taskType=>({taskType,prompts:items.filter(p=>p.task===taskType).length})),
    contextComparison:{withContext:boolFraction(withContext),withoutContext:boolFraction(withoutContext),unknownPairs},
    examples:{positive:positive.slice(0,3),negative:negative.slice(0,3),positiveCount:positive.length,negativeCount:negative.length},
    suggestions:[...new Map(suggestions.map(item=>[item.employeeId,item])).values()].sort((a,b)=>a.employee.localeCompare(b.employee,'zh-CN')||a.employeeId.localeCompare(b.employeeId))};
}
