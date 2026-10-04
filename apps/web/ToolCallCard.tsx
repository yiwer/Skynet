import type {ReactNode} from 'react';
import type {ConversationTrace} from '../../packages/contracts/conversation.js';
import './tool-call-card.css';

const ms=(value:number)=>`${value.toLocaleString('zh-CN',{maximumFractionDigits:6})} ms`;
const statuses:Record<string,string>={completed:'已完成',error:'错误',failed:'失败',in_progress:'进行中',running:'进行中',cancelled:'已取消',canceled:'已取消'};
export const isToolRole=(role:string)=>role==='tool request'||role==='tool result';

/** Presentation of one source event; paired events keep their own position and link. */
export function ToolCallCard({kind,name,children,open,trace,evidencePath,tracePath,peerPath,association,segment}: {
  kind:'request'|'result';name?:string;children:ReactNode;open?:boolean;trace?:ConversationTrace;
  evidencePath?:string;tracePath?:string;peerPath?:string|null;association?:'paired'|'unmatched'|'ambiguous';segment?:ReactNode;
}){
  const role=kind==='request'?'工具调用':'工具结果';
  return <details className="conversation-tool-card tool-call-card" open={open||undefined} aria-label={`${role}${name?' '+name:''}`}>
    <summary>
      <svg className="tool-call-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="m4 5 4 4-4 4m6 1h6"/></svg>
      <span className="conversation-tool-kind">{kind==='request'?'调用':'结果'}</span><strong>{name??'工具'}</strong>
      {trace?.status&&<span className="tool-call-status">{statuses[trace.status]??trace.status}</span>}
      {trace?.exitCode!==undefined&&<span className="tool-call-fact">退出 {trace.exitCode}</span>}
      {trace?.executionDurationMs!==undefined&&<span className="tool-call-fact">执行 {ms(trace.executionDurationMs)}</span>}
      {trace?.durationMs!==undefined&&<span className="tool-call-fact">{trace.durationSource==='source-timestamps'?'来源时间差':'记录耗时'} {ms(trace.durationMs)}</span>}
      {segment}
    </summary>
    <div className="conversation-tool-content">
      <section className="tool-call-body" aria-label={kind==='request'?'调用参数':'调用结果'}>
        <h4>{kind==='request'?'参数':'结果'}</h4><pre className="conversation-tool-text">{children}</pre>
      </section>
      <nav className="tool-call-actions" aria-label="工具记录">
        {peerPath&&<a className="conversation-tool-peer" href={peerPath}>{kind==='request'?'查看调用结果':'查看调用参数'}</a>}
        {evidencePath&&<a href={evidencePath}>原件</a>}
        {tracePath&&<a href={tracePath}>Trace 原件</a>}
      </nav>
      {association==='ambiguous'&&<p className="conversation-tool-association">调用 ID 存在多个匹配</p>}
      {association==='unmatched'&&<p className="conversation-tool-association">{kind==='request'?'未匹配到结果':'未匹配到调用'}</p>}
    </div>
  </details>;
}
