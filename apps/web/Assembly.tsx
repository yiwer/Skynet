import { useEffect, useState } from 'react';
import type { AssemblyAudit, AssemblySummary, ProcessingPage } from '../../packages/contracts/assembly.js';
import { sourceLabel } from '../../packages/contracts/archive.js';
import { beijingDate } from '../../packages/contracts/reports.js';
import './assembly.css';

type Request = (path: string, signal?: AbortSignal) => Promise<Response>;
const states = { assembled: '已组装', assembling: '组装中', gap: '有缺口', 'pending-lineage': '待确认谱系' };
const decisions = { independent: '独立会话', continuation: '续聊合并', restoration: '恢复历史合并', unresolved: '谱系待确认' };
const format = (value: number | null) => value === null ? '未记录' : value.toLocaleString('zh-CN');
const dateTime = (value: string | null) => value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '未记录';
async function download(request: Request, path: string, filename: string) {
  const blob = await (await request(path)).blob(), url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function AssemblyPanel({ snapshotId, request }: { snapshotId: string; request: Request }) {
  const [audit, setAudit] = useState<AssemblyAudit | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [retry, setRetry] = useState(0);
  const selectedVersion = new URLSearchParams(location.hash.split('?')[1]).get('assemblyVersion');
  useEffect(() => {
    const abort = new AbortController(); setAudit(null); setError('');
    request(`/api/snapshots/${snapshotId}/assembly${selectedVersion ? '?version=' + selectedVersion : ''}`, abort.signal).then(response => response.json()).then(value => { if (!abort.signal.aborted) setAudit(value); })
      .catch(failure => { if (!abort.signal.aborted) setError(failure.message); }); return () => abort.abort();
  }, [snapshotId, selectedVersion, retry]);
  async function more() {
    if (!audit || audit.nextOffset === null) return; setBusy(true); setError('');
    try { const next: AssemblyAudit = await (await request(`/api/snapshots/${snapshotId}/assembly?version=${audit.version}&offset=${audit.nextOffset}`)).json();
      setAudit({ ...audit, sources: [...audit.sources, ...next.sources], gaps: [...audit.gaps, ...next.gaps], sideLinks: [...audit.sideLinks, ...next.sideLinks], nextOffset: next.nextOffset });
    } catch (failure) { setError((failure as Error).message); } finally { setBusy(false); }
  }
  return <section className="assembly-panel" aria-label="组装与去重"><h2>组装与去重</h2>
    {audit ? <><div className="assembly-result"><span className="assembly-state" data-state={audit.state}>{states[audit.state]}</span><span>{decisions[audit.lineage.decision]}</span></div>
      <dl><div><dt>来源原件</dt><dd>{audit.sourceCount} 份</dd></div><div><dt>记录</dt><dd>{audit.records.unique} 条</dd></div>
        <div><dt>合并历史</dt><dd>{audit.records.inherited} 条</dd></div><div><dt>重复记录</dt><dd>{audit.records.repeated} 条</dd></div>
        {audit.records.compactSummaries > 0 && <div><dt>压缩摘要</dt><dd>{audit.records.compactSummaries} 条</dd></div>}
        <div><dt>重复分块</dt><dd>{format(audit.transport.duplicateChunkRequests)}</dd></div><div><dt>重复提交</dt><dd>{format(audit.transport.snapshotReplays)}</dd></div>
        <div><dt>完成时间</dt><dd>{dateTime(audit.completedAt)}</dd></div>
        {audit.generation && <div><dt>快照代次</dt><dd>第 {audit.generation.revision} 次</dd></div>}
      </dl>
      {audit.lineage.sourceSnapshotId && <a href={'#' + audit.lineage.sourceSnapshotId}>查看原始归属</a>}
      {audit.lineage.reason && <p className="assembly-reason">{audit.lineage.reason}</p>}
      {audit.delivery.disconnectedAttempts > 0 && <p>离线补传 · {audit.delivery.disconnectedAttempts} 次断连</p>}
      <details><summary>来源与处理详情</summary><ul className="assembly-sources">{audit.sources.map(source => <li key={source.materialId ?? 'primary'}><a href={source.webPath}>{source.name}</a><span>{format(source.chunkCount)} 块 · {source.byteLength.toLocaleString()} 字节</span></li>)}</ul>
        {audit.gaps.map((gap, index) => <p className="assembly-reason" key={index}>{gap.reference}</p>)}
        {audit.sideLinks.map((link, index) => <p className="assembly-reason" key={index}>{link.relation === 'child' ? '子会话' : '关联会话'} · {link.sessionId}</p>)}
        {audit.nextOffset !== null && <button disabled={busy} onClick={more}>更多来源与详情</button>}
        <dl><div><dt>组装规则</dt><dd>{audit.ruleVersion}</dd></div><div><dt>版本</dt><dd className="hash">{audit.version}</dd></div></dl>
      </details><button className="assembly-export" disabled={busy} onClick={async () => { setBusy(true); try { await download(request, `/api/assembly/export?snapshotId=${snapshotId}&version=${audit.version}`, `assembly-${snapshotId}.json`); } catch (failure) { setError((failure as Error).message); } finally { setBusy(false); } }}>导出组装记录</button>
    </> : !error && <p role="status">读取组装记录…</p>}
    {error && <><p role="alert">{error}</p><button onClick={() => setRetry(value => value + 1)}>重试组装记录</button></>}
  </section>;
}

export function DataProcessing({ request }: { request: Request }) {
  const [date, setDate] = useState(beijingDate(new Date())), [state, setState] = useState(''), [source, setSource] = useState('');
  const [data, setData] = useState<ProcessingPage | null>(null), [rows, setRows] = useState<AssemblySummary[]>([]), [offset, setOffset] = useState(0), [next, setNext] = useState<number | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [retry, setRetry] = useState(0), [chart, setChart] = useState(true), [pendingOnly, setPendingOnly] = useState(false);
  useEffect(() => { const abort = new AbortController(); setData(null); setError(''); request('/api/processing?date=' + date, abort.signal).then(response => response.json()).then(value => { if (!abort.signal.aborted) setData(value); })
    .catch(failure => { if (!abort.signal.aborted) setError(failure.message); }); return () => abort.abort(); }, [date, retry]);
  useEffect(() => {
    const abort = new AbortController(); setBusy(true); setError('');
    const query = new URLSearchParams({ ...(pendingOnly ? { currentOnly: 'true' } : { date }), offset: String(offset), ...(state ? { state } : {}), ...(source ? { source } : {}) });
    request('/api/assembly?' + query, abort.signal).then(response => response.json()).then(value => { if (!abort.signal.aborted) { setRows(value.rows); setNext(value.nextOffset); } })
      .catch(failure => { if (!abort.signal.aborted) setError(failure.message); }).finally(() => { if (!abort.signal.aborted) setBusy(false); }); return () => abort.abort();
  }, [date, state, source, offset, retry, pendingOnly]);
  return <article className="workspace-page processing-page"><header className="processing-heading"><h1>数据处理</h1><div className="processing-actions"><label>日期<input type="date" value={date} onChange={event => { if (event.target.value) { setDate(event.target.value); setOffset(0); setPendingOnly(false); } }}/></label><button onClick={() => setRetry(value => value + 1)}>刷新</button><button disabled={!data || busy} onClick={async () => { if (!data) return; setBusy(true); try { await download(request, `/api/processing/export?date=${data.date}&version=${data.version}`, `processing-${data.date}.json`); } catch (failure) { setError((failure as Error).message); } finally { setBusy(false); } }}>导出</button></div></header>
    {error && <p role="alert">{error}</p>}
    <div className="workspace-scroll" data-scroll-region="processing">
    {data ? <><section className="processing-block" aria-label="处理链路"><div className="processing-block-heading"><h2>处理链路</h2><span>北京时间 · {data.date}</span></div>
      <ol className="processing-stages">{data.stages.map(stage => <li key={stage.key}><span>{stage.label}</span><strong>{stage.count.toLocaleString()}</strong><small>{stage.unit}</small></li>)}</ol>
      <div className="processing-latency"><span>拾取 → 可读确认 P95</span><strong className={data.latency.p95Ms !== null && data.latency.p95Ms > data.latency.targetMs ? 'processing-late' : undefined}>{data.latency.p95Ms === null ? '未记录' : `${(data.latency.p95Ms / 1000).toFixed(2)} s`}</strong><span>目标 60 s · {data.latency.samples} 个样本 · {data.latency.unknown} 个快照未记录</span></div>
      <details className="processing-rules"><summary>处理规则 · {data.ruleVersion}</summary><p>分块与提交重试不增加活动；续聊依据原件位置与字节证据合并；子会话关联保留；无法确认的谱系独立保存。</p><p>延迟从原件拾取开始，使用同一采集进程的单调时钟计至服务器可读确认；跨进程补传耗时未记录。流水阶段按服务器收到或完成日期计数。</p><p>观测开始：{dateTime(data.observedSince)}</p></details>
    </section>{data.backlog.pendingSnapshots > 0 && <section className="processing-pending" aria-label="投递积压"><h2>投递积压</h2><p>{data.backlog.pendingSnapshots} 份 · {data.backlog.devices} 台设备 · {(data.backlog.pendingBytes / 1024).toFixed(1)} KiB</p><p>最近收到：{dateTime(data.backlog.observedAt)}</p><a href="#delivery">查看设备同步状态</a></section>}{data.pending.length > 0 && <section className="processing-pending" aria-label="待处理原因"><h2>当前待处理</h2>{data.pending.map((item, index) => <button key={index} onClick={() => { setState(item.state in states ? item.state : ''); setOffset(0); setPendingOnly(true); }}><span>{item.reason}</span><b>{item.count}</b></button>)}</section>}</> : <p role="status">读取处理链路…</p>}
    <section className="processing-block" aria-label="会话组装记录"><div className="processing-block-heading"><h2>{pendingOnly ? '当前待处理记录' : '会话组装记录'}</h2>{pendingOnly && <button onClick={() => { setPendingOnly(false); setState(''); setOffset(0); }}>返回当日记录</button>}<div className="processing-filters"><label>组装状态<select value={state} onChange={event => { setState(event.target.value); setOffset(0); }}><option value="">全部状态</option>{Object.entries(states).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Agent<select value={source} onChange={event => { setSource(event.target.value); setOffset(0); }}><option value="">全部 Agent</option>{(['claude-code-cli', 'codex-cli', 'codex-desktop'] as const).map(value => <option key={value} value={value}>{sourceLabel(value)}</option>)}</select></label></div></div>
      <div className="processing-table" tabIndex={0}><table><thead><tr><th>完成时间</th><th>会话</th><th>员工</th><th>来源</th><th>分块接收</th><th>合并历史</th><th>结果</th><th>详情</th></tr></thead><tbody>{rows.map(row => <tr key={row.snapshotId}><td>{dateTime(row.completedAt)}</td><td><a href={'#' + row.snapshotId}>{row.project.split(/[\\/]/).filter(Boolean).at(-1) || '未归类项目'}</a><span className="processing-native">{row.sourceSessionId}</span></td><td>{row.employee}</td><td>{row.sourceCount} 份<span className="processing-native">{sourceLabel(row.source)}</span></td><td className="processing-number">{format(row.transport.chunkRequests)}</td><td className="processing-number">{row.records.inherited} 条</td><td><span className="assembly-state" data-state={row.state}>{states[row.state]}</span></td><td><a href={`#${row.snapshotId}?assemblyVersion=${row.version}`}>查看组装</a></td></tr>)}</tbody></table></div>
      {!rows.length && !busy && <p className="processing-empty">此筛选下暂无记录</p>}
      <div className="processing-pagination"><button disabled={busy || offset === 0} onClick={() => setOffset(Math.max(0, offset - 20))}>上一页</button><button disabled={busy || next === null} onClick={() => setOffset(next ?? 0)}>下一页</button></div>
    </section>
    {data && <><section className="processing-block" aria-label="数据质量"><div className="processing-block-heading"><h2>Token 用量上报覆盖</h2><div className="processing-toggle"><button aria-label="Token 覆盖切换为图表" aria-pressed={chart} onClick={() => setChart(true)}>图表</button><button aria-label="Token 覆盖切换为表格" aria-pressed={!chart} onClick={() => setChart(false)}>表格</button></div></div>
      {chart ? <div className="processing-coverage">{data.tokenCoverage.map(row => <div key={row.source}><span>{sourceLabel(row.source)}</span><meter tabIndex={0} min={0} max={Math.max(1, row.sessions)} value={row.knownSessions} aria-label={`${sourceLabel(row.source)} 已上报 ${row.knownSessions} / ${row.sessions} 个会话`}/><span>{row.knownSessions} / {row.sessions}</span><span className="processing-unknown">{row.unknownSessions} 未知</span></div>)}</div> : <div className="processing-table" tabIndex={0}><table aria-label="Token 用量上报覆盖"><thead><tr><th>Agent</th><th>会话</th><th>已上报</th><th>未知</th></tr></thead><tbody>{data.tokenCoverage.map(row => <tr key={row.source}><th>{sourceLabel(row.source)}</th><td>{row.sessions}</td><td>{row.knownSessions}</td><td>{row.unknownSessions}</td></tr>)}</tbody></table></div>}
      {!data.tokenCoverage.length && <p className="processing-empty">当日暂无会话用量</p>}</section>
      <section className="processing-block" aria-label="指标口径"><h2>指标口径</h2><div className="processing-table" tabIndex={0}><table><thead><tr><th>指标</th><th>定义</th><th>来源</th></tr></thead><tbody>{data.catalog.definitions.map(item => <tr key={item.key}><th>{item.label}</th><td>{item.definition}</td><td>{item.origin}</td></tr>)}</tbody></table></div></section></>}
    </div></article>;
}
