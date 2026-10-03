import { useEffect, useState, type FormEvent } from 'react';
import type { MetricCatalog, MetricTotals, MetricsPage, MetricsQuery } from '../../packages/contracts/metrics.js';
import { sourceLabel } from '../../packages/contracts/archive.js';

type Props = { request: (path: string, signal?: AbortSignal, method?: 'POST', body?: unknown) => Promise<Response> };
const params = (query: Partial<MetricsQuery>) => new URLSearchParams(Object.entries(query)
  .filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]));
const number = (value: number) => value.toLocaleString('zh-CN');
const tokens = (row: MetricTotals, kind: 'Input' | 'Output') => `${number(row[`known${kind}Tokens`])} 已知${row[`unknown${kind}Sessions`] ? ` · ${row[`unknown${kind}Sessions`]} 会话未知` : ''}`;

export function UsageMetrics({ request }: Props) {
  const [draft, setDraft] = useState<MetricsQuery>({ period: 'this-week', offset: 0 });
  const [query, setQuery] = useState<MetricsQuery>(draft);
  const [page, setPage] = useState<MetricsPage | null>(null);
  const [catalog, setCatalog] = useState<MetricCatalog | null>(null);
  const [employees, setEmployees] = useState<Array<{ employeeId: string; employee: string }>>([]);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [retry, setRetry] = useState(0);
  const [chart, setChart] = useState(false); const [exporting, setExporting] = useState(false); const [message, setMessage] = useState('');
  useEffect(() => {
    const abort = new AbortController(); setBusy(true); setError(''); setPage(null); setMessage('');
    Promise.all([request(`/api/metrics?${params(query)}`, abort.signal).then(value => value.json()),
      request('/api/metrics/catalog', abort.signal).then(value => value.json())]).then(([data, definitions]: [MetricsPage, MetricCatalog]) => {
      if (abort.signal.aborted) return;
      setPage(data); setCatalog(definitions);
      setEmployees(previous => [...new Map([...previous, ...data.employees].map(person => [person.employeeId, { employeeId: person.employeeId, employee: person.employee }])).values()]
        .sort((a, b) => a.employee.localeCompare(b.employee, 'zh-CN') || a.employeeId.localeCompare(b.employeeId)));
    }).catch(failure => { if (!abort.signal.aborted) setError(failure.message); })
      .finally(() => { if (!abort.signal.aborted) setBusy(false); });
    return () => abort.abort();
  }, [query, retry]);
  function apply(event: FormEvent) { event.preventDefault(); setQuery({ ...draft, offset: 0, version: undefined }); }
  async function recompute() {
    setBusy(true); setError(''); setMessage('');
    try {
      const data: MetricsPage = await (await request('/api/metrics/recompute', undefined, 'POST', { ...query, offset: 0, version: undefined })).json();
      setQuery({ ...query, offset: 0, version: data.version });
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }
  async function download() {
    if (!page) return;
    setExporting(true); setError('');
    try {
      const response = await request(`/api/metrics/export?${params({ ...query, offset: 0, version: page.version })}`);
      const url = URL.createObjectURL(await response.blob()); const anchor = document.createElement('a');
      anchor.href = url; anchor.download = `skynet-metrics-${page.version}.json`; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000); setMessage('已准备当前版本的完整指标下载。');
    } catch (failure) { setError((failure as Error).message); }
    finally { setExporting(false); }
  }
  const maximum = Math.max(1, ...page?.daily.map(day => day.knownInputTokens + day.knownOutputTokens) ?? []);
  return <section className="usage-metrics" aria-label="用量指标">
    <div className="heading"><div><p className="eyebrow">来源记录 · 北京时间</p><h1>用量指标</h1></div>
      <button onClick={() => document.getElementById('metric-definitions')?.scrollIntoView({ block: 'start' })}>查看指标口径</button></div>
    <p className="muted">会话、用户轮次、工具调用和原生 Token 使用同一份存档计算。未知用量单独列出。</p>
    <form className="metric-filters" onSubmit={apply}><div className="search-fields">
      <label>时间范围<select value={draft.period} onChange={event => setDraft({ ...draft, period: event.target.value as MetricsQuery['period'] })}>
        <option value="this-week">本周</option><option value="last-week">上周</option><option value="since-enrollment">接入至今</option><option value="custom">自定义日期</option></select></label>
      <label>员工<select value={draft.employeeId ?? ''} onChange={event => setDraft({ ...draft, employeeId: event.target.value || undefined })}>
        <option value="">全部员工</option>{employees.map(person => <option value={person.employeeId} key={person.employeeId}>{person.employee}</option>)}</select></label>
      <label>Agent<select value={draft.source ?? ''} onChange={event => setDraft({ ...draft, source: event.target.value as MetricsQuery['source'] || undefined })}>
        <option value="">全部 Agent</option><option value="codex-desktop">Codex Desktop</option><option value="codex-cli">Codex CLI</option><option value="claude-code-cli">Claude Code CLI</option></select></label>
      <label>项目路径<input value={draft.project ?? ''} maxLength={1024} disabled={draft.project === ''} placeholder="全部项目" onChange={event => setDraft({ ...draft, project: event.target.value || undefined })} /></label>
      {draft.period === 'custom' && <><label>开始日期<input type="date" value={draft.from ?? ''} max={draft.to} required onChange={event => setDraft({ ...draft, from: event.target.value })} /></label>
        <label>结束日期<input type="date" value={draft.to ?? ''} min={draft.from} required onChange={event => setDraft({ ...draft, to: event.target.value })} /></label></>}
    </div><label className="inline-check"><input type="checkbox" checked={draft.project === ''} onChange={event => setDraft({ ...draft, project: event.target.checked ? '' : undefined })} />仅未归类项目</label>
      <button className="primary" disabled={busy}>应用筛选</button></form>
    {busy && <p role="status">正在计算用量指标…</p>}
    {error && <><p className="error" role="alert">{error}</p><button disabled={busy} onClick={() => setRetry(value => value + 1)}>重试指标</button></>}
    {message && <p role="status">{message}</p>}
    {page && <>
      <p className="muted small">{page.scope.from} 至 {page.scope.to} · {page.totals.sessions === 0 && page.dataAsOf === new Date(0).toISOString()
        ? '尚无可确认数据截至时间' : `数据截至 ${new Date(page.dataAsOf).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}`} · 版本 {page.revision}</p>
      {!page.sourceInputsComplete && <p className="notice">部分指标未知或来源完整性未确认，已知部分可查，未知部分未计为零。{page.unknownReasons.join('；')}</p>}
      <dl className="metric-totals"><div><dt>会话</dt><dd>{number(page.totals.sessions)}</dd></div><div><dt>用户轮次</dt><dd>{number(page.totals.userTurns)}</dd></div>
        <div><dt>工具调用</dt><dd>{number(page.totals.toolCalls)}</dd></div><div><dt>输入 Token</dt><dd>{tokens(page.totals, 'Input')}</dd></div>
        <div><dt>输出 Token</dt><dd>{tokens(page.totals, 'Output')}</dd></div></dl>
      <div className="export-actions"><button disabled={busy} onClick={recompute}>从原件重算</button><button disabled={busy || exporting} onClick={download}>{exporting ? '正在准备导出…' : '导出当前版本'}</button></div>
      <section aria-label="每日用量"><div className="heading"><h2>每日已知用量</h2><button aria-pressed={chart} onClick={() => setChart(value => !value)}>{chart ? '切换为表格' : '切换为图表'}</button></div>
        {chart ? <figure className="metric-chart"><figcaption>输入与输出 Token（已知部分）；未知会话在每行单列</figcaption>
          {page.daily.map(day => <div className="metric-chart-row" key={day.date}><span>{day.date}</span><svg viewBox="0 0 320 28" role="img" aria-label={`${day.date} 输入 ${tokens(day, 'Input')}，输出 ${tokens(day, 'Output')}`}>
            <rect x="0" y="3" width={day.knownInputTokens / maximum * 320} height="22" className="metric-input-bar" />
            <rect x={day.knownInputTokens / maximum * 320} y="3" width={day.knownOutputTokens / maximum * 320} height="22" className="metric-output-bar" /></svg>
            <span>{number(day.knownInputTokens + day.knownOutputTokens)} 已知 · {day.unknownTokenSessions} 会话未知</span></div>)}
          <p className="muted small">蓝色：输入；绿色：输出。空条仅表示已知值为零，未知值请参照文字。</p></figure>
          : <div className="metric-table-scroll"><table><caption>按来源日期归期的已知用量与未知会话</caption><thead><tr><th>日期</th><th>会话</th><th>用户轮次</th><th>输入 Token</th><th>输出 Token</th></tr></thead>
            <tbody>{page.daily.map(day => <tr key={day.date}><th scope="row">{day.date}</th><td>{day.sessions}</td><td>{day.userTurns}</td><td>{tokens(day, 'Input')}</td><td>{tokens(day, 'Output')}</td></tr>)}</tbody></table></div>}
        {page.daily.length === 0 && <p>所选范围没有已确认接入后的来源活动。</p>}</section>
      <section aria-label="会话用量"><h2>会话明细</h2><p className="muted small">按原员工、项目及会话下钻；原件保留固定快照。跨日会话数不能直接相加。</p>
        <div className="metric-table-scroll"><table><caption>当前指标版本的会话分页</caption><thead><tr><th>员工 / 项目</th><th>Agent</th><th>轮次 / 工具</th><th>输入 Token</th><th>输出 Token</th><th>原件</th></tr></thead>
          <tbody>{page.sessions.map(session => <tr key={`${session.sessionId}:${session.employeeId}:${session.project}`}><th scope="row">{session.employee}<span className="muted small metric-cell-detail">{session.project || '未归类项目'}</span></th>
            <td>{sourceLabel(session.source)}</td><td>{session.userTurns} / {session.toolCalls}</td><td>{tokens(session, 'Input')}</td><td>{tokens(session, 'Output')}</td>
            <td><a href={session.webPath}>查看会话</a>{!session.sourceInputsComplete && <span className="metric-cell-detail">指标含未知</span>}</td></tr>)}</tbody></table></div>
        {page.sessions.length === 0 && <p>没有符合条件的会话。</p>}
        <div className="pagination"><button disabled={busy || query.offset === 0} onClick={() => setQuery({ ...query, version: page.version, offset: Math.max(0, query.offset - 20) })}>上一页会话</button>
          <button disabled={busy || page.nextOffset === null} onClick={() => setQuery({ ...query, version: page.version, offset: page.nextOffset! })}>下一页会话</button></div></section>
    </>}
    {catalog && <section id="metric-definitions" className="metric-definitions" aria-label="指标口径"><h2>指标口径</h2>
      <dl>{catalog.definitions.map(item => <div key={item.key}><dt>{item.label}</dt><dd>{item.definition}<span className="metric-cell-detail muted small">{item.origin}</span></dd></div>)}</dl>
      <ul>{catalog.limitations.map(item => <li key={item}>{item}</li>)}</ul></section>}
  </section>;
}
