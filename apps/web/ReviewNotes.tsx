import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ReviewNotesPage } from '../../packages/contracts/review-notes.js';
import './review-notes.css';

type Request = (path: string, signal?: AbortSignal) => Promise<Response>;
export type AppendNote = (path: string, body: unknown) => Promise<Response>;
const beijing = (value: string) => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
export function ReviewNotes({ employeeId, assessmentVersion, request, appendNote }: {
  employeeId: string; assessmentVersion: string; request: Request; appendNote?: AppendNote;
}) {
  const [data, setData] = useState<ReviewNotesPage>(), [cursor, setCursor] = useState<string>(), [revision, setRevision] = useState(0);
  const [text, setText] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [saving, setSaving] = useState(false), [saved, setSaved] = useState(false);
  const submission = useRef<{ requestId: string; text: string; assessmentVersion: string } | undefined>(undefined);
  const path = `/api/employees/${employeeId}/review-notes`;
  useEffect(() => {
    const abort = new AbortController(); setBusy(true); setError('');
    request(path + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''), abort.signal).then(response => response.json()).then(value => {
      if (!abort.signal.aborted) setData(value);
    }).catch(e => { if (!abort.signal.aborted) setError(e.message); }).finally(() => { if (!abort.signal.aborted) setBusy(false); });
    return () => abort.abort();
  }, [path, cursor, revision]);
  async function save(event: FormEvent) {
    event.preventDefault(); if (!appendNote || saving || !text.trim()) return;
    if (!submission.current || submission.current.text !== text || submission.current.assessmentVersion !== assessmentVersion) submission.current = { requestId: crypto.randomUUID(), text, assessmentVersion };
    setSaving(true); setSaved(false); setError('');
    try {
      await appendNote(path, submission.current); setText(''); submission.current = undefined; setSaved(true); setCursor(undefined); setRevision(n => n + 1);
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  }
  return <section className="review-notes" aria-label="复核备注">
    <header><h2>复核备注</h2>{data && <span>{data.count} 条</span>}<button type="button" onClick={() => { setCursor(undefined); setRevision(n => n + 1); }} disabled={busy || saving}>刷新备注</button></header>
    {error && <p className="error" role="alert">{error}</p>}{busy && <p className="review-notes-status" role="status">正在读取备注…</p>}
    {data?.count === 0 && <p className="review-notes-empty">暂无备注</p>}
    {!!data?.notes.length && <ol className="review-notes-list" aria-label="备注记录" tabIndex={0}>{data.notes.map(note => <li key={note.id}>
      <div className="review-note-meta"><strong>{note.author.name}</strong><time dateTime={note.createdAt}>{beijing(note.createdAt)}</time></div>
      <p className="review-note-text">{note.text}</p>
      <a href={`#profile?employeeId=${employeeId}&version=${note.assessmentVersion}`}>所附评估</a>
    </li>)}</ol>}
    {(cursor || data?.nextCursor) && <nav aria-label="备注分页"><button type="button" disabled={!cursor || busy} onClick={() => setCursor(undefined)}>最新备注</button>
      <button type="button" disabled={!data?.nextCursor || busy} onClick={() => setCursor(data!.nextCursor!)}>更早备注</button></nav>}
    {appendNote && <form onSubmit={save}><label htmlFor={'review-note-' + employeeId}>备注内容</label>
      <textarea id={'review-note-' + employeeId} rows={3} maxLength={2000} value={text} disabled={saving} onChange={e => { setText(e.target.value); setSaved(false); }} />
      <div className="review-notes-submit"><span>{text.length}/2000</span>{saved && <span role="status">已保存</span>}<button type="submit" disabled={saving || !text.trim()}>{saving ? '正在保存…' : '保存备注'}</button></div>
    </form>}
  </section>;
}
