import { useEffect, useState, type FormEvent } from 'react';
import { sourceLabel } from '../../packages/contracts/archive.js';
import type { SearchInput, SearchPage, SearchHit } from '../../packages/contracts/search.js';

type Props = { request: (path: string, signal?: AbortSignal) => Promise<Response> };
export function ArchiveSearch({ request }: Props) {
  const [draft, setDraft] = useState<SearchInput>({ content: '', employee: '', project: '', projectState: 'all', history: 'latest' });
  const [query, setQuery] = useState<SearchInput | null>(null);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [page, setPage] = useState<SearchPage | null>(null);
  const [scanned, setScanned] = useState(0);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!query) return;
    const abort = new AbortController(); setBusy(true); setError('');
    const params = new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined && value !== '').map(([key, value]) => [key, String(value)]));
    request(`/api/search?${params}`, abort.signal).then(response => response.json()).then((data: SearchPage) => {
      if (abort.signal.aborted) return;
      setPage(data); setHits(previous => query.cursor ? [...previous, ...data.hits] : data.hits);
      setScanned(previous => query.cursor ? previous + data.scanned : data.scanned);
    }).catch(failure => { if (!abort.signal.aborted) setError(failure.message); })
      .finally(() => { if (!abort.signal.aborted) setBusy(false); });
    return () => abort.abort();
  }, [query, retry]);
  function submit(event: FormEvent) {
    event.preventDefault(); setPage(null); setHits([]); setScanned(0); setQuery({ ...draft });
  }
  return <section className="archive-search" aria-label="搜索会话"><h2>搜索会话与原文</h2>
    <form onSubmit={submit}>
      <div className="search-fields">
        <label>会话内容<input type="search" maxLength={160} value={draft.content} onChange={event => setDraft({ ...draft, content: event.target.value })} /></label>
        <label>员工姓名<input maxLength={256} value={draft.employee} onChange={event => setDraft({ ...draft, employee: event.target.value })} /></label>
        <label>项目包含<input maxLength={1024} value={draft.project} disabled={draft.projectState === 'unclassified'} onChange={event => setDraft({ ...draft, project: event.target.value })} /></label>
        <label>Agent<select value={draft.source ?? ''} onChange={event => setDraft({ ...draft, source: event.target.value as SearchInput['source'] || undefined })}>
          <option value="">全部 Agent</option><option value="codex-desktop">Codex Desktop</option><option value="codex-cli">Codex CLI</option><option value="claude-code-cli">Claude Code CLI</option></select></label>
        <label>来源起始日期<input type="date" value={draft.from ?? ''} max={draft.to} onChange={event => setDraft({ ...draft, from: event.target.value || undefined })} /></label>
        <label>来源结束日期<input type="date" value={draft.to ?? ''} min={draft.from} onChange={event => setDraft({ ...draft, to: event.target.value || undefined })} /></label>
      </div>
      <div className="search-options"><label><input type="checkbox" checked={draft.projectState === 'unclassified'} onChange={event => setDraft({ ...draft, project: '', projectState: event.target.checked ? 'unclassified' : 'all' })} />仅未归类项目</label>
        <label><input type="checkbox" checked={draft.history === 'all'} onChange={event => setDraft({ ...draft, history: event.target.checked ? 'all' : 'latest' })} />包含历史快照与代次</label></div>
      <p className="muted small">内容、姓名和项目按包含文字查找。日期按原文发生时间（北京时间）筛选；未知日期及关联材料不计入日期筛选。二进制附件不做文字识别。</p>
      <button className="primary" disabled={busy}>搜索存档</button>
    </form>
    {busy && <p role="status">正在搜索原件…</p>}
    {error && <><p className="error" role="alert">{error}</p><button disabled={busy} onClick={() => setRetry(value => value + 1)}>重试搜索</button></>}
    {page && <div className="search-results" aria-label="搜索结果">
      <p role="status">已检查 {scanned} 份快照，找到 {hits.length} 份。{page.complete ? '本次搜索已完成。' : '还有快照待检查；请继续搜索。'}</p>
      {!busy && page.complete && hits.length === 0 && <p>没有匹配原件。可清除内容或日期条件，或勾选历史快照扩大范围。</p>}
      <ol>{hits.map(hit => <li key={hit.id}><a className="search-hit" href={hit.webPath}><strong>{hit.employee} · {hit.project || '未归类项目'}</strong>
        <span>{sourceLabel(hit.source)} · {hit.sourceDate ?? '来源日期未知'} · {hit.revision === null ? '修订未知' : `修订 ${hit.revision}`}</span>
        <span>{hit.location?.kind === 'material' ? '关联材料' : hit.location?.kind === 'raw' ? `原件第 ${hit.line} 行（原始格式）` : hit.line ? `原件第 ${hit.line} 行${hit.block === null ? '' : ` / block ${hit.block}`}` : '空原件'} · 打开首个命中</span>
        <q>{hit.excerpt}</q></a></li>)}</ol>
      {page.nextCursor && <button disabled={busy} onClick={() => setQuery({ ...query, cursor: page.nextCursor! })}>继续搜索更多快照</button>}
      <p className="muted small">每份快照列出首个命中。本次搜索保留 15 分钟；上传新版本后重新搜索可查看。完整材料仍可在详情导出。</p>
    </div>}
  </section>;
}
