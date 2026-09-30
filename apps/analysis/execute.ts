import type { AnalysisConfig } from './config.js';
import { runNativeAnalysis } from './native.js';
import { validateAnalysis, type AnalysisInput } from '../server/analysis.js';

// #23 can add a bounded segment/aggregate pipeline here, without changing durable ownership.
// Each native call must use beforeForward; intermediate summaries never become original citations.
export async function executeAnalysis(config: AnalysisConfig, input: AnalysisInput, signal: AbortSignal, beforeForward: () => Promise<boolean>) {
  const result = await runNativeAnalysis(config, input, signal, beforeForward);
  return { items: validateAnalysis(input, result.output), usage: result.usage, fixture: config.mode === 'fixture' };
}
