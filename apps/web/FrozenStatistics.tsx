import {useEffect,useState} from 'react';
import type {FrozenStatisticReference} from '../../packages/contracts/reports.js';
import type {WorkStatistics} from '../../packages/contracts/coverage.js';

/** Report readers follow only the persisted reference. They never ask for the
 * latest statistic to fill an older report, including during reference paging. */
export function FrozenStatistics({reference,request,onEvidence}:{reference:FrozenStatisticReference;
  request:(path:string,signal?:AbortSignal)=>Promise<Response>;onEvidence:()=>void}){
  const [open,setOpen]=useState(false),[offset,setOffset]=useState(0),[retry,setRetry]=useState(0);
  const [data,setData]=useState<WorkStatistics>(),[error,setError]=useState(''),[loading,setLoading]=useState(false);
  const identity=JSON.stringify(reference);
  useEffect(()=>{setOffset(0);setData(undefined);setError('');},[identity]);
  useEffect(()=>{
    setData(undefined);setError('');setLoading(open);if(!open)return;
    const abort=new AbortController();
    request(`/api/work-statistics/${reference.employeeId}?${new URLSearchParams({date:reference.date,revision:String(reference.revision),offset:String(offset)})}`,abort.signal)
      .then(response=>response.json()).then((value:WorkStatistics)=>{if(abort.signal.aborted)return;
        if(value.version!==reference.version||value.revision!==reference.revision||value.employeeId!==reference.employeeId||value.date!==reference.date)throw new Error('固定统计版本不匹配，请重新读取本版；不会替换为最新统计');setData(value);
      }).catch(failure=>{if(!abort.signal.aborted)setError(failure.message);}).finally(()=>{if(!abort.signal.aborted)setLoading(false);});
    return()=>abort.abort();
  },[identity,offset,open,retry,request]);
  return <details onToggle={event=>setOpen(event.currentTarget.open)}><summary>核查固定统计 v{reference.revision} · {reference.date}</summary>
    {loading&&<p role="status">正在读取本版统计原句…</p>}{error&&<p role="alert">{error} <button onClick={()=>setRetry(value=>value+1)}>重试本版统计</button></p>}
    {data&&<><p className="muted small">{data.definition}</p><p className="muted small">{data.tokens.definition}</p>
      <ul>{data.intervals.map((interval,index)=><li key={index}>{interval.from} — {interval.to} · {interval.points} 个来源活动点</li>)}</ul>
      {!data.references.length&&<p>本页没有支持的结构化文件或 Token 引用；不表示没有。</p>}
      <ul>{data.references.map((reference,index)=><li key={index}><a href={reference.webPath} onClick={onEvidence}>{reference.kind==='file'?reference.value:`Token 记录，第 ${reference.line} 行`}</a></li>)}</ul>
      <div className="pagination"><button disabled={!offset} onClick={()=>setOffset(value=>Math.max(0,value-20))}>上一页固定引用</button><button disabled={data.nextOffset===null} onClick={()=>setOffset(data.nextOffset!)}>下一页固定引用</button></div>
      <p className="muted small">统计版本 {data.version}；区间不是人工工时。</p></>}
  </details>;
}
