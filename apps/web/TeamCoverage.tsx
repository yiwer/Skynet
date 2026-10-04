import {TeamKpis,TeamPeople,TeamFilters,teamParams,teamHashQuery} from './TeamUsage.js';
import type {TeamReport} from '../../packages/contracts/team-report.js';
import { useEffect, useState } from 'react';
import { beijingDate, type DailyReport } from '../../packages/contracts/reports.js';
import { assessmentLabels } from '../../packages/contracts/analysis.js';
import type { CoverageCell, CoverageMatrix, CoverageObservation, WorkStatistics } from '../../packages/contracts/coverage.js';

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

export function TeamCoverage({ request, onEvidence, currentEmployeeId }: { request: (path: string, signal?: AbortSignal) => Promise<Response>; onEvidence: () => void; currentEmployeeId: string }) {
  const [query,setQuery]=useState(teamHashQuery);const date=beijingDate();const [offset,setOffset]=useState(0);
  const [matrix, setMatrix] = useState<CoverageMatrix>(); const [selection, setSelection] = useState<CoverageCell>();
  const [error, setError] = useState(''); const [retry, setRetry] = useState(0);
  const [detail, setDetail] = useState<{ statistics: WorkStatistics; observations: CoverageObservation[]; nextObservationOffset: number | null; report: DailyReport | null }>();
  const [detailError, setDetailError] = useState(''); const [detailRetry, setDetailRetry] = useState(0); const [observationOffset, setObservationOffset] = useState(0);
  const [statisticsOffset, setStatisticsOffset] = useState(0); const [statisticsRevision, setStatisticsRevision] = useState<number>();
  const [reportRevision, setReportRevision] = useState<number>();
  const [overview, setOverview] = useState<TeamReport>(); const [overviewError, setOverviewError] = useState('');

  const from = overview?.scope.from, to = overview?.scope.to;
  useEffect(()=>{const change=()=>{if(location.hash.split('?')[0]==='#coverage'){const next=teamHashQuery();setQuery(previous=>JSON.stringify(previous)===JSON.stringify(next)?previous:next);setOffset(0);}};window.addEventListener('hashchange',change);return()=>window.removeEventListener('hashchange',change);},[]);
  useEffect(()=>{setOverview(undefined);setOverviewError('');const abort=new AbortController();request('/api/team-report?'+teamParams(query),abort.signal).then(response=>response.json()).then(value=>{if(!abort.signal.aborted)setOverview(value);}).catch(error=>{if(!abort.signal.aborted)setOverviewError(error.message);});return()=>abort.abort();},[query,retry]);  useEffect(()=>{setMatrix(undefined);setSelection(undefined);if(!overview)return;const value={...overview.coverage,rows:overview.coverage.rows.slice(offset,offset+10),nextOffset:overview.coverage.rows.length>offset+10?offset+10:null};setMatrix(value);const row=value.rows.find(row=>row.employeeId===currentEmployeeId)??value.rows[0];setSelection(row?.cells.find(cell=>cell.date===date)??row?.cells.at(-1));setObservationOffset(0);setStatisticsOffset(0);setStatisticsRevision(undefined);setReportRevision(undefined);},[overview?.version,overview?.coverage.dateOffset,offset]);  useEffect(() => {
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
  const dayMetrics=selection&&overview?{scope:{from:selection.date},employees:overview.people.flatMap(person=>{const day=person.daily.find(day=>day.date===selection.date);return day&&day.userTurns!==undefined&&(day.activeSessions>0||(day.knownInputTokens??0)>0)?[{employeeId:person.employeeId,sessions:day.activeSessions,userTurns:day.userTurns,toolCalls:day.toolCalls,knownInputTokens:day.knownInputTokens??0,unknownInputSessions:day.unknownInputSessions??0}]:[];})}:undefined;  const showDayMetrics = !!dayMetrics && dayMetrics.scope.from === selection?.date && dayMetrics.employees.length > 0;
  const showReports = matrix?.rows.some(row => row.cells.some(cell => cell.date === selection?.date && ['ready', 'unfinished'].includes(cell.analysis)));
  return <section className="team-coverage workspace-page" aria-label="团队覆盖矩阵">
    <div className="heading coverage-heading"><div><h1>团队概览</h1>{matrix && <p>{from} — {to}</p>}</div>
      <div className="coverage-heading-actions"><button disabled={!overview} onClick={async()=>{if(!overview)return;try{const response=await request('/api/team-report/export?'+teamParams({...query,version:overview.version})),url=URL.createObjectURL(await response.blob()),a=document.createElement('a');a.href=url;a.download=`skynet-team-${overview.version}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(error){setOverviewError((error as Error).message);}}}>导出当前版本</button></div></div>
    <TeamFilters query={query} report={overview} onChange={value=>{location.hash='#coverage?'+teamParams(value);}}/>
    {overview&&<p className="team-cutoff">数据截至 {new Date(overview.dataAsOf).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})} · <a href="#team-definitions" onClick={event=>{event.preventDefault();document.getElementById('team-definitions')?.setAttribute('open','');document.getElementById('team-definitions')?.scrollIntoView();}}>指标口径</a></p>}    <div className="workspace-scroll coverage-scroll">
    {error||overviewError ? <><p role="alert" className="error">{error||overviewError}</p><button onClick={() => setRetry(value => value + 1)}>重试覆盖矩阵</button></> : !matrix ? <p role="status">加载中…</p> : <>
      {overview&&<TeamKpis report={overview}/>}
      {matrix.rows.length > 0 ? <>
      <div className="coverage-section-heading"><h2 className="coverage-block-title">覆盖与活动</h2><div className="team-date-pages"><span>{matrix.dates[0]} — {matrix.dates.at(-1)}</span>{(overview?.coverage.totalDates??0)>7&&<><button disabled={overview?.coverage.nextDateOffset==null} onClick={()=>{location.hash='#coverage?'+teamParams({...query,version:overview!.version,coverageOffset:overview!.coverage.nextDateOffset!});}}>更早 7 天</button><button disabled={!overview?.coverage.dateOffset} onClick={()=>{location.hash='#coverage?'+teamParams({...query,version:overview!.version,coverageOffset:Math.max(0,(overview!.coverage.dateOffset??0)-7)});}}>更晚 7 天</button></>}</div></div>
      <div className="coverage-layout"><div>
        <div className="coverage-matrix" role="group" aria-label="员工与日期覆盖">
          <table className="coverage-table"><caption className="platform-sr-only">员工与日期覆盖状态</caption><thead><tr><th scope="col">员工</th>
            {matrix.dates.map(day => <th scope="col" key={day} className="coverage-date-heading"><button aria-pressed={selection?.date === day} aria-label={`查看日期 ${day}`} onClick={() => { const cell = matrix.rows.find(row => row.employeeId === selection?.employeeId)?.cells.find(cell => cell.date === day); if (cell) select(cell); }}><span>{weekday(day)}</span><b>{Number(day.slice(8))}</b></button></th>)}
            <th scope="col">会话</th>{showDayMetrics && <><th scope="col">轮次</th><th scope="col">工具</th><th scope="col">Token 输入</th></>}{showReports && <th scope="col">日报</th>}</tr></thead>
          <tbody>{matrix.rows.map(row => {
            const selectedDay = row.cells.find(cell => cell.date === selection?.date);
            const measured = showDayMetrics ? dayMetrics?.employees.find(employee => employee.employeeId === row.employeeId) : undefined;
            return <tr key={row.employeeId} className={selection?.employeeId === row.employeeId ? 'coverage-row-selected' : undefined}><th scope="row"><button className="coverage-person" aria-pressed={selection?.employeeId === row.employeeId} onClick={() => { if (selectedDay) select(selectedDay); }}><span className="coverage-person-avatar" aria-hidden="true">{Array.from(row.employee)[0]}</span><span>{row.employee}</span></button></th>
            {row.cells.map(cell => <td key={cell.date} className={selection?.date === cell.date ? 'coverage-current-column' : undefined}><button
              className={`coverage-cell ${cell.collection === 'gap-observed' ? 'coverage-gap' : ''} ${selection?.employeeId === cell.employeeId && selection?.date === cell.date ? 'coverage-selected' : ''}`}
              data-selected-date={selection?.date === cell.date} aria-pressed={selection?.employeeId === cell.employeeId && selection?.date === cell.date}
              aria-label={`${row.employee} ${cell.date}，${cell.records} 条已确认记录，${collection[cell.collection]}，${analysis[cell.analysis]}`}
              title={`${cell.records} 条记录 · ${collection[cell.collection]} · ${analysis[cell.analysis]}`} onClick={() => select(cell)}><CoverageGlyph cell={cell} /></button></td>)}
            <td className="coverage-number">{selectedDay?.sessions}</td>{showDayMetrics && <><td className="coverage-number">{measured?.userTurns}</td><td className="coverage-number">{measured?.toolCalls}</td><td className="coverage-number">{measured && measured.sessions > measured.unknownInputSessions ? <>{compact(measured.knownInputTokens)}{measured.unknownInputSessions > 0 && <sup title="部分会话未上报 Token">*</sup>}</> : null}</td></>}
            {showReports && <td>{selectedDay?.analysis === 'ready' ? <span className="coverage-report-state">已生成</span> : selectedDay?.analysis === 'unfinished' ? <span className="coverage-report-state is-unfinished">处理中</span> : null}</td>}</tr>;
          })}</tbody></table>
        </div>
        <div className="coverage-legend" aria-label="符号说明"><span><CoverageGlyph kind="observed" />有活动</span><span><CoverageGlyph />无记录</span><span><CoverageGlyph kind="unknown" />覆盖未知</span><span><CoverageGlyph kind="gap" />采集缺口</span><span><CoverageGlyph kind="pending" />待确认</span><span><CoverageGlyph kind="unfinished" />处理中</span></div>

        {(offset > 0 || matrix.nextOffset !== null) && <div className="pagination"><button disabled={!offset} onClick={() => setOffset(value => Math.max(0, value - 10))}>上一页员工</button><button disabled={matrix.nextOffset === null} onClick={() => setOffset(matrix.nextOffset!)}>下一页员工</button></div>}
      </div>{selection && <aside className="coverage-inspector" aria-label="选中员工与日期">
        <div className="coverage-inspector-heading"><span className="coverage-person-avatar" aria-hidden="true">{Array.from(selection.employee)[0]}</span><div><h2>{selection.employee}</h2><p>{selection.date} 周{weekday(selection.date)}</p></div></div>
        <ul className="coverage-statuses">{selection.currentConnection !== 'unknown' && selection.currentConnection !== 'not-applicable' && <li>{connection[selection.currentConnection]}</li>}{selection.configured !== 'unknown' && <li>{configured[selection.configured]}</li>}{selection.hostConfirmation !== 'unknown' && <li>{host[selection.hostConfirmation]}</li>}{selection.collection === 'gap-observed' && <li>采集缺口</li>}</ul>
        {detailError ? <><p role="alert" className="error">{detailError}</p><button onClick={() => setDetailRetry(value => value + 1)}>重试统计与观测</button></> : !detail ? <p role="status">加载中…</p> : <>
          {!!detail.report?.items.length && <section aria-label="方向主题与阻塞">
            {([['goal', '方向'], ['topic', '主题'], ['blocker', '阻塞']] as const).map(([category, label]) => {
              const items = detail.report!.items.filter(item => item.category === category).slice(0, 1);
              return items.length > 0 && <div key={category}><h3>{label}</h3>{items.map((item, index) => <div key={index}><p>{item.text}</p><p className="muted small">{assessmentLabels[item.assessment]}</p><a href={`#work?${new URLSearchParams({ kind: 'project', subject: item.project, from: selection.date, to: selection.date })}`}>{item.project || '未归类项目'} →</a></div>)}</div>;
            })}
          </section>}
          {detail.statistics.records > 0 && <section><h3>已记录活动</h3><dl className="coverage-metrics"><div><dt>会话</dt><dd>{metric(detail.statistics.sessions)}</dd></div><div><dt>用户轮次</dt><dd>{metric(detail.statistics.userTurns)}</dd></div><div><dt>工具调用</dt><dd>{metric(detail.statistics.toolCalls)}</dd></div>
            {detail.statistics.files.observedCount > 0 && <div><dt>文件路径</dt><dd>{metric(detail.statistics.files.observedCount)}{!detail.statistics.files.complete && '+'}</dd></div>}{detail.statistics.tokens.total != null && <div><dt>来源 Token</dt><dd>{metric(detail.statistics.tokens.total)}</dd></div>}{detail.statistics.intervals.length > 0 && <div><dt>活动区间</dt><dd>{detail.statistics.intervals.length}</dd></div>}</dl></section>}
          {(detail.statistics.tokens.usageRecords > 0 || detail.statistics.intervals.length > 0) && <details><summary>Token 与活动区间</summary><dl className="coverage-metrics">{([['输入', detail.statistics.tokens.input], ['缓存读取', detail.statistics.tokens.cachedInput], ['缓存写入', detail.statistics.tokens.cacheWriteInput], ['输出', detail.statistics.tokens.output], ['推理输出', detail.statistics.tokens.reasoningOutput]] as const).filter(([, value]) => value != null).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{metric(value)}</dd></div>)}</dl><ul>{detail.statistics.intervals.map((interval, index) => <li key={index}>{time(interval.from)} — {time(interval.to)} · {interval.points} 个活动点</li>)}</ul></details>}
          {(detail.statistics.references.length > 0 || statisticsOffset > 0) && <details><summary>统计引用 · v{detail.statistics.revision}</summary><ul>{detail.statistics.references.map((reference, index) => <li key={index}><a href={reference.webPath} onClick={onEvidence}>{reference.kind === 'file' ? reference.value : `Token · 第 ${reference.line} 行`}</a></li>)}</ul>
            {(statisticsOffset > 0 || detail.statistics.nextOffset !== null) && <div className="pagination"><button disabled={!statisticsOffset} onClick={() => setStatisticsOffset(value => Math.max(0, value - 20))}>上一页引用</button><button disabled={detail.statistics.nextOffset === null} onClick={() => setStatisticsOffset(detail.statistics.nextOffset!)}>下一页引用</button></div>}</details>}
          {(detail.observations.length > 0 || observationOffset > 0) && <details><summary>设备观测</summary><ul>{detail.observations.map((observation, index) => <li key={index}><strong>{observation.device} · {observation.source ?? '后台'}</strong><p>{time(observation.firstReceivedAt)} — {time(observation.lastReceivedAt)}</p>{(observation.gapObserved || observation.backlogObserved) && <p>{[observation.gapObserved && '采集缺口', observation.backlogObserved && '待提交原件'].filter(Boolean).join(' · ')}</p>}</li>)}</ul>
            {(observationOffset > 0 || detail.nextObservationOffset !== null) && <div className="pagination"><button disabled={!observationOffset} onClick={() => setObservationOffset(value => Math.max(0, value - 20))}>上一页观测</button><button disabled={detail.nextObservationOffset === null} onClick={() => setObservationOffset(detail.nextObservationOffset!)}>下一页观测</button></div>}</details>}
          <a className="coverage-daily-link" href={`#daily?${new URLSearchParams({ employeeId: selection.employeeId, date: selection.date, ...(detail.report?.revision ? { revision: String(detail.report.revision) } : {}) })}`}>查看日报 →</a>
        </>}
      </aside>}</div>
      </> : <p className="report-empty">暂无员工</p>}
      {overview&&<><TeamPeople report={overview} query={query}/><details id="team-definitions"><summary>指标口径与版本</summary><p>人数按所选范围有业务会话的员工计算；人员固定按姓名。Token 为已知部分，未知会话不进入趋势。已验证结果、仅声称和返工为模型推断；返工显示分子、有效非首条分母与未知数。</p><p>覆盖矩阵中活动随员工、日期、Agent 和项目筛选；采集观测描述设备与来源，不能按项目证明连续覆盖。每日检查可进入各自原文及日报版本。</p><p>{overview.coverage.definition}</p><p>团队版本 {overview.version}</p><p>来源 {overview.usageVersion} · {overview.promptVersion} · {overview.waitReportVersion}</p></details></>}    </>}
    </div>
  </section>;
}
