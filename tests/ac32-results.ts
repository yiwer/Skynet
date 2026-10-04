import {z} from 'zod';

export const plan={
  entries:['metrics','usage','efficiency','prompts','wait-report','waits','team','weekly','people','assessment','profile','activity'],
  dataset:{employees:10,weeks:4,sessions:1000,turnsPerSession:20,businessEvents:80000,waits:19000,analyzedSessions:20},
  minimumSamples:{cold:20,warm:20},thresholdMs:{coldP95:3000,warmP95:1000},
  coldBoundary:'fresh-node-fresh-postgres-restored-source-state',
};
export type Entry=typeof plan.entries[number];
export type Observation={entry:Entry;environmentId:string;coldMs:number|null;warmMs:number|null;correctness:'passed'|'failed';checks?:boolean;error?:string;responseBytes?:number;version?:string};
export type Measurements={kind:'ac32-observations-1';diagnostic:boolean;sourceRevision:string;sourceBundleHash:string;dataset:typeof plan.dataset;observations:Observation[]};
const schema=z.object({kind:z.literal('ac32-observations-1'),diagnostic:z.boolean(),sourceRevision:z.string().regex(/^[a-f0-9]{40}$/),sourceBundleHash:z.string().regex(/^[a-f0-9]{64}$/),
  dataset:z.object(Object.fromEntries(Object.keys(plan.dataset).map(key=>[key,z.number().int().positive()]))),
  observations:z.array(z.object({entry:z.string().refine(value=>plan.entries.includes(value)),environmentId:z.string().min(1),coldMs:z.number().finite().nonnegative().nullable(),warmMs:z.number().finite().nonnegative().nullable(),
    correctness:z.enum(['passed','failed']),checks:z.boolean().optional(),error:z.string().optional(),responseBytes:z.number().int().nonnegative().optional(),version:z.string().optional()}))});
export function summarize(value:unknown){
  const data=schema.parse(value),distinct=new Set(data.observations.map(row=>row.environmentId));
  const entries=Object.fromEntries(plan.entries.map(entry=>{
    const rows=data.observations.filter(row=>row.entry===entry),stats=(values:number[])=>{const sorted=values.toSorted((a,b)=>a-b);return {samples:sorted.length,
      p50Ms:sorted.length?sorted[Math.ceil(sorted.length*.5)-1]!:null,p95Ms:sorted.length>=20?sorted[Math.ceil(sorted.length*.95)-1]!:null,
      minimumMs:sorted[0]??null,maximumMs:sorted.at(-1)??null};};
    return [entry,{cold:stats(rows.flatMap(row=>row.coldMs===null?[]:[row.coldMs])),warm:stats(rows.flatMap(row=>row.warmMs===null?[]:[row.warmMs])),correctness:rows.every(row=>row.correctness==='passed'),lifecycleVerified:rows.some(row=>row.checks===true)}];
  }));
  const missingEntries=plan.entries.filter(entry=>!data.observations.some(row=>row.entry===entry));
  const fullDataset=Object.entries(plan.dataset).every(([key,amount])=>data.dataset[key]===amount);
  const enough=Object.values(entries).every(entry=>entry.cold.samples>=20&&entry.warm.samples>=20);
  const independent=distinct.size===data.observations.length;
  const correctness=Object.values(entries).every(entry=>entry.correctness);
  const thresholds=Object.values(entries).every(entry=>entry.cold.p95Ms!==null&&entry.cold.p95Ms<=3000&&entry.warm.p95Ms!==null&&entry.warm.p95Ms<=1000);
  const complete=fullDataset&&enough&&independent&&missingEntries.length===0&&Object.values(entries).every(entry=>entry.lifecycleVerified);
  return {kind:'ac32-distribution-1',status:!correctness?'failed':data.diagnostic?'diagnostic-not-acceptance':!complete?'incomplete':thresholds?'passed':'failed',
    sourceRevision:data.sourceRevision,sourceBundleHash:data.sourceBundleHash,dataset:data.dataset,coldBoundary:plan.coldBoundary,
    percentileMethod:'nearest-rank; P95 withheld below 20 observations',thresholdMs:plan.thresholdMs,thresholdsSatisfied:enough?thresholds:null,missingEntries,fullDataset,independent,entries};
}
