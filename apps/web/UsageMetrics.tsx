import { useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import type { MetricCatalog, MetricTotals, MetricsPage, MetricsQuery } from '../../packages/contracts/metrics.js';
import { sourceLabel, type Source } from '../../packages/contracts/archive.js';
import './usage-metrics.css';

type Props = { request: (path: string, signal?: AbortSignal, method?: 'POST', body?: unknown) => Promise<Response> };
const params = (query: Partial<MetricsQuery>) => new URLSearchParams(Object.entries(query)
  .filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]));
const number = (value: number) => value.toLocaleString('zh-CN');
const compact = (value: number) => value >= 1e6 ? `${Number((value / 1e6).toFixed(2))}M` : value >= 1000 ? `${Number((value / 1000).toFixed(1))}k` : number(value);
const tokens = (row: MetricTotals, kind: 'Input' | 'Output') => `${number(row[`known${kind}Tokens`])} 已知${row[`unknown${kind}Sessions`] ? ` · ${row[`unknown${kind}Sessions`]} 会话未知` : ''}`;
const agents: Source[] = ['claude-code-cli', 'codex-cli', 'codex-desktop'];
const sourceSeries = (source: Source) => agents.indexOf(source) + 1;
function Spark({ values }: { values: number[] }) {
  if (!values.length) return null;
  const maximum = Math.max(1, ...values), points = values.map((value, index) => `${4 + index / Math.max(1, values.length - 1) * 112},${24 - value / maximum * 18}`);
  return <svg className="usage-spark" viewBox="0 0 120 30" aria-hidden="true"><polyline points={points.join(' ')} /><circle cx={values.length > 1 ? 116 : 4} cy={24 - values.at(-1)! / maximum * 18} r="3" /></svg>;
}
function Stat({ label, value, children, trend }: { label: string; value: string | number; children: ReactNode; trend?: number[] }) {
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
  const [catalog, setCatalog] = useState<MetricCatalog | null>(null);
  const [employees, setEmployees] = useState<Array<{ employeeId: string; employee: string }>>([]);
  const [projects, setProjects] = useState<string[]>([]); const [customProject, setCustomProject] = useState(false); const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [retry, setRetry] = useState(0);
  const [chart, setChart] = useState(true); const [peopleChart, setPeopleChart] = useState(true);
  const [chartError, setChartError] = useState(''); const [chartRetry, setChartRetry] = useState(0);
  const [exporting, setExporting] = useState(false); const [message, setMessage] = useState('');
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
    if (next.period !== 'custom' || next.from && next.to && next.from <= next.to) setQuery({ ...next, offset: 0, version: undefined });
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
      setTimeout(() => URL.revokeObjectURL(url), 1000); setMessage('已准备当前版本的完整指标下载。');
    } catch (failure) { setError((failure as Error).message); }
    finally { setExporting(false); }
  }
  const allSessions = complete?.version === page?.version ? complete?.sessions : undefined;
  const people = page?.employees.map(person => ({ ...person, agents: agents.map(source => ({ source,
    input: allSessions?.filter(session => session.employeeId === person.employeeId && session.source === source).reduce((sum, session) => sum + session.knownInputTokens, 0) ?? 0 })) })) ?? [];
  const employeeMaximum = Math.max(1, ...people.map(person => person.knownInputTokens));
  const dailyMaximum = Math.max(1, ...page?.daily.map(day => day.knownInputTokens + day.knownOutputTokens) ?? []);
  const dailyWidth = Math.max(600, (page?.daily.length ?? 0) * 44);
  return <section className="usage-metrics" aria-label="用量指标" aria-busy={busy}>
    <div className="usage-page-head"><h1 aria-label="用量指标">用量与产出</h1><p>谁用了多少 Token，会话里发生了什么。用量来自会话原件；产出只展示可核对的结果，尚无数据的指标标为未知。</p></div>
    <form className="usage-filters" onSubmit={apply} aria-label="用量筛选"><div className="usage-filter-row">
      <div className="usage-periods" role="group" aria-label="时间范围">
        {([['this-week', '本周'], ['last-week', '上周'], ['since-enrollment', '接入至今']] as const).map(([period, label]) => <button key={period} type="button" aria-pressed={draft.period === period} onClick={() => selectScope({ ...draft, period })}>{label}</button>)}
        <button type="button" aria-pressed={draft.period === 'custom'} onClick={() => setDraft({ ...draft, period: 'custom', from: draft.from ?? page?.scope.from, to: draft.to ?? page?.scope.to })}>自定义</button>
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
      {draft.period === 'custom' && <div className="usage-custom-dates"><label>开始日期<input type="date" value={draft.from ?? ''} max={draft.to} required onChange={event => setDraft({ ...draft, from: event.target.value })} /></label>
        <label>结束日期<input type="date" value={draft.to ?? ''} min={draft.from} required onChange={event => setDraft({ ...draft, to: event.target.value })} /></label><button className="usage-apply" disabled={busy}>应用筛选</button></div>}
      <div className="usage-filter-meta"><button className="usage-advanced-toggle" type="button" aria-expanded={advanced} aria-controls="usage-advanced-filters" onClick={() => setAdvanced(value => !value)}>更多筛选{draft.project === '' ? ' · 未归类' : ''}</button>
        <p>北京时间{page && <> · {page.dataAsOf === new Date(0).toISOString() ? '尚无可确认数据截至时间' : `截至 ${new Date(page.dataAsOf).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}`} · 版本 {page.revision}</>} · <button type="button" className="usage-link" onClick={() => document.getElementById('metric-definitions')?.scrollIntoView({ block: 'start' })}>指标口径</button></p></div>
      {advanced && <div className="usage-advanced-filters" id="usage-advanced-filters"><label className="usage-project-check"><input type="checkbox" checked={draft.project === ''} onChange={event => { setCustomProject(false); selectScope({ ...draft, project: event.target.checked ? '' : undefined }); }} />仅未归类项目</label>
        {customProject && <div className="usage-custom-project"><label>项目路径<input value={draft.project ?? ''} maxLength={1024} placeholder="输入完整项目路径" onChange={event => setDraft({ ...draft, project: event.target.value || undefined })} /></label>{draft.period !== 'custom' && <button className="usage-apply" disabled={busy}>应用筛选</button>}</div>}
      </div>}
    </form>
    {busy && <p className="usage-status" role="status">正在计算用量指标…</p>}
    {error && <div className="usage-error" role="alert"><p>{error}</p><button disabled={busy} onClick={() => setRetry(value => value + 1)}>重试指标</button></div>}
    {message && <p className="usage-status usage-success" role="status">{message}</p>}
    {page && <>
      <dl className="usage-stats">
        <Stat label="Token 输入（已知）" value={compact(page.totals.knownInputTokens)} trend={page.daily.map(day => day.knownInputTokens)}>输出 {compact(page.totals.knownOutputTokens)}{page.totals.unknownTokenSessions ? <> · <span className="usage-unknown">{page.totals.unknownTokenSessions} 会话未知</span></> : page.sourceInputsComplete ? ' · 全部已知' : ' · 完整性未知'}</Stat>
        <Stat label="会话" value={number(page.totals.sessions)} trend={page.daily.map(day => day.sessions)}>{number(page.totals.userTurns)} 轮提示词 · {number(page.totals.toolCalls)} 次工具调用</Stat>
        <Stat label="已验证结果" value="—"><span className="usage-unknown">未知</span> · 尚无已验证结果数据</Stat>
        <Stat label="代码变更" value="—"><span className="usage-unknown">未知</span> · 尚无变更行与文件数据</Stat>
        <Stat label="测试通过" value="—"><span className="usage-unknown">未知</span> · 尚无测试与提交数据</Stat>
      </dl>
      <div className="usage-guard"><span className="usage-info-icon" aria-hidden="true">i</span><div><p>确定性指标来自会话原件。未上报的数据标为“未知”，不计为 0。平台不合成评分、不按人排名。</p>{!page.sourceInputsComplete && <details><summary>部分指标未知或来源完整性未确认</summary><p>{page.unknownReasons.join('；')}</p></details>}</div></div>
      <div className="usage-figure-grid">
        <section className="usage-figure" aria-label="员工用量"><div className="usage-figure-head"><div><h2>每人 Token 输入（已知）</h2><p>按 Agent 堆叠；未知用量单独标记，不画成 0。员工按姓名排列。</p></div><ViewToggle chart={peopleChart} setChart={setPeopleChart} /></div>
          {!allSessions ? chartError ? <div className="usage-error" role="alert"><p>{chartError}</p><button onClick={() => setChartRetry(value => value + 1)}>重试员工图表</button></div> : <p className="usage-status" role="status">正在读取当前版本的完整用量…</p>
            : peopleChart ? <div className="usage-horizontal-bars" role="list" aria-label="各员工按 Agent 归集的已知输入 Token">
              {people.map((person, index) => <div className="usage-bar-row" role="listitem" key={person.employeeId}><Person name={person.employee} index={index} /><div className="usage-bar-plot"><div className="usage-bar-track" style={{ '--bar-width': `${person.knownInputTokens / employeeMaximum * 80}%` } as CSSProperties}>
                {person.agents.filter(agent => agent.input > 0).map(agent => <span className="usage-bar-segment" key={agent.source} data-series={sourceSeries(agent.source)} style={{ flexGrow: agent.input }} title={`${person.employee} · ${sourceLabel(agent.source)} · 输入 ${number(agent.input)} 已知`} />)}</div><span className="usage-bar-value" title={`${number(person.knownInputTokens)} 已知`}>{compact(person.knownInputTokens)}</span>{person.unknownInputSessions > 0 && <span className="usage-unknown">+{person.unknownInputSessions} 会话未知</span>}</div></div>)}
              {people.length > 0 && <div className="usage-bar-axis" aria-hidden="true"><div /><div>{[0, 0.25, 0.5, 0.75, 1].map(tick => <span key={tick} style={{ left: `${tick * 80}%` }}>{compact(employeeMaximum * tick)}</span>)}</div></div>}
            </div> : <div className="usage-table-scroll"><table><caption>员工按 Agent 的已知输入 Token</caption><thead><tr><th>员工</th>{agents.map(source => <th key={source}>{sourceLabel(source)}</th>)}<th>合计（已知）</th><th>未知会话</th></tr></thead><tbody>{people.map(person => <tr key={person.employeeId}><th scope="row">{person.employee}</th>{person.agents.map(agent => <td key={agent.source}>{number(agent.input)} 已知</td>)}<td>{number(person.knownInputTokens)} 已知</td><td>{person.unknownInputSessions}</td></tr>)}</tbody></table></div>}
          {allSessions && people.length === 0 && <p className="usage-empty">所选范围没有已确认接入后的来源活动。</p>}
          <ul className="usage-legend">{agents.map(source => <li key={source}><i data-series={sourceSeries(source)} />{sourceLabel(source)}</li>)}<li><i className="usage-legend-unknown" />未上报或无法确认（未知）</li></ul>
        </section>
        <section className="usage-figure" aria-label="员工产出"><div className="usage-figure-head"><div><h2>每人产出</h2><p>会话数来自原件；其余产出尚无可核对数据，保留为未知。</p></div></div><div className="usage-table-scroll"><table><caption>员工的会话与产出可用性</caption><thead><tr><th>员工</th><th>会话</th><th>已验证结果</th><th>仅声称</th><th>代码变更行</th><th>测试通过</th><th>会话内提交</th></tr></thead><tbody>{page.employees.map((person, index) => <tr key={person.employeeId}><th scope="row"><Person name={person.employee} index={index} /></th><td>{number(person.sessions)}</td>{Array.from({ length: 5 }, (_, item) => <td key={item}><span className="usage-unavailable-value">— <span>未知</span></span></td>)}</tr>)}</tbody></table></div>{page.employees.length === 0 && <p className="usage-empty">没有符合条件的员工用量。</p>}</section>
      </div>
      <section className="usage-figure" aria-label="会话用量与产出"><div className="usage-figure-head"><div><h2>会话：Token 与已验证结果</h2><p>每个会话的已知 Token 可在下方明细查看；已验证结果尚无可核对数据。</p></div></div><div className="usage-unavailable"><span className="usage-unavailable-mark" aria-hidden="true">—</span><strong>已验证结果未知</strong><p>有可核对的产出数据后，才能展示会话用量与结果的关系。</p></div></section>
      <section className="usage-figure" aria-label="每日用量"><div className="usage-figure-head"><div><h2>每日 Token 用量（已知）</h2><p>{page.scope.from} 至 {page.scope.to} · 按北京时间来源日期归期；显示所选范围合计，未知会话单独标记。</p></div><ViewToggle chart={chart} setChart={setChart} daily /></div>
        {chart ? <><div className="usage-daily-scroll"><svg className="usage-daily-chart" viewBox={`0 0 ${dailyWidth} 200`} style={{ minWidth: dailyWidth }} role="img" aria-label="每日已知输入与输出 Token；未知会话在日期上方以短横标记">
          <line className="usage-chart-grid" x1="24" y1="24" x2={dailyWidth - 8} y2="24" /><line className="usage-chart-grid" x1="24" y1="94" x2={dailyWidth - 8} y2="94" /><line className="usage-chart-axis" x1="24" y1="164" x2={dailyWidth - 8} y2="164" />
          {page.daily.map((day, index) => { const unit = (dailyWidth - 40) / page.daily.length, x = 24 + unit * index + unit * 0.25, width = Math.max(4, unit * 0.5), input = day.knownInputTokens / dailyMaximum * 128, output = day.knownOutputTokens / dailyMaximum * 128;
            return <g key={day.date}><title>{day.date}：输入 {tokens(day, 'Input')}；输出 {tokens(day, 'Output')}</title><rect data-series="1" x={x} y={164 - input} width={width} height={input} /><rect data-series="3" x={x} y={164 - input - output} width={width} height={output} />{day.unknownTokenSessions > 0 && <rect className="usage-daily-unknown" x={x} y="8" width={width} height="3" />}<text x={x + width / 2} y="186" textAnchor="middle">{day.date.slice(5)}</text></g>;
          })}</svg></div><ul className="usage-legend"><li><i data-series="1" />输入 Token</li><li><i data-series="3" />输出 Token</li><li><i className="usage-legend-unknown" />当日存在未知会话</li></ul></>
          : <div className="usage-table-scroll"><table><caption>按来源日期归期的已知用量与未知会话</caption><thead><tr><th>日期</th><th>会话</th><th>用户轮次</th><th>输入 Token</th><th>输出 Token</th></tr></thead><tbody>{page.daily.map(day => <tr key={day.date}><th scope="row">{day.date}</th><td>{day.sessions}</td><td>{day.userTurns}</td><td>{tokens(day, 'Input')}</td><td>{tokens(day, 'Output')}</td></tr>)}</tbody></table></div>}
        {page.daily.length === 0 && <p className="usage-empty">所选范围没有已确认接入后的来源活动。</p>}
      </section>
      <section className="usage-figure" aria-label="会话用量"><div className="usage-figure-head"><div><h2>会话明细</h2><p>按原员工、项目及会话下钻；原件保留固定快照。跨日会话数不能直接相加。</p></div><div className="usage-export-actions"><button disabled={busy} onClick={recompute}>从原件重算</button><button disabled={busy || exporting} onClick={download}>{exporting ? '正在准备导出…' : '导出当前版本'}</button></div></div>
        <div className="usage-table-scroll"><table><caption>当前指标版本的会话分页</caption><thead><tr><th>员工 / 项目</th><th>Agent</th><th>轮次 / 工具</th><th>输入 Token</th><th>输出 Token</th><th>原件</th></tr></thead><tbody>{page.sessions.map(session => <tr key={`${session.sessionId}:${session.employeeId}:${session.project}`}><th scope="row">{session.employee}<span className="usage-cell-detail">{session.project || '未归类项目'}</span></th><td>{sourceLabel(session.source)}</td><td>{session.userTurns} / {session.toolCalls}</td><td>{tokens(session, 'Input')}</td><td>{tokens(session, 'Output')}</td><td><a href={session.webPath}>查看会话</a>{!session.sourceInputsComplete && <span className="usage-cell-detail">指标含未知</span>}</td></tr>)}</tbody></table></div>
        {page.sessions.length === 0 && <p className="usage-empty">没有符合条件的会话。</p>}
        <div className="usage-pagination"><button disabled={busy || query.offset === 0} onClick={() => setQuery({ ...query, version: page.version, offset: Math.max(0, query.offset - 20) })}>上一页会话</button><span>版本 {page.revision} · 第 {Math.floor(query.offset / 20) + 1} 页</span><button disabled={busy || page.nextOffset === null} onClick={() => setQuery({ ...query, version: page.version, offset: page.nextOffset! })}>下一页会话</button></div>
      </section>
    </>}
    {catalog && <section id="metric-definitions" className="usage-figure usage-definitions" aria-label="指标口径"><div className="usage-figure-head"><div><h2>指标口径</h2><p>同一份原件、同一个指标版本；未知不当作零。</p></div></div><dl>{catalog.definitions.map(item => <div key={item.key}><dt>{item.label}</dt><dd>{item.definition}<span className="usage-cell-detail">{item.origin}</span></dd></div>)}</dl><ul>{catalog.limitations.map(item => <li key={item}>{item}</li>)}</ul></section>}
  </section>;
}
