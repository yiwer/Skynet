import type { AnalysisConfig } from './config.js';
import { NativeAnalysisFailure, runNativeAnalysis } from './native.js';
import { validateAnalysis, type AnalysisInput } from '../server/analysis.js';
import type { AnalysisItem, AnalysisRun } from '../../packages/contracts/analysis.js';
import { initialProcessing, mapOutput, planAggregation, planSegments, validateAggregate } from './long.js';

// #23 can add a bounded segment/aggregate pipeline here, without changing durable ownership.
// Each native call must use beforeForward; intermediate summaries never become original citations.
export async function executeAnalysis(config: AnalysisConfig, input: AnalysisInput, signal: AbortSignal, beforeForward: () => Promise<boolean>, native = runNativeAnalysis): Promise<NonNullable<AnalysisRun['result']>> {
  const plan = planSegments(input, config); const processing = initialProcessing();
  const usage: NonNullable<AnalysisRun['result']>['usage'] = { inputTokens: 0, outputTokens: 0, runtimeCostUsd: 0, providerBilledCny: null, requests: 0 };
  let forwarded = 0;
  const forward = async () => { if (signal.aborted || forwarded >= config.maxRequests || !await beforeForward()) return false; forwarded++; return true; };
  const addUsage = (value: typeof usage) => {
    for (const key of ['inputTokens', 'outputTokens', 'runtimeCostUsd'] as const) usage[key] = usage[key] === null || value[key] === null ? null : usage[key]! + value[key]!;
  };
  const unknownUsage = () => { usage.inputTokens = usage.outputTokens = usage.runtimeCostUsd = null; };
  const extracted: AnalysisItem[] = [];
  for (const stage of plan.stages) {
    if (signal.aborted || forwarded >= config.maxRequests) { processing.ranges.push({ start: stage.start, end: stage.end, state: 'skipped', reason: '全任务请求或时间限额' }); continue; }
    try {
      const result = await native(config, stage.input, signal, forward); addUsage(result.usage);
      extracted.push(...validateAnalysis(input, mapOutput(stage, result.output)));
      processing.ranges.push({ start: stage.start, end: stage.end, state: 'extracted' });
    } catch { unknownUsage(); processing.ranges.push({ start: stage.start, end: stage.end, state: 'failed', reason: '该段模型、限额或原句校验失败；没有使用该段结论' }); }
  }
  if (plan.skipped) processing.ranges.push(plan.skipped);
  if (!extracted.length || signal.aborted) throw new NativeAnalysisFailure(forwarded, signal.aborted ? 'timeout-or-cancelled' : 'no-validated-segment');
  let items = extracted.slice(0, 28);
  if (plan.stages.length > 1) {
    const aggregate = planAggregation(input, extracted, config.maxInputBytes); processing.omittedFindings = aggregate.omittedFindings;
    if (!aggregate.stage.input.events.length || forwarded >= config.maxRequests) processing.aggregation = 'limited';
    else try {
      const result = await native(config, aggregate.stage.input, signal, forward); addUsage(result.usage);
      items = validateAnalysis(input, validateAggregate(aggregate.stage, result.output, aggregate.allowed)); processing.aggregation = aggregate.omittedFindings ? 'limited' : 'succeeded';
    } catch { unknownUsage(); processing.aggregation = 'failed'; }
  } else if (extracted.length > 28) processing.omittedFindings += extracted.length - 28;
  if (processing.aggregation === 'failed' || processing.aggregation === 'limited') processing.omittedFindings += Math.max(0, extracted.length - items.length);
  while (items.length && Buffer.byteLength(JSON.stringify(items)) > 48 * 1024) { items.pop(); processing.omittedFindings++; }
  usage.requests = forwarded;
  processing.complete = processing.ranges.every(range => range.state === 'extracted') && ['not-needed', 'succeeded'].includes(processing.aggregation) && !processing.omittedFindings;
  if (signal.aborted) throw new NativeAnalysisFailure(forwarded, 'timeout-or-cancelled');
  return { items, usage, fixture: config.mode === 'fixture', processing };
}
