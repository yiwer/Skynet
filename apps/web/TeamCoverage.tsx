import { useEffect, useState } from 'react';
import { beijingDate, type DailyReport } from '../../packages/contracts/reports.js';
import { assessmentLabels } from '../../packages/contracts/analysis.js';
import type { CoverageCell, CoverageMatrix, CoverageObservation, WorkStatistics } from '../../packages/contracts/coverage.js';
import type { MetricsPage } from '../../packages/contracts/metrics.js';
import { PlatformIcon } from './PlatformShell.js';
import './team-coverage.css';

const collection = { 'gap-observed': '采集缺口已观察', 'observations-only': '仅有时点观测', unknown: '覆盖未知' };
const analysis = { ready: '报告已有版本', unfinished: '分析/报告未完成', 'not-scheduled': '尚未安排分析', unknown: '分析未知' };
const connection = { connected: '当前设备可达', 'not-connected': '当前未连接', unknown: '当前连接未知', 'not-applicable': '历史连接不回填' };
const configured = { configured: '已报告配置', 'not-configured': '已报告未配置', mixed: '配置状态混合', unknown: '安装配置未知' };
const host = { observed: '已观察宿主事件', 'pending-confirmation': '宿主信任/首次事件待确认', unknown: '宿主确认未知' };
const time = (value: string | null) => value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '未知';
const metric = (value: number | null | undefined) => value == null ? '未知' : value.toLocaleString();
const compact = (value: number) => value >= 1e6 ? `${Number((value / 1e6).toFixed(2))}M` : value >= 1000 ? `${Number((value / 1000).toFixed(1))}k` : String(value);
const weekday = (date: string) => ['日', '一', '二', '三', '四', '五', '六'][new Date(`${date}T00:00:00Z`).getUTCDay()];
function CoverageGlyph({ cell, kind }: { cell?: CoverageCell; kind?: 'observed' | 'unknown' | 'gap' | 'pending' | 'unfinished' }) {
  const observed = cell ? cell.activity === 'observed' : kind === 'observed';
  return <svg className="coverage-glyph" viewBox="0 0 24 24" aria-hidden="true">
    {observed ? <circle className="coverage-glyph-fill" cx="12" cy="12" r="6" /> : cell?.collection !== 'unknown' && kind !== 'unknown' ? <circle className="coverage-glyph-ring" cx="12" cy="12" r="5.5" /> : null}
    {(cell?.collection === 'unknown' || kind === 'unknown') && <circle className="coverage-glyph-unknown" cx="12" cy="12" r="5.5" />}
    {(cell?.collection === 'gap-observed' || kind === 'gap') && <path className="coverage-glyph-critical" d="M19 1.5 23 8.5h-8z" />}
    {(cell?.hostConfirmation === 'pending-confirmation' || kind === 'pending') && <path className="coverage-glyph-warning" d="m19 1.5 3.5 3.5L19 8.5 15.5 5z" />}
    {(cell?.analysis === 'unfinished' || kind === 'unfinished') && <rect className="coverage-glyph-critical" x="15.8" y="15.8" width="6.4" height="6.4" rx="1" />}
    {cell?.currentConnection === 'not-connected' && <path className="coverage-glyph-offline" d="M5 19 19 5" />}
  </svg>;
}

function TokenTrend({ days }: { days: MetricsPage['daily'] }) {
  if (!days.length) return null;
  const maximum = Math.max(1, ...days.map(day => day.knownInputTokens));
  const points = days.map((day, index) => `${4 + index / Math.max(1, days.length - 1) * 132},${29 - day.knownInputTokens / maximum * 24}`).join(' ');
  return <svg className="coverage-token-trend" viewBox="0 0 140 34" role="img" aria-label={`每日已知 Token 输入：${days.map(day => `${day.date} ${day.knownInputTokens}${day.unknownInputSessions ? `，${day.unknownInputSessions}个会话未知` : ''}`).join('；')}`}><line x1="4" y1="29" x2="136" y2="29" /><polyline points={points} /></svg>;
}

export function TeamCoverage({ request, onEvidence, currentEmployeeId }: { request: (path: string, signal?: AbortSignal) => Promise<Response>; onEvidence: () => void; currentEmployeeId: string }) {
  const [date, setDate] = useState(beijingDate()); const [offset, setOffset] = useState(0);
  const [matrix, setMatrix] = useState<CoverageMatrix>(); const [selection, setSelection] = useState<CoverageCell>();
  const [error, setError] = useState(''); const [retry, setRetry] = useState(0);
  const [detail, setDetail] = useState<{ statistics: WorkStatistics; observations: CoverageObservation[]; nextObservationOffset: number | null; report: DailyReport | null }>();
  const [detailError, setDetailError] = useState(''); const [detailRetry, setDetailRetry] = useState(0); const [observationOffset, setObservationOffset] = useState(0);
  const [statisticsOffset, setStatisticsOffset] = useState(0); const [statisticsRevision, setStatisticsRevision] = useState<number>();
  const [reportRevision, setReportRevision] = useState<number>();
  const [overview, setOverview] = useState<MetricsPage>(); const [overviewError, setOverviewError] = useState('');
  const [dayMetrics, setDayMetrics] = useState<MetricsPage>(); const [dayMetricsError, setDayMetricsError] = useState('');
  const from = matrix?.dates[0], to = matrix?.dates.at(-1);
  useEffect(() => {
    setOverview(undefined); setOverviewError('');
    if (!from || !to) return;
    const abort = new AbortController();
    void request(`/api/metrics?${new URLSearchParams({ period: 'custom', from, to })}`, abort.signal).then(response => response.json()).then((page: MetricsPage) => {
      if (!abort.signal.aborted) setOverview(page);
    }).catch(failure => { if (!abort.signal.aborted) setOverviewError(failure.message); });
    return () => abort.abort();
  }, [from, to, retry]);
  useEffect(() => {
    setDayMetrics(undefined); setDayMetricsError('');
    if (!selection) return;
    const abort = new AbortController();
    void request(`/api/metrics?${new URLSearchParams({ period: 'custom', from: selection.date, to: selection.date })}`, abort.signal).then(response => response.json()).then((page: MetricsPage) => {
      if (!abort.signal.aborted) setDayMetrics(page);
    }).catch(failure => { if (!abort.signal.aborted) setDayMetricsError(failure.message); });
    return () => abort.abort();
  }, [selection?.date, retry]);
  useEffect(() => {
    const abort = new AbortController(); setError(''); setMatrix(undefined); setSelection(undefined);
    void request(`/api/team-coverage?date=${date}&offset=${offset}`, abort.signal).then(response => response.json()).then((value: CoverageMatrix) => {
      if (!abort.signal.aborted) { setMatrix(value); setSelection((value.rows.find(row => row.employeeId === currentEmployeeId) ?? value.rows[0])?.cells.find(cell => cell.date === date)); setObservationOffset(0); setStatisticsOffset(0); setStatisticsRevision(undefined); setReportRevision(undefined); }
    }).catch(failure => { if (!abort.signal.aborted) setError(failure.message); });
    return () => abort.abort();
  }, [date, offset, retry]);
  useEffect(() => {
    const abort = new AbortController(); setDetail(undefined); setDetailError('');
    if (selection) void Promise.all([
      request(`/api/work-statistics/${selection.employeeId}?date=${selection.date}&offset=${statisticsOffset}${statisticsRevision ? `&revision=${statisticsRevision}` : ''}`, abort.signal).then(response => response.json()),
      request(`/api/team-coverage/${selection.employeeId}/observations?date=${selection.date}&offset=${observationOffset}`, abort.signal).then(response => response.json()),
      request(`/api/daily-reports/${selection.employeeId}/${selection.date}${reportRevision ? `?revision=${reportRevision}` : ''}`, abort.signal).then(response => response.json()).catch(() => null),
    ]).then(([statistics, observations, report]) => { if (!abort.signal.aborted) { setDetail({ statistics, observations: observations.observations, nextObservationOffset: observations.nextOffset, report }); setStatisticsRevision(statistics.revision); setReportRevision(report?.revision || undefined); } })
      .catch(failure => { if (!abort.signal.aborted) setDetailError(failure.message); });
    return () => abort.abort();
  }, [selection?.employeeId, selection?.date, observationOffset, statisticsOffset, detailRetry]);
  function select(cell: CoverageCell) { setSelection(cell); setObservationOffset(0); setStatisticsOffset(0); setStatisticsRevision(undefined); setReportRevision(undefined); setDetailRetry(value => value + 1); }
  return <section className="team-coverage" aria-label="团队覆盖矩阵">
    <div className="heading coverage-heading"><div><h1>团队概览</h1><p>{matrix ? `${from} — ${to}` : '最近七日'} · 北京时间{matrix ? ` · 数据截至 ${time(matrix.checkedAt)}` : ''}</p></div>
      <div className="coverage-heading-actions"><label>截止日期 <input type="date" value={date} onChange={event => { if (event.target.value) { setDate(event.target.value); setOffset(0); } }} /></label><a className="coverage-report-link" href="#metrics"><PlatformIcon name="chart" />数据报表</a></div></div>
    {error ? <><p role="alert" className="error">{error}</p><button onClick={() => setRetry(value => value + 1)}>重试覆盖矩阵</button></> : !matrix ? <p role="status">正在读取覆盖矩阵…</p> : <>
      <div className="coverage-kpis" aria-label="所示期间指标">
        <div className="coverage-kpi"><p>所示期间活跃员工</p><strong>{overview ? overview.employees.filter(employee => employee.sessions > 0).length : '未知'}</strong><span>原件中有已确认会话的员工</span></div>
        <div className="coverage-kpi"><p>Token 输入（已知）</p><strong>{overview ? compact(overview.totals.knownInputTokens) : '未知'}</strong><span>{overview ? `${overview.totals.unknownInputSessions} 个会话输入未知${!overview.sourceInputsComplete ? ' · 来源存在缺口' : ''}` : '读取期间原件统计后显示'}</span>{overview && <TokenTrend days={overview.daily} />}</div>
        <div className="coverage-kpi"><p>已验证结果</p><strong className="coverage-unknown-value">未知</strong><span>成果核验指标尚未实现</span></div>
        <div className="coverage-kpi"><p>代码变更</p><strong className="coverage-unknown-value">未知</strong><span>原件中变更行统计尚未实现</span></div>
        <div className="coverage-kpi"><p>Agent 等待回复</p><strong className="coverage-unknown-value">未知</strong><span>等待区间指标尚未实现</span></div>
      </div>
      {overviewError && <p role="status" className="coverage-data-note">期间指标暂不可读取：{overviewError}</p>}
      <h2 className="coverage-block-title">覆盖与活动 · 右侧统计为 {selection?.date ?? date} 周{weekday(selection?.date ?? date)}</h2>
      <div className="coverage-layout"><div>
        <div className="coverage-matrix" role="group" aria-label="员工与日期覆盖">
          <table className="coverage-table"><caption className="platform-sr-only">员工 × 日期覆盖状态，以及所选日期的活动统计</caption><thead><tr><th scope="col">员工</th>
            {matrix.dates.map(day => <th scope="col" key={day} className="coverage-date-heading"><button aria-pressed={selection?.date === day} aria-label={`查看日期 ${day}`} onClick={() => { const cell = matrix.rows.find(row => row.employeeId === selection?.employeeId)?.cells.find(cell => cell.date === day); if (cell) select(cell); }}><span>{weekday(day)}</span><b>{Number(day.slice(8))}</b></button></th>)}
            <th scope="col">会话</th><th scope="col">轮次</th><th scope="col">工具调用</th><th scope="col">文件</th><th scope="col">Token 输入</th><th scope="col">日报</th></tr></thead>
          <tbody>{matrix.rows.map(row => {
            const selectedDay = row.cells.find(cell => cell.date === selection?.date);
            const measured = dayMetrics?.scope.from === selection?.date ? dayMetrics?.employees.find(employee => employee.employeeId === row.employeeId) : undefined;
            const rowDetail = detail?.statistics.employeeId === row.employeeId && detail?.statistics.date === selection?.date ? detail : undefined;
            return <tr key={row.employeeId} className={selection?.employeeId === row.employeeId ? 'coverage-row-selected' : undefined}><th scope="row"><button className="coverage-person" aria-pressed={selection?.employeeId === row.employeeId} onClick={() => { if (selectedDay) select(selectedDay); }}><span className="coverage-person-avatar" aria-hidden="true">{Array.from(row.employee)[0]}</span><span>{row.employee}</span></button></th>
            {row.cells.map(cell => <td key={cell.date} className={selection?.date === cell.date ? 'coverage-current-column' : undefined}><button
              className={`coverage-cell ${cell.collection === 'gap-observed' ? 'coverage-gap' : ''} ${selection?.employeeId === cell.employeeId && selection?.date === cell.date ? 'coverage-selected' : ''}`}
              data-selected-date={selection?.date === cell.date} aria-pressed={selection?.employeeId === cell.employeeId && selection?.date === cell.date}
              aria-label={`${row.employee} ${cell.date}，${cell.records} 条已确认记录，${collection[cell.collection]}，${analysis[cell.analysis]}`}
              title={`${cell.records} 条已确认记录 · ${collection[cell.collection]} · ${analysis[cell.analysis]}`} onClick={() => select(cell)}><CoverageGlyph cell={cell} /></button></td>)}
            <td className="coverage-number">{metric(selectedDay?.sessions)}</td><td className="coverage-number">{metric(measured?.userTurns)}</td><td className="coverage-number">{metric(measured?.toolCalls)}</td><td className="coverage-number">{rowDetail ? `${metric(rowDetail.statistics.files.observedCount)}${rowDetail.statistics.files.complete ? '' : '+'}` : <span className="coverage-unknown">未知</span>}</td>
            <td className="coverage-number">{measured ? <>{compact(measured.knownInputTokens)}{measured.unknownInputSessions > 0 && <span className="coverage-unknown">+未知</span>}</> : <span className="coverage-unknown">未知</span>}</td>
            <td><span className={`coverage-report-state${selectedDay?.analysis === 'unfinished' ? ' is-unfinished' : ''}`}>{selectedDay?.analysis === 'ready' ? '已有版本' : selectedDay?.analysis === 'unfinished' ? '未完成' : selectedDay?.analysis === 'not-scheduled' ? '未安排' : '未知'}</span></td></tr>;
          })}</tbody></table>
        </div>
        <div className="coverage-legend" aria-label="符号说明"><span><CoverageGlyph kind="observed" />有已观察活动</span><span><CoverageGlyph />无已观察活动</span><span><CoverageGlyph kind="unknown" />覆盖未知</span><span><CoverageGlyph kind="gap" />采集缺口</span><span><CoverageGlyph kind="pending" />宿主待确认</span><span><CoverageGlyph kind="unfinished" />分析未完成</span></div>
        <p className="coverage-data-note">无已观察活动不等于没有工作。心跳、原件提交与分析完成各自独立；覆盖未知保留为未知。所选员工的文件数量以右侧原件统计为准，其余显示未知。</p>
        {dayMetricsError && <p role="status" className="coverage-data-note">当日指标暂不可读取：{dayMetricsError}</p>}
        {!matrix.rows.length && <p>还没有员工。接入后可查看已提交记录与设备观测。</p>}
        <div className="pagination"><button disabled={!offset} onClick={() => setOffset(value => Math.max(0, value - 10))}>上一页员工</button>
          <button disabled={matrix.nextOffset === null} onClick={() => setOffset(matrix.nextOffset!)}>下一页员工</button></div>
        <p className="muted small">{matrix.definition} 历史观测开始保存于 {time(matrix.observationStartedAt)}。</p>
      </div><aside className="coverage-inspector" aria-label="选中员工与日期">{selection ? <>
        <div className="coverage-inspector-heading"><span className="coverage-person-avatar" aria-hidden="true">{Array.from(selection.employee)[0]}</span><div><h2>{selection.employee}</h2><p>{selection.date} 周{weekday(selection.date)}</p></div></div>
        <ul className="coverage-statuses"><li>{connection[selection.currentConnection]}</li><li>{configured[selection.configured]}</li><li>{host[selection.hostConfirmation]}</li>
          <li>{collection[selection.collection]}</li><li>{analysis[selection.analysis]}</li></ul>
        <p className="muted small">服务器收到观测：{time(selection.firstReceivedAt)} — {time(selection.lastReceivedAt)}。这不是连续采集证明。</p>
        {detailError ? <><p role="alert" className="error">{detailError}</p><button onClick={() => setDetailRetry(value => value + 1)}>重试统计与观测</button></> : !detail ? <p role="status">正在读取原始统计与观测…</p> : <>
          <section aria-label="方向主题与阻塞"><h3>方向、主题与阻塞</h3>
            {detail.report?.coverage?.fixture && <p className="notice">合成分析，非正式模型验收。</p>}
            {detail.report?.version ? <p className="muted small">已保存日报 v{detail.report.revision}{detail.report.refreshPending ? ' · 后续刷新待完成' : ''}{detail.report.state !== 'ready' ? ' · 材料或分析不完整' : ''}</p>
              : <p>{detail.report ? '本日主题尚未生成' : '日报暂不可读取'}；方向与阻塞未知。</p>}
            {([['goal', '方向'], ['topic', '主题'], ['blocker', '阻塞']] as const).map(([category, label]) => {
              const items = (detail.report?.items ?? []).filter(item => item.category === category).slice(0, 1);
              return <div key={category}><h4>{label}</h4>{items.length ? items.map((item, index) => <div key={index}><p>{item.text}</p><p className="muted small">{assessmentLabels[item.assessment]}</p>
                <a href={`#work?${new URLSearchParams({ kind: 'project', subject: item.project, from: selection.date, to: selection.date })}`}>查看项目工作：{item.project || '未归类项目'}</a></div>)
                : <p className="muted small">尚无本页证据支持的{label}，不代表没有。</p>}</div>;
            })}
            <p><a href={`#daily?${new URLSearchParams({ employeeId: selection.employeeId, date: selection.date, ...(detail.report?.revision ? { revision: String(detail.report.revision) } : {}) })}`}>查看该员工本日工作</a></p>
          </section>
          <h3>已记录活动</h3><dl className="coverage-metrics"><div><dt>会话</dt><dd>{metric(detail.statistics.sessions)}</dd></div><div><dt>用户轮次</dt><dd>{metric(detail.statistics.userTurns)}</dd></div>
            <div><dt>工具调用</dt><dd>{metric(detail.statistics.toolCalls)}</dd></div><div><dt>记录中文件路径</dt><dd>{metric(detail.statistics.files.observedCount)}{!detail.statistics.files.complete && ' · 不完整'}</dd></div>
            <div><dt>来源 Token 总量</dt><dd>{metric(detail.statistics.tokens.total)}</dd></div><div><dt>活动时间段</dt><dd>{detail.statistics.intervals.length} 段</dd></div></dl>
          <p className="muted small">仅已确认原活动；Token 来源记录非账单，区间非工时。</p>
          <details><summary>核查统计口径</summary><p className="muted small">{detail.statistics.definition}</p><p className="muted small">{detail.statistics.tokens.definition}</p></details>
          <details><summary>Token 分项与活动点</summary><p>输入 {metric(detail.statistics.tokens.input)}；缓存读取 {metric(detail.statistics.tokens.cachedInput)}；缓存写入 {metric(detail.statistics.tokens.cacheWriteInput)}；输出 {metric(detail.statistics.tokens.output)}；推理输出 {metric(detail.statistics.tokens.reasoningOutput)}。</p>
            <ul>{detail.statistics.intervals.map((interval, index) => <li key={index}>{time(interval.from)} — {time(interval.to)} · {interval.points} 个来源活动点</li>)}</ul></details>
          <details><summary>原件统计引用</summary><ul>{detail.statistics.references.map((reference, index) => <li key={index}><a href={reference.webPath} onClick={onEvidence}>{reference.kind === 'file' ? reference.value : `Token 记录，第 ${reference.line} 行`}</a></li>)}</ul>
            <div className="pagination"><button disabled={!statisticsOffset} onClick={() => setStatisticsOffset(value => Math.max(0, value - 20))}>上一页引用</button>
              <button disabled={detail.statistics.nextOffset === null} onClick={() => setStatisticsOffset(detail.statistics.nextOffset!)}>下一页引用</button></div>
            <p className="muted small">统计版本 {detail.statistics.revision}；翻页保持同一版本。重新选择员工与日期可读取当前版本。</p></details>
          <h3>服务器收到的设备观测</h3>{!detail.observations.length && <p>该日没有保存的观测，覆盖未知。</p>}
          <ul>{detail.observations.map((observation, index) => <li key={index}><strong>{observation.device} · {observation.source ?? '后台'}</strong><p>{time(observation.firstReceivedAt)} — {time(observation.lastReceivedAt)}</p>
            <p>{observation.gapObserved ? '曾观察采集缺口' : '未在这些时点报告缺口'}{observation.backlogObserved ? ' · 曾有待提交原件' : ''}</p></li>)}</ul>
          <div className="pagination"><button disabled={!observationOffset} onClick={() => setObservationOffset(value => Math.max(0, value - 20))}>上一页观测</button><button disabled={detail.nextObservationOffset === null} onClick={() => setObservationOffset(detail.nextObservationOffset!)}>下一页观测</button></div>
        </>}
      </> : <p>选择员工和日期查看统计与覆盖证据。</p>}</aside></div>
      <section className="coverage-people-summary" aria-label="所示期间人员汇总"><div className="coverage-summary-heading"><h2>所示期间人员汇总</h2><a href="#metrics">打开完整报表</a></div>
        {!overview ? <p className="coverage-data-note">{overviewError ? '期间原件统计暂不可读取。' : '正在读取期间原件统计…'}</p> : !overview.employees.length ? <p className="coverage-data-note">所示期间尚无已确认活动，不能据此判断员工是否工作。</p> : <div className="coverage-summary-table"><table><thead><tr><th scope="col">员工</th><th scope="col">会话</th><th scope="col">Token 输入（已知）</th><th scope="col">用户轮次</th><th scope="col">工具调用</th><th scope="col">已验证结果</th><th scope="col">使用能力</th></tr></thead><tbody>{[...overview.employees].sort((a, b) => a.employee.localeCompare(b.employee, 'zh-CN') || a.employeeId.localeCompare(b.employeeId)).map(employee => <tr key={employee.employeeId}><th scope="row"><span className="coverage-summary-person"><span className="coverage-person-avatar" aria-hidden="true">{Array.from(employee.employee)[0]}</span>{employee.employee}</span></th><td>{metric(employee.sessions)}</td><td>{compact(employee.knownInputTokens)}{employee.unknownInputSessions > 0 && <span className="coverage-unknown">{employee.unknownInputSessions} 会话未知</span>}</td><td>{metric(employee.userTurns)}</td><td>{metric(employee.toolCalls)}</td><td><span className="coverage-unknown">未知</span></td><td><span className="coverage-unknown">尚未评估</span></td></tr>)}</tbody></table></div>}
        <p className="coverage-data-note">按姓名排列；Token 未上报的会话单独标注，不折算工时。已验证结果与使用能力尚未实现。{overview && `指标版本 ${overview.revision} · ${overview.version.slice(0, 12)}`}</p>
      </section>
    </>}
  </section>;
}
