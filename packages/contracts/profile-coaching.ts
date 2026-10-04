import type {PromptFraction} from './prompt-report.js';
import type {promptElementLabels,InsightCitation} from './session-insights.js';
import type {WaitReport} from './wait-report.js';
import type {ReplyWait} from './waits.js';
import type {CapabilityAssessment,AssessmentPreset,DimKey} from './assessment.js';

type Elements=Record<keyof typeof promptElementLabels,PromptFraction>;
export type CoachingExample={sessionId:string;snapshotId:string;verified:number|null;claimed:number|null;rework:number|null;tokens:number|null;
  citation:InsightCitation;insight:{snapshotId:string;version:string};correctionIds:string[];correctionCount:number};
export type CoachingWeek={state:'empty'|'available'|'unknown';range:{from:string;to:string};assessmentVersion:string;modelVersion:string;baselineVersion:string;frontierVersion:string|undefined;
  usageVersion:string;waitsVersion:string;sessions:number;prompts:number;confidence:CapabilityAssessment['confidence'];index:number|null;dimensions:Record<DimKey,number|null>};
export type ProfileCoaching={
  algorithmVersion:string;usageVersion:string;
  representatives:{best:CoachingExample|null;rework:CoachingExample|null};
  trend:{preset:AssessmentPreset;previous:CoachingWeek;current:CoachingWeek};
  waiting:{waitVersion:string;summary:WaitReport['summary'];teamMedianMs:number|null;unavailableSourceCount:number;teamUnavailableSourceCount:number;hours:{hour:number;count:number;medianMs:number|null}[];
    permissions:WaitReport['permissions'];evidence:Pick<ReplyWait,'id'|'startedAt'|'durationMs'|'parallel'|'start'|'end'>[]};
  communication:{
    firstPrompts:{person:{count:number;unknownFirst:number;elements:Elements};team:{count:number;unknownFirst:number;elements:Elements}};
    rework:PromptFraction;clarification:PromptFraction;cleanSessions:PromptFraction;
    team:{rework:PromptFraction;clarification:PromptFraction};
    medianLength:{value:number|null;knownMedian:number|null;knownCount:number;unknownCount:number};
    sourceInputsComplete:boolean;unknownReasons:string[];correctionIds:string[];correctionCount:number;
  };
};
