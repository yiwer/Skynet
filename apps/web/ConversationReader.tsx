import { useEffect, useRef, useState } from 'react';
import { conversationAnchorSchema, type ConversationAnchor, type ConversationPage } from '../../packages/contracts/conversation.js';

export function conversationSelection(hash: string) {
  const params = new URLSearchParams(hash.split('?')[1]);
  const result = conversationAnchorSchema.safeParse({ line: Number(params.get('line')), block: Number(params.get('block') ?? 0),
    textOffset: Number(params.get('textOffset') ?? 0), ...(params.has('parserVersion') ? { parserVersion: params.get('parserVersion') } : {}) });
  const matchLength = Number(params.get('matchLength'));
  return { anchor: result.success ? result.data : undefined, includeTools: params.get('includeTools') === 'true',
    matchLength: Number.isSafeInteger(matchLength) && matchLength > 0 ? matchLength : undefined };
}

export function ConversationReader({ snapshotId, initial, request }: { snapshotId: string;
  initial: { anchor?: ConversationAnchor; includeTools: boolean; matchLength?: number }; request: (path: string, signal?: AbortSignal) => Promise<Response> }) {
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
      if (!abort.signal.aborted) { setPage(value); if (value.includeTools !== includeTools) setIncludeTools(value.includeTools); }
    }).catch(failure => { if (!abort.signal.aborted) setError(failure.message); })
      .finally(() => { if (!abort.signal.aborted) setBusy(false); });
    return () => abort.abort();
  }, [snapshotId, includeTools, anchor, cursor, retry]);
  useEffect(() => { if (page?.anchor) region.current?.focus(); }, [page]);
  const date = (value: string) => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
  return <section className="conversation-reader" aria-label="对话阅读" ref={region} tabIndex={-1}>
    <div className="heading"><div><h3>对话</h3><p className="muted small">按原件顺序阅读；消息内容保持原文。</p></div>
      <label className="inline-check"><input type="checkbox" checked={includeTools} onChange={event => {
        setIncludeTools(event.target.checked); setAnchor(undefined); setCursors([undefined]);
      }} />显示工具调用与结果</label></div>
    {busy && <p role="status">正在读取对话…</p>}
    {error && <><p className="error" role="alert">{error}</p><button onClick={() => { setCursors([undefined]); setRetry(value => value + 1); }}>重新读取对话</button></>}
    {page && <>
      <p className="muted small">{page.totalMessages} 条消息 · {page.totalToolCalls} 次工具调用 · 来源时间按北京时间显示</p>
      {(page.status.captureGapCount > 0 || page.status.unrecognizedLines > 0 || page.status.partialLine) && <p className="notice">采集材料存在缺口或未解析内容；对话视图不能代替完整原件。可切换原件视图核查。</p>}
      {page.status.compacted && <p className="notice">来源记录包含上下文压缩，已归档原件与关联材料仍可查阅。</p>}
      <p className="muted small">离线补传状态、会话是否仍在进行及未上报的等待事件：未知。</p>
      {page.messages.length === 0 && <p>当前范围没有可显示的对话消息。可展开工具，或查看原件。</p>}
      {page.messages.map(message => {
        const focused = page.anchor?.line === message.line && page.anchor.block === message.block &&
          page.anchor.textOffset >= message.textOffset && page.anchor.textOffset < message.textOffset + Math.max(1, message.text.length);
        return <section className={`conversation-message conversation-${message.role}${focused ? ' conversation-focused' : ''}`}
          key={`${message.id}:${message.textOffset}`} aria-label={`${message.role === 'user' ? '用户' : message.role === 'assistant' ? 'Agent' : '工具'}消息`}>
          <div className="message-meta"><strong>{message.role === 'user' ? '用户' : message.role === 'assistant' ? 'Agent' : message.role}</strong>
            <time>{message.timestamp ? date(message.timestamp) : '来源时间未知'}</time>
            {message.context === 'historical' && <span className="badge">历史上下文</span>}
            {message.context === 'unknown-time' && <span>来源时间未知</span>}
            {message.context === 'unknown-enrollment' && <span>接入边界未知</span>}
            {focused && <strong>命中位置</strong>}</div>
          {!includeTools && message.hiddenToolEvents > 0 && <p className="muted small">{message.hiddenToolCalls} 次工具调用、{message.hiddenToolEvents} 条工具记录（已隐藏）</p>}
          {message.toolEvidence === 'none-observed' && <p className="muted small">无工具结果佐证</p>}
          {message.toolEvidence === 'present-not-assessed' && <p className="muted small">存在工具结果，结论尚需核查。</p>}
          <pre>{focused && initial.matchLength ? <><mark>{message.text.slice(0, initial.matchLength)}</mark>{message.text.slice(initial.matchLength)}</> : message.text}</pre>
          <p className="muted small">{message.origin?.employee ?? page.employee} · 原件第 {message.line} 行 / block {message.block}
            {message.textOffset > 0 || message.text.length < message.textLength ? ` · 本段 ${message.textOffset}–${message.textOffset + message.text.length} / ${message.textLength}` : ''}
            {' · '}<a href={message.evidencePath}>在时间线核查原句</a>{' · '}<a href={message.conversationPath}>此消息链接</a></p>
        </section>;
      })}
      {!includeTools && page.trailingHiddenToolEvents > 0 && <p className="notice">末尾另有 {page.trailingHiddenToolCalls} 次工具调用、{page.trailingHiddenToolEvents} 条工具记录，展开工具即可查看。</p>}
      <div className="pagination"><button disabled={busy || cursors.length === 1} onClick={() => setCursors(value => value.slice(0, -1))}>上一页对话</button>
        <button disabled={busy || !page.nextCursor} onClick={() => setCursors(value => [...value, page.nextCursor!])}>继续阅读对话</button></div>
      {page.relatedTotal > 0 && <details><summary>关联会话与材料（{page.relatedTotal}）</summary><ul>{page.related.map(item => <li key={item.materialId}>
        <a href={item.webPath}>{item.name}</a> · {item.role}</li>)}</ul><a href={page.relatedDetailsPath}>查看完整关联材料清单</a></details>}
    </>}
  </section>;
}
