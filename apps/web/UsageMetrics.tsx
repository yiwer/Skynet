import { useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import type { MetricTotals, MetricsPage, MetricsQuery } from '../../packages/contracts/metrics.js';
import { sourceLabel, type Source } from '../../packages/contracts/archive.js';
import './usage-metrics.css';

type Props = { request: (path: string, signal?: AbortSignal, method?: 'POST', body?: unknown) => Promise<Response> };
const params = (query: Partial<MetricsQuery>) => new URLSearchParams(Object.entries(query)
  .filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]));
const number = (value: number) => value.toLocaleString('zh-CN');
const compact = (value: number) => value >= 1e6 ? `${Number((value / 1e6).toFixed(2))}M` : value >= 1000 ? `${Number((value / 1000).toFixed(1))}k` : number(value);
const tokenUnknown = (row: MetricTotals, kind: 'Input' | 'Output') => row[kind === 'Input' ? 'inputTokens' : 'outputTokens'] === null;
const tokens = (row: MetricTotals, kind: 'Input' | 'Output') => tokenUnknown(row, kind) ? row[`known${kind}Tokens`] ? `${number(row[`known${kind}Tokens`])}*` : '—' : number(row[`known${kind}Tokens`]);
function TokenValue({ value, unknown, short = false }: { value: number; unknown: boolean; short?: boolean }) {
  return <span title={unknown ? value ? '部分用量未上报' : '用量未上报' : undefined}>{unknown && !value ? '未知' : short ? compact(value) : number(value)}{unknown && value > 0 && <sup className="usage-partial">*</sup>}</span>;
}
const agents: Source[] = ['claude-code-cli', 'codex-cli', 'codex-desktop'];
const sourceSeries = (source: Source) => agents.indexOf(source) + 1;
const trendValue = (day: MetricsPage['daily'][number], kind: 'inputTokens' | 'outputTokens') => day.tokenTrend ? day.tokenTrend[kind] : day[kind];
function Spark({ values }: { values: (number | null)[] }) {
  if (!values.some(value => value !== null)) return null;
  const maximum = Math.max(1, ...values.filter((value): value is number => value !== null));
  const segments: string[][] = []; let segment: string[] = [];
  values.forEach((value, index) => {
    if (value === null) { if (segment.length) segments.push(segment); segment = []; }
    else segment.push(`${4 + index / Math.max(1, values.length - 1) * 112},${24 - value / maximum * 18}`);
  });
  if (segment.length) segments.push(segment);
  return <svg className="usage-spark" viewBox="0 0 120 30" aria-hidden="true">{segments.map((points, index) => <g key={index}><polyline points={points.join(' ')} />{points.map(point => { const [cx, cy] = point.split(','); return <circle key={point} cx={cx} cy={cy} r="2" />; })}</g>)}</svg>;
}
function Stat({ label, value, children, trend }: { label: string; value: ReactNode; children?: ReactNode; trend?: (number | null)[] }) {
  return <div className="usage-stat"><dt>{label}</dt><dd>{value}</dd><div className="usage-stat-sub">{children}</div>{trend && <Spark values={trend} />}</div>;
}
function ViewToggle({ chart, setChart, daily = false }: { chart: boolean; setChart: (value: boolean) => void; daily?: boolean }) {
  return <div className="usage-view-toggle" role="group" aria-label={daily ? '每日用量显示方式' : '员工用量显示方式'}>
    <button type="button" aria-label={daily ? '切换为图表' : '员工用量切换为图表'} aria-pressed={chart} onClick={() => setChart(true)}>图表</button>
    <button type="button" aria-label={daily ? '切换为表格' : '员工用量切换为表格'} aria-pressed={!chart} onClick={() => setChart(false)}>表格</button>
  </div>;
}
function Person({ name, index }: { name: string; index: number }) {
  return <span className="usage-person"><span className="usage-avatar" data-tone={index % 6} aria-hidden="true">{Array.from(name)[0]}</span><span>{name}</span></span>;
}
export function UsageMetrics({ request }: Props) {
  const [draft, setDraft] = useState<MetricsQuery>({ period: 'this-week', offset: 0 });
  const [query, setQuery] = useState<MetricsQuery>(draft);
  const [page, setPage] = useState<MetricsPage | null>(null);
  const [complete, setComplete] = useState<MetricsPage | null>(null);
  const [employees, setEmployees] = useState<Array<{ employeeId: string; employee: string }>>([]);
  const [projects, setProjects] = useState<string[]>([]); const [customProject, setCustomProject] = useState(false); const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [retry, setRetry] = useState(0);
  const [dayTooltip, setDayTooltip] = useState(''); const [agentTooltip, setAgentTooltip] = useState('');
  const [chart, setChart] = useState(true); const [peopleChart, setPeopleChart] = useState(true);
  const [chartError, setChartError] = useState(''); const [chartRetry, setChartRetry] = useState(0);
  const [exporting, setExporting] = useState(false); const [message, setMessage] = useState('');
  useEffect(() => {
    const abort = new AbortController(); setBusy(true); setError(''); setPage(null); setMessage('');
    request(`/api/metrics?${params(query)}`, abort.signal).then(value => value.json()).then((data: MetricsPage) => {
      if (abort.signal.aborted) return;
      setPage(data);
      setEmployees(previous => [...new Map([...previous, ...data.employees].map(person => [person.employeeId, { employeeId: person.employeeId, employee: person.employee }])).values()]
        .sort((a, b) => a.employee.localeCompare(b.employee, 'zh-CN') || a.employeeId.localeCompare(b.employeeId)));
    }).catch(failure => { if (!abort.signal.aborted) setError(failure.message); })
      .finally(() => { if (!abort.signal.aborted) setBusy(false); });
    return () => abort.abort();
  }, [query, retry]);
  useEffect(() => {
    if (!page || complete?.version === page.version) return;
    const abort = new AbortController(); setChartError('');
    if (query.offset === 0 && page.nextOffset === null) { setComplete(page); return; }
    // A session page is never a complete employee/Agent distribution. Read
    // the same persisted version's bounded full export to draw this chart.
    request(`/api/metrics/export?${params({ ...query, offset: 0, version: page.version })}`, abort.signal)
      .then(response => response.json()).then((data: MetricsPage) => { if (!abort.signal.aborted) setComplete(data); })
      .catch(failure => { if (!abort.signal.aborted) setChartError(failure.message); });
    return () => abort.abort();
  }, [page?.version, chartRetry]);
  useEffect(() => { if (complete) setProjects(previous => [...new Set([...previous, ...complete.sessions.map(session => session.project).filter(Boolean)])].sort((a, b) => a.localeCompare(b, 'zh-CN'))); }, [complete?.version]);
  function selectScope(next: MetricsQuery) {
    setDraft(next);
    setQuery({ ...next, offset: 0, version: undefined });
  }
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
      setTimeout(() => URL.revokeObjectURL(url), 1000); setMessage('导出已准备好');
    } catch (failure) { setError((failure as Error).message); }
    finally { setExporting(false); }
  }
  const allSessions = complete?.version === page?.version ? complete?.sessions : undefined;
  const displayedAgents = agents.filter(source => page?.sources.some(row => row.source === source));
  const people = page?.employees.map(person => ({ ...person, agents: displayedAgents.map(source => {
    const rows = allSessions?.filter(session => session.employeeId === person.employeeId && session.source === source) ?? [];
    return { source, input: rows.reduce((sum, session) => sum + session.knownInputTokens, 0), unknown: rows.some(session => session.inputTokens === null) };
  }) })) ?? [];
  const hasInput = page && (page.sessions.length > 0 || page.totals.knownInputTokens > 0);
  const hasOutput = page && (page.sessions.length > 0 || page.totals.knownOutputTokens > 0);
  const hasUsage = page && page.employees.length > 0 && (page.totals.sessions > 0 || page.totals.userTurns > 0 || page.totals.toolCalls > 0 || hasInput || hasOutput);
  const employeeMaximum = Math.max(1, ...people.map(person => person.knownInputTokens));
  const dailyMaximum = Math.max(1, ...page?.daily.map(day => (trendValue(day, 'inputTokens') ?? 0) + (trendValue(day, 'outputTokens') ?? 0)) ?? []);
  const dailyWidth = Math.max(600, (page?.daily.length ?? 0) * 44);
  return <section className="usage-metrics workspace-page" aria-label="用量指标" aria-busy={busy}>
    <div className="usage-page-head"><h1 aria-label="用量指标">用量与产出</h1>{page && <div className="usage-export-actions"><button disabled={busy} onClick={recompute}>从原件重算</button><button disabled={busy || exporting} onClick={download}>{exporting ? '正在导出…' : '导出当前版本'}</button></div>}</div>
    <form className="usage-filters" onSubmit={apply} aria-label="用量筛选"><div className="usage-filter-row">
      <div className="usage-periods" role="group" aria-label="时间范围">
        {([['this-week', '本周'], ['last-week', '上周'], ['since-enrollment', '接入至今']] as const).map(([period, label]) => <button key={period} type="button" aria-pressed={draft.period === period} onClick={() => selectScope({ ...draft, period })}>{label}</button>)}
      </div>
      <label>员工<select value={draft.employeeId ?? ''} onChange={event => selectScope({ ...draft, employeeId: event.target.value || undefined })}>
        <option value="">全部员工</option>{employees.map(person => <option value={person.employeeId} key={person.employeeId}>{person.employee}</option>)}</select></label>
      <label>Agent<select value={draft.source ?? ''} onChange={event => selectScope({ ...draft, source: event.target.value as MetricsQuery['source'] || undefined })}>
        <option value="">全部 Agent</option><option value="codex-desktop">Codex Desktop</option><option value="codex-cli">Codex CLI</option><option value="claude-code-cli">Claude Code CLI</option></select></label>
      <label>项目<select value={customProject ? 'custom' : draft.project === undefined ? 'all' : draft.project === '' ? 'unclassified' : `project:${draft.project}`} onChange={event => {
        const value = event.target.value;
        if (value === 'custom') { setCustomProject(true); setAdvanced(true); return; }
        setCustomProject(false); selectScope({ ...draft, project: value === 'all' ? undefined : value === 'unclassified' ? '' : value.slice(8) });
      }}><option value="all">全部项目</option>{projects.map(project => <option value={`project:${project}`} key={project}>{project}</option>)}{draft.project === '' && <option value="unclassified">未归类项目</option>}<option value="custom">自定义路径…</option></select></label>
      </div>
      <div className="usage-filter-meta"><button className="usage-advanced-toggle" type="button" aria-expanded={advanced} aria-controls="usage-advanced-filters" onClick={() => setAdvanced(value => !value)}>更多筛选{draft.project === '' ? ' · 未归类' : ''}</button>
        <p>{page && <>{page.scope.from} — {page.scope.to} · 北京时间 · 数据截至 {new Date(page.dataAsOf).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}</>}</p></div>
      {advanced && <div className="usage-advanced-filters" id="usage-advanced-filters"><label className="usage-project-check"><input type="checkbox" checked={draft.project === ''} onChange={event => { setCustomProject(false); selectScope({ ...draft, project: event.target.checked ? '' : undefined }); }} />仅未归类项目</label>
        {customProject && <div className="usage-custom-project"><label>项目路径<input value={draft.project ?? ''} maxLength={1024} placeholder="输入完整项目路径" onChange={event => setDraft({ ...draft, project: event.target.value || undefined })} /></label><button className="usage-apply" disabled={busy}>应用筛选</button></div>}
      </div>}
    </form>
    <div className="workspace-scroll">
    {busy && <p className="usage-status" role="status">正在计算用量指标…</p>}
    {error && <div className="usage-error" role="alert"><p>{error}</p><button disabled={busy} onClick={() => setRetry(value => value + 1)}>重试指标</button></div>}
    {message && <p className="usage-status usage-success" role="status">{message}</p>}
    {page && !hasUsage && <p className="usage-empty">暂无用量</p>}
    {page && hasUsage && <>
      <dl className="usage-stats">
        {hasInput && <Stat label="输入 Token" value={<TokenValue value={page.totals.knownInputTokens} unknown={tokenUnknown(page.totals, 'Input')} short />} trend={page.daily.map(day => trendValue(day, 'inputTokens'))}>{page.totals.unknownInputSessions > 0 && <>未知 {page.totals.unknownInputSessions} 个会话</>}</Stat>}
        {hasOutput && <Stat label="输出 Token" value={<TokenValue value={page.totals.knownOutputTokens} unknown={tokenUnknown(page.totals, 'Output')} short />} trend={page.daily.map(day => trendValue(day, 'outputTokens'))}>{page.totals.unknownOutputSessions > 0 && <>未知 {page.totals.unknownOutputSessions} 个会话</>}</Stat>}
        <Stat label="会话" value={number(page.totals.sessions)} />
        <Stat label="用户轮次" value={number(page.totals.userTurns)} />
        <Stat label="工具调用" value={number(page.totals.toolCalls)} />
      </dl>
      {(hasInput || hasOutput) && <div className="usage-figure-grid">
        {hasInput && <section className="usage-figure" aria-label="员工用量"><div className="usage-figure-head"><div><h2>每人输入 Token</h2></div><ViewToggle chart={peopleChart} setChart={setPeopleChart} /></div>
          {!allSessions ? chartError ? <div className="usage-error" role="alert"><p>{chartError}</p><button onClick={() => setChartRetry(value => value + 1)}>重试员工图表</button></div> : <p className="usage-status" role="status">正在读取当前版本的完整用量…</p>
            : peopleChart ? <div className="usage-horizontal-bars" role="list" aria-label="各员工按 Agent 归集的已知输入 Token">
              {people.map((person, index) => <div className="usage-bar-row" role="listitem" key={person.employeeId}><Person name={person.employee} index={index} /><div className="usage-bar-plot"><div className="usage-bar-track" style={{ '--bar-width': `${person.knownInputTokens / employeeMaximum * 80}%` } as CSSProperties}>
                {person.agents.filter(agent => agent.input > 0).map(agent => <span className="usage-bar-segment" key={agent.source} data-series={sourceSeries(agent.source)} style={{ flexGrow: agent.input }} tabIndex={0} role="img" onFocus={event => setAgentTooltip(event.currentTarget.getAttribute('aria-label')!)} onBlur={() => setAgentTooltip('')} onMouseEnter={event => setAgentTooltip(event.currentTarget.getAttribute('aria-label')!)} onMouseLeave={() => setAgentTooltip('')} onKeyDown={event => { if (event.key === 'Escape') setAgentTooltip(''); }} aria-label={`${person.employee} · ${sourceLabel(agent.source)} · ${number(agent.input)}${agent.unknown ? '（部分）' : ''}`} />)}</div><span className="usage-bar-value"><TokenValue value={person.knownInputTokens} unknown={tokenUnknown(person, 'Input')} short /></span></div></div>)}
              {people.length > 0 && <div className="usage-bar-axis" aria-hidden="true"><div /><div>{[0, 0.25, 0.5, 0.75, 1].map(tick => <span key={tick} style={{ left: `${tick * 80}%` }}>{compact(employeeMaximum * tick)}</span>)}</div></div>}
            </div> : <div className="usage-table-scroll"><table><caption>员工按 Agent 的已知输入 Token</caption><thead><tr><th>员工</th>{displayedAgents.map(source => <th key={source}>{sourceLabel(source)}</th>)}<th>合计</th></tr></thead><tbody>{people.map(person => <tr key={person.employeeId}><th scope="row">{person.employee}</th>{person.agents.map(agent => <td key={agent.source}><TokenValue value={agent.input} unknown={agent.unknown} /></td>)}<td><TokenValue value={person.knownInputTokens} unknown={tokenUnknown(person, 'Input')} /></td></tr>)}</tbody></table></div>}
          {agentTooltip && peopleChart && <p className="usage-chart-tooltip" role="tooltip">{agentTooltip}</p>}
          <ul className="usage-legend">{displayedAgents.map(source => <li key={source}><i data-series={sourceSeries(source)} />{sourceLabel(source)}</li>)}</ul>
        </section>}
      {(hasInput || hasOutput) && <section className="usage-figure" aria-label="每日用量"><div className="usage-figure-head"><div><h2>每日 Token</h2></div><ViewToggle chart={chart} setChart={setChart} daily /></div>
        {chart ? <><div className="usage-daily-scroll"><svg className="usage-daily-chart" viewBox={`0 0 ${dailyWidth} 200`} style={{ minWidth: dailyWidth }} role="group" aria-label="每日 Token 趋势">
          <line className="usage-chart-grid" x1="24" y1="24" x2={dailyWidth - 8} y2="24" /><line className="usage-chart-grid" x1="24" y1="94" x2={dailyWidth - 8} y2="94" /><line className="usage-chart-axis" x1="24" y1="164" x2={dailyWidth - 8} y2="164" />
          {page.daily.map((day, index) => { const unit = (dailyWidth - 40) / page.daily.length, x = 24 + unit * index + unit * 0.25, width = Math.max(4, unit * 0.5), input = (trendValue(day, 'inputTokens') ?? 0) / dailyMaximum * 128, output = (trendValue(day, 'outputTokens') ?? 0) / dailyMaximum * 128;
            const excluded = day.tokenTrend?.excludedSessions ?? day.unknownTokenSessions;
            const label = `${day.date}：输入 ${trendValue(day, 'inputTokens') === null ? '未知' : number(trendValue(day, 'inputTokens')!)}；输出 ${trendValue(day, 'outputTokens') === null ? '未知' : number(trendValue(day, 'outputTokens')!)}${excluded ? `；${excluded} 个未知会话未计入趋势` : ''}`;
            return <g key={day.date} tabIndex={0} role="img" aria-label={label} onFocus={() => setDayTooltip(label)} onBlur={() => setDayTooltip('')} onMouseEnter={() => setDayTooltip(label)} onMouseLeave={() => setDayTooltip('')} onKeyDown={event => { if (event.key === 'Escape') setDayTooltip(''); }}><rect data-series="1" x={x} y={164 - input} width={width} height={input} /><rect data-series="3" x={x} y={164 - input - output} width={width} height={output} />{excluded > 0 && <rect className="usage-daily-unknown" x={x} y="8" width={width} height="3" />}<text x={x + width / 2} y="186" textAnchor="middle">{day.date.slice(5)}</text></g>;
          })}</svg></div>{dayTooltip && <p className="usage-chart-tooltip" role="tooltip">{dayTooltip}</p>}<ul className="usage-legend"><li><i data-series="1" />输入 Token</li><li><i data-series="3" />输出 Token</li>{page.daily.some(day => day.unknownTokenSessions > 0) && <li title="当日有未上报用量"><i className="usage-legend-unknown" /><span>未知会话</span></li>}</ul></>
          : <div className="usage-table-scroll"><table><caption>按来源日期归期的已知用量与未知会话</caption><thead><tr><th>日期</th><th>会话</th><th>用户轮次</th><th>输入 Token</th><th>输出 Token</th></tr></thead><tbody>{page.daily.map(day => <tr key={day.date}><th scope="row">{day.date}</th><td>{day.sessions}</td><td>{day.userTurns}</td><td><TokenValue value={day.knownInputTokens} unknown={tokenUnknown(day, 'Input')} /></td><td><TokenValue value={day.knownOutputTokens} unknown={tokenUnknown(day, 'Output')} /></td></tr>)}</tbody></table></div>}
      </section>}
      </div>}
      <section className="usage-figure" aria-label="会话用量"><div className="usage-figure-head"><div><h2>会话明细</h2></div></div>
        <div className="usage-table-scroll"><table><caption>当前指标版本的会话分页</caption><thead><tr><th>员工 / 项目</th><th>Agent</th><th>轮次 / 工具</th><th>输入 Token</th><th>输出 Token</th><th>原件</th></tr></thead><tbody>{page.sessions.map(session => <tr key={`${session.sessionId}:${session.employeeId}:${session.project}`}><th scope="row">{session.employee}<span className="usage-cell-detail">{session.project || '未归类项目'}</span></th><td>{sourceLabel(session.source)}</td><td>{session.userTurns} / {session.toolCalls}</td><td><TokenValue value={session.knownInputTokens} unknown={tokenUnknown(session, 'Input')} /></td><td><TokenValue value={session.knownOutputTokens} unknown={tokenUnknown(session, 'Output')} /></td><td><a href={session.webPath}>查看会话</a></td></tr>)}</tbody></table></div>
        {page.sessions.length === 0 && <p className="usage-empty">没有符合条件的会话。</p>}
        <div className="usage-pagination"><button disabled={busy || query.offset === 0} onClick={() => setQuery({ ...query, version: page.version, offset: Math.max(0, query.offset - 20) })}>上一页会话</button><span>版本 {page.revision} · 第 {Math.floor(query.offset / 20) + 1} 页</span><button disabled={busy || page.nextOffset === null} onClick={() => setQuery({ ...query, version: page.version, offset: page.nextOffset! })}>下一页会话</button></div>
      </section>
    </>}
    {page && <details className="usage-data-status"><summary>指标口径 · 版本 {page.revision}</summary><p>{page.definition}</p><p>{page.catalogVersion}</p></details>}
    {page && !page.sourceInputsComplete && page.unknownReasons.length > 0 && <details className="usage-data-status"><summary>数据缺口 · {page.unknownReasons.length}</summary><ul>{page.unknownReasons.map(reason => <li key={reason}>{reason}</li>)}</ul></details>}
    </div>
  </section>;
}
