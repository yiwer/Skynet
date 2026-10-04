import { useEffect, useRef, useState } from 'react';
import { dimKeys, type CapabilityAssessment as Assessment, type MetricScore, type AssessmentHistoryPage } from '../../packages/contracts/assessment.js';
import './assessment.css';
import { ReviewNotes, type AppendNote } from './ReviewNotes.js';
type Request = (path: string, signal?: AbortSignal) => Promise<Response>;
const selection = () => new URLSearchParams(location.hash.split('?')[1]);
const periods = [['since-enrollment', '接入至今'], ['this-week', '本周'], ['last-week', '上周']] as const;
const presets = ['默认', '重产出', '重质量'] as const;
const profile = (employeeId: string, period: string, preset: string, version?: string) => '#profile?' + new URLSearchParams({ employeeId, period, preset, ...(version ? { version } : {}) });
const number = (value: number | null) => value === null ? '—' : Math.round(value).toLocaleString('zh-CN');
function formatted(value: number | null, unit: MetricScore['unit']) {
  if (value === null) return '—';
  const factor = unit === 'ratio' ? 100 : 1;
  return Number((value * factor).toFixed(1)).toLocaleString('zh-CN') + ({ ratio: '%', multiple: '×', minutes: ' 分钟', number: '' }[unit]);
}
export function CapabilityAssessment({ request, currentEmployeeId, appendNote }: { request: Request; currentEmployeeId: string; appendNote?: AppendNote }) {
  const [query, setQuery] = useState(selection), [data, setData] = useState<Assessment>(), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0), [people, setPeople] = useState<{ id: string; name: string }[]>([]), [next, setNext] = useState<number | null>(null);
  const [history, setHistory] = useState<AssessmentHistoryPage>(), [historyBusy, setHistoryBusy] = useState(false);
  const historyAbort = useRef<AbortController | null>(null);
  const employeeId = query.get('employeeId') ?? currentEmployeeId, version = query.get('version');
  const requestedPeriod = query.get('period'), requestedPreset = query.get('preset');
  const period = version ? data?.selection?.period ?? requestedPeriod ?? 'since-enrollment' : requestedPeriod ?? 'since-enrollment';
  const preset = version ? data?.preset ?? requestedPreset ?? '默认' : requestedPreset ?? '默认';
  useEffect(() => { const change = () => setQuery(selection()); window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change); }, []);
  useEffect(() => {
    const abort = new AbortController(); setBusy(true); setData(undefined); setError('');
    const params = new URLSearchParams({ ...(version ? { version } : {}), ...(requestedPeriod ? { period: requestedPeriod } : {}), ...(requestedPreset ? { preset: requestedPreset } : {}) });
    request(`/api/assessments/${employeeId}?${params}`, abort.signal).then(r => r.json()).then(value => { if (!abort.signal.aborted) setData(value); })
      .catch(e => { if (!abort.signal.aborted) setError(e.message); }).finally(() => { if (!abort.signal.aborted) setBusy(false); });
    return () => abort.abort();
  }, [employeeId, version, requestedPeriod, requestedPreset, retry]);
  useEffect(() => {
    if (!data) return; const abort = new AbortController(); historyAbort.current = abort; setHistoryBusy(true); setHistory(undefined);
    request(`/api/assessments/${employeeId}/history`, abort.signal).then(r => r.json()).then(value => { if (!abort.signal.aborted) setHistory(value); })
      .catch(e => { if (!abort.signal.aborted) setError(e.message); }).finally(() => { if (!abort.signal.aborted) setHistoryBusy(false); });
    return () => historyAbort.current?.abort();
  }, [employeeId, data?.version, retry]);
  async function moreHistory() {
    if (!history?.nextCursor) return; const abort = new AbortController(); historyAbort.current?.abort(); historyAbort.current = abort; setHistoryBusy(true);
    try { const next: AssessmentHistoryPage = await (await request(`/api/assessments/${employeeId}/history?cursor=${history.nextCursor}`, abort.signal)).json();
      if (!abort.signal.aborted) setHistory(value => value ? { ...next, items: [...value.items, ...next.items] } : next);
    } catch (e) { if (!abort.signal.aborted) setError((e as Error).message); } finally { if (!abort.signal.aborted) setHistoryBusy(false); }
  }
  useEffect(() => { const abort = new AbortController(); request('/api/daily-report-employees', abort.signal).then(r => r.json()).then(value => {
    if (!abort.signal.aborted) { setPeople(value.employees); setNext(value.nextOffset); }
  }).catch(e => { if (!abort.signal.aborted) setError(e.message); }); return () => abort.abort(); }, []);
  async function download(kind: 'assessment' | 'model' | 'baseline' = 'assessment') {
    if (!data) return;
    const ref = kind === 'model' ? data.modelVersion : kind === 'baseline' ? data.inputs.baselineVersion : data.version;
    const path = kind === 'assessment' ? `/api/assessments/${employeeId}/export?version=${ref}` : `/api/assessment-${kind}s/${ref}`;
    try { const response = await request(path), url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a'); link.href = url; link.download = `${kind}-${ref}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setError((e as Error).message); }
  }
  return <section className="assessment-page">
    <header className="assessment-heading"><div><p>员工画像</p><h1>{data?.employee ?? people.find(p => p.id === employeeId)?.name ?? '使用能力评估'}</h1></div>
      <div className="assessment-actions"><button onClick={() => setRetry(n => n + 1)} disabled={busy}>刷新</button><button onClick={() => download()} disabled={!data}>导出评估</button></div></header>
    <div className="assessment-controls"><label>员工<select aria-label="评估员工" value={employeeId} onChange={e => { location.hash = profile(e.target.value, period, preset); }}>
      {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      {next !== null && <button onClick={async () => { try { const value = await (await request('/api/daily-report-employees?offset=' + next)).json(); setPeople(p => [...p, ...value.employees]); setNext(value.nextOffset); } catch (e) { setError((e as Error).message); } }}>更多员工</button>}
      <div className="assessment-segments" role="group" aria-label="评估周期">{periods.map(([value, label]) => <button key={value} type="button" aria-pressed={period === value} disabled={busy} onClick={() => { location.hash = profile(employeeId, value, preset); }}>{label}</button>)}</div>
      <div className="assessment-segments" role="group" aria-label="权重方案">{presets.map(value => <button key={value} type="button" aria-pressed={preset === value} disabled={busy} onClick={() => { location.hash = profile(employeeId, period, value); }}>{value}</button>)}</div>
      {version && <a href={profile(employeeId, period, preset)}>查看当前评估</a>}</div>
    {error && <p className="error" role="alert">{error}</p>}{busy && <p role="status">正在读取评估…</p>}
    {data && <div key={data.version} className="assessment-content" data-scroll-region="assessment">
      <div className="assessment-range" aria-label="评估范围"><span>{version ? '历史评估 · ' : ''}{data.period} · {data.preset}</span><span>{data.range.empty ? '所选周期早于接入' : `${data.range.from ?? '接入日未知'} — ${data.range.to}`} · 北京时间</span></div>
      <details className="assessment-history"><summary>历史评估</summary>{historyBusy && <p role="status">正在读取版本…</p>}
        {history && <><ol>{history.items.map(item => <li key={item.version}><a href={profile(employeeId, item.selection?.period ?? 'since-enrollment', item.preset, item.version)} aria-current={version === item.version ? 'page' : undefined}>
          <strong>{item.period} · {item.preset}</strong><span>{new Date(item.generatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })} · {number(item.index)} 分 · {item.level}</span><small>{item.version.slice(0, 12)}</small></a></li>)}</ol>
          {history.nextCursor && <button onClick={moreHistory} disabled={historyBusy}>更多历史版本</button>}</>}</details>
      {!data.sample.sessions ? <p className="assessment-empty" data-testid="assessment-empty">{data.range.empty ? '所选周期早于接入' : '暂无会话'}</p> : <>
      <section className="assessment-verdict" aria-label="评估结论"><div><p className="assessment-eyebrow">使用 Coding Agent 的能力</p><div className="assessment-score"><span className="assessment-level" data-level={data.level}>{data.level}</span>
        <strong data-testid="assessment-index">{number(data.index)}</strong>{data.index !== null && <span>/ 100</span>}</div>
        <p className="assessment-reason">{data.reason}</p><p className="assessment-confidence">可信度{data.confidence}{data.margin !== null && ` · 估计误差 ±${data.margin}`}</p>
        <div className="assessment-sample"><span>{data.sample.sessions} 个会话</span><span>{data.sample.prompts} 条提示词</span><span>{data.sample.activeDays} 个活跃日</span></div></div>
        {!!(data.strengths.length || data.priorities.length) && <aside>{data.strengths.length > 0 && <><h2>强项</h2><div className="assessment-chips">{data.strengths.map(key => <span key={key}>{data.dims[key].label} {number(data.dims[key].score)}</span>)}</div></>}
          {data.tips.length > 0 && <><h2>优先提升</h2><ul>{data.tips.map(tip => <li key={tip.dim}><strong>{data.dims[tip.dim].label}</strong><span>{tip.text}</span></li>)}</ul></>}</aside>}</section>
      {data.coverageIssues.length > 0 && <details className="assessment-coverage"><summary>采集覆盖 · {data.coverageIssues.length} 项</summary><ul>{data.coverageIssues.map(issue => <li key={issue}>{issue}</li>)}</ul></details>}
      <div className="assessment-section-title"><h2>能力维度</h2><span>本人得分 <i /> 团队中位数</span></div>
      <div className="assessment-dimensions">{dimKeys.map(key => { const dim = data.dims[key], score = dim.score === null ? null : Math.round(dim.score), unknown = dim.metrics.every(metric => metric.state === 'unknown'); return <details className="assessment-dimension" key={key} open={score !== null && score < 60}>
        <summary><strong>{dim.label}</strong><div className="assessment-bar" role="img" aria-label={`${dim.label} ${number(score)} 分，团队中位数 ${number(dim.teamMedian)}`}><i style={{ width: (score ?? 0) + '%' }} />{dim.teamMedian !== null && <em style={{ left: dim.teamMedian + '%' }} />}</div>
          <b>{number(score)}</b><span className="assessment-dim-state" data-low={score !== null && score < 60 || undefined}>{score === null ? unknown ? '来源未知' : '样本不足' : score < 60 ? '待提升' : score >= 70 ? '强项' : '一般'}</span></summary>
        <div className="assessment-metrics" aria-label={dim.label + '指标'}>{dim.metrics.map(metric => <article key={metric.key}><div className="assessment-metric-heading"><strong>{metric.label}</strong><span>{metric.state === 'scored' ? `${number(metric.score)} 分` : metric.state === 'unknown' ? '来源未知' : '样本不足'}</span></div>
          <dl><div><dt>原始值</dt><dd>{formatted(metric.value, metric.unit)}</dd></div><div><dt>0 → 100 分</dt><dd>{formatted(metric.anchor[0], metric.unit)} → {formatted(metric.anchor[1], metric.unit)}</dd></div><div><dt>样本 {metric.samples}</dt><dd>门槛 {metric.minimum}</dd></div></dl>
          {metric.reason && <p>{metric.reason}</p>}{metric.evidence.length > 0 && <div className="assessment-evidence">{metric.evidence.map((item, index) => <a key={item.webPath + index} href={item.webPath}>{item.quote ? `原文 ${index + 1}` : '查看会话'}</a>)}</div>}</article>)}</div>
        <p className="assessment-weight">方案权重 {dim.weight}% · 本次权重 {Number(dim.effectiveWeight.toFixed(1))}%</p></details>; })}</div>
      {(data.representatives.best || data.representatives.rework) && <section className="assessment-representatives"><h2>代表性会话</h2>{data.representatives.best && <a href={data.representatives.best.webPath}>最佳示例</a>}{data.representatives.rework && <a href={data.representatives.rework.webPath}>返工较多</a>}</section>}
      </>}
      <ReviewNotes key={employeeId} employeeId={employeeId} assessmentVersion={data.version} request={request} appendNote={appendNote} />
      <details className="assessment-method"><summary>计算规则与版本</summary><p>单项按固定锚点线性折算至 0—100 分，样本不足或来源未知不计分。缺失维度的权重按比例分给其余维度。</p><p>综合指数先取整：72 分起为较好，60—71 分为一般。低可信度等级待定；误差按 26 ÷ √会话数取整估计。</p>
        <p>产出基线采用团队同类任务的接入至今数据；当前原生轮次结束且等待输入才纳入已结束样本，续聊会更新下一版。团队维度中位数只用于对照。活跃工作日分母截至评估生成日。</p>
        <table className="assessment-parameters" aria-label="当前评估权重"><caption>{data.preset}方案</caption><thead><tr><th>维度</th><th>方案权重</th><th>本次权重</th></tr></thead><tbody>{dimKeys.map(key => <tr key={key}><th scope="row">{data.dims[key].label}</th><td>{data.dims[key].weight}%</td><td>{Number(data.dims[key].effectiveWeight.toFixed(1))}%</td></tr>)}</tbody></table>
        <dl><div><dt>生成时间（北京时间）</dt><dd>{new Date(data.generatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}</dd></div><div><dt>模型版本</dt><dd>{data.modelVersion}</dd></div><div><dt>基线版本</dt><dd>{data.inputs.baselineVersion}</dd></div><div><dt>结果版本</dt><dd>{data.version}</dd></div></dl>
        <div className="assessment-actions"><a href={`#profile?employeeId=${employeeId}&version=${data.version}`}>此版本固定链接</a><button onClick={() => download('model')}>导出模型参数</button><button onClick={() => download('baseline')}>导出基线</button></div></details>
    </div>}
  </section>;
}
