import { useEffect, useState,useRef } from 'react';
import type { WaitsQuery, WaitsReadingPage, ReplyWait,WaitEmployee } from '../../packages/contracts/waits.js';
import { sourceLabel } from '../../packages/contracts/archive.js';
import './usage-metrics.css';
import './waits.css';
import {WaitStatistics} from './WaitStatistics.js';
import type {WaitReport} from '../../packages/contracts/wait-report.js';

type Request = (path: string, signal?: AbortSignal, method?: 'POST', body?: unknown) => Promise<Response>;
const params = (value: object) => new URLSearchParams(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, String(item)]));
export const waitDuration = (ms: number | null) => ms === null ? '未知' : `${Math.floor(ms / 60000)} 分 ${Number((ms % 60000 / 1000).toFixed(3))} 秒`;
const timestamp = (value: string | null) => value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '未知';
export function WaitMark({ wait }: { wait: ReplyWait }) {
  return <details className="conversation-wait" data-long={wait.long || undefined} aria-label="等待回复标记"><summary>
    <span>等待回复 · {waitDuration(wait.durationMs)}</span>{wait.long && <span className="wait-long">长等待</span>}
    {wait.parallel === 'observed' && <span>期间在其他会话中活动</span>}
    </summary><div className="wait-evidence">
      <span>{timestamp(wait.startedAt)} → {timestamp(wait.endedAt)}</span>{wait.reason && <span>{wait.reason}</span>}
      {wait.start && <a href={wait.start.webPath}>轮次结束原件</a>}<a href={wait.end.webPath}>用户消息原件</a>
      {wait.parallelEvidence.map((item, index) => <a key={`${item.snapshotId}:${item.line}:${item.block}`} href={item.conversationPath ?? item.webPath}>并行活动 {index + 1}</a>)}
    </div></details>;
}
function hashWaits():WaitsQuery{const p=new URLSearchParams(location.hash.split('?')[1]);return {period:(p.get('period')??'this-week') as WaitsQuery['period'],offset:0,...Object.fromEntries(['employeeId','source','project','week','version'].flatMap(key=>p.has(key)?[[key,p.get(key)!]]:[]))};}
const queryKey=(q:WaitsQuery)=>JSON.stringify([q.period,q.employeeId,q.source,q.project,q.week,q.version,q.offset]);
export function WaitingReport({ request }: { request: Request }) {
  const [query, setQuery] = useState<WaitsQuery>(hashWaits);
  const [page, setPage] = useState<WaitsReadingPage>(); const [facets, setFacets] = useState<WaitEmployee[]>([]);
  const [offsets,setOffsets]=useState([0]),[facetError,setFacetError]=useState('');
  const [details,setDetails]=useState<{version:string;daily:WaitsReadingPage['daily'];unavailableSources:NonNullable<WaitsReadingPage['unavailableSources']>;dailyNext:number|null;sourceNext:number|null}>();
  const [detailBusy,setDetailBusy]=useState(false);
  const detailAbort=useRef<AbortController|undefined>(undefined);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const [project, setProject] = useState(()=>hashWaits().project??'');
  const [statistics,setStatistics]=useState<WaitReport>(),[statisticsError,setStatisticsError]=useState('');
  useEffect(() => {
    detailAbort.current?.abort();detailAbort.current=new AbortController();setDetailBusy(false);
    return()=>detailAbort.current?.abort();
  },[page?.version]);
  useEffect(() => {
    const abort = new AbortController(); setBusy(true); setError(''); setPage(previous=>previous?.version===query.version?previous:undefined);
    request('/api/waits?' + params(query), abort.signal).then(response => response.json()).then((data: WaitsReadingPage) => {
      if (!abort.signal.aborted) setPage(data);
    }).catch(failure => { if (!abort.signal.aborted) setError(failure.message); }).finally(() => { if (!abort.signal.aborted) setBusy(false); });
    return () => abort.abort();
  }, [query, retry]);
  useEffect(() => {
    setFacets([]);setFacetError('');setDetails(undefined);
    if (!page) return; const abort = new AbortController();const version=page.version;
    setDetails({version,daily:page.daily,unavailableSources:page.unavailableSources??[],dailyNext:page.pages.daily.nextOffset,sourceNext:page.pages.unavailableSources.nextOffset});
    void(async()=>{
      let offset=0;const employees:WaitEmployee[]=[];
      do{
        const value:WaitsReadingPage=await(await request('/api/waits?'+params({...query,version,section:'employees',offset}),abort.signal)).json();
        if(abort.signal.aborted)return;
        const cursor=value.pages.employees;
        if(value.version!==version||cursor.offset!==offset||cursor.total!==page.pages.employees.total)throw new Error('员工选项版本不一致');
        employees.push(...value.employees);
        if(cursor.nextOffset===null)break;
        if(cursor.nextOffset<=offset)throw new Error('员工选项分页未推进');offset=cursor.nextOffset;
      }while(true);
      if(employees.length!==page.pages.employees.total)throw new Error('员工选项尚未读全');
      if(!abort.signal.aborted)setFacets(employees);
    })().catch(failure=>{if(!abort.signal.aborted)setFacetError(failure.message);});
    return () => abort.abort();
  }, [page?.version]);
  useEffect(()=>{
    setStatistics(undefined);setStatisticsError('');if(!page)return;const abort=new AbortController();
    request('/api/wait-report?'+params({period:query.period,week:query.week,employeeId:query.employeeId,source:query.source,project:query.project,waitVersion:page.version}),abort.signal)
      .then(response=>response.json()).then((value:WaitReport)=>{if(!abort.signal.aborted)setStatistics(value);})
      .catch(failure=>{if(!abort.signal.aborted)setStatisticsError(failure.message);});return()=>abort.abort();
  },[page?.version]);
  useEffect(()=>{const change=()=>{if(location.hash.split('?')[0]==='#waits'){const next=hashWaits();setQuery(previous=>queryKey(previous)===queryKey(next)?previous:next);setOffsets([0]);setProject(next.project??'');}};window.addEventListener('hashchange',change);return()=>window.removeEventListener('hashchange',change);},[]);
  const scope = (next: Partial<WaitsQuery>) => {setOffsets([0]);setQuery({ ...query, ...next, offset: 0, version: undefined,week:undefined });};
  const employees = [...facets].sort((a, b) => a.employee.localeCompare(b.employee, 'zh-CN'));
  const detail=page&&details?.version===page.version?details:undefined;
  async function more(section:'daily'|'unavailableSources'){
    if(!page||!detail||detailBusy)return;const offset=section==='daily'?detail.dailyNext:detail.sourceNext;if(offset===null)return;
    const version=page.version,signal=detailAbort.current?.signal;setDetailBusy(true);
    try{
      const value:WaitsReadingPage=await(await request('/api/waits?'+params({...query,version,section,offset}),signal)).json();
      if(signal?.aborted)return;
      const cursor=value.pages[section];
      if(value.version!==version||cursor.offset!==offset||cursor.total!==page.pages[section].total||cursor.nextOffset!==null&&cursor.nextOffset<=offset)throw new Error('等待明细分页不一致');
      setDetails(previous=>previous?.version!==version?previous:{...previous,[section]:[...previous[section],...value[section]!],...(section==='daily'?{dailyNext:cursor.nextOffset}:{sourceNext:cursor.nextOffset})});
    }catch(failure){if(!signal?.aborted)setError((failure as Error).message);}finally{if(!signal?.aborted)setDetailBusy(false);}
  }
  async function recompute() {
    setBusy(true); setError('');
    try { const next: WaitsReadingPage = await (await request('/api/waits/recompute', undefined, 'POST', { ...query, offset: 0, version: undefined })).json();setOffsets([0]); setQuery({ ...query, offset: 0, version: next.version }); }
    catch (failure) { setError((failure as Error).message); } finally { setBusy(false); }
  }
  async function download() {
    if (!page) return;
    try { const response = await request('/api/waits/export?' + params({ ...query, version: page.version, offset: 0 }));
      const url = URL.createObjectURL(await response.blob()), link = document.createElement('a'); link.href = url; link.download = `skynet-waits-${page.version}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) { setError((failure as Error).message); }
  }
  async function downloadStatistics() {
    if (!statistics) return;
    try {
      const response = await request('/api/wait-report/export?' + params({period:query.period,week:query.week,employeeId:query.employeeId,source:query.source,project:query.project,version:statistics.version}));
      const url=URL.createObjectURL(await response.blob()),link=document.createElement('a');link.href=url;link.download=`skynet-wait-report-${statistics.version}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    } catch (failure) {setError((failure as Error).message);}
  }
  return <section className="waiting-report usage-metrics workspace-page" aria-label="响应与等待" aria-busy={busy}>
    <div className="usage-page-head"><h1>响应与等待</h1>{page && <div className="usage-export-actions">{!query.week&&<button disabled={busy} onClick={recompute}>从原件重算</button>}<button disabled={busy} onClick={download}>导出当前版本</button>{statistics&&<button disabled={busy} onClick={downloadStatistics}>导出统计</button>}</div>}</div>
    <form className="usage-filters" onSubmit={event => { event.preventDefault(); scope({ project: project || undefined }); }}><div className="usage-filter-row">
      <div className="usage-periods" role="group" aria-label="时间范围">{([['this-week', '本周'], ['last-week', '上周'], ['since-enrollment', '接入至今']] as const).map(([period, label]) => <button type="button" key={period} aria-pressed={!query.week&&query.period === period} onClick={() => scope({ period })}>{label}</button>)}</div>
      <label>员工<select value={query.employeeId ?? ''} onChange={event => scope({ employeeId: event.target.value || undefined })}><option value="">全部员工</option>{query.employeeId&&!employees.some(row=>row.employeeId===query.employeeId)&&<option value={query.employeeId}>{page?.scope.employeeName??'所选员工'}</option>}{employees.map(row => <option key={row.employeeId} value={row.employeeId}>{row.employee}</option>)}</select></label>
      <label>Agent<select value={query.source ?? ''} onChange={event => scope({ source: event.target.value as WaitsQuery['source'] || undefined })}><option value="">全部 Agent</option><option value="codex-cli">Codex CLI</option><option value="codex-desktop">Codex Desktop</option><option value="claude-code-cli">Claude Code CLI</option></select></label>
      <label>项目<input aria-label="项目路径" value={project} maxLength={1024} placeholder="全部项目" onChange={event => setProject(event.target.value)}/></label><button>应用</button>
    </div>{page && <p className="wait-scope">{page.scope.from} — {page.scope.to} · 北京时间 · 版本 {page.revision}{page.dataAsOf&&` · 截至 ${timestamp(page.dataAsOf)}`}</p>}</form>
    <div className="workspace-scroll">
      {busy && <p role="status">正在读取等待记录…</p>}{error && <div role="alert"><p>{error}</p><button onClick={() => setRetry(value => value + 1)}>重试</button></div>}
      {facetError&&<p role="alert">{facetError}</p>}{page && <>
      {statistics?<WaitStatistics key={statistics.version} report={statistics} sourceUnavailable={page.pages.unavailableSources.total>0}/>:statisticsError?<p role="alert">{statisticsError}</p>:<p role="status">正在读取等待分布…</p>}
      <p className="wait-total-caption">已确认等待合计 <span data-testid="wait-reply-total">{page.summary.replyWaitCount?waitDuration(page.summary.knownReplyWaitMs):page.summary.replyWaitMs===null?'未知':'0 分 0 秒'}</span> · {page.summary.replyWaitCount} 段</p>
      {page.pages.daily.total > 0 && <details className="usage-data-status"><summary>按日查看 · {page.pages.daily.total} 天</summary><div className="usage-table-scroll"><table><caption>按日等待</caption><thead><tr><th>日期</th><th>已确认等待回复</th><th>未知段数</th></tr></thead><tbody>{(detail?.daily??page.daily).map(day => <tr key={day.date}><th>{day.date}</th><td>{waitDuration(day.knownReplyWaitMs)}</td><td>{day.unknownReplyWaitCount}</td></tr>)}</tbody></table></div>{detail?.dailyNext!==null&&detail&&<button disabled={detailBusy} onClick={()=>void more('daily')}>更多日期</button>}</details>}
      {page.pages.unavailableSources.total>0&&<details className="usage-data-status"><summary>不可读取来源 · {page.pages.unavailableSources.total} 项</summary><div className="usage-table-scroll"><table aria-label="不可读取来源"><thead><tr><th>员工 / 项目</th><th>状态</th><th>来源</th></tr></thead><tbody>{(detail?.unavailableSources??page.unavailableSources??[]).map(row=><tr key={row.snapshotId+row.employeeId+row.project}><th>{row.employee}<span className="usage-cell-detail">{row.project||'未归类项目'}</span></th><td>{row.reason==='missing'?'原件缺失':row.reason==='hash-mismatch'?'原件校验失败':'原件不可读取'}</td><td><a href={row.evidence.webPath}>查看来源</a></td></tr>)}</tbody></table></div>{detail?.sourceNext!==null&&detail&&<button disabled={detailBusy} onClick={()=>void more('unavailableSources')}>更多来源</button>}</details>}
      <section className="usage-figure"><div className="usage-figure-head"><h2>等待记录</h2><span>{page.total} 段</span></div>
        <div className="usage-table-scroll"><table aria-label="等待记录"><thead><tr><th>员工 / 项目</th><th>轮次结束 → 用户回复</th><th>等待回复</th><th>期间活动</th><th>来源</th></tr></thead><tbody>{page.intervals.map(interval => <tr key={interval.id} data-long={interval.long || undefined}>
          <th scope="row">{interval.employee}<span className="usage-cell-detail">{interval.project || '未归类项目'}</span><span className="usage-cell-detail">{sourceLabel(interval.source)}</span></th>
          <td><time>{timestamp(interval.startedAt)}</time><span className="usage-cell-detail">→ {timestamp(interval.endedAt)}</span></td>
          <td><strong>{waitDuration(interval.durationMs)}</strong>{interval.long && <span className="wait-long">长等待</span>}{interval.reason && <details><summary>未知来源</summary><p>{interval.reason}</p></details>}</td>
          <td>{interval.parallel === 'observed' ? <details><summary>有并行活动</summary>{interval.parallelEvidence.map((evidence, index) => <a className="usage-cell-detail" href={evidence.conversationPath ?? evidence.webPath} key={index}>活动原件 {index + 1}</a>)}</details> : interval.parallel === 'not-observed' ? '未观察到' : '未知'}</td>
          <td><a href={interval.end.conversationPath?`${interval.end.conversationPath}&waitVersion=${page.version}`:interval.end.webPath}>查看对话</a>{interval.start && <a className="usage-cell-detail" href={interval.start.webPath}>轮次结束原件</a>}</td>
        </tr>)}</tbody></table></div>
        {page.total === 0 && <p className="usage-empty">{page.pages.unavailableSources.total?'原件不可读取，等待记录未知':'暂无等待记录'}</p>}
        {(offsets.length>1||page.nextOffset!==null) && <div className="usage-pagination"><button disabled={busy || offsets.length===1} onClick={() => {const previous=offsets.slice(0,-1);setOffsets(previous);setQuery({ ...query, version: page.version, offset: previous.at(-1)! });}}>上一页等待</button><span>第 {offsets.length} 页</span><button disabled={busy || page.nextOffset === null} onClick={() => {setOffsets([...offsets,page.nextOffset!]);setQuery({ ...query, version: page.version, offset: page.nextOffset! });}}>下一页等待</button></div>}
      </section><details className="usage-data-status"><summary>计算口径与来源</summary><p>{page.definition}</p>{page.unknownReasons.map(reason => <p key={reason}>{reason}</p>)}<span>{page.algorithmVersion}</span></details></>}
    </div>
  </section>;
}
