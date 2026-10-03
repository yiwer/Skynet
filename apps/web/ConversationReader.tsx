import { useEffect, useRef, useState, type ReactNode } from 'react';
import { conversationAnchorSchema, conversationLink, type ConversationAnchor, type ConversationMessage,
  type ConversationPage, type ConversationTrace, type ConversationTracePage } from '../../packages/contracts/conversation.js';
import { evidenceLink } from '../../packages/contracts/search.js';

type Request = (path: string, signal?: AbortSignal) => Promise<Response>;
const date = (value: string) => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
const traceDate = (value: string) => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3, hour12: false });
const duration = (value: number) => `${value.toLocaleString('zh-CN', { maximumFractionDigits: 6 })} ms`;
const contextNames = { system: '系统上下文', developer: '开发者上下文', environment: '环境上下文' };

function AgentAvatar() { return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="8" width="12" height="10" rx="2"/><path d="M12 4v4M9 12h.01M15 12h.01M10 15h4"/></svg>; }

export function conversationSelection(hash: string) {
  const params = new URLSearchParams(hash.split('?')[1]);
  const result = conversationAnchorSchema.safeParse({ line: Number(params.get('line')), block: Number(params.get('block') ?? 0),
    textOffset: Number(params.get('textOffset') ?? 0), ...(params.has('parserVersion') ? { parserVersion: params.get('parserVersion') } : {}) });
  const matchLength = Number(params.get('matchLength'));
  return { anchor: result.success ? result.data : undefined, includeTools: params.get('includeTools') === 'true',
    includeContext: params.get('includeContext') === 'true', matchLength: Number.isSafeInteger(matchLength) && matchLength > 0 ? matchLength : undefined };
}

function TraceFacts({ trace }: { trace: ConversationTrace }) {
  const rows: Array<[string, string]> = [];
  if (trace.nativeId) rows.push(['记录 ID', trace.nativeId]);
  if (trace.callId) rows.push(['调用 ID', trace.callId]);
  if (trace.turnId) rows.push(['轮次 ID', trace.turnId]);
  if (trace.model) rows.push(['模型', trace.model]);
  if (trace.channel) rows.push(['通道', trace.channel]);
  if (trace.toolName) rows.push(['工具', trace.toolName]);
  if (trace.status) rows.push(['状态', trace.status]);
  if (trace.startedAt) rows.push(['开始时间', traceDate(trace.startedAt)]);
  if (trace.completedAt) rows.push(['结束时间', traceDate(trace.completedAt)]);
  if (trace.durationMs !== undefined) rows.push([trace.durationSource === 'source-timestamps' ? '来源时间差' : '记录耗时', duration(trace.durationMs)]);
  if (trace.executionDurationMs !== undefined) rows.push(['执行耗时', duration(trace.executionDurationMs)]);
  if (trace.exitCode !== undefined) rows.push(['退出码', String(trace.exitCode)]);
  return <dl className="conversation-trace-facts">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}

function TracePanel({ path, open, request }: { path: string; open: boolean; request: Request }) {
  const [spans, setSpans] = useState<ConversationTracePage['spans']>([]);
  const [cursor, setCursor] = useState<string>();
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [retry, setRetry] = useState(0);
  const fetchedCursor = useRef<string | null>(null);
  useEffect(() => {
    if (!open || fetchedCursor.current === (cursor ?? '')) return;
    const abort = new AbortController(); setBusy(true); setError('');
    request(path + (cursor ? `?${new URLSearchParams({ cursor })}` : ''), abort.signal).then(response => response.json()).then((value: ConversationTracePage) => {
      if (abort.signal.aborted) return;
      setSpans(previous => cursor ? [...previous, ...value.spans] : value.spans);
      setTotal(value.total); setNextCursor(value.nextCursor); fetchedCursor.current = cursor ?? '';
    }).catch(failure => { if (!abort.signal.aborted) setError(failure.message); })
      .finally(() => { if (!abort.signal.aborted) setBusy(false); });
    return () => abort.abort();
  }, [path, cursor, open, retry]);
  return <div className="conversation-trace-panel">
    {spans.length > 0 && <ol className="conversation-trace-list">{spans.map(span => <li key={`${span.line}:${span.kind}`}>
      <details><summary><strong>{span.kind}</strong>{span.durationMs !== undefined && <span>{duration(span.durationMs)}</span>}<span>#{span.line}</span></summary>
        <TraceFacts trace={span}/><a href={span.evidencePath}>查看 Trace 原件</a></details>
    </li>)}</ol>}
    {busy && <p role="status">正在读取 Trace…</p>}
    {error && <div role="alert"><p className="error">{error}</p><button onClick={() => setRetry(value => value + 1)}>重新读取 Trace</button></div>}
    {!busy && !error && spans.length === 0 && <p>暂无 Trace</p>}
    {spans.length > 0 && <div className="conversation-trace-pagination"><span>{spans.length} / {total}</span>{nextCursor && <button disabled={busy} onClick={() => setCursor(nextCursor)}>继续读取 Trace</button>}</div>}
  </div>;
}

function SegmentLabel({ message }: { message: ConversationMessage }) {
  if (message.textOffset === 0 && message.text.length === message.textLength) return null;
  return <span className="conversation-segment">{message.textOffset > 0 ? '连续段' : '首段'} · {message.textOffset + 1}–{message.textOffset + message.text.length} / {message.textLength} 字符</span>;
}

export function ConversationReader({ snapshotId, initial, request, navigation, onTitle }: { snapshotId: string;
  initial: { anchor?: ConversationAnchor; includeTools: boolean; includeContext?: boolean; matchLength?: number }; request: Request;
  navigation?: ReactNode; onTitle?: (title: string) => void }) {
  const [includeTools, setIncludeTools] = useState(initial.includeTools);
  const [includeContext, setIncludeContext] = useState(initial.includeContext ?? false);
  const [anchor, setAnchor] = useState(initial.anchor);
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const [page, setPage] = useState<ConversationPage | null>(null);
  const [traceOpen, setTraceOpen] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [retry, setRetry] = useState(0);
  const region = useRef<HTMLElement>(null);
  const cursor = cursors.at(-1);
  useEffect(() => {
    const abort = new AbortController(); setBusy(true); setError(''); setPage(null);
    const params = new URLSearchParams({ includeTools: String(includeTools), includeContext: String(includeContext) });
    if (cursor) params.set('cursor', cursor);
    else if (anchor) for (const [key, value] of Object.entries(anchor)) params.set(key, String(value));
    request(`/api/snapshots/${snapshotId}/conversation?${params}`, abort.signal).then(response => response.json()).then((value: ConversationPage) => {
      if (!abort.signal.aborted) {
        setPage(value);
        if (value.includeTools !== includeTools) setIncludeTools(value.includeTools);
        if (value.includeContext !== includeContext) setIncludeContext(value.includeContext);
        if (!cursor && !anchor) { const first = value.messages.find(message => message.role === 'user' && !message.contextKind); if (first) onTitle?.(first.text.split('\n')[0]!.slice(0, 64)); }
      }
    }).catch(failure => { if (!abort.signal.aborted) setError(failure.message); })
      .finally(() => { if (!abort.signal.aborted) setBusy(false); });
    return () => abort.abort();
  }, [snapshotId, includeTools, includeContext, anchor, cursor, retry]);
  useEffect(() => {
    if (!page) return;
    if (page.anchor) {
      const focused = region.current?.querySelector<HTMLElement>('[data-conversation-focused="true"]');
      focused?.focus({ preventScroll: true }); focused?.scrollIntoView({ block: 'nearest' });
    } else if (cursor) { region.current?.focus({ preventScroll: true }); region.current?.scrollIntoView({ block: 'start' }); }
  }, [page]);
  const changeTools = (value: boolean) => { setIncludeTools(value); setAnchor(undefined); setCursors([undefined]); };
  const changeContext = (value: boolean) => { setIncludeContext(value); setAnchor(undefined); setCursors([undefined]); };
  return <section className="conversation-reader" aria-label="对话阅读" ref={region} tabIndex={-1} aria-busy={busy}>
    <div className="conversation-toolbar">{navigation ?? <h3>对话</h3>}
      <div className="conversation-options"><label className="conversation-tool-switch"><input type="checkbox" aria-label="显示工具调用与结果" checked={includeTools} onChange={event => changeTools(event.target.checked)}/><span aria-hidden="true" className="switch-track"/>工具调用</label>
        <label className="conversation-tool-switch"><input type="checkbox" aria-label="显示系统与环境上下文" checked={includeContext} onChange={event => changeContext(event.target.checked)}/><span aria-hidden="true" className="switch-track"/>上下文</label></div></div>
    <h3 className="sr-only">对话</h3>
    {busy && <p role="status">正在读取对话…</p>}
    {error && <><p className="error" role="alert">{error}</p><button onClick={() => { setCursors([undefined]); setRetry(value => value + 1); }}>重新读取对话</button></>}
    {page && <>
      <p className="sr-only">{page.totalMessages} 条消息 · {page.totalToolCalls} 次工具调用 · 来源时间按北京时间显示</p>
      {page.traceCount > 0 && <details className="conversation-session-trace" open={traceOpen} onToggle={event => setTraceOpen(event.currentTarget.open)}><summary>Trace <span>{page.traceCount}</span></summary>
        <TracePanel key={page.tracePath} path={page.tracePath} open={traceOpen} request={request}/></details>}
      {page.messages.length === 0 && <p>暂无消息</p>}
      <div className="conversation-stream">{page.messages.map(message => {
        const focused = page.anchor?.line === message.line && page.anchor.block === message.block &&
          page.anchor.textOffset >= message.textOffset && page.anchor.textOffset < message.textOffset + Math.max(1, message.text.length);
        const isTool = !!message.tool || message.role === 'tool request' || message.role === 'tool result';
        const contextName = message.contextKind ? contextNames[message.contextKind] : undefined;
        const isUser = message.role === 'user' && !contextName;
        const isAssistant = message.role === 'assistant' && !contextName;
        const kind = message.tool?.kind ?? (message.role === 'tool result' ? 'result' : 'request');
        const toolName = message.tool?.name ?? message.trace?.toolName;
        const roleName = contextName ?? (isTool ? kind === 'request' ? '工具调用' : '工具结果' : isUser ? message.origin?.employee ?? page.employee : isAssistant ? 'Agent' : message.role);
        const text = focused && initial.matchLength ? <><mark>{message.text.slice(0, initial.matchLength)}</mark>{message.text.slice(initial.matchLength)}</> : message.text;
        const peer = message.tool?.peer;
        const peerPath = peer ? conversationLink(snapshotId, { line: peer.line, block: peer.block, textOffset: 0, parserVersion: page.parserVersion }) : null;
        return <section className={`conversation-message conversation-${contextName ? 'context' : isTool ? 'tool' : message.role}${focused ? ' conversation-focused' : ''}`}
          key={`${message.id}:${message.textOffset}`} aria-label={`${roleName}消息`} tabIndex={focused ? -1 : undefined} data-conversation-focused={focused || undefined}>
          {isAssistant && <span className="conversation-avatar" aria-hidden="true"><AgentAvatar/></span>}
          <div className="conversation-column">
            {isTool ? <details className="conversation-tool-card" open={focused || undefined}>
              <summary><span className="conversation-tool-kind">{kind === 'request' ? '调用' : '结果'}</span><strong>{toolName ?? '工具'}</strong><SegmentLabel message={message}/></summary>
              <div className="conversation-tool-content"><pre className="conversation-tool-text">{text}</pre>
                {peerPath && <a className="conversation-tool-peer" href={peerPath}>{kind === 'request' ? '查看调用结果' : '查看调用参数'}</a>}
                {message.tool?.association === 'ambiguous' && <p className="conversation-tool-association">调用 ID 存在多个匹配</p>}
                {message.tool?.association === 'unmatched' && <p className="conversation-tool-association">{kind === 'request' ? '未匹配到结果' : '未匹配到调用'}</p>}
              </div></details> : contextName ? <details className="conversation-context-card" open={focused || undefined}><summary>{contextName}<SegmentLabel message={message}/></summary><pre className="conversation-tool-text">{text}</pre></details>
              : <><pre className="conversation-bubble">{text}</pre><SegmentLabel message={message}/></>}
            <div className="message-meta"><strong>{roleName}</strong>
              {message.timestamp && <time dateTime={message.timestamp} title={date(message.timestamp)}>{new Date(message.timestamp).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false })}</time>}
              {message.context === 'historical' && <span className="badge">历史上下文</span>}{focused && <strong>命中位置</strong>}
              <details className="conversation-evidence"><summary aria-label={`原件第 ${message.line} 行`}>#{message.line}</summary><div className="conversation-evidence-popup"><p>{message.origin?.employee ?? page.employee} · block {message.block}{' · '}<a href={message.evidencePath}>在时间线核查原句</a>{' · '}<a href={message.conversationPath}>此消息链接</a></p></div></details>
              {!includeTools && message.hiddenToolEvents > 0 && <button className="conversation-hidden-tools" onClick={() => changeTools(true)} aria-label={`显示 ${message.hiddenToolCalls} 次工具调用、${message.hiddenToolEvents} 条工具记录`}>{message.hiddenToolCalls} 次工具调用（已隐藏）</button>}
            </div>
            {message.trace && <details className="conversation-message-trace"><summary>Trace</summary><TraceFacts trace={message.trace}/><a href={message.trace.traceLine ? evidenceLink(snapshotId, { kind: 'raw', line: message.trace.traceLine, textOffset: 0 }) : message.evidencePath}>查看 Trace 原件</a></details>}
          </div>
          {isUser && <span className="conversation-avatar conversation-avatar-user" aria-hidden="true">{Array.from(message.origin?.employee ?? page.employee)[0]}</span>}
        </section>;
      })}</div>
      {!includeTools && page.trailingHiddenToolEvents > 0 && <button onClick={() => changeTools(true)}>显示 {page.trailingHiddenToolCalls} 次工具调用</button>}
      {(cursors.length > 1 || page.nextCursor) && <div className="pagination"><button disabled={busy || cursors.length === 1} onClick={() => setCursors(value => value.slice(0, -1))}>上一页对话</button>
        <button disabled={busy || !page.nextCursor} onClick={() => setCursors(value => [...value, page.nextCursor!])}>{page.messages.at(-1) && page.messages.at(-1)!.textOffset + page.messages.at(-1)!.text.length < page.messages.at(-1)!.textLength ? '继续读取下一段' : '继续阅读对话'}</button></div>}
      {page.relatedTotal > 0 && <details className="conversation-related"><summary>关联会话与材料（{page.relatedTotal}）</summary><ul>{page.related.map(item => <li key={item.materialId}><a href={item.webPath}>{item.name}</a> · {item.role}</li>)}</ul><a href={page.relatedDetailsPath}>查看完整关联材料清单</a></details>}
    </>}
  </section>;
}
