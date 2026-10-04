import type {Database} from './database.js';
import type {usageOutputService} from './usage-output.js';
import type {waitsService} from './waits.js';
import type {sessionInsightsService} from './session-insights.js';
import type {AssessmentPeriod,AssessmentPreset} from '../../packages/contracts/assessment.js';
import type {UsageOutputPage} from '../../packages/contracts/usage-output.js';
import {assessmentSessions} from './assessment-factors.js';
import {scoreAssessmentInputs} from './assessment-inputs.js';

const references=(report:UsageOutputPage)=>[...new Map(report.sessions.flatMap(row=>row.insightVersions).map(ref=>[ref.version,ref])).values()];
function freezeInput(value:unknown):void{
  if(value&&typeof value==='object'&&!Object.isFrozen(value)){
    for(const child of Object.values(value))freezeInput(child);Object.freeze(value);
  }
}

/** One attempt's three-period input acquisition. These are optimization
 * budgets: an oversized pool declines reuse without imposing a report limit. */
export async function assessmentPeriods(db:Database,usage:ReturnType<typeof usageOutputService>,waits:ReturnType<typeof waitsService>,insights:ReturnType<typeof sessionInsightsService>,clock:()=>Date,preset:AssessmentPreset,selected:AssessmentPeriod){
  const periods=[...new Set<AssessmentPeriod>([selected,'last-week','this-week'])],reports=new Map<AssessmentPeriod,UsageOutputPage>();
  for(const period of periods)reports.set(period,await usage.complete({period}));
  const baselineReport=reports.get('since-enrollment')??await usage.complete({period:'since-enrollment'}),baselineReferences=references(baselineReport);
  const perPeriod=new Map(periods.map(period=>[period,[...new Map([...references(reports.get(period)!),...baselineReferences].map(ref=>[ref.version,ref])).values()]]));
  const allReferences=[...new Map([...perPeriod.values()].flat().map(ref=>[ref.version,ref])).values()];
  if(allReferences.length>2000)return null;
  const views=await insights.readVersions(allReferences),facts=await insights.readMessageFacts(views);
  if(Buffer.byteLength(JSON.stringify([views,facts]))>96*1024*1024)return null;
  // Shared fixed inputs cannot be changed by a period's scoring or selection.
  freezeInput(views);freezeInput(facts);for(const report of reports.values())freezeInput(report);freezeInput(baselineReport);
  // Keep each original reference order. Map(message.id) intentionally keeps
  // first position and last value, as in standalone assessmentInputs.
  const byVersion=new Map(views.map((view,index)=>[view.version,{view,facts:facts[index]!}]));
  const context=(refs:typeof allReferences)=>{
    const values=refs.map(ref=>byVersion.get(ref.version)!);
    return {views:values.map(value=>value.view),messages:[...new Map(values.flatMap(value=>value.facts.messages).map(message=>[message.id,message])).values()]};
  };
  const baselineContext=context(baselineReferences),baselineFactors=assessmentSessions(baselineReport.sessions,baselineContext.views,baselineReport.scope,baselineContext.messages);
  const results=new Map<AssessmentPeriod,Awaited<ReturnType<typeof scoreAssessmentInputs>>>();
  for(const period of periods){
    const report=reports.get(period)!,waitReport=await waits.complete({period}),input=context(perPeriod.get(period)!);
    const factors=period==='since-enrollment'?baselineFactors:assessmentSessions(report.sessions,input.views,report.scope,input.messages);
    results.set(period,await scoreAssessmentInputs(db,clock,preset,{report,waitReport,baselineReport,factors,baselineFactors,baselineReferences}));
  }
  return results;
}
