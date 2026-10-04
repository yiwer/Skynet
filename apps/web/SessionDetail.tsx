import { useEffect, useState, type ReactNode } from 'react';
import type { Manifest } from '../../packages/contracts/archive.js';
import { sourceLabel } from '../../packages/contracts/archive.js';
import type { ActivityEvent, ActivitySummary, ActivityContext } from '../../packages/activity.js';
import type { Provenance } from '../../packages/contracts/provenance.js';
import type { Coverage } from './CaptureCoverage.js';
import { HistoryMaterials } from './HistoryMaterials.js';
import { SessionAnalysis } from './SessionAnalysis.js';
import { SessionInsights } from './SessionInsights.js';
import { QualificationProof } from './QualificationProof.js';
import { ConversationReader, conversationSelection } from './ConversationReader.js';
import { EvidenceReader } from './EvidenceReader.js';
import type { selectedEvidence } from './EvidenceReader.js';
import type { MetricTotals } from '../../packages/contracts/metrics.js';
import { AssemblyPanel } from './Assembly.js';
export type Detail = { snapshotId:string; employee:string; manifest:Manifest; committedAt:string; events:ActivityEvent[]; activity:ActivitySummary;
 unrecognizedLines:number; partialLine:boolean; nextOffset:number|null; total:number; captureHealth:Coverage; provenance:Provenance;
 recovery:{nativeRuntimeVersion:string|null; preparation:string; nativeBackend:string; limitation:string} };
const date=(value:string)=>new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
const contextLabel:Record<ActivityContext,string>={historical:'历史上下文','after-enrollment':'接入后活动','unknown-time':'来源时间未知','unknown-enrollment':'接入边界未知'};
type Props={detail:Detail;reading:'conversation'|'timeline'|'raw'; conversationHash:string;refresh:number;offset:number;
 evidenceLocation:ReturnType<typeof selectedEvidence>;setOffset:(value:number|((old:number)=>number))=>void;
 request:(path:string,signal?:AbortSignal,method?:'POST',body?:unknown)=>Promise<Response>;
 download:(kind:'raw'|'readable'|'recovery')=>Promise<void>;exporting:boolean;exportStatus:string;exportError:string};
function SessionFacts({snapshotId,request}:{snapshotId:string;request:Props['request']}) {
 const [totals,setTotals]=useState<MetricTotals|null>(null);const [error,setError]=useState('');
 useEffect(()=>{const abort=new AbortController();setTotals(null);setError('');request('/api/snapshots/'+snapshotId+'/metrics?period=since-enrollment',abort.signal).then(r=>r.json()).then(v=>{if(!abort.signal.aborted)setTotals(v.totals);}).catch(e=>{if(!abort.signal.aborted)setError(e.message);});return()=>abort.abort();},[snapshotId]);
 const rows:Array<[string,number]>=[];
 if(totals){if(totals.inputTokens!==null)rows.push(['输入 Token',totals.inputTokens]);if(totals.outputTokens!==null)rows.push(['输出 Token',totals.outputTokens]);rows.push(['工具调用',totals.toolCalls]);}
 if(!rows.length&&!error)return null;
 return <section className="session-facts"><h2>会话数据</h2><dl>{rows.map(([label,n])=><div key={label}><dt>{label}</dt><dd>{n.toLocaleString('zh-CN')}</dd></div>)}</dl>{error&&<p role="alert">数据读取失败</p>}</section>;
}
export function SessionDetail({detail,reading,conversationHash,refresh,offset,evidenceLocation,setOffset,request,download,exporting,exportStatus,exportError}:Props){
 const selected=detail.snapshotId;
 const [title,setTitle]=useState('');
 const [analysisRefresh,setAnalysisRefresh]=useState(0);
 useEffect(()=>{setTitle('');},[selected]);
 useEffect(()=>{if(new URLSearchParams(conversationHash.split('?')[1]).get('recover')==='true')document.getElementById('session-recovery')?.scrollIntoView({block:'start'});},[conversationHash]);
 const heading=detail.manifest.project.replaceAll('\\','/').split('/').filter(Boolean).at(-1)||'未归类项目';
 const navigation:ReactNode=<nav className="reading-nav" aria-label="会话阅读方式">{([['conversation','对话视图'],['timeline','时间线'],['raw','原件 JSONL']] as const).map(([mode,label])=><a key={mode} aria-label={label} href={'#'+selected+'?view='+mode} aria-current={reading===mode?'page':undefined}>{mode==='conversation'?'对话':label}</a>)}</nav>;
 return <article className="session-detail" aria-label="会话详情">
 <div className="session-page-heading"><nav className="session-crumbs" aria-label="位置"><a href="#sessions">会话</a><span>/</span><span className="hash">{detail.manifest.sourceSessionId}</span></nav><div className="session-title-row"><div><h1>{title||heading}</h1><p>{detail.employee} · {heading} · {sourceLabel(detail.manifest.source)} · {detail.activity.sourceFrom?date(detail.activity.sourceFrom):'来源时间未知'}</p></div><a className="session-recover-button" href={'#recovery?snapshot='+selected}>找回此会话</a></div></div>
 <div className="session-meta"><span>{detail.total} 条记录</span><span>{detail.manifest.byteLength.toLocaleString()} 字节</span></div>
 <div className="session-columns"><section className="session-reading" data-scroll-region="conversation" aria-label="会话内容">
 {reading==='conversation'?<ConversationReader key={selected+':'+conversationHash+':'+refresh} snapshotId={selected} initial={conversationSelection(conversationHash)} request={request} navigation={navigation} onTitle={setTitle}/>:navigation}
 {reading==='raw'&&<EvidenceReader key={'raw:'+selected+':'+refresh} snapshotId={selected} location={{kind:'raw',line:1,textOffset:0}} request={request}/>}
 {reading==='timeline'&&evidenceLocation&&<EvidenceReader key={selected+':'+JSON.stringify(evidenceLocation)+':'+refresh} snapshotId={selected} location={evidenceLocation} request={request}/>}
          {reading === 'timeline' && <>
          {detail.events.map(event => <section className="message" key={`${event.line}:${event.block ?? 0}`}><div className="message-meta"><strong>{event.role}</strong><span>{contextLabel[event.context]}</span><span>原件第 {event.line} 行 · 来源时间：{event.timestamp ? date(event.timestamp) : '未知'}</span></div>
            {event.origin && <p className="muted small">原始归属：{event.origin.employee} · {event.origin.project || '未归类项目'} · 设备 {event.origin.deviceId} · <a href={event.origin.webPath ?? `#${event.origin.snapshotId}`}>原始{event.origin.materialId ? '材料' : '快照'}第 {event.origin.line} 行</a></p>}<QualificationProof origin={event.origin} /><pre>{event.text}</pre></section>)}
          {!evidenceLocation && detail.events.length === 0 && <p>暂无消息</p>}
          {!evidenceLocation && <div className="pagination"><button disabled={offset === 0} onClick={() => setOffset(value => Math.max(0, value - 100))}>上一页</button><button disabled={detail.nextOffset === null} onClick={() => setOffset(detail.nextOffset ?? 0)}>下一页</button></div>}</>}
</section><aside className="session-side" data-scroll-region="session-inspector" aria-label="会话数据与存档">
 <SessionFacts snapshotId={selected} request={request}/>
 <AssemblyPanel snapshotId={selected} request={request}/>
 <SessionInsights key={`insights-${selected}`} snapshotId={selected} request={request} analysisRefresh={analysisRefresh}/>
 <section className="session-file"><h2>存档</h2><dl><div><dt>来源</dt><dd>{sourceLabel(detail.manifest.source)}</dd></div><div><dt>版本</dt><dd>{detail.manifest.sourceVersion}</dd></div><div><dt>提交时间</dt><dd>{date(detail.committedAt)}</dd></div></dl>
 <div className="session-file-actions"><button disabled={exporting} onClick={()=>download('raw')}>下载原件</button><button disabled={exporting} onClick={()=>download('readable')}>导出文本</button></div></section>
 <SessionAnalysis key={`analysis-${selected}`} snapshotId={selected} request={(path,signal,method)=>request(path,signal,method)} onChange={()=>setAnalysisRefresh(value=>value+1)}/>
 <HistoryMaterials key={selected} snapshotId={selected} capture={detail.manifest.capture} request={(path,signal)=>request(path,signal)}/>
 <details className="session-archive-facts"><summary>原件与来源信息</summary><dl><div><dt>会话 ID</dt><dd className="hash">{detail.manifest.sourceSessionId}</dd></div><div><dt>SHA-256</dt><dd className="hash">{detail.manifest.hash}</dd></div><div><dt>系统</dt><dd>{detail.manifest.sourceOs}</dd></div>{detail.activity.sourceFrom&&<div><dt>开始时间</dt><dd>{date(detail.activity.sourceFrom)}</dd></div>}{detail.activity.sourceTo&&<div><dt>结束时间</dt><dd>{date(detail.activity.sourceTo)}</dd></div>}</dl>
 {detail.provenance.sourceSnapshotId&&<a href={`#${detail.provenance.sourceSnapshotId}`}>来源快照</a>}
 {(detail.unrecognizedLines>0||detail.partialLine)&&<p>{detail.unrecognizedLines>0&&`${detail.unrecognizedLines} 行未解析`}{detail.partialLine&&' · 末行待完成'}</p>}
 </details>
 {(exporting||exportStatus)&&<p role="status">{exporting?'正在准备下载…':exportStatus}</p>}{exportError&&<p className="error" role="alert">{exportError}</p>}
 </aside></div></article>;
}
