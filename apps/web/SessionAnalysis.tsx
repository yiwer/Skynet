import { useEffect, useState } from 'react';
import { analysisLabels, assessmentLabels, type AnalysisPage, type AnalysisRun } from '../../packages/contracts/analysis.js';
import { evidenceLink } from '../../packages/contracts/search.js';

export const analysisStates = { queued: '等待分析', running: '正在分析', 'retry-wait': '等待有限重试', superseded: '版本已过期', succeeded: '分析已完成', failed: '分析失败' };
export function SessionAnalysis({ snapshotId, request,onChange }: { snapshotId: string; request: (path: string, signal?: AbortSignal, method?: 'POST') => Promise<Response>;onChange?:()=>void }) {
  const [page, setPage] = useState<AnalysisPage | null>(null); const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0); const [busy, setBusy] = useState(false); const [offset, setOffset] = useState(0);
  useEffect(() => {
    const abort = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    async function read() {
      try {
        const value: AnalysisPage = await (await request(`/api/snapshots/${snapshotId}/analysis?offset=${offset}`, abort.signal)).json();
        if (abort.signal.aborted) return;
        setPage(previous => ({ ...value, runs: offset ? [...(previous?.runs ?? []).filter(run => !value.runs.some(next => next.id === run.id)), ...value.runs] : value.runs }));
        setError('');
        onChange?.();
        if (value.runs.some(run => ['queued', 'running', 'retry-wait'].includes(run.state))) timer = setTimeout(read, 1500);
      } catch (failure) { if (!abort.signal.aborted) setError((failure as Error).message); }
    }
    void read(); return () => { abort.abort(); clearTimeout(timer); };
  }, [snapshotId, offset, refresh]);
  async function start() {
    setBusy(true); setError('');
    try { await request(`/api/snapshots/${snapshotId}/analysis`, undefined, 'POST'); setOffset(0); setRefresh(value => value + 1); }
    catch (failure) { setError((failure as Error).message); } finally { setBusy(false); }
  }
  if(!error&&(!page||!page.availability.ready&&page.runs.length===0))return null;
  return <section className="recovery" aria-label="会话分析"><h3>会话分析</h3>
    <div className="export-actions">{page?.availability.ready&&<button disabled={busy} onClick={start}>{busy?'正在提交…':'分析会话'}</button>}<button onClick={()=>setRefresh(value=>value+1)}>刷新</button></div>
    {error&&<p role="alert" className="error">{error}</p>}
    {page?.runs.map(run=><AnalysisResult key={run.id} run={run} retry={async()=>{try{await request(`/api/analysis/${run.id}/retry`,undefined,'POST');setRefresh(value=>value+1);}catch(failure){setError((failure as Error).message);}}}/>)}
    {page?.nextOffset!=null&&<button onClick={()=>setOffset(page.nextOffset!)}>更多分析</button>}
  </section>;
}
function AnalysisResult({ run, retry }: { run: AnalysisRun; retry: () => Promise<void> }) {
  return <div className="analysis-result"><h4>{run.state==='succeeded'&&run.result?.processing?.complete===false?'分析部分完成':analysisStates[run.state]}</h4>
    <p className="small muted">版本 {run.generation} · {run.applicable?'当前版本':'历史版本'}</p>
    {['failed','retry-wait'].includes(run.state)&&run.attempts<run.maxAttempts&&<button onClick={retry}>重试</button>}
    {run.error&&<p className="error">{run.error}</p>}
    {run.result?.items.map((item,index)=><div key={index}><h4>{analysisLabels[item.category]} · {assessmentLabels[item.assessment]}</h4><p>{item.text}</p>
      <details><summary>原文 · {item.citations.length}</summary>{item.citations.map((citation,part)=><p key={part}><a href={citation.webPath}>第 {citation.location.kind==='material'?'关联材料':citation.location.line} 行</a> <q>{citation.quote}</q></p>)}
      {item.citations.filter(c=>c.location.kind!=='event').map((citation,part)=><a key={part} href={evidenceLink(citation.inputSnapshotId,citation.inputLocation)}>查看输入原句</a>)}</details>
    </div>)}
    <details><summary>处理记录</summary><p>{run.config.model} · {run.input.eventCount} 条记录 · {run.attempts}/{run.maxAttempts} 次</p>
      {run.result?.processing?.ranges.map((range,index)=><p key={index}>{range.start.event} — {range.end.event} · {range.state==='extracted'?'已完成':range.state==='failed'?'失败':'待处理'}</p>)}
    </details>
  </div>;
}
