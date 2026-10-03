import { useEffect, useRef, useState, type ReactNode } from 'react';
import { conversationAnchorSchema, type ConversationAnchor, type ConversationPage } from '../../packages/contracts/conversation.js';

function AgentAvatar() { return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="8" width="12" height="10" rx="2"/><path d="M12 4v4M9 12h.01M15 12h.01M10 15h4"/></svg>; }

export function conversationSelection(hash: string) {
  const params = new URLSearchParams(hash.split('?')[1]);
  const result = conversationAnchorSchema.safeParse({ line: Number(params.get('line')), block: Number(params.get('block') ?? 0),
    textOffset: Number(params.get('textOffset') ?? 0), ...(params.has('parserVersion') ? { parserVersion: params.get('parserVersion') } : {}) });
  const matchLength = Number(params.get('matchLength'));
  return { anchor: result.success ? result.data : undefined, includeTools: params.get('includeTools') === 'true',
    matchLength: Number.isSafeInteger(matchLength) && matchLength > 0 ? matchLength : undefined };
}

export function ConversationReader({ snapshotId, initial, request, navigation, onTitle }: { snapshotId: string;
  initial: { anchor?: ConversationAnchor; includeTools: boolean; matchLength?: number }; request: (path: string, signal?: AbortSignal) => Promise<Response>;
  navigation?: ReactNode; onTitle?: (title: string) => void }) {
  const [includeTools, setIncludeTools] = useState(initial.includeTools);
  const [anchor, setAnchor] = useState(initial.anchor);
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const [page, setPage] = useState<ConversationPage | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [retry, setRetry] = useState(0);
  const region = useRef<HTMLElement>(null);
  const cursor = cursors.at(-1);
  useEffect(() => {
    const abort = new AbortController(); setBusy(true); setError(''); setPage(null);
    const params = new URLSearchParams({ includeTools: String(includeTools) });
    if (cursor) params.set('cursor', cursor);
    else if (anchor) for (const [key, value] of Object.entries(anchor)) params.set(key, String(value));
    request(`/api/snapshots/${snapshotId}/conversation?${params}`, abort.signal).then(response => response.json()).then((value: ConversationPage) => {
      if (!abort.signal.aborted) { setPage(value); if (value.includeTools !== includeTools) setIncludeTools(value.includeTools);
        if (!cursor && !anchor) { const first = value.messages.find(message=>message.role==='user'); if (first) onTitle?.(first.text.split('\n')[0]!.slice(0,64)); } }
    }).catch(failure => { if (!abort.signal.aborted) setError(failure.message); })
      .finally(() => { if (!abort.signal.aborted) setBusy(false); });
    return () => abort.abort();
  }, [snapshotId, includeTools, anchor, cursor, retry]);
  useEffect(() => { if (page?.anchor) region.current?.focus(); }, [page]);
  const date = (value: string) => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
  return <section className="conversation-reader" aria-label="对话阅读" ref={region} tabIndex={-1}>
    <div className="conversation-toolbar">{navigation ?? <h3>对话</h3>}
      <label className="conversation-tool-switch"><input type="checkbox" aria-label="显示工具调用与结果" checked={includeTools} onChange={event => {
        setIncludeTools(event.target.checked); setAnchor(undefined); setCursors([undefined]);
      }} /><span aria-hidden="true" className="switch-track"/>显示工具调用</label></div>
    <h3 className="sr-only">对话</h3>
    {busy && <p role="status">正在读取对话…</p>}
    {error && <><p className="error" role="alert">{error}</p><button onClick={() => { setCursors([undefined]); setRetry(value => value + 1); }}>重新读取对话</button></>}
    {page && <>
      <p className="sr-only">{page.totalMessages} 条消息 · {page.totalToolCalls} 次工具调用 · 来源时间按北京时间显示</p>
      {page.messages.length === 0 && <p>暂无消息</p>}
      <div className="conversation-stream">{page.messages.map(message => {
        const focused = page.anchor?.line === message.line && page.anchor.block === message.block &&
          page.anchor.textOffset >= message.textOffset && page.anchor.textOffset < message.textOffset + Math.max(1, message.text.length);
        return <section className={`conversation-message conversation-${message.role}${focused ? ' conversation-focused' : ''}`}
          key={`${message.id}:${message.textOffset}`} aria-label={`${message.role === 'user' ? '用户' : message.role === 'assistant' ? 'Agent' : '工具'}消息`}>
          {message.role === 'assistant' && <span className="conversation-avatar" aria-hidden="true"><AgentAvatar/></span>}
          <div className="conversation-column">
          <pre className="conversation-bubble">{focused && initial.matchLength ? <><mark>{message.text.slice(0, initial.matchLength)}</mark>{message.text.slice(initial.matchLength)}</> : message.text}</pre>
          <div className="message-meta"><strong>{message.role === 'user' ? message.origin?.employee ?? page.employee : message.role === 'assistant' ? 'Agent' : message.role}</strong>
            {message.timestamp&&<time title={date(message.timestamp)}>{new Date(message.timestamp).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hour12:false})}</time>}
            {message.context === 'historical' && <span className="badge">历史上下文</span>}
            {focused && <strong>命中位置</strong>}
          <details className="conversation-evidence"><summary aria-label={`原件第 ${message.line} 行`}>#{message.line}</summary><div className="conversation-evidence-popup">
          <p>{message.origin?.employee ?? page.employee} · block {message.block}
            {message.textOffset > 0 || message.text.length < message.textLength ? ` · 本段 ${message.textOffset}–${message.textOffset + message.text.length} / ${message.textLength}` : ''}
            {' · '}<a href={message.evidencePath}>在时间线核查原句</a>{' · '}<a href={message.conversationPath}>此消息链接</a></p></div></details>
          {!includeTools && message.hiddenToolEvents > 0 && <span className="conversation-hidden-tools" title={`${message.hiddenToolCalls} 次工具调用、${message.hiddenToolEvents} 条工具记录（已隐藏）`}>{message.hiddenToolCalls} 次工具调用（已隐藏）<span className="sr-only">{message.hiddenToolCalls} 次工具调用、{message.hiddenToolEvents} 条工具记录（已隐藏）</span></span>}
          </div></div>
          {message.role === 'user' && <span className="conversation-avatar conversation-avatar-user" aria-hidden="true">{Array.from(message.origin?.employee ?? page.employee)[0]}</span>}
        </section>;
      })}</div>
      {!includeTools && page.trailingHiddenToolEvents > 0 && <button onClick={()=>{setIncludeTools(true);setAnchor(undefined);setCursors([undefined]);}}>显示 {page.trailingHiddenToolCalls} 次工具调用</button>}
      {(cursors.length>1||page.nextCursor)&&<div className="pagination"><button disabled={busy || cursors.length === 1} onClick={() => setCursors(value => value.slice(0, -1))}>上一页对话</button>
        <button disabled={busy || !page.nextCursor} onClick={() => setCursors(value => [...value, page.nextCursor!])}>继续阅读对话</button></div>}
      {page.relatedTotal > 0 && <details><summary>关联会话与材料（{page.relatedTotal}）</summary><ul>{page.related.map(item => <li key={item.materialId}>
        <a href={item.webPath}>{item.name}</a> · {item.role}</li>)}</ul><a href={page.relatedDetailsPath}>查看完整关联材料清单</a></details>}
    </>}
  </section>;
}
