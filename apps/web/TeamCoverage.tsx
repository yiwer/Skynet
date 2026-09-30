import { useEffect, useState } from 'react';
import { beijingDate } from '../../packages/contracts/reports.js';
import type { CoverageCell, CoverageMatrix, CoverageObservation, WorkStatistics } from '../../packages/contracts/coverage.js';

const collection = { 'gap-observed': '采集缺口已观察', 'observations-only': '仅有时点观测', unknown: '覆盖未知' };
const analysis = { ready: '报告已有版本', unfinished: '分析/报告未完成', 'not-scheduled': '尚未安排分析', unknown: '分析未知' };
const connection = { connected: '当前设备可达', 'not-connected': '当前未连接', unknown: '当前连接未知', 'not-applicable': '历史连接不回填' };
const configured = { configured: '已报告配置', 'not-configured': '已报告未配置', mixed: '配置状态混合', unknown: '安装配置未知' };
const host = { observed: '已观察宿主事件', 'pending-confirmation': '宿主信任/首次事件待确认', unknown: '宿主确认未知' };
const time = (value: string | null) => value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '未知';
const metric = (value: number | null | undefined) => value == null ? '未知' : value.toLocaleString();

export function TeamCoverage({ request, onEvidence, currentEmployeeId }: { request: (path: string, signal?: AbortSignal) => Promise<Response>; onEvidence: () => void; currentEmployeeId: string }) {
  const [date, setDate] = useState(beijingDate()); const [offset, setOffset] = useState(0);
  const [matrix, setMatrix] = useState<CoverageMatrix>(); const [selection, setSelection] = useState<CoverageCell>();
  const [error, setError] = useState(''); const [retry, setRetry] = useState(0);
  const [detail, setDetail] = useState<{ statistics: WorkStatistics; observations: CoverageObservation[]; nextObservationOffset: number | null }>();
  const [detailError, setDetailError] = useState(''); const [detailRetry, setDetailRetry] = useState(0); const [observationOffset, setObservationOffset] = useState(0);
  const [statisticsOffset, setStatisticsOffset] = useState(0); const [statisticsRevision, setStatisticsRevision] = useState<number>();
  useEffect(() => {
    const abort = new AbortController(); setError(''); setMatrix(undefined); setSelection(undefined);
    void request(`/api/team-coverage?date=${date}&offset=${offset}`, abort.signal).then(response => response.json()).then((value: CoverageMatrix) => {
      if (!abort.signal.aborted) { setMatrix(value); setSelection((value.rows.find(row => row.employeeId === currentEmployeeId) ?? value.rows[0])?.cells.find(cell => cell.date === date)); setObservationOffset(0); setStatisticsOffset(0); setStatisticsRevision(undefined); }
    }).catch(failure => { if (!abort.signal.aborted) setError(failure.message); });
    return () => abort.abort();
  }, [date, offset, retry]);
  useEffect(() => {
    const abort = new AbortController(); setDetail(undefined); setDetailError('');
    if (selection) void Promise.all([
      request(`/api/work-statistics/${selection.employeeId}?date=${selection.date}&offset=${statisticsOffset}${statisticsRevision ? `&revision=${statisticsRevision}` : ''}`, abort.signal).then(response => response.json()),
      request(`/api/team-coverage/${selection.employeeId}/observations?date=${selection.date}&offset=${observationOffset}`, abort.signal).then(response => response.json()),
    ]).then(([statistics, observations]) => { if (!abort.signal.aborted) { setDetail({ statistics, observations: observations.observations, nextObservationOffset: observations.nextOffset }); setStatisticsRevision(statistics.revision); } })
      .catch(failure => { if (!abort.signal.aborted) setDetailError(failure.message); });
    return () => abort.abort();
  }, [selection?.employeeId, selection?.date, observationOffset, statisticsOffset, detailRetry]);
  function select(cell: CoverageCell) { setSelection(cell); setObservationOffset(0); setStatisticsOffset(0); setStatisticsRevision(undefined); setDetailRetry(value => value + 1); }
  return <section className="team-coverage" aria-label="团队覆盖矩阵">
    <div className="heading"><div><p className="eyebrow">来源日期 · 北京时间</p><h1>团队覆盖</h1><p>先看记录与采集状态，再打开原件核查。</p></div>
      <label>截止日期 <input type="date" value={date} onChange={event => { if (event.target.value) { setDate(event.target.value); setOffset(0); } }} /></label></div>
    <p className="notice">无已观察活动不等于没有工作。心跳、原件提交与分析完成各自独立；覆盖未知保留为未知。</p>
    {error ? <><p role="alert" className="error">{error}</p><button onClick={() => setRetry(value => value + 1)}>重试覆盖矩阵</button></> : !matrix ? <p role="status">正在读取覆盖矩阵…</p> : <>
      <div className="coverage-date-picker" aria-label="查看日期">{matrix.dates.map(day => <button key={day} aria-pressed={selection?.date === day}
        onClick={() => { const cell = matrix.rows.find(row => row.employeeId === selection?.employeeId)?.cells.find(cell => cell.date === day); if (cell) select(cell); }}>{day.slice(5)}</button>)}</div>
      <div className="coverage-layout"><div>
        <div className="coverage-matrix" role="group" aria-label="员工与日期覆盖">
          <div className="coverage-matrix-header"><strong>员工</strong>{matrix.dates.map(day => <span key={day}>{day.slice(5)}</span>)}</div>
          {matrix.rows.map(row => <div className="coverage-matrix-row" key={row.employeeId}><strong>{row.employee}</strong>{row.cells.map(cell => <button
            key={cell.date} className={`coverage-cell ${cell.collection === 'gap-observed' ? 'coverage-gap' : ''} ${selection?.employeeId === cell.employeeId && selection?.date === cell.date ? 'coverage-selected' : ''}`}
            data-selected-date={selection?.date === cell.date} aria-pressed={selection?.employeeId === cell.employeeId && selection?.date === cell.date}
            aria-label={`${row.employee} ${cell.date}，${cell.records} 条已确认记录，${collection[cell.collection]}，${analysis[cell.analysis]}`}
            onClick={() => select(cell)}><span className="coverage-day">{cell.date.slice(5)}</span><strong>{cell.records ? `${cell.records} 条` : '无已观察活动'}</strong>
              <span>{collection[cell.collection]}</span><small>{analysis[cell.analysis]}</small></button>)}</div>)}
        </div>
        {!matrix.rows.length && <p>还没有员工。接入后可查看已提交记录与设备观测。</p>}
        <div className="pagination"><button disabled={!offset} onClick={() => setOffset(value => Math.max(0, value - 10))}>上一页员工</button>
          <button disabled={matrix.nextOffset === null} onClick={() => setOffset(matrix.nextOffset!)}>下一页员工</button></div>
        <p className="muted small">{matrix.definition} 历史观测开始保存于 {time(matrix.observationStartedAt)}。</p>
      </div><aside className="coverage-inspector" aria-label="选中员工与日期">{selection ? <>
        <p className="eyebrow">{selection.date}</p><h2>{selection.employee}</h2>
        <ul className="coverage-statuses"><li>{connection[selection.currentConnection]}</li><li>{configured[selection.configured]}</li><li>{host[selection.hostConfirmation]}</li>
          <li>{collection[selection.collection]}</li><li>{analysis[selection.analysis]}</li></ul>
        <p className="muted small">服务器收到观测：{time(selection.firstReceivedAt)} — {time(selection.lastReceivedAt)}。这不是连续采集证明。</p>
        {detailError ? <><p role="alert" className="error">{detailError}</p><button onClick={() => setDetailRetry(value => value + 1)}>重试统计与观测</button></> : !detail ? <p role="status">正在读取原始统计与观测…</p> : <>
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
    </>}
  </section>;
}
