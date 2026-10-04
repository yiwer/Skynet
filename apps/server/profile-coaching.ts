import type {sessionInsightsService} from './session-insights.js';
import type {UsageOutputPage} from '../../packages/contracts/usage-output.js';
import type {CapabilityAssessment} from '../../packages/contracts/assessment.js';
import type {ProfileCoaching} from '../../packages/contracts/profile-coaching.js';
import {promptFactors} from './prompt-factors.js';
import {median,assessmentSessions,selectRepresentativeSessions} from './assessment-factors.js';
import type {waitsService} from './waits.js';
import {summarizeWaits,waitDistribution} from './wait-report.js';
import type {assessmentService} from './assessment.js';
import {dimKeys} from '../../packages/contracts/assessment.js';
import {monday} from '../../packages/contracts/work-views.js';

export function profileCoachingService(insights:ReturnType<typeof sessionInsightsService>,waits:ReturnType<typeof waitsService>,assessments:ReturnType<typeof assessmentService>){
  async function read(assessment:CapabilityAssessment,source:UsageOutputPage):Promise<ProfileCoaching>{
    const rows=source.sessions.filter(row=>row.selected),keys=[...new Map(rows.flatMap(row=>row.insightVersions).map(key=>[key.version,key])).values()];
    const views=await insights.readVersions(keys),facts=await insights.readMessageFacts(views);
    const all=[...new Map(facts.flatMap(fact=>fact.messages).map(message=>[message.id,message])).values()];
    const selected=all.filter(message=>message.context==='after-enrollment'&&message.sourceDate&&message.sourceDate>=source.scope.from&&message.sourceDate<=source.scope.to&&rows.some(row=>
      row.employeeId===message.employeeId&&row.project===message.project&&row.source===message.source&&row.sourceSessionId===message.sourceSessionId&&row.snapshotIds.includes(message.originalSnapshotId)));
    const native=promptFactors(rows,views,selected,all),ownRows=rows.filter(row=>row.employeeId===assessment.employeeId),own=promptFactors(ownRows,views,selected.filter(message=>message.employeeId===assessment.employeeId),all);
    const employee=source.employees.find(row=>row.employeeId===assessment.employeeId),unknown=Math.max(0,(employee?.userTurns??0)-own.prompts.length),teamUnknown=Math.max(0,source.totals.userTurns-native.prompts.length);
    function first(factors:typeof native,missing:number){const prompts=factors.prompts.filter(prompt=>prompt.first===true),unknownFirst=factors.prompts.filter(prompt=>prompt.first===null).length+missing,elements=factors.elements(prompts);
      for(const value of Object.values(elements))value.unknown+=unknownFirst;return {count:prompts.length,unknownFirst,elements};}
    const withUnknown=(value:ProfileCoaching['communication']['rework'],missing:number)=>({...value,unknown:value.unknown+missing});
    const latest=new Set(ownRows.flatMap(row=>row.latestCarrierSnapshotIds));
    // Token baselines do not determine whether native message text is complete.
    const complete=!(employee?.unscopedSources??0)&&unknown===0&&[...latest].every(id=>facts.some(fact=>fact.snapshotId===id&&fact.complete));
    const knownMedian=median(own.prompts.map(prompt=>prompt.length));
    const representatives=selectRepresentativeSessions(assessmentSessions(ownRows,views,source.scope,all));
    function example(kind:keyof typeof representatives):ProfileCoaching['representatives']['best']{
      const candidate=representatives[kind];if(!candidate)return null;
      const prompt=own.prompts.find(prompt=>prompt.sessionId===candidate.sessionId&&(kind==='best'?prompt.first===true:prompt.first===false&&prompt.rework===true));
      const citation=prompt?.citations[0]??(kind==='rework'?views.filter(view=>candidate.versions.some(ref=>ref.version===view.version)).flatMap(view=>view.inferences?.outcomes.filter(outcome=>outcome.status==='claimed').flatMap(outcome=>outcome.citations)??[])
        .find(cite=>selected.some(message=>message.employeeId===assessment.employeeId&&message.eventIds.includes(cite.origin?.eventId??''))):undefined);
      if(!citation)return null;
      const source=views.find(view=>candidate.versions.some(ref=>ref.version===view.version)&&[...view.inferences?.prompts.flatMap(prompt=>prompt.citations)??[],...view.inferences?.outcomes.flatMap(outcome=>outcome.citations)??[]].some(cite=>cite.origin?.eventId===citation.origin?.eventId&&cite.quote===citation.quote));
      if(!source)return null;
      return {sessionId:candidate.sessionId,snapshotId:candidate.snapshotId,verified:candidate.verified,claimed:candidate.claimed,rework:candidate.rework,tokens:candidate.tokens,
        citation,insight:{snapshotId:source.snapshotId,version:source.version},correctionIds:(source.corrections?.appliedIds??[]).slice(0,16),correctionCount:source.corrections?.appliedIds.length??0};
    }
    const waitSource=await waits.export({period:assessment.selection?.period??'since-enrollment',version:assessment.inputs.waitsVersion}),intervals=waitSource.intervals.filter(row=>row.employeeId===assessment.employeeId);
    const waitSummary=summarizeWaits({...waitSource,intervals}),bins=Array.from({length:24},()=>[] as number[]);
    for(const row of intervals)if(row.durationMs!==null&&row.startedAt)bins[new Date(Date.parse(row.startedAt)+8*3600000).getUTCHours()]!.push(row.durationMs);
    async function week(period:'last-week'|'this-week'):Promise<ProfileCoaching['trend']['current']>{
      const value=assessment.selection?.period===period?assessment:await assessments.export(assessment.employeeId,{period,preset:assessment.preset});
      return {state:!value.sample.sessions&&!value.coverageIssues.length?'empty':value.index===null?'unknown':'available',range:{from:monday(value.range.to),to:value.range.to},
        assessmentVersion:value.version,modelVersion:value.modelVersion,baselineVersion:value.inputs.baselineVersion,frontierVersion:value.inputs.frontierVersion,usageVersion:value.inputs.usageVersion,waitsVersion:value.inputs.waitsVersion,
        sessions:value.sample.sessions,prompts:value.sample.prompts,confidence:value.confidence,index:value.index,dimensions:Object.fromEntries(dimKeys.map(key=>[key,value.dims[key].score])) as ProfileCoaching['trend']['current']['dimensions']};
    }
    const previous=await week('last-week'),current=await week('this-week'),correctionIds=[...new Set(own.prompts.flatMap(prompt=>prompt.correctionIds))].sort();
    return {algorithmVersion:'profile-coaching-1',usageVersion:source.version,representatives:{best:example('best'),rework:example('rework')},trend:{preset:assessment.preset,previous,current},
      waiting:{waitVersion:waitSource.version,summary:waitSummary.summary,teamMedianMs:summarizeWaits(waitSource).summary.medianMs,permissions:waitSummary.permissions,
        unavailableSourceCount:new Set((waitSource.unavailableSources??[]).filter(row=>row.employeeId===assessment.employeeId).map(row=>row.snapshotId)).size,
        teamUnavailableSourceCount:new Set((waitSource.unavailableSources??[]).map(row=>row.snapshotId)).size,
        hours:bins.map((values,hour)=>({hour,count:values.length,medianMs:waitDistribution(values).medianMs})),
        evidence:[...intervals].sort((a,b)=>(b.durationMs??-1)-(a.durationMs??-1)||a.id.localeCompare(b.id)).slice(0,3).map(({id,startedAt,durationMs,parallel,start,end})=>({id,startedAt,durationMs,parallel,start,end}))},communication:{
      firstPrompts:{person:first(own,unknown),team:first(native,teamUnknown)},rework:withUnknown(own.rework(own.prompts),unknown),clarification:withUnknown(own.clarification,unknown),cleanSessions:own.cleanSessions,
      team:{rework:withUnknown(native.rework(native.prompts),teamUnknown),clarification:withUnknown(native.clarification,teamUnknown)},
      medianLength:{value:complete?knownMedian:null,knownMedian,knownCount:own.prompts.length,unknownCount:unknown},
      sourceInputsComplete:complete,unknownReasons:complete?[]:[...new Set([...(employee?.unknownReasons??[]),'部分原件未完整解析，提示词范围可能不完整'])],
      correctionIds:correctionIds.slice(0,16),correctionCount:correctionIds.length,
    }};
  }
  return {read};
}
