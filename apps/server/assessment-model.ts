import { digest } from './database.js';
import { dimKeys, type AssessmentPreset, type CapabilityAssessment, type DimKey, type MetricScore } from '../../packages/contracts/assessment.js';

type MetricDefinition = Pick<MetricScore, 'key' | 'label' | 'anchor' | 'minimum' | 'unit'>;
const metric = (key: string, label: string, zero: number, full: number, minimum: number, unit: MetricScore['unit'] = 'ratio'): MetricDefinition => ({ key, label, anchor: [zero, full], minimum, unit });
export const assessmentModel = {
  algorithm: 'capability-assessment-1', status: 'initial-parameters',
  dimensions: {
    adopt: { label: '使用深度', metrics: [metric('activeShare', '活跃天数占比', .3, .9, 1), metric('perDay', '活跃日会话数', .6, 1.8, 1, 'number')] },
    prompt: { label: '需求表达', metrics: [metric('elem', '首条提示词要素覆盖', .3, .75, 3), metric('clarify', 'Agent 追问率', .2, .03, 3)] },
    iter: { label: '迭代效率', metrics: [metric('rework', '返工率', .28, .05, 3), metric('clean', '无返工会话占比', .2, .85, 3), metric('turnsPerVer', '每条已验证结果轮次', 14, 3, 3, 'number')] },
    verify: { label: '验证把关', metrics: [metric('verShare', '已验证占比', .5, .95, 4), metric('testShare', '运行测试的会话占比', .15, .8, 3)] },
    output: { label: '产出转化', metrics: [metric('outIdx', '已验证结果指数', .5, 1.4, 3, 'multiple'), metric('effIdx', '产效比指数', .5, 1.5, 3, 'multiple')] },
    flow: { label: '协作节奏', metrics: [metric('permMed', '权限等待中位数', 6, .8, 3, 'minutes'), metric('longShare', '10 分钟以上等待占比', .35, .05, 3)] },
  },
  presets: { '默认': { adopt: 20, prompt: 20, iter: 20, verify: 20, output: 15, flow: 5 }, '重产出': { adopt: 15, prompt: 15, iter: 15, verify: 15, output: 35, flow: 5 }, '重质量': { adopt: 10, prompt: 25, iter: 25, verify: 30, output: 10, flow: 0 } },
  levels: [{ minimum: 72, label: '较好' }, { minimum: 60, label: '一般' }, { minimum: 0, label: '需提升' }],
  confidence: { high: { sessions: 8, prompts: 40 }, medium: { sessions: 5, prompts: 25 }, coverageDowngrade: 1 },
  marginNumerator: 26, strengthMinimum: 70, priorityBelow: 60, maximumRecommendations: 2,
  baseline: { range: 'since-enrollment', verifiedMeanFloor: .5, efficiency: 'verified-per-million-input-tokens', completed: 'native-latest-turn-waiting-input', zeroMedian: 'unknown' },
  tips: { adopt: '把排查、补测试、整理文档这类日常任务也交给 Agent，保持每个工作日都在用', iter: '动手前让 Agent 先复述方案并确认；把不能改动的范围写进第一条提示词', verify: '要求 Agent 运行测试并贴出结果；对“已验证”“已通过”的说法追问证据', output: '把任务拆小，每个会话以一个可验证的结果收尾（测试通过或提交）', flow: '把 git diff、测试等只读命令加入允许列表，减少 Agent 等待批准' },
  promptTips: { goal: '第一句写清要达成的目标', constraints: '写明不能改动的文件、接口或环境', context: '附上文件路径、报错日志或复现步骤', acceptance: '写明怎样算完成，例如要跑哪些测试' },
};
export const assessmentModelVersion = digest(JSON.stringify(assessmentModel));
export function emptyDimensions(preset: AssessmentPreset = '默认'): CapabilityAssessment['dims'] {
  const dims = {} as CapabilityAssessment['dims'];
  for (const key of dimKeys) dims[key] = { label: assessmentModel.dimensions[key].label, score: null,
    weight: assessmentModel.presets[preset][key], effectiveWeight: 0, teamMedian: null,
    metrics: assessmentModel.dimensions[key].metrics.map(def => ({ ...def, value: null, score: null, samples: 0,
      state: def.key === 'permMed' ? 'unknown' : 'insufficient', evidence: [], evidenceCount: 0,
      reason: def.key === 'permMed' ? '来源未记录可核对的权限请求与决定时刻' : '样本不足' })) };
  return dims;
}

export function scoreMetric(target: MetricScore, value: number | null, samples: number, reason?: string) {
  target.samples = samples;
  target.state = value === null ? 'unknown' : samples < target.minimum ? 'insufficient' : 'scored';
  target.value = target.state === 'scored' ? value : null;
  target.reason = target.state === 'unknown' ? reason ?? '来源数据未知' : target.state === 'insufficient' ? '样本不足' : null;
  target.score = target.value === null ? null : Math.max(0, Math.min(100, (target.value - target.anchor[0]) / (target.anchor[1] - target.anchor[0]) * 100));
}
export function concludeAssessment(dims: CapabilityAssessment['dims'], sample: CapabilityAssessment['sample'], issues: string[]) {
  for (const key of dimKeys) {
    const scores = dims[key].metrics.flatMap(m => m.score === null ? [] : [m.score]);
    dims[key].score = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  }
  const scored = dimKeys.filter(key => dims[key].score !== null), weight = scored.reduce((n, key) => n + dims[key].weight, 0);
  for (const key of dimKeys) dims[key].effectiveWeight = dims[key].score === null || !weight ? 0 : dims[key].weight / weight * 100;
  const index = weight ? Math.round(scored.reduce((n, key) => n + dims[key].score! * dims[key].weight, 0) / weight) : null;
  const enough = (rule: { sessions: number; prompts: number }) => sample.sessions >= rule.sessions && sample.prompts >= rule.prompts;
  let confidence = enough(assessmentModel.confidence.high) ? 3 : enough(assessmentModel.confidence.medium) ? 2 : 1;
  if (issues.length) confidence = Math.max(1, confidence - assessmentModel.confidence.coverageDowngrade);
  const strengths = scored.filter(key => Math.round(dims[key].score!) >= assessmentModel.strengthMinimum).sort((a, b) => dims[b].score! - dims[a].score!).slice(0, assessmentModel.maximumRecommendations);
  const low = scored.filter(key => Math.round(dims[key].score!) < assessmentModel.priorityBelow).sort((a, b) => dims[a].score! - dims[b].score!);
  const priorities = low.slice(0, assessmentModel.maximumRecommendations), tips = priorities.map(dim => ({ dim, text: dim === 'prompt' ? assessmentModel.promptTips.goal : assessmentModel.tips[dim] }));
  return { index, margin: sample.sessions ? Math.round(assessmentModel.marginNumerator / Math.sqrt(sample.sessions)) : null,
    confidence: (['低', '中', '高'] as const)[confidence - 1]!,
    level: (confidence === 1 || index === null ? '待定' : assessmentModel.levels.find(level => index >= level.minimum)!.label) as CapabilityAssessment['level'],
    strengths, priorities, tips, reason: !sample.sessions ? '暂无会话' : `${low.length} 个维度低于 60 分${strengths.length ? ` · ${strengths.map(key => dims[key].label).join('、')}为强项` : ''}` };
}
