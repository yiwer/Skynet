import { useEffect, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import type { EvidenceLine, Manifest, SessionSummary } from '../../packages/contracts/archive.js';
import './style.css';

type Detail = { snapshotId: string; employee: string; manifest: Manifest; committedAt: string; events: EvidenceLine[];
  unrecognizedLines: number; partialLine: boolean; nextOffset: number | null; total: number };
const date = (value: string) => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });

function App() {
  const [credential, setCredential] = useState('');
  const [token, setToken] = useState('');
  const [name, setName] = useState('');
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [detailRetry, setDetailRetry] = useState(0);
  const [selected, setSelected] = useState(location.hash.slice(1));
  const [offset, setOffset] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const change = () => { setSelected(location.hash.slice(1)); setOffset(0); };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);

  async function request(path: string, access = token, signal?: AbortSignal) {
    const response = await fetch(path, { headers: { Authorization: `Bearer ${access}` }, signal });
    if (!response.ok) throw new Error(response.status === 401 ? '凭据无效或已停用，请重新登录。' : '暂时无法读取，请稍后重试。');
    return response;
  }
  async function login(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const user = await (await request('/api/me', credential)).json();
      setName(user.name); setToken(credential); setCredential('');
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    if (!token) return;
    const abort = new AbortController(); setBusy(true); setError('');
    request('/api/sessions', token, abort.signal).then(response => response.json()).then(data => {
      if (!abort.signal.aborted) setSessions(data.sessions);
    }).catch(failure => { if (!abort.signal.aborted) setError(failure.message); })
      .finally(() => { if (!abort.signal.aborted) setBusy(false); });
    return () => abort.abort();
  }, [token, refresh]);
  useEffect(() => {
    setDetail(null); setDetailError(''); setDetailLoading(false);
    if (!token || !selected) return;
    const abort = new AbortController(); setDetailLoading(true);
    request(`/api/snapshots/${encodeURIComponent(selected)}?offset=${offset}`, token, abort.signal)
      .then(response => response.json()).then(data => { if (!abort.signal.aborted) setDetail(data); })
      .catch(failure => { if (!abort.signal.aborted) setDetailError(failure.message); })
      .finally(() => { if (!abort.signal.aborted) setDetailLoading(false); });
    return () => abort.abort();
  }, [token, selected, offset, refresh, detailRetry]);
  async function download() {
    if (!detail) return;
    try {
      const response = await request(`/api/snapshots/${detail.snapshotId}/raw`);
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${detail.snapshotId}.jsonl`; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) { setError((failure as Error).message); }
  }

  return <><header><a className="brand" href="#">Skynet <span>会话存档</span></a>{token && <div className="account"><span>{name}</span>
    <button onClick={() => { setToken(''); setName(''); setSessions([]); setDetail(null); setError(''); }}>退出</button></div>}</header>
    <main>{!token ? <section className="login"><p className="eyebrow">工作过程，有据可查</p><h1>阅读会话原件</h1>
      <p>登录后可查看所有员工、所有项目的已提交存档。</p>
      <form onSubmit={login}><label htmlFor="credential">个人读取凭据</label><input id="credential" type="password" value={credential}
        onChange={event => setCredential(event.target.value)} autoComplete="off" required aria-describedby="credential-hint" />
        <p id="credential-hint" className="muted">使用管理员签发的读取凭据。凭据仅在当前页面内保留。</p>
        <button className="primary" disabled={busy || !credential}>{busy ? '正在验证…' : '进入存档'}</button></form></section> : <>
      <div className="heading"><div><p className="eyebrow">共享存档 · 北京时间</p><h1>会话原件</h1></div><button disabled={busy} onClick={() => setRefresh(value => value + 1)}>{busy ? '正在刷新…' : '刷新存档'}</button></div>
      <p className="notice">当前保存单副本。原件已提交与原生恢复已验证是不同状态；Desktop 原生能力待验证。</p>
      <div className="workspace"><aside aria-label="会话列表"><h2>最近会话 <span>{sessions.length}</span></h2>
        {busy && <p role="status">正在读取存档…</p>}
        {!busy && sessions.length === 0 && <p className="muted">还没有已提交的会话。后台上传后刷新；暂存材料不会显示为已存档。</p>}
        <nav>{sessions.map(session => <a key={session.id} href={`#${session.id}`} className={`session ${selected === session.id ? 'selected' : ''}`} aria-current={selected === session.id ? 'page' : undefined}>
          <strong>{session.employee}</strong><span className="project">{session.project || '未归类项目'}</span><small>{date(session.committed_at)}</small><span className="badge">原件已提交</span></a>)}</nav>
        <p className="muted small">最多显示最近 100 条会话。</p></aside>
        <article aria-label="会话详情">{!selected ? <div className="empty"><h2>选择一条会话</h2><p>阅读消息、工具结果与对应原件位置。</p></div> : detailLoading ? <p role="status">正在读取会话…</p> : detailError ? <>
          <p className="error" role="alert">{detailError}</p><button onClick={() => setDetailRetry(value => value + 1)}>重试读取会话</button>
        </> : detail && <>
          <div className="detail-heading"><div><p className="eyebrow">{detail.employee} · Codex Desktop</p><h2>{detail.manifest.project || '未归类项目'}</h2></div><button onClick={download}>下载原件</button></div>
          <dl><div><dt>提交时间</dt><dd>{date(detail.committedAt)}</dd></div><div><dt>来源环境</dt><dd>{detail.manifest.sourceVersion} / {detail.manifest.sourceOs}</dd></div>
            <div><dt>存档范围</dt><dd>{detail.manifest.byteLength.toLocaleString()} 字节 · 当前收到的单个原件</dd></div><div><dt>SHA-256</dt><dd className="hash">{detail.manifest.hash}</dd></div></dl>
          {(detail.unrecognizedLines > 0 || detail.partialLine) && <p className="notice">{detail.unrecognizedLines} 行未解析{detail.partialLine ? '，另有未闭合的末行' : ''}。全部字节仍保存在原件中。</p>}
          <p className="muted">共 {detail.total} 条已解析记录。消息只代表会话中记录的内容。</p>
          {detail.events.map(event => <section className="message" key={event.line}><div className="message-meta"><strong>{event.role}</strong><span>原件第 {event.line} 行{event.timestamp ? ` · ${date(event.timestamp)}` : ''}</span></div><pre>{event.text}</pre></section>)}
          {detail.events.length === 0 && <p>当前原件没有可解析的消息；可下载原件核查。</p>}
          <div className="pagination"><button disabled={offset === 0} onClick={() => setOffset(value => Math.max(0, value - 100))}>上一页</button><button disabled={detail.nextOffset === null} onClick={() => setOffset(detail.nextOffset ?? 0)}>下一页</button></div>
        </>}</article></div></>}
      {error && <p className="error" role="alert">{error}</p>}</main><footer>Skynet · 完整性以实际收到的材料为准</footer></>;
}

createRoot(document.getElementById('root')!).render(<App />);
