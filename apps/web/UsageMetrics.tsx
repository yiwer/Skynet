import { useEffect, useState, useRef, type CSSProperties, type FormEvent } from 'react';
import type { MetricTotals, MetricsQuery } from '../../packages/contracts/metrics.js';
import { sourceLabel, type Source } from '../../packages/contracts/archive.js';
import type { UsageOutputPage } from '../../packages/contracts/usage-output.js';
import { OutputKpis, OutputTable, UsageScatter, UsageDailyPeople } from './UsageOutputCharts.js';
import './usage-metrics.css';

type Props = { request: (path: string, signal?: AbortSignal, method?: 'POST', body?: unknown) => Promise<Response> };
const params = (query: Partial<MetricsQuery>) => new URLSearchParams(Object.entries(query)
  .filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]));
const selectionKey = (query: MetricsQuery) => { const value = params(query); value.sort(); return value.toString(); };
const number = (value: number) => value.toLocaleString('zh-CN');
const compact = (value: number) => value >= 1e6 ? `${Number((value / 1e6).toFixed(2))}M` : value >= 1000 ? `${Number((value / 1000).toFixed(1))}k` : number(value);
const tokenUnknown = (row: MetricTotals, kind: 'Input' | 'Output') => row[kind === 'Input' ? 'inputTokens' : 'outputTokens'] === null;
function TokenValue({ value, unknown, short = false }: { value: number; unknown: boolean; short?: boolean }) {
  return <span title={unknown ? value ? '部分用量未上报' : '用量未上报' : undefined}>{unknown && !value ? '未知' : short ? compact(value) : number(value)}{unknown && value > 0 && <sup className="usage-partial">*</sup>}</span>;
}
const agents: Source[] = ['claude-code-cli', 'codex-cli', 'codex-desktop'];
const sourceSeries = (source: Source) => agents.indexOf(source) + 1;
function ViewToggle({ chart, setChart, daily = false }: { chart: boolean; setChart: (value: boolean) => void; daily?: boolean }) {
  return <div className="usage-view-toggle" role="group" aria-label={daily ? '每日用量显示方式' : '员工用量显示方式'}>
    <button type="button" aria-label={daily ? '切换为图表' : '员工用量切换为图表'} aria-pressed={chart} onClick={() => setChart(true)}>图表</button>
    <button type="button" aria-label={daily ? '切换为表格' : '员工用量切换为表格'} aria-pressed={!chart} onClick={() => setChart(false)}>表格</button>
  </div>;
}
function Person({ name, index }: { name: string; index: number }) {
  return <span className="usage-person"><span className="usage-avatar" data-tone={index % 6} aria-hidden="true">{Array.from(name)[0]}</span><span>{name}</span></span>;
}
function hashMetrics():MetricsQuery{const p=new URLSearchParams(location.hash.split('?')[1]);return {period:(p.get('period')??'this-week') as MetricsQuery['period'],offset:0,...Object.fromEntries(['employeeId','source','project','week','version','from','to'].flatMap(key=>p.has(key)?[[key,p.get(key)!]]:[]))};}
export function UsageMetrics({ request }: Props) {
  const definitions=useRef<HTMLDetailsElement>(null);
  const [draft, setDraft] = useState<MetricsQuery>(hashMetrics);
  const [query, setQuery] = useState<MetricsQuery>(draft);
  const [page, setPage] = useState<UsageOutputPage | null>(null);
  const [complete, setComplete] = useState<UsageOutputPage | null>(null);
  const [employees, setEmployees] = useState<Array<{ employeeId: string; employee: string }>>([]);
  const [projects, setProjects] = useState<string[]>([]); const [customProject, setCustomProject] = useState(false); const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [retry, setRetry] = useState(0);
  const [agentTooltip, setAgentTooltip] = useState('');
  const [peopleChart, setPeopleChart] = useState(true);
  const [chartError, setChartError] = useState(''); const [chartRetry, setChartRetry] = useState(0);
  const [exporting, setExporting] = useState(false); const [message, setMessage] = useState('');
  useEffect(() => {
    const abort = new AbortController(); setBusy(true); setError(''); setPage(null); setMessage('');
    request(`/api/usage-output?${params(query)}`, abort.signal).then(value => value.json()).then((data: UsageOutputPage) => {
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
    request(`/api/usage-output/export?${params({ ...query, offset: 0, version: page.version })}`, abort.signal)
      .then(response => response.json()).then((data: UsageOutputPage) => { if (!abort.signal.aborted) setComplete(data); })
      .catch(failure => { if (!abort.signal.aborted) setChartError(failure.message); });
    return () => abort.abort();
  }, [page?.version, chartRetry]);
  useEffect(() => { if (complete) setProjects(previous => [...new Set([...previous, ...complete.sessions.map(session => session.project).filter(Boolean)])].sort((a, b) => a.localeCompare(b, 'zh-CN'))); }, [complete?.version]);
  useEffect(()=>{const change=()=>{if(['#metrics','#usage'].includes(location.hash.split('?')[0]!)){
    const next=hashMetrics(), key=selectionKey(next);
    // Navigation can mount this page before its hashchange event arrives.
    // Keep an equal selection so that event does not abort and restart its read.
    setDraft(previous=>selectionKey(previous)===key?previous:next);
    setQuery(previous=>selectionKey(previous)===key?previous:next);
  }};window.addEventListener('hashchange',change);return()=>window.removeEventListener('hashchange',change);},[]);
  function selectScope(next: MetricsQuery) {
    next={...next,week:undefined};
    setDraft(next);
    setQuery({ ...next, offset: 0, version: undefined });
  }
  function apply(event: FormEvent) { event.preventDefault(); setQuery({ ...draft,week:undefined,offset:0,version:undefined }); }
  async function recompute() {
    setBusy(true); setError(''); setMessage('');
    try {
      const data: UsageOutputPage = await (await request('/api/usage-output/recompute', undefined, 'POST', { ...query, offset: 0, version: undefined })).json();
      setQuery({ ...query, offset: 0, version: data.version });
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }
  async function download() {
    if (!page) return;
    setExporting(true); setError('');
    try {
      const response = await request(`/api/usage-output/export?${params({ ...query, offset: 0, version: page.version })}`);
      const url = URL.createObjectURL(await response.blob()); const anchor = document.createElement('a');
      anchor.href = url; anchor.download = `skynet-usage-output-${page.version}.json`; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000); setMessage('导出已准备好');
    } catch (failure) { setError((failure as Error).message); }
    finally { setExporting(false); }
  }
  const allSessions = complete?.version === page?.version ? complete?.sessions : undefined;
  const displayedAgents = agents.filter(source => page?.employees.some(row => row.agents.some(agent => agent.source === source && (agent.sessions > 0 || agent.knownInputTokens > 0))));
  const people = page?.employees.map(person => ({ ...person, agents: displayedAgents.map(source => {
    const rows = allSessions?.filter(session => session.employeeId === person.employeeId && session.source === source) ?? [];
    return { source, input: rows.reduce((sum, session) => sum + session.knownInputTokens, 0), unknown: rows.some(session => session.inputTokens === null) };
  }) })) ?? [];
  const hasInput = page && (page.sessions.length > 0 || page.totals.knownInputTokens > 0);
  const hasOutput = page && (page.sessions.length > 0 || page.totals.knownOutputTokens > 0);
  const hasUsage = page && page.employees.length > 0 && (page.totals.sessions > 0 || page.totals.userTurns > 0 || page.totals.toolCalls > 0 || hasInput || hasOutput);
  const employeeMaximum = Math.max(1, ...people.map(person => person.knownInputTokens));
  return <section className="usage-metrics workspace-page" aria-label="用量指标" aria-busy={busy}>
    <div className="usage-page-head"><h1>用量与产出</h1>{page && <div className="usage-export-actions">{!query.week&&<button disabled={busy} onClick={recompute}>从原件重算</button>}<button disabled={busy || exporting} onClick={download}>{exporting ? '正在导出…' : '导出当前版本'}</button></div>}</div>
    <form className="usage-filters" onSubmit={apply} aria-label="用量筛选"><div className="usage-filter-row">
      <div className="usage-periods" role="group" aria-label="时间范围">
        {([['this-week', '本周'], ['last-week', '上周'], ['since-enrollment', '接入至今']] as const).map(([period, label]) => <button key={period} type="button" aria-pressed={!draft.week&&draft.period === period} onClick={() => selectScope({ ...draft, period })}>{label}</button>)}
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
        <p>{page && <>{page.scope.from} — {page.scope.to} · 北京时间 · 数据截至 {new Date(page.dataAsOf).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })} · <button type="button" className="usage-advanced-toggle" onClick={()=>{if(definitions.current){definitions.current.open=true;definitions.current.scrollIntoView({block:'nearest'});}}}>指标口径</button></>}</p></div>
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
      <OutputKpis page={page}/>
      {(hasInput || hasOutput) && <div className="usage-figure-grid">
        {hasInput && <section className="usage-figure" aria-label="员工用量"><div className="usage-figure-head"><div><h2>每人输入 Token</h2></div><ViewToggle chart={peopleChart} setChart={setPeopleChart} /></div>
          {!allSessions ? chartError ? <div className="usage-error" role="alert"><p>{chartError}</p><button onClick={() => setChartRetry(value => value + 1)}>重试员工图表</button></div> : <p className="usage-status" role="status">正在读取当前版本的完整用量…</p>
            : peopleChart ? <div className="usage-horizontal-bars" role="list" aria-label="各员工按 Agent 归集的已知输入 Token">
              {people.map((person, index) => <div className="usage-bar-row" role="listitem" key={person.employeeId}><Person name={person.employee} index={index} /><div className="usage-bar-plot"><div className="usage-bar-track" style={{ '--bar-width': `${person.knownInputTokens / employeeMaximum * 80}%` } as CSSProperties}>
                {person.agents.filter(agent => agent.input > 0).map(agent => <span className="usage-bar-segment" key={agent.source} data-series={sourceSeries(agent.source)} style={{ flexGrow: agent.input }} tabIndex={0} role="img" onFocus={event => setAgentTooltip(event.currentTarget.getAttribute('aria-label')!)} onBlur={() => setAgentTooltip('')} onMouseEnter={event => setAgentTooltip(event.currentTarget.getAttribute('aria-label')!)} onMouseLeave={() => setAgentTooltip('')} onKeyDown={event => { if (event.key === 'Escape') setAgentTooltip(''); }} aria-label={`${person.employee} · ${sourceLabel(agent.source)} · ${number(agent.input)}${agent.unknown ? '（部分）' : ''}`} />)}</div><span className="usage-bar-value"><TokenValue value={person.knownInputTokens} unknown={tokenUnknown(person, 'Input')} short />{person.unknownTokenSessions>0&&<span className="usage-cell-detail">{person.unknownTokenSessions} 会话未知</span>}</span></div></div>)}
              {people.some(person=>person.knownInputTokens>0) && <div className="usage-bar-axis" aria-hidden="true"><div /><div>{[0, 0.25, 0.5, 0.75, 1].map(tick => <span key={tick} style={{ left: `${tick * 80}%` }}>{compact(employeeMaximum * tick)}</span>)}</div></div>}
            </div> : <div className="usage-table-scroll"><table><caption>员工按 Agent 的已知输入 Token</caption><thead><tr><th>员工</th>{displayedAgents.map(source => <th key={source}>{sourceLabel(source)}</th>)}<th>合计</th><th>未知会话</th></tr></thead><tbody>{people.map(person => <tr key={person.employeeId}><th scope="row">{person.employee}</th>{person.agents.map(agent => <td key={agent.source}><TokenValue value={agent.input} unknown={agent.unknown} /></td>)}<td><TokenValue value={person.knownInputTokens} unknown={tokenUnknown(person, 'Input')} /></td><td>{person.unknownTokenSessions}</td></tr>)}</tbody></table></div>}
          {agentTooltip && peopleChart && <p className="usage-chart-tooltip" role="tooltip">{agentTooltip}</p>}
          <ul className="usage-legend">{displayedAgents.map(source => <li key={source}><i data-series={sourceSeries(source)} />{sourceLabel(source)}</li>)}</ul>
        </section>}
      <OutputTable page={page}/>
      </div>}
      {complete?.version === page.version && <><UsageScatter page={complete}/><UsageDailyPeople page={complete}/></>}
      <section className="usage-figure" aria-label="会话用量"><div className="usage-figure-head"><div><h2>会话明细</h2></div></div>
        <div className="usage-table-scroll"><table><caption>当前指标版本的会话分页</caption><thead><tr><th>员工 / 项目</th><th>Agent</th><th>轮次 / 工具</th><th>输入 Token</th><th>输出 Token</th><th>原件</th></tr></thead><tbody>{page.sessions.filter(session => session.selected).map(session => <tr key={`${session.sessionId}:${session.employeeId}:${session.project}`}><th scope="row">{session.employee}<span className="usage-cell-detail">{session.project || '未归类项目'}</span></th><td>{sourceLabel(session.source)}</td><td>{session.userTurns} / {session.toolCalls}</td><td><TokenValue value={session.knownInputTokens} unknown={tokenUnknown(session, 'Input')} /></td><td><TokenValue value={session.knownOutputTokens} unknown={tokenUnknown(session, 'Output')} /></td><td><a href={session.webPath}>查看会话</a></td></tr>)}</tbody></table></div>
        {page.sessions.length === 0 && <p className="usage-empty">没有符合条件的会话。</p>}
        <div className="usage-pagination"><button disabled={busy || query.offset === 0} onClick={() => setQuery({ ...query, version: page.version, offset: Math.max(0, query.offset - 20) })}>上一页会话</button><span>版本 {page.revision} · 第 {Math.floor(query.offset / 20) + 1} 页</span><button disabled={busy || page.nextOffset === null} onClick={() => setQuery({ ...query, version: page.version, offset: page.nextOffset! })}>下一页会话</button></div>
      </section>
    </>}
    {page && <details ref={definitions} className="usage-data-status"><summary>指标口径 · 版本 {page.revision}</summary><p>按 eventId 去重，归属原员工和北京时间来源日期。Token 来自已支持原生版本；未知会话单列，不进入每日趋势。</p><p>已验证与仅声称结果由模型提取并绑定原文证据；代码、测试和提交来自会话内工具记录，按各自单位展示。点击会话可核查固定分析版本。</p><p>{page.catalogVersion}</p></details>}
    {page && !page.sourceInputsComplete && page.unknownReasons.length > 0 && <details className="usage-data-status"><summary>数据缺口 · {page.unknownReasons.length}</summary><ul>{page.unknownReasons.map(reason => <li key={reason}>{reason}</li>)}</ul></details>}
    </div>
  </section>;
}
