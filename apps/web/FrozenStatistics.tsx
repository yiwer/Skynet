import {useEffect,useState} from 'react';
import type {FrozenStatisticReference} from '../../packages/contracts/reports.js';
import type {WorkStatistics} from '../../packages/contracts/coverage.js';
import {useFixedRevisionReader} from './useFixedRevisionReader.js';

/** Report readers follow only the persisted reference. They never ask for the
 * latest statistic to fill an older report, including during reference paging. */
export function FrozenStatistics({reference,request,onEvidence}:{reference:FrozenStatisticReference;
  request:(path:string,signal?:AbortSignal)=>Promise<Response>;onEvidence:()=>void}){
  const [open,setOpen]=useState(false),[offset,setOffset]=useState(0);
  const identity=JSON.stringify(reference);
  useEffect(()=>{setOffset(0);},[identity]);
  const reader=useFixedRevisionReader<WorkStatistics>({identity:`${identity}/${offset}`,enabled:open,load:async signal=>{
    const value:WorkStatistics=await (await request(`/api/work-statistics/${reference.employeeId}?${new URLSearchParams({date:reference.date,revision:String(reference.revision),offset:String(offset)})}`,signal)).json();
    if(value.version!==reference.version||value.revision!==reference.revision||value.employeeId!==reference.employeeId||value.date!==reference.date)throw new Error('固定统计版本不匹配，请重新读取本版；不会替换为最新统计');return value;
  }});
  const data=reader.data,error=reader.error,loading=reader.loading;
  return <details className="report-frozen-statistics" onToggle={event=>setOpen(event.currentTarget.open)}><summary>统计证据 · {reference.date} · v{reference.revision}</summary>
    {loading && <p role="status">加载中…</p>}{error && <p role="alert">{error} <button onClick={reader.retry}>重试本版统计</button></p>}
    {data && <>{data.records > 0 && <dl>{([['输入 Token',data.tokens.input],['缓存读取',data.tokens.cachedInput],['缓存写入',data.tokens.cacheWriteInput],['输出 Token',data.tokens.output],['推理输出',data.tokens.reasoningOutput]] as const).filter(([,value])=>value!=null).map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value!.toLocaleString('zh-CN')}</dd></div>)}</dl>}
      {!!data.intervals.length && <ul>{data.intervals.map((interval,index)=><li key={index}>{interval.from} — {interval.to} · {interval.points} 个活动点</li>)}</ul>}
      {!!data.references.length && <ul>{data.references.map((reference,index)=><li key={index}><a href={reference.webPath} onClick={onEvidence}>{reference.kind==='file'?reference.value:`Token · 第 ${reference.line} 行`}</a></li>)}</ul>}
      {!data.references.length && !data.intervals.length && <p>暂无引用</p>}
      {(offset>0||data.nextOffset!==null) && <div className="pagination"><button disabled={!offset} onClick={()=>setOffset(value=>Math.max(0,value-20))}>上一页固定引用</button><button disabled={data.nextOffset===null} onClick={()=>setOffset(data.nextOffset!)}>下一页固定引用</button></div>}
    </>}
  </details>;
}
