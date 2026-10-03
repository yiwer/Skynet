import { useEffect, useState } from 'react';
import type { AnalysisOperations as Operations } from '../../packages/contracts/analysis.js';
import { analysisStates } from './SessionAnalysis.js';
import type { ServerOperations } from '../../packages/contracts/server-operations.js';
import { PlatformIcon } from './PlatformShell.js';
import './operations.css';

export function AnalysisOperations({ request }: {request: (path: string, signal?: AbortSignal) => Promise<Response>}) {
  const [data, setData] = useState<Operations>(); const [offset, setOffset] = useState(0); const [error, setError] = useState('');
  const [server, setServer] = useState<ServerOperations>(); const [serverError, setServerError] = useState('');
  useEffect(() => {
    const abort = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    async function read() {
      try { const value = await (await request('/api/server/operations', abort.signal)).json(); if (!abort.signal.aborted) { setServer(value); setServerError(''); } }
      catch (failure) { if (!abort.signal.aborted) setServerError((failure as Error).message); }
      if (!abort.signal.aborted) timer = setTimeout(read, 5000);
    }
    void read(); return () => { abort.abort(); clearTimeout(timer); };
  }, []);
  useEffect(() => {
    const abort = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    async function read() {
      try { const value = await (await request(`/api/analysis/operations?offset=${offset}`, abort.signal)).json();
        if (!abort.signal.aborted) { setData(value); setError(''); } }
      catch (failure) { if (!abort.signal.aborted) setError((failure as Error).message); }
      if (!abort.signal.aborted) timer = setTimeout(read, 2000);
    }
    void read(); return () => { abort.abort(); clearTimeout(timer); };
  }, [offset]);
  const count = (state: string) => data ? data.counts.find(row=>row.state===state)?.count ?? 0 : '—';
  const bytes = (value: number | null | undefined) => value == null ? '未知' : value >= 1073741824 ? `${(value/1073741824).toFixed(1)} GB` : value >= 1048576 ? `${(value/1048576).toFixed(1)} MB` : `${value.toLocaleString('zh-CN')} B`;
  const at = (value: string) => new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false});
  return <section className="analysis-operations" aria-label="分析队列与资源"><div className="operations-page-head"><div><h1>分析与运行</h1><p>分析与原件接收解耦：模型故障、超时或预算耗尽时，会话照常接收、查看与导出。</p></div><a href="#server">运行与备份详情</a></div>
    {!data&&!error&&<p role="status">读取状态…</p>}
    {error&&<p role="alert">{error}{data?'；以下保留上次成功读取的状态，当前状态尚未核实。':'；状态尚未读到，稍后自动重试。'}</p>}
    <div className="operations-tiles">
      <section><h2><PlatformIcon name="layers"/>分析队列</h2><p className="operations-tile-value">{count('queued')} 排队 · {count('running')} 运行 · {count('retry-wait')} 等待重试</p><p>{data?.availability.reason??'正在读取运行状态…'}</p><details><summary>全部任务状态</summary><ul>{data?.counts.map(row=><li key={row.state}>{analysisStates[row.state]}：{row.count}</li>)}</ul></details></section>
      <section><h2><PlatformIcon name="pulse"/>模型用量与预算</h2><p className="operations-tile-value">提供商实付：未知</p><p>用量与实际付款分别核对；未知用量不按 0 处理。</p><ul>{data?.budgets.map(budget=><li key={budget.id}>保留预留 ¥{budget.reservedCny} · {budget.id}</li>)}</ul>{data?.budgets.length===0&&<p>尚无预算预留。</p>}</section>
      <section><h2><PlatformIcon name="folder"/>原件存储</h2><p className="operations-tile-value">{bytes(server?.storage.committedBytes)} / {bytes(server?.storage.filesystemBytes)}</p>{server?.storage.filesystemBytes!=null&&server.storage.freeBytes!=null&&server.storage.filesystemBytes>0&&<meter min={0} max={server.storage.filesystemBytes} value={server.storage.filesystemBytes-server.storage.freeBytes} aria-label="原件所在文件系统已用容量"/>}<p>可用 {bytes(server?.storage.freeBytes)} · {server?.storage.committedObjects??'未知'} 个已提交对象 · 原件不自动删除</p>{(serverError||server?.storage.capacityError)&&<p role="alert">{serverError||server?.storage.capacityError}</p>}</section>
      <section><h2><PlatformIcon name="restore"/>备份与恢复演练</h2><p>{!server?(serverError?'备份状态未知。':'正在读取备份状态…'):server.latestBackup?`上次成功备份 ${at(server.latestBackup.completedAt)} · ${server.latestBackup.failureDomain==='same-host'?'同机副本':'故障域见详情'}`:'尚无成功备份记录。'}</p><p>{!server?(serverError?'恢复演练状态未知。':'正在读取恢复演练状态…'):server.latestRestore?`恢复完整性校验 ${at(server.latestRestore.verifiedAt)}`:'尚无恢复完整性校验记录。'}</p><p>上传确认仅表示单副本接收；完整性校验不等于原生续聊通过。</p>{serverError&&server&&<p role="alert">当前状态未核实，以上为上次成功读取的记录。</p>}</section>
    </div>
    <section className="operations-jobs"><h2>分析作业</h2><div className="operations-table-scroll"><table><thead><tr><th>作业</th><th>范围</th><th>状态</th><th>尝试</th><th>说明</th><th>用量</th></tr></thead><tbody>{data?.runs.map(run=><tr key={run.id}><td><span className="hash">{run.id}</span></td><td><a href={`#${run.snapshotId}`}>会话 · 版本 {run.generation}</a></td><td><span className={`operations-state state-${run.state}`}>{analysisStates[run.state]}</span></td><td>{run.attempts}/{run.maxAttempts}</td><td>{run.applicable?'当前适用':'待适用 / 历史'}{(run.error??run.targetError)&&<p>{run.error??run.targetError}</p>}<details><summary>尝试记录</summary>{run.attemptHistory.map(attempt=><p key={attempt.number}>尝试 {attempt.number}：{attempt.state}；请求 {attempt.requests??'未知'}；预留 ¥{attempt.reservedCny}；实付未知。</p>)}</details></td><td>实付未知</td></tr>)}</tbody></table></div>{data?.runs.length===0&&<p className="operations-empty">当前没有分析作业。原件接收与读取继续可用。</p>}
      <div className="pagination"><button disabled={offset===0} onClick={()=>setOffset(value=>Math.max(0,value-10))}>上一页任务</button><button disabled={data?.nextOffset==null} onClick={()=>setOffset(data!.nextOffset!)}>下一页任务</button></div><p className="muted small">{data?.definition}</p></section>
    <details className="operations-runtime"><summary>运行时配置与预算明细</summary><h2>运行时配置</h2><ul>{data?.workers.map(worker => <li key={worker.id}>{worker.online ? '在线' : '离线'} · {worker.config.mode === 'fixture' ? '合成演示，非正式验收' : '千问按量'} · {worker.config.model}
      <p>配置 {worker.config.configurationHash}；并发上限 {worker.config.concurrency}，尝试上限 {worker.config.maxAttempts}，每次 {worker.config.timeoutSeconds} 秒、请求 {worker.config.maxRequests} 次、输入 {worker.config.maxInputBytes} 字节；预算 {worker.config.budgetId} ¥{worker.config.budgetCny}。</p></li>)}</ul>
    <h2>保留的预算预留</h2><ul>{data?.budgets.map(budget => <li key={budget.id}>{budget.id}：¥{budget.reservedCny}（未知用量不退款）</li>)}</ul>
    <h2>最新输入目标</h2><ul>{data?.targets.map(target => <li key={target.id}><a href={`#${target.desiredSnapshotId}`}>最新快照 · 版本 {target.generation}</a> · {target.applicableJobId ? '有适用结果' : '待准备 / 待分析'}<p>{target.error}</p></li>)}</ul>
    </details>
  </section>;
}
