import { useEffect, useState } from 'react';
import type { AnalysisOperations as Operations } from '../../packages/contracts/analysis.js';
import { analysisStates } from './SessionAnalysis.js';

export function AnalysisOperations({ request }: {request: (path: string, signal?: AbortSignal) => Promise<Response>}) {
  const [data, setData] = useState<Operations>(); const [offset, setOffset] = useState(0); const [error, setError] = useState('');
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
  return <section aria-label="分析队列与资源"><h1>分析队列与资源</h1>
    <p>{data?.availability.reason ?? '读取状态…'}</p>{error && <p role="alert">{error}</p>}
    <p>{data?.definition}</p><p>提供商实付：未知；失败期间原件可继续同步、查询和导出。</p>
    <ul>{data?.counts.map(row => <li key={row.state}>{analysisStates[row.state]}：{row.count}</li>)}</ul>
    <h2>运行时配置</h2><ul>{data?.workers.map(worker => <li key={worker.id}>{worker.online ? '在线' : '离线'} · {worker.config.mode === 'fixture' ? '合成演示，非正式验收' : '千问按量'} · {worker.config.model}
      <p>配置 {worker.config.configurationHash}；并发上限 {worker.config.concurrency}，尝试上限 {worker.config.maxAttempts}，每次 {worker.config.timeoutSeconds} 秒、请求 {worker.config.maxRequests} 次、输入 {worker.config.maxInputBytes} 字节；预算 ¥{worker.config.budgetCny}。</p></li>)}</ul>
    <h2>保留的预算预留</h2><ul>{data?.budgets.map(budget => <li key={budget.id}>{budget.id}：¥{budget.reservedCny}（未知用量不退款）</li>)}</ul>
    <h2>任务</h2><ul>{data?.runs.map(run => <li key={run.id}><a href={`#${run.snapshotId}`}>{analysisStates[run.state]} · 版本 {run.generation}</a> · 尝试 {run.attempts}/{run.maxAttempts} · {run.applicable ? '当前适用' : '待适用 / 历史'}
      <p>{run.error ?? run.targetError}</p>{run.attemptHistory.map(attempt => <p key={attempt.number}>尝试 {attempt.number}：{attempt.state}；请求 {attempt.requests ?? '未知'}；预留 ¥{attempt.reservedCny}；实付未知。</p>)}</li>)}</ul>
    <h2>最新输入目标</h2><ul>{data?.targets.map(target => <li key={target.id}><a href={`#${target.desiredSnapshotId}`}>最新快照 · 版本 {target.generation}</a> · {target.applicableJobId ? '有适用结果' : '待准备 / 待分析'}<p>{target.error}</p></li>)}</ul>
    <button disabled={offset === 0} onClick={() => setOffset(value => Math.max(0, value - 10))}>上一页任务</button>
    <button disabled={data?.nextOffset == null} onClick={() => setOffset(data!.nextOffset!)}>下一页任务</button>
  </section>;
}
