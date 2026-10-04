import { useEffect, useState } from 'react';
import { dimKeys } from '../../packages/contracts/assessment.js';
import { capabilityLevels, type CapabilityPeople as People, type CapabilityCard } from '../../packages/contracts/capability-people.js';
import './capability-people.css';

type Request = (path: string, signal?: AbortSignal) => Promise<Response>;
type Model = { dimensions: Record<string, { label: string; metrics: { label: string; anchor: [number, number]; minimum: number; unit: string }[] }>;
  presets: Record<string, Record<string, number>> };
const selected = () => new URLSearchParams(location.hash.split('?')[1]);
const number = (value: number | null) => value === null ? '—' : Math.round(value).toLocaleString('zh-CN');
const percent = (value: number | null) => value === null ? '—' : (value * 100).toLocaleString('zh-CN', { maximumFractionDigits: 1 }) + '%';
function Measures({ person }: { person: CapabilityCard }) {
  return <p className="people-measures">{person.sample.sessions} 会话 · {person.sample.prompts} 提示词<br />已验证 {number(person.verified.value)}{person.verified.value === null && `（已知 ${person.verified.known}）`} · 返工 {percent(person.rework.value)}
    {person.rework.value !== null && <span>（{person.rework.numerator} / {person.rework.denominator}）</span>}</p>;
}
export function CapabilityPeople({ request }: { request: Request }) {
  const [query, setQuery] = useState(selected), [data, setData] = useState<People>(), [model, setModel] = useState<Model>(), [error, setError] = useState('');
  const [busy, setBusy] = useState(false), [table, setTable] = useState(false), [retry, setRetry] = useState(0);
  useEffect(() => { const change = () => setQuery(selected()); window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change); }, []);
  useEffect(() => {
    const abort = new AbortController(); setBusy(true); setError(''); setData(undefined);
    (async () => {
      const first: People = await (await request('/api/capability-people?' + query, abort.signal)).json();
      let value = first;
      while (value.nextOffset !== null) {
        const page: People = await (await request('/api/capability-people?' + new URLSearchParams({ version: first.version, offset: String(value.nextOffset) }), abort.signal)).json();
        value = { ...first, employees: [...value.employees, ...page.employees], nextOffset: page.nextOffset };
      }
      if (!abort.signal.aborted) setData(value);
    })().catch(e => { if (!abort.signal.aborted) setError(e.message); }).finally(() => { if (!abort.signal.aborted) setBusy(false); });
    return () => abort.abort();
  }, [query.toString(), retry]);
  useEffect(() => {
    if (!data?.modelVersion) return;
    const abort = new AbortController(); request('/api/assessment-models/' + data.modelVersion, abort.signal).then(r => r.json()).then(value => { if (!abort.signal.aborted) setModel(value); }).catch(e => { if (!abort.signal.aborted) setError(e.message); });
    return () => abort.abort();
  }, [data?.modelVersion]);
  const period = query.get('period') ?? data?.selection.period ?? 'since-enrollment', preset = query.get('preset') ?? data?.selection.preset ?? '默认';
  function change(key: 'period' | 'preset', value: string) { location.hash = 'people?' + new URLSearchParams({ period, preset, [key]: value }); }
  async function download() {
    if (!data) return;
    try { const response = await request('/api/capability-people/export?version=' + data.version), url = URL.createObjectURL(await response.blob());
      const a = document.createElement('a'); a.href = url; a.download = 'people-' + data.version + '.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setError((e as Error).message); }
  }
  return <section className="people-page" aria-label="员工一览">
    <header className="people-heading"><h1>员工</h1><div><button onClick={() => setRetry(n => n + 1)} disabled={busy}>刷新</button><button disabled={!data} onClick={download}>导出当前版本</button></div></header>
    <div className="people-controls"><div role="group" aria-label="评估范围">{[['since-enrollment', '接入至今'], ['this-week', '本周'], ['last-week', '上周']].map(([key, label]) => <button key={key} aria-pressed={period === key} onClick={() => change('period', key!)}>{label}</button>)}</div>
      <div role="group" aria-label="权重方案">{['默认', '重产出', '重质量'].map(key => <button key={key} aria-pressed={preset === key} onClick={() => change('preset', key)}>{key}</button>)}</div>
      {query.has('version') && <a href={'#people?' + new URLSearchParams({ period, preset })}>查看当前一览</a>}</div>
    {error && <p role="alert" className="error">{error}</p>}{busy && <p role="status">正在读取员工…</p>}
    {data && <div className="people-scroll" key={data.version}>
      <div className="people-verdict">{data.groups.map(group => <section key={group.level} aria-label={group.level}><header><h2 data-level={group.level}>{group.level}</h2><span>{group.count} 人</span></header>
        {group.count ? <ul>{data.employees.filter(person => person.level === group.level).map(person => <li key={person.employeeId}><a href={person.profilePath}><strong>{person.employee}</strong><b>{number(person.index)}</b></a><p>{person.reason}</p></li>)}</ul> : <p className="people-empty-group">暂无</p>}</section>)}</div>
      <div className="people-section-heading"><h2>每位员工 <span>{data.total}</span></h2><div role="group" aria-label="员工展示"><button aria-pressed={!table} aria-label="员工卡片" onClick={() => setTable(false)}>卡片</button><button aria-pressed={table} aria-label="员工表格" onClick={() => setTable(true)}>表格</button></div></div>
      {data.total === 0 ? <p className="people-empty">暂无员工</p> : table ? <div className="people-table"><table aria-label="员工能力"><thead><tr><th>员工</th><th>等级</th><th>指数</th><th>估计误差</th><th>可信度</th>{dimKeys.map(key => <th key={key}>{model?.dimensions[key]?.label ?? key}</th>)}<th>会话</th><th>提示词</th><th>已验证</th><th>返工率</th><th>依据</th></tr></thead>
        <tbody>{data.employees.map(person => <tr key={person.employeeId}><th><a href={person.profilePath}>{person.employee}</a></th><td>{person.level}</td><td>{number(person.index)}</td><td>{person.margin === null ? '—' : `±${person.margin}`}</td><td>{person.confidence}</td>{dimKeys.map(key => <td key={key}>{number(person.dims[key].score)}</td>)}<td>{person.sample.sessions}</td><td>{person.sample.prompts}</td><td>{number(person.verified.value)}</td><td>{percent(person.rework.value)}{person.rework.value !== null && `（${person.rework.numerator}/${person.rework.denominator}）`}</td><td>{person.reason}{person.coverageIssues.length > 0 && ` · ${person.coverageIssues.join('；')}`}</td></tr>)}</tbody></table></div>
        : <ul className="people-grid">{data.employees.map(person => <li key={person.employeeId}><a className="people-card" href={person.profilePath} aria-label={person.employee + '：打开员工画像'}>
          <header><span className="people-avatar" aria-hidden="true">{person.employee.slice(0, 1)}</span><strong>{person.employee}</strong><span className="people-level" data-level={person.level}>{person.level}</span></header>
          {person.sample.sessions ? <p className="people-index"><b>{number(person.index)}</b><span>综合{person.margin !== null && ` · 估计误差 ±${person.margin}`}<br />可信度{person.confidence}</span></p> : <p className="people-no-sessions">暂无会话</p>}
          <ul className="people-dims">{dimKeys.map(key => <li key={key}><span>{person.dims[key].label}</span><span className="people-bar"><i style={{ width: (person.dims[key].score ?? 0) + '%' }} /></span><b>{number(person.dims[key].score)}</b></li>)}</ul>
          <Measures person={person} /><p className="people-reason">{person.reason}</p>{person.coverageIssues.length > 0 && <p className="people-coverage">{person.coverageIssues.join('；')}</p>}
        </a></li>)}</ul>}
      <details className="people-method"><summary>评估方法与口径</summary>{model && <div className="people-table"><table aria-label="评估方法"><thead><tr><th>维度</th><th>方案权重</th><th>指标</th><th>0 → 100 分</th><th>最小样本</th></tr></thead><tbody>{dimKeys.flatMap(key => model.dimensions[key]?.metrics.map(metric => <tr key={key + metric.label}><th>{model.dimensions[key]!.label}</th><td>{model.presets[preset]?.[key]}%</td><td>{metric.label}</td><td>{metric.anchor.map(value => metric.unit === 'ratio' ? percent(value) : value + (metric.unit === 'minutes' ? ' 分钟' : metric.unit === 'multiple' ? '×' : '')).join(' → ')}</td><td>{metric.minimum}</td></tr>) ?? [])}</tbody></table></div>}
        <p>使用固定锚点，产出按团队同类任务校正。单项样本不足不计分，缺失维度按比例重分配权重；低可信度暂不评级。</p><p>指数先取整，72 分起为较好，60—71 为一般。该结果用于辅导和经验分享，需结合原始证据人工复核。</p>
        <dl><dt>结果版本</dt><dd>{data.version}</dd><dt>模型版本</dt><dd>{data.modelVersion}</dd><dt>生成时间（北京时间）</dt><dd>{new Date(data.generatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}</dd></dl>
        <a href={'#people?version=' + data.version}>此版本固定链接</a></details>
    </div>}
  </section>;
}
