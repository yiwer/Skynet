import { useEffect, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import type { Manifest, SessionSummary } from '../../packages/contracts/archive.js';
import type { ActivityEvent, ActivitySummary, ActivityContext } from '../../packages/activity.js';
import { sourceLabel } from '../../packages/contracts/archive.js';
import { IdentityManagement } from './IdentityManagement.js';
import { HistoryMaterials } from './HistoryMaterials.js';
import './style.css';

type Detail = { snapshotId: string; employee: string; manifest: Manifest; committedAt: string; events: ActivityEvent[]; activity: ActivitySummary;
  unrecognizedLines: number; partialLine: boolean; nextOffset: number | null; total: number;
  recovery: { nativeRuntimeVersion: string | null; preparation: string; nativeBackend: string; limitation: string } };
const date = (value: string) => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
const contextLabel: Record<ActivityContext, string> = { historical: '历史上下文', 'after-enrollment': '接入后活动',
  'unknown-time': '来源时间未知', 'unknown-enrollment': '接入边界未知' };

function App() {
  const [credential, setCredential] = useState('');
  const [token, setToken] = useState('');
  const [name, setName] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [canManageIdentities, setCanManageIdentities] = useState(false);
  const [view, setView] = useState<'archive' | 'identities'>('archive');
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionCursor, setSessionCursor] = useState<string | null>(null);
  const [nextSessionCursor, setNextSessionCursor] = useState<string | null>(null);
  const [sessionRetry, setSessionRetry] = useState(0);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [detailRetry, setDetailRetry] = useState(0);
  const [selected, setSelected] = useState(location.hash.slice(1));
  const [offset, setOffset] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [exportStatus, setExportStatus] = useState('');
  function logout(message = '') {
    setToken(''); setName(''); setEmployeeId(''); setCanManageIdentities(false); setView('archive');
    setSessions([]); setSessionCursor(null); setNextSessionCursor(null); setDetail(null); setError(message);
  }

  useEffect(() => {
    const change = () => { setSelected(location.hash.slice(1)); setOffset(0); };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);

  async function request(path: string, access = token, signal?: AbortSignal) {
    const response = await fetch(path, { headers: { Authorization: `Bearer ${access}` }, signal });
    if (response.status === 401 && token && access === token) logout('凭据无效或已停用，请重新登录。');
    if (!response.ok) throw new Error(response.status === 401 ? '凭据无效或已停用，请重新登录。' : '暂时无法读取，请稍后重试。');
    return response;
  }
  async function login(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const user = await (await request('/api/me', credential)).json();
      setName(user.name); setEmployeeId(user.id); setCanManageIdentities(user.canManageIdentities); setToken(credential); setCredential('');
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    if (!token) return;
    const abort = new AbortController(); setBusy(true); setError('');
    request(`/api/sessions${sessionCursor ? `?cursor=${encodeURIComponent(sessionCursor)}` : ''}`, token, abort.signal).then(response => response.json()).then(data => {
      if (!abort.signal.aborted) { setSessions(previous => sessionCursor ? [...previous, ...data.sessions] : data.sessions); setNextSessionCursor(data.nextCursor); }
    }).catch(failure => { if (!abort.signal.aborted) setError(failure.message); })
      .finally(() => { if (!abort.signal.aborted) setBusy(false); });
    return () => abort.abort();
  }, [token, refresh, sessionCursor, sessionRetry]);
  useEffect(() => {
    setDetail(null); setDetailError(''); setDetailLoading(false);
    setExportError(''); setExportStatus('');
    if (!token || !selected) return;
    const abort = new AbortController(); setDetailLoading(true);
    request(`/api/snapshots/${encodeURIComponent(selected)}?offset=${offset}`, token, abort.signal)
      .then(response => response.json()).then(data => { if (!abort.signal.aborted) setDetail(data); })
      .catch(failure => { if (!abort.signal.aborted) setDetailError(failure.message); })
      .finally(() => { if (!abort.signal.aborted) setDetailLoading(false); });
    return () => abort.abort();
  }, [token, selected, offset, refresh, detailRetry]);
  async function download(kind: 'raw' | 'readable' | 'recovery') {
    if (!detail) return;
    setExporting(true); setExportError(''); setExportStatus('');
    try {
      const response = await request(`/api/snapshots/${detail.snapshotId}/${kind}`);
      const url = URL.createObjectURL(await response.blob());
      const extension = { raw: 'jsonl', readable: 'txt', recovery: 'skynet-recovery.json' }[kind];
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${detail.snapshotId}.${extension}`; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportStatus('已准备下载；保存文件后按恢复说明操作。');
    } catch (failure) { setExportError((failure as Error).message); }
    finally { setExporting(false); }
  }

  return <><header><a className="brand" href="#" onClick={() => setView('archive')}>Skynet <span>会话存档</span></a>{token && <div className="account"><span>{name}</span>
    <button onClick={() => logout()}>退出</button></div>}</header>
    <main>{!token ? <section className="login"><p className="eyebrow">工作过程，有据可查</p><h1>阅读会话原件</h1>
      <p>登录后可查看所有员工、所有项目的已提交存档。</p>
      <form onSubmit={login}><label htmlFor="credential">个人读取凭据</label><input id="credential" type="password" value={credential}
        onChange={event => setCredential(event.target.value)} autoComplete="off" required aria-describedby="credential-hint" />
        <p id="credential-hint" className="muted">使用管理员签发的读取凭据。凭据仅在当前页面内保留。</p>
        <button className="primary" disabled={busy || !credential}>{busy ? '正在验证…' : '进入存档'}</button></form></section> : <>
      <nav className="view-nav" aria-label="平台页面"><button aria-current={view === 'archive' ? 'page' : undefined} onClick={() => setView('archive')}>会话存档</button>
        {canManageIdentities && <button aria-current={view === 'identities' ? 'page' : undefined} onClick={() => setView('identities')}>接入与设备</button>}</nav>
      {view === 'identities' && canManageIdentities ? <IdentityManagement token={token} currentEmployeeId={employeeId}
        onUnauthorized={() => logout('身份已停用或凭据失效，请重新登录。')} /> : <>
      <div className="heading"><div><p className="eyebrow">共享存档 · 北京时间</p><h1>会话原件</h1></div><button disabled={busy} onClick={() => { setSessionCursor(null); setRefresh(value => value + 1); }}>{busy ? '正在刷新…' : '刷新存档'}</button></div>
      <p className="notice">当前保存单副本。原件已提交与原生恢复已验证是不同状态；Desktop 原生能力待验证。</p>
      <div className="workspace"><aside aria-label="会话列表"><h2>最近会话 <span>{sessions.length}</span></h2>
        {busy && <p role="status">正在读取存档…</p>}
        {!busy && sessions.length === 0 && <p className="muted">还没有已提交的会话。后台上传后刷新；暂存材料不会显示为已存档。</p>}
        <nav>{sessions.map(session => <a key={session.id} href={`#${session.id}`} className={`session ${selected === session.id ? 'selected' : ''}`} aria-current={selected === session.id ? 'page' : undefined}>
          <strong>{session.employee}</strong><span>{sourceLabel(session.source)}</span><span className="project">{session.project || '未归类项目'}</span><small>{date(session.committed_at)}</small><span className="badge">原件已提交</span></a>)}</nav>
        {nextSessionCursor && <button disabled={busy} onClick={() => { setSessionCursor(nextSessionCursor); setSessionRetry(value => value + 1); }}>加载更多会话</button>}
        <p className="muted small">按提交时间分页读取；刷新可查看最新快照。</p></aside>
        <article aria-label="会话详情">{!selected ? <div className="empty"><h2>选择一条会话</h2><p>阅读消息、工具结果与对应原件位置。</p></div> : detailLoading ? <p role="status">正在读取会话…</p> : detailError ? <>
          <p className="error" role="alert">{detailError}</p><button onClick={() => setDetailRetry(value => value + 1)}>重试读取会话</button>
        </> : detail && <>
          <div className="detail-heading"><div><p className="eyebrow">{detail.employee} · {sourceLabel(detail.manifest.source)}</p><h2>{detail.manifest.project || '未归类项目'}</h2></div><button disabled={exporting} onClick={() => download('raw')}>下载原件</button></div>
          <dl><div><dt>提交时间</dt><dd>{date(detail.committedAt)}</dd></div><div><dt>来源环境</dt><dd>{detail.manifest.sourceVersion} / {detail.manifest.sourceOs}</dd></div>
            <div><dt>存档范围</dt><dd>{detail.manifest.byteLength.toLocaleString()} 字节原件 · {detail.manifest.capture?.materials.length ?? 0} 项关联材料</dd></div><div><dt>SHA-256</dt><dd className="hash">{detail.manifest.hash}</dd></div></dl>
          {(detail.unrecognizedLines > 0 || detail.partialLine) && <p className="notice">{detail.unrecognizedLines} 行未解析{detail.partialLine ? '，另有未闭合的末行' : ''}。全部字节仍保存在原件中。</p>}
          <HistoryMaterials key={detail.snapshotId} snapshotId={detail.snapshotId} capture={detail.manifest.capture} request={(path, signal) => request(path, token, signal)} />
          <section className="recovery" aria-label="来源日期与活动"><h3>来源日期与活动</h3>
            <dl><div><dt>设备接入</dt><dd>{detail.activity.enrolledAt ? date(detail.activity.enrolledAt) : '未知（旧设备没有可信登记时间）'}</dd></div>
              <div><dt>宿主登记</dt><dd>{date(detail.manifest.qualifiedAt)}</dd></div>
              <div><dt>来源时间范围</dt><dd>{detail.activity.sourceFrom && detail.activity.sourceTo ? `${date(detail.activity.sourceFrom)} — ${date(detail.activity.sourceTo)}` : '未知'}</dd></div></dl>
            <p>今日活动（北京时间 {detail.activity.today.date}）：{detail.activity.today.counts
              ? `用户轮次 ${detail.activity.today.counts.userTurns} · 工具调用 ${detail.activity.today.counts.toolCalls} · 已解析条目 ${detail.activity.today.counts.records}`
              : '未知，缺少可信设备接入时间。'}</p>
            <p className="muted small">仅计入来源时间明确的接入后活动。历史上下文 {detail.activity.historicalRecords} 条、来源时间未知 {detail.activity.unknownTimeRecords} 条、接入边界未知 {detail.activity.unknownEnrollmentRecords} 条；上传与提交时间不作为工作发生时间。</p>
            <details><summary>按来源日期查看</summary><ul>{detail.activity.days.map(day => <li key={day.date}>
              <strong>{day.date}</strong>：历史上下文 {day.historicalRecords} 条；接入后用户轮次 {day.afterEnrollment.userTurns}、工具调用 {day.afterEnrollment.toolCalls}
            </li>)}</ul>{detail.activity.days.length === 0 && <p>没有可确定归属的来源日期。</p>}</details>
          </section>
          <section className="recovery" aria-label="导出与会话找回"><h3>导出与会话找回</h3>
            <p>{detail.recovery.limitation}</p>
            <p className="muted small">原生运行时：{detail.recovery.nativeRuntimeVersion ?? '未识别'}。{detail.recovery.nativeBackend === 'fixture-tested' ? '相同版本的原生运行时合成续聊已有测试；支持范围以该来源的验证记录为准。' : '该来源版本尚无原生续聊验证记录。'}</p>
            <div className="export-actions"><button disabled={exporting} onClick={() => download('readable')}>导出完整可读材料</button>
              <button disabled={exporting} onClick={() => download('recovery')}>下载恢复包</button></div>
            <p className="muted small">恢复仅允许新建隔离目录，并检查来源、目标版本、操作系统、长度与哈希。现有会话不会被覆盖；代码工作区和登录状态不在恢复范围内。</p>
            {detail.recovery.preparation !== 'candidate' && <p className="notice">当前来源或快照不满足已测恢复准备条件。可下载保存；恢复命令会给出具体原因。</p>}
            <details><summary>{detail.manifest.source === 'codex-cli' ? '查看 CLI 恢复准备步骤' : '查看恢复准备步骤'}</summary><ol><li>保存恢复包，记录上方来源版本；保留原件。</li>
              {detail.manifest.source === 'codex-cli' ? <><li>在 Windows x64 的独立测试环境安装相同 CLI 0.157.1。</li>
                <li>运行 restore，指定包、全新隔离目录、--source-version 0.157.1 和 CLI 绝对路径；校验失败时不写已有目标。</li>
                <li>以恢复目录作为新 CODEX_HOME，在自己的工作区使用原会话 ID 执行原生 resume。配置与登录独立设置；源码、依赖和附件不由此包恢复。</li>
                <li>工具返回值及代码变更仅反映原会话可提供的材料；未记录或未解析的内容不代表没有发生。</li></>
              : detail.manifest.source === 'claude-code-cli' ? <><li>在隔离环境安装相同 Claude Code CLI。当前仅有 Windows x64、2.1.281 的合成续聊记录。</li>
                <li>按部署文档运行 restore，指定包文件、全新配置目录和 Claude 可执行文件；原有配置不会被覆盖。</li>
                <li>核对恢复回执，将 CLAUDE_CONFIG_DIR 指向新目录，自行配置登录后用 --resume 和来源会话 ID 继续。关联材料及真实模型续聊仍待验证。</li></>
              : <><li>在独立测试账户或测试设备安装相同 Desktop 与内置运行时版本。仅有 Windows x64、Desktop 26.924.2738.0、运行时 0.158.0-alpha.2.1 的后端测试记录。</li>
                <li>按部署文档运行 collector 的 restore 命令，指定包文件、全新目录、Desktop 版本及原生运行时路径。</li>
                <li>检查恢复回执。Desktop 中打开并继续原会话的步骤仍待验证，当前不能据此确认 Desktop 找回成功。</li></>}</ol></details>
            {(exporting || exportStatus) && <p role="status">{exporting ? '正在准备下载…' : exportStatus}</p>}
            {exportError && <p className="error" role="alert">{exportError} 可重新点击导出重试。</p>}
          </section>
          <p className="muted">共 {detail.total} 条已解析记录。消息只代表会话中记录的内容。</p>
          {detail.events.map(event => <section className="message" key={`${event.line}:${event.block ?? 0}`}><div className="message-meta"><strong>{event.role}</strong><span>{contextLabel[event.context]}</span><span>原件第 {event.line} 行 · 来源时间：{event.timestamp ? date(event.timestamp) : '未知'}</span></div><pre>{event.text}</pre></section>)}
          {detail.events.length === 0 && <p>当前原件没有可解析的消息；可下载原件核查。</p>}
          <div className="pagination"><button disabled={offset === 0} onClick={() => setOffset(value => Math.max(0, value - 100))}>上一页</button><button disabled={detail.nextOffset === null} onClick={() => setOffset(detail.nextOffset ?? 0)}>下一页</button></div>
        </>}</article></div></>}</>}
      {error && <p className="error" role="alert">{error}</p>}</main><footer>Skynet · 完整性以实际收到的材料为准</footer></>;
}

createRoot(document.getElementById('root')!).render(<App />);
