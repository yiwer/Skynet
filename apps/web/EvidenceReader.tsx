import { useEffect, useRef, useState } from 'react';
import { locationSchema, type EvidenceLocation } from '../../packages/contracts/search.js';
import type { EventOrigin } from '../../packages/contracts/provenance.js';
import { QualificationProof } from './QualificationProof.js';

export function selectedEvidence(hash: string) {
  const params = new URLSearchParams(hash.split('?')[1]);
  const object = Object.fromEntries(params.entries());
  const result = locationSchema.safeParse({ ...object, ...Object.fromEntries(['offset', 'line', 'block', 'textOffset']
    .filter(key => object[key] !== undefined).map(key => [key, Number(object[key])])) });
  return result.success ? result.data : null;
}
type Page = { kind: string; events?: { line: number; block?: number; textOffset: number; text: string; role: string; origin?: EventOrigin }[];
  text?: string; line?: number; textOffset?: number; next: EvidenceLocation | null; interpretation?: string; context?: string };
export function EvidenceReader({ snapshotId, location, request }: { snapshotId: string; location: EvidenceLocation;
  request: (path: string, signal?: AbortSignal) => Promise<Response> }) {
  const [positions, setPositions] = useState([location]); const [page, setPage] = useState<Page | null>(null);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [retry, setRetry] = useState(0);
  const region = useRef<HTMLElement>(null);
  useEffect(() => { region.current?.focus(); }, []);
  const position = positions.at(-1)!;
  useEffect(() => {
    const abort = new AbortController(); setBusy(true); setError(''); setPage(null);
    const params = new URLSearchParams(Object.entries(position).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]));
    request(`/api/snapshots/${snapshotId}/location?${params}`, abort.signal).then(response => response.json()).then(data => {
      if (!abort.signal.aborted) setPage(data);
    }).catch(failure => { if (!abort.signal.aborted) setError(failure.message); })
      .finally(() => { if (!abort.signal.aborted) setBusy(false); });
    return () => abort.abort();
  }, [snapshotId, position, retry]);
  return <section ref={region} className="focused-evidence" aria-label="命中证据" tabIndex={-1}><h3>命中位置与上下文</h3>
    {busy && <p role="status">正在读取命中原文…</p>}
    {error && <><p className="error" role="alert">{error}</p><button onClick={() => setRetry(value => value + 1)}>重试证据</button></>}
    {page?.events?.map(event => <section className="message" key={`${event.line}:${event.block ?? 0}:${event.textOffset}`}><div className="message-meta">
      <strong>{event.role}</strong><span>原件第 {event.line} 行{event.block === undefined ? '' : ` / block ${event.block}`} · 文字位置 {event.textOffset}</span></div>
      {event.origin && <p className="muted small">原始归属：{event.origin.employee} · {event.origin.project || '未归类项目'} · <a href={event.origin.webPath ?? `#${event.origin.snapshotId}`}>原始{event.origin.materialId ? '材料' : '快照'}第 {event.origin.line} 行</a></p>}<QualificationProof origin={event.origin} /><pre>{event.text}</pre></section>)}
    {page?.text !== undefined && <><p>{page.kind === 'raw' ? `原件第 ${page.line} 行` : '关联材料'} · 文字位置 {page.textOffset}</p><pre>{page.text}</pre></>}
    <div className="export-actions"><button disabled={busy || positions.length === 1} onClick={() => setPositions(previous => previous.slice(0, -1))}>上一段原文</button>
      <button disabled={busy || !page?.next} onClick={() => setPositions(previous => [...previous, page!.next!])}>继续读取原文</button>
      <button disabled={busy} onClick={() => setPositions([position.kind === 'material' ? { ...position, textOffset: 0 } : position.kind === 'raw'
        ? { kind: 'raw', line: Math.max(1, position.line - 1), textOffset: 0 } : { kind: 'event', offset: Math.max(0, position.offset - 1), textOffset: 0 }])}>查看前文</button></div>
  </section>;
}
