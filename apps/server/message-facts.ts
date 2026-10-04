import {digest} from './database.js';
import {conversationContext} from './conversation-trace.js';
import type {AnalysisInput} from './analysis.js';
import type {MessageFacts,RecordedMessage} from '../../packages/contracts/message-facts.js';
import type {Source} from '../../packages/contracts/archive.js';

/** Deterministic metadata only: originals remain the only stored message text. */
export function recordedMessages(input:AnalysisInput,sourceSessionId:string,historyComplete=true):MessageFacts {
  const complete=historyComplete&&input.coverage.unrecognizedLines===0&&!input.coverage.partialLine&&!input.coverage.captureGaps.length;
  const groups=new Map<string,{record:RecordedMessage;text:string[]}>();
  for(const event of input.events){
    if(!['user','assistant'].includes(event.role)||conversationContext(event)||!event.origin)continue;
    const origin=event.origin,id=digest(JSON.stringify([origin.snapshotId,origin.materialId??null,origin.line,event.role]));
    let group=groups.get(id);
    if(!group){group={record:{id,eventIds:[],role:event.role as 'user'|'assistant',length:0,first:null,previousPromptId:null,
      employeeId:origin.employeeId,project:origin.project,sourceDate:origin.sourceDate,context:origin.context,source:input.source as Source,
      sourceSessionId,originalSnapshotId:origin.snapshotId,line:origin.line,materialId:origin.materialId??null,webPath:origin.webPath!},text:[]};groups.set(id,group);}
    if(!group.record.eventIds.includes(origin.eventId)){group.record.eventIds.push(origin.eventId);group.text.push(event.text);}
  }
  let previous:string|null=null;
  const messages=[...groups.values()].map(({record,text})=>{record.length=Array.from(text.join('\n')).length;
    record.previousPromptId=complete?previous:null;if(record.role==='user'){record.first=complete?previous===null:null;previous=record.id;}return record;});
  return {complete,messages};
}
