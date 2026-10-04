import {z} from 'zod';
import {analysisOutputSchema} from '../../packages/contracts/analysis.js';
import {analysisInsightsSchema} from '../../packages/contracts/session-insights.js';
import type {AnalysisInput} from '../server/analysis.js';

const citation=z.object({evidenceId:z.string().regex(/^e\d+s\d+$/).max(32)}).strict();
const citations=z.array(citation).max(3),required=citations.min(1);
// Runtime-specific wire schema. Exact original quotes and offsets are resolved by
// the host; a language model never has to count UTF-16 units or re-escape paths.
export const qoderOutputSchema=analysisOutputSchema.extend({
  items:z.array(analysisOutputSchema.shape.items.element.extend({citations})).max(28),
  insights:analysisInsightsSchema.extend({
    taskType:analysisInsightsSchema.shape.taskType.extend({citations}),
    prompts:z.array(analysisInsightsSchema.shape.prompts.element.extend({citations:required})).max(128),
    replies:z.array(analysisInsightsSchema.shape.replies.element.extend({citations:required})).max(128),
    outcomes:z.array(analysisInsightsSchema.shape.outcomes.element.extend({citations:required})).max(28),
    suggestions:z.array(analysisInsightsSchema.shape.suggestions.element.extend({citations:required})).max(4),
  }).optional(),
});
export function qoderEvidence(input:AnalysisInput){
  const catalog=new Map<string,{event:number;textOffset:number;quote:string}>();
  const events=input.events.map(({text,...event},index)=>{
    const passages:{evidenceId:string;text:string}[]=[];
    for(let start=0;start<text.length;){let end=Math.min(start+512,text.length);
      if(end<text.length&&/[\uD800-\uDBFF]/.test(text[end-1]!))end--;
      const quote=text.slice(start,end),evidenceId=`e${index}s${start}`;
      catalog.set(evidenceId,{event:index,textOffset:start,quote});passages.push({evidenceId,text:quote});start=end;
    }
    return {...event,event:index,passages};
  });
  return {input:{...input,events},decode:(value:unknown)=>{
    const output=qoderOutputSchema.parse(value);
    const cited=<T extends{citations:{evidenceId:string}[]}>(item:T)=>({...item,citations:item.citations.map(cite=>{
      const original=catalog.get(cite.evidenceId);if(!original)throw new Error('Unknown original evidence identifier');return {...original};
    })});
    return analysisOutputSchema.parse({items:output.items.map(cited),...(output.insights?{insights:{...output.insights,
      taskType:cited(output.insights.taskType),prompts:output.insights.prompts.map(cited),replies:output.insights.replies.map(cited),
      outcomes:output.insights.outcomes.map(cited),suggestions:output.insights.suggestions.map(cited)}}:{})});
  }};
}
