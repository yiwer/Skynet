import { useEffect, useState } from 'react';
import type { AnalysisOperations as Operations } from '../../packages/contracts/analysis.js';
import { analysisStates } from './SessionAnalysis.js';
import './operations.css';

export function AnalysisOperations({ request }: { request: (path: string, signal?: AbortSignal) => Promise<Response> }) {
  const [data, setData] = useState<Operations>(); const [offset, setOffset] = useState(0); const [error, setError] = useState('');
  useEffect(() => {
    const abort = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    async function read() {
      try {
        const value = await (await request(`/api/analysis/operations?offset=${offset}`, abort.signal)).json();
        if (!abort.signal.aborted) { setData(value); setError(''); }
      } catch (failure) { if (!abort.signal.aborted) setError((failure as Error).message); }
      if (!abort.signal.aborted) timer = setTimeout(read, 2000);
    }
    void read(); return () => { abort.abort(); clearTimeout(timer); };
  }, [offset]);
  const activeCounts = data?.counts.filter(row => row.count > 0) ?? [];
  const hasConfiguration = data && (data.availability.ready || data.runs.length > 0) && (data.workers.length > 0 || data.budgets.length > 0 || data.targets.length > 0);
  return <section className="analysis-operations workspace-page" aria-label="分析队列与资源">
    <div className="operations-page-head"><div><h1>分析与运行</h1></div><a href="#server">运行与备份</a></div>
    <div className="workspace-scroll">
      {!data && !error && <p role="status">正在读取…</p>}
      {error && <p role="alert">{error}{data ? ' · 显示上次记录' : ''}</p>}
      {data && <>
        {activeCounts.length > 0 && <div className="operations-status-strip">{activeCounts.map(row => <span key={row.state} className={`operations-state state-${row.state}`}>{analysisStates[row.state]} <strong>{row.count}</strong></span>)}{data.availability.model && <span className="operations-model">{data.availability.model}</span>}</div>}
        {data.runs.length > 0 ? <section className="operations-jobs" aria-label="分析作业"><div className="operations-table-scroll"><table><thead><tr><th>作业</th><th>会话</th><th>状态</th><th>尝试</th><th>记录</th><th>请求 / 预留</th></tr></thead>
          <tbody>{data.runs.map(run => <tr key={run.id}><td><span className="hash" title={run.id}>{run.id.slice(0, 8)}</span></td><td><a href={`#${run.snapshotId}`}>版本 {run.generation}</a></td>
            <td><span className={`operations-state state-${run.state}`}>{analysisStates[run.state]}</span></td><td>尝试 {run.attempts}/{run.maxAttempts}</td>
            <td>{run.applicable ? '当前结果' : '历史记录'}{(run.error ?? run.targetError) && <p className="operations-run-error">{run.error ?? run.targetError}</p>}
              {run.attemptHistory.length > 0 && <details><summary>尝试记录</summary>{run.attemptHistory.map(attempt => <div className="operations-attempt" key={attempt.number}><p>第 {attempt.number} 次 · {attempt.state}{attempt.requests !== null ? ` · ${attempt.requests} 次请求` : ''} · 预留 ¥{attempt.reservedCny}</p>{attempt.error && <p className="operations-run-error">{attempt.error}</p>}</div>)}</details>}</td>
            <td>{run.attemptHistory.length > 0 ? <>{run.attemptHistory.some(attempt => attempt.requests !== null) && <span>{run.attemptHistory.reduce((sum, attempt) => sum + (attempt.requests ?? 0), 0)} 次已知请求</span>}<span className="operations-cell-detail">预留 ¥{run.attemptHistory.reduce((sum, attempt) => sum + attempt.reservedCny, 0).toFixed(2)}</span></> : '—'}</td>
          </tr>)}</tbody></table></div>
          {(offset > 0 || data.nextOffset !== null) && <div className="pagination"><button disabled={offset === 0} onClick={() => setOffset(value => Math.max(0, value - 10))}>上一页任务</button><button disabled={data.nextOffset === null} onClick={() => setOffset(data.nextOffset!)}>下一页任务</button></div>}
        </section> : <p className="operations-empty">{data.availability.ready ? '暂无分析作业' : '分析未启用'}</p>}
        {hasConfiguration && <details className="operations-runtime"><summary>运行配置</summary>
          {data.workers.length > 0 && <><h2>运行实例</h2><ul>{data.workers.map(worker => <li key={worker.id}><strong>{worker.config.model}</strong> · {worker.online ? '在线' : '离线'}<span className="operations-cell-detail">{worker.config.mode} · 并发 {worker.config.concurrency} · 最多 {worker.config.maxAttempts} 次尝试 · 超时 {worker.config.timeoutSeconds} 秒</span><span className="operations-cell-detail">预算 {worker.config.budgetId} · ¥{worker.config.budgetCny}</span></li>)}</ul></>}
          {data.budgets.length > 0 && <><h2>预算预留</h2><ul>{data.budgets.map(budget => <li key={budget.id}>{budget.id}<strong>¥{budget.reservedCny}</strong></li>)}</ul></>}
          {data.targets.length > 0 && <><h2>分析目标</h2><ul>{data.targets.map(target => <li key={target.id}><a href={`#${target.desiredSnapshotId}`}>版本 {target.generation}</a><span>{target.applicableJobId ? '已有结果' : '待分析'}</span>{target.error && <p className="operations-run-error">{target.error}</p>}</li>)}</ul></>}
        </details>}
      </>}
    </div>
  </section>;
}
