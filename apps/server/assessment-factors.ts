import type { UsageSession } from '../../packages/contracts/usage-output.js';
import type { SessionInsights, SessionInferences, InsightCitation } from '../../packages/contracts/session-insights.js';
import type { CapabilityAssessment, MetricScore } from '../../packages/contracts/assessment.js';
import type { WaitsPage } from '../../packages/contracts/waits.js';
import { assessmentModel, scoreMetric } from './assessment-model.js';
import type {RecordedMessage} from '../../packages/contracts/message-facts.js';
import {promptFactors} from './prompt-factors.js';

const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
export const median = (xs: number[]) => { const values = [...xs].sort((a, b) => a - b), middle = Math.floor(values.length / 2); return !values.length ? null : values.length % 2 ? values[middle]! : (values[middle - 1]! + values[middle]!) / 2; };
const sumKnown = (values: (number | null)[]) => values.some(n => n === null) ? null : values.reduce<number>((n, value) => n + value!, 0);
type Prompt = Pick<SessionInferences['prompts'][number],'elements'|'rework'|'complete'|'citations'> & {first:boolean|null};
type Reply = {clarifications:number|null;citations:InsightCitation[]};
export type AssessmentSession = {
  sessionId: string; employeeId: string; snapshotId: string; webPath: string; versions: { snapshotId: string; version: string }[];
  analysisVersions: string[]; task: string; done: boolean; turnKnown: boolean; historyKnown: boolean; inferenceComplete: boolean;
  userTurns: number; tokens: number | null; verified: number | null; claimed: number | null; tests: number | null;
  prompts: Prompt[]; replies: Reply[]; rework: number | null; evidence: InsightCitation[];
};
export function assessmentSessions(rows: UsageSession[], views: SessionInsights[], range: { from: string; to: string },messages:RecordedMessage[]): AssessmentSession[] {
  const byVersion = new Map(views.map(view => [view.version, view])), groups = new Map<string, UsageSession[]>();
  for (const row of rows.filter(row => row.sessions)) {
    const key = row.employeeId + '/' + row.sessionId; groups.set(key, [...groups.get(key) ?? [], row]);
  }
  const scoped=messages.filter(message=>message.context==='after-enrollment'&&message.sourceDate&&message.sourceDate>=range.from&&message.sourceDate<=range.to&&rows.some(row=>
    row.employeeId===message.employeeId&&row.project===message.project&&row.source===message.source&&row.sourceSessionId===message.sourceSessionId&&row.snapshotIds.includes(message.originalSnapshotId)));
  const native=promptFactors(rows.filter(row=>row.sessions),views,scoped,messages);
  return [...groups.values()].map(group => {
    const first = group[0]!, versions = [...new Map(group.flatMap(row => row.insightVersions).map(v => [v.version, v])).values()];
    const inputs = versions.map(v => byVersion.get(v.version)!), leafIds = new Set(group.flatMap(row => row.latestCarrierSnapshotIds));
    const leaves = inputs.filter(view => leafIds.has(view.snapshotId));
    const selected=native.prompts.filter(prompt=>prompt.sessionId===first.sessionId&&prompt.employeeId===first.employeeId);
    const promptList:Prompt[]=selected.map(prompt=>({...prompt,complete:leaves.length>0&&leaves.every(view=>view.state==='complete'&&view.inferences?.complete)}));
    const nonFirst = promptList.filter(p => p.first===false), userTurns = group.reduce((n, row) => n + row.userTurns, 0);
    const complete = leaves.length > 0 && leaves.every(v => v.state === 'complete') && promptList.length === userTurns;
    const historyKnown = leaves.length > 0 && leaves.every(v => v.messageHistoryComplete === true);
    const tasks = new Set(leaves.map(view => view.state === 'complete' ? view.inferences?.taskType.value ?? 'unknown' : 'unknown'));
    return { sessionId: first.sessionId, employeeId: first.employeeId, snapshotId: leaves.at(-1)?.snapshotId ?? first.snapshotId, webPath: group.at(-1)!.webPath, versions,
      analysisVersions: [...new Set(inputs.flatMap(view => view.analysisVersion ? [view.analysisVersion.id] : []))],
      task: tasks.size === 1 ? [...tasks][0]! : 'unknown', done: leaves.length > 0 && leaves.every(v => v.sourceState?.turn.state === 'waiting-input'),
      turnKnown: leaves.length > 0 && leaves.every(v => v.sourceState && v.sourceState.turn.state !== 'unknown'), historyKnown, inferenceComplete: complete, userTurns,
      tokens: sumKnown(group.map(row => row.inputTokens)), verified: sumKnown(group.map(row => row.outputs.verified.value)), claimed: sumKnown(group.map(row => row.outputs.claimed.value)), tests: sumKnown(group.map(row => row.outputs.tests.value)),
      prompts: promptList, replies: selected.map(prompt=>({clarifications:prompt.clarifications,citations:prompt.clarificationCitations})), rework: historyKnown && complete && promptList.every(p=>p.first!==null) && nonFirst.every(p => p.complete && p.rework !== null) ? nonFirst.filter(p => p.rework).length : null,
      evidence: inputs.flatMap(v => [...v.inferences?.outcomes.flatMap(o => o.citations) ?? [], ...v.facts.tests.evidence]) };
  });
}
export function assessmentBaseline(sessions: AssessmentSession[]) {
  const logical = new Map<string, AssessmentSession[]>();
  for (const session of sessions) logical.set(session.sessionId, [...logical.get(session.sessionId) ?? [], session]);
  const samples = [...logical.values()].flatMap(group => {
    const types = new Set(group.map(s => s.task)), verified = sumKnown(group.map(s => s.verified)), tokens = sumKnown(group.map(s => s.tokens));
    if (!group.every(s => s.done) || types.size !== 1 || types.has('unknown') || verified === null) return [];
    return [{ sessionId: group[0]!.sessionId, task: group[0]!.task, verified, ratio: tokens !== null && tokens > 0 ? verified / (tokens / 1e6) : null,
      insightVersions: [...new Set(group.flatMap(s => s.versions.map(v => v.version)))].sort() }];
  });
  const tasks = Object.fromEntries([...new Set(samples.map(s => s.task))].sort().map(task => {
    const relevant = samples.filter(s => s.task === task), ratios = relevant.flatMap(s => s.ratio === null ? [] : [s.ratio]), middle = median(ratios);
    return [task, { verifiedMean: Math.max(assessmentModel.baseline.verifiedMeanFloor, mean(relevant.map(s => s.verified))!), efficiencyMedian: middle && middle > 0 ? middle : null,
      sessions: relevant.length, tokenSessions: ratios.length }];
  }));
  return { definition: assessmentModel.baseline, tasks, samples };
}
type Baseline = ReturnType<typeof assessmentBaseline>;
function evidence(metric: MetricScore, citations: (InsightCitation | { snapshotId: string; webPath: string; quote?: string })[]) {
  const unique = [...new Map(citations.map(c => [c.webPath, { snapshotId: c.snapshotId, webPath: c.webPath, ...('quote' in c ? { quote: c.quote } : {}) }])).values()];
  metric.evidence = unique.slice(0, 3); metric.evidenceCount = unique.length;
}
export function fillAssessmentFactors(dims: CapabilityAssessment['dims'], sessions: AssessmentSession[], baseline: Baseline, waits: WaitsPage, employeeId: string) {
  const metric = (key: string) => Object.values(dims).flatMap(dim => dim.metrics).find(item => item.key === key)!;
  if (!sessions.length) return { promptTip: null, representatives: { best: null, rework: null } };
  const prompts = sessions.flatMap(s => s.prompts), ordered = sessions.filter(s => s.historyKnown).flatMap(s => s.prompts);
  const first = ordered.filter(p => p.first===true), nonFirst = ordered.filter(p => p.first===false), complete = sessions.every(s => s.inferenceComplete);
  const promptN = sessions.reduce((n, s) => n + s.userTurns, 0), verified = sumKnown(sessions.map(s => s.verified)), claimed = sumKnown(sessions.map(s => s.claimed));
  const firstComplete = complete && sessions.every(s => s.historyKnown) && ordered.every(p=>p.first!==null) && first.every(p => p.complete && Object.values(p.elements).every(value => value !== null));
  scoreMetric(metric('elem'), firstComplete ? mean(first.map(p => Object.values(p.elements).filter(Boolean).length / 4)) ?? 0 : null, first.length, sessions.every(s => s.historyKnown) ? '首条提示词推断不完整' : '原始提示词起点未知');
  const replies = sessions.flatMap(s => s.replies), clarifyKnown = complete && replies.every(r => r.clarifications !== null);
  scoreMetric(metric('clarify'), clarifyKnown ? promptN ? replies.reduce((n,r)=>n+r.clarifications!,0) / promptN : 0 : null, promptN, '追问推断不完整');
  const rework = sumKnown(sessions.map(s => s.rework));
  scoreMetric(metric('rework'), rework === null ? null : nonFirst.length ? rework / nonFirst.length : 0, nonFirst.length, '非首条边界或返工推断不完整');
  scoreMetric(metric('clean'), rework === null ? null : sessions.filter(s => s.rework === 0).length / sessions.length, sessions.length, '非首条边界或返工推断不完整');
  scoreMetric(metric('turnsPerVer'), verified === null ? null : promptN / Math.max(.5, verified), promptN, '已验证结果未知');
  const outcomes = verified !== null && claimed !== null ? verified + claimed : null;
  scoreMetric(metric('verShare'), outcomes === null ? null : outcomes ? verified! / outcomes : 0, outcomes ?? 0, '结果核验状态未知');
  const testSessions = sessions.filter(s => ['implementation','fix','refactor','test'].includes(s.task));
  const testsKnown = sessions.every(s => s.task !== 'unknown') && testSessions.every(s => s.tests !== null);
  scoreMetric(metric('testShare'), testsKnown ? testSessions.length ? testSessions.filter(s => s.tests! > 0).length / testSessions.length : 0 : null, testSessions.length, '任务类型或测试记录未知');
  const closureKnown = sessions.every(s => s.turnKnown), ended = sessions.filter(s => s.done);
  const outputKnown = closureKnown && ended.every(s => s.task !== 'unknown' && s.verified !== null && baseline.tasks[s.task]);
  scoreMetric(metric('outIdx'), outputKnown ? mean(ended.map(s => s.verified! / baseline.tasks[s.task]!.verifiedMean)) ?? 0 : null, ended.length, closureKnown ? '已结束样本的任务类型或已验证结果未知' : '原生轮次边界未知');
  const tokenEnded = ended.filter(s => s.tokens !== null && s.tokens > 0), ratiosKnown = closureKnown && tokenEnded.every(s => s.verified !== null && baseline.tasks[s.task]?.efficiencyMedian);
  scoreMetric(metric('effIdx'), ratiosKnown ? mean(tokenEnded.map(s => (s.verified! / (s.tokens! / 1e6)) / baseline.tasks[s.task]!.efficiencyMedian!)) ?? 0 : null, tokenEnded.length, closureKnown ? '同类任务产效比基线未知或为零' : '原生轮次边界未知');
  scoreMetric(metric('permMed'), null, 0, '来源未记录可核对的权限请求与决定时刻');
  const intervals = waits.intervals.filter(w => w.employeeId === employeeId), available = intervals.filter(w => w.durationMs !== null && w.parallel === 'not-observed');
  const waitKnown = sessions.every(s => s.turnKnown) && intervals.every(w => w.durationMs !== null && w.parallel !== 'unknown');
  scoreMetric(metric('longShare'), waitKnown ? available.length ? available.filter(w => w.long).length / available.length : 0 : null, available.length, '原生轮次边界或并行活动覆盖未知');
  for (const key of ['elem','clarify','rework','clean','turnsPerVer']) evidence(metric(key), key === 'clarify' ? replies.flatMap(p => p.citations) : (key === 'elem' ? first : prompts).flatMap(p => p.citations));
  for (const key of ['verShare','testShare','outIdx','effIdx']) evidence(metric(key), sessions.flatMap(s => s.evidence));
  evidence(metric('longShare'), available.flatMap(w => [w.start, w.end].filter((e): e is NonNullable<typeof e> => !!e)));
  const promptTip = firstComplete && first.length ? Object.entries(assessmentModel.promptTips).map(([key, text]) => ({ text, rate: first.filter(p => p.elements[key as keyof Prompt['elements']]).length / first.length })).sort((a, b) => a.rate - b.rate)[0]!.text : null;
  const best = ended.filter(s => s.verified !== null && s.verified > 0 && s.rework === 0).sort((a, b) => b.verified! - a.verified! || (a.tokens ?? Infinity) - (b.tokens ?? Infinity) || a.sessionId.localeCompare(b.sessionId))[0];
  const worst = sessions.filter(s => s.rework !== null && s.claimed !== null && s.verified !== null && (s.rework > 0 || s.claimed > s.verified)).sort((a, b) => (b.rework! + b.claimed! - b.verified!) - (a.rework! + a.claimed! - a.verified!) || a.sessionId.localeCompare(b.sessionId))[0];
  const reference = (s: AssessmentSession | undefined) => s ? { snapshotId: s.snapshotId, webPath: s.webPath } : null;
  return { promptTip, representatives: { best: reference(best), rework: reference(worst) } };
}
