import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import type { SessionSummary } from '../../packages/contracts/archive.js';
import { IdentityManagement } from './IdentityManagement.js';
import { DeviceDelivery } from './DeviceDelivery.js';
import './style.css';
import './platform-tokens.css';
import './platform-shell.css';
import './conversation.css';
import { PlatformShell } from './PlatformShell.js';
import { SessionDetail, type Detail } from './SessionDetail.js';
import { SessionIndex } from './SessionIndex.js';
import { RecoveryFlow } from './RecoveryFlow.js';
import { ArchiveSearch } from './ArchiveSearch.js';
import { selectedEvidence } from './EvidenceReader.js';
import { AnalysisOperations } from './AnalysisOperations.js';
import { DailyReports } from './DailyReports.js';
import { TeamCoverage } from './TeamCoverage.js';
import { WorkViews } from './WorkViews.js';
import { ServerOperations } from './ServerOperations.js';
import { UsageMetrics } from './UsageMetrics.js';
import { DataProcessing } from './Assembly.js';
import { WaitingReport } from './WaitingReport.js';
import { SessionEfficiency } from './SessionEfficiency.js';
import { CapabilityAssessment } from './CapabilityAssessment.js';
import {PromptReportPage} from './PromptReport.js';
import { ActivityRecords } from './ActivityRecords.js';
import './product-polish.css';

function App() {
  const [credential, setCredential] = useState('');
  const [token, setToken] = useState('');
  const [name, setName] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [canManageIdentities, setCanManageIdentities] = useState(false);
  type View='archive'|'identities'|'delivery'|'daily'|'analysis'|'work'|'coverage'|'server'|'metrics'|'recovery'|'pipeline'|'waits'|'prompts'|'efficiency'|'activity'|'profile';
  const hashView=():View=>{const head=location.hash.slice(1).split('?')[0];const aliases:Record<string,View>={profile:'profile',prompts:'prompts',activity:'activity',efficiency:'efficiency',waits:'waits',metrics:'metrics',usage:'metrics',daily:'daily',work:'work',project:'work',team:'coverage',coverage:'coverage',devices:'identities',identities:'identities',pipeline:'pipeline',delivery:'delivery',ops:'analysis',analysis:'analysis',server:'server',recovery:'recovery'};return aliases[head??'']??'archive';};
  const snapshotFromHash=()=>{const head=location.hash.slice(1).split('?')[0]??'';return /^[a-f0-9-]{36}$/.test(head)?head:'';};
  const searchDialog=useRef<HTMLDialogElement>(null);
  const [searchOpen,setSearchOpen]=useState(false);
  function openSearch(){setSearchOpen(true);}
  useEffect(()=>{if(searchOpen){searchDialog.current?.showModal();searchDialog.current?.querySelector<HTMLInputElement>('input[type=search]')?.focus();}else searchDialog.current?.close();},[searchOpen]);
  function navigate(next:string){location.hash=next==='archive'?'sessions':next;setView(next as View);setSelected('');setSearchOpen(false);}

  const [view, setView] = useState<View>(hashView);
  const hashReading = (): 'conversation' | 'timeline' | 'raw' => {
    const selected = new URLSearchParams(location.hash.split('?')[1]).get('view');
    return selected === 'raw' ? 'raw' : selected === 'timeline' || selectedEvidence(location.hash) ? 'timeline' : 'conversation';
  };
  const [reading, setReading] = useState(hashReading);
  const [conversationHash, setConversationHash] = useState(location.hash);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionCursor, setSessionCursor] = useState<string | null>(null);
  const [nextSessionCursor, setNextSessionCursor] = useState<string | null>(null);
  const [sessionRetry, setSessionRetry] = useState(0);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [detailRetry, setDetailRetry] = useState(0);
  const [selected, setSelected] = useState(snapshotFromHash);
  const [evidenceLocation, setEvidenceLocation] = useState(() => selectedEvidence(location.hash));
  const [offset, setOffset] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [exportStatus, setExportStatus] = useState('');
  function logout(message = '') {
    setSearchOpen(false);
    setBusy(false);
    setToken(''); setName(''); setEmployeeId(''); setCanManageIdentities(false); setView('archive');
    setSessions([]); setSessionCursor(null); setNextSessionCursor(null); setDetail(null); setError(message);
  }

  useEffect(() => {
    const change = () => { const next = hashView(); setView(next); setSelected(next === 'archive' ? snapshotFromHash() : ''); setSearchOpen(false); setEvidenceLocation(next === 'archive' ? selectedEvidence(location.hash) : null); setReading(hashReading()); setConversationHash(location.hash); setOffset(0); };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);

  async function request(path: string, access = token, signal?: AbortSignal, method?: 'POST',body?:unknown) {
    const response = await fetch(path, { method, headers: { Authorization: `Bearer ${access}`, ...(method ? { 'Content-Type': 'application/json' } : {}) }, signal, ...(method ? { body: JSON.stringify(body??{}) } : {}) });
    if (response.status === 401 && token && access === token) logout('凭据无效或已停用，请重新登录。');
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(response.status === 401 ? '凭据无效或已停用，请重新登录。'
        : typeof body?.error === 'string' ? body.error : '暂时无法读取，请稍后重试。');
    }
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
    request(`/api/snapshots/${encodeURIComponent(selected)}?offset=${offset}${evidenceLocation || reading !== 'timeline' ? '&summary=true' : ''}`, token, abort.signal)
      .then(response => response.json()).then(data => { if (!abort.signal.aborted) setDetail(data); })
      .catch(failure => { if (!abort.signal.aborted) setDetailError(failure.message); })
      .finally(() => { if (!abort.signal.aborted) setDetailLoading(false); });
    return () => abort.abort();
  }, [token, selected, offset, evidenceLocation, reading, refresh, detailRetry]);
  async function download(kind: 'raw' | 'readable' | 'recovery') {
    if (!detail) return;
    setExporting(true); setExportError(''); setExportStatus('');
    try {
      const response = await request(`/api/snapshots/${detail.snapshotId}/${kind}`);
      const url = URL.createObjectURL(await response.blob());
      const extension = { raw: 'jsonl', readable: 'txt', recovery: 'skynet-recovery.json' }[kind];
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${detail.snapshotId}.${extension}`; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportStatus('下载已准备');
    } catch (failure) { setExportError((failure as Error).message); }
    finally { setExporting(false); }
  }

  return <PlatformShell authenticated={!!token} name={name} canManageIdentities={canManageIdentities} view={view} onNavigate={navigate} onLogout={()=>logout()} onSearch={openSearch}>
    {!token?<section className="login"><h1>登录 Skynet</h1><form onSubmit={login}><label htmlFor="credential">个人读取凭据</label><input id="credential" type="password" value={credential} onChange={event=>setCredential(event.target.value)} autoComplete="off" required/><button className="primary" disabled={busy||!credential}>{busy?'正在验证…':'进入存档'}</button></form></section>:<>
    {view==='metrics'?<UsageMetrics key={token} request={(path,signal,method,body)=>request(path,token,signal,method,body)}/>
    :view==='profile'?<CapabilityAssessment currentEmployeeId={employeeId} request={(path,signal)=>request(path,token,signal)} appendNote={(path,body)=>request(path,token,undefined,'POST',body)}/>
    :view==='activity'?<ActivityRecords key={token} hash={conversationHash} request={(path,signal,method,body)=>request(path,token,signal,method,body)}/>
    :view==='waits'?<WaitingReport key={token} request={(path,signal,method,body)=>request(path,token,signal,method,body)}/>
    :view==='efficiency'?<SessionEfficiency key={token} request={(path,signal,method,body)=>request(path,token,signal,method,body)}/>
    :view==='prompts'?<PromptReportPage key={token} request={(path,signal,method,body)=>request(path,token,signal,method,body)}/>
    :view==='pipeline'?<DataProcessing request={(path,signal)=>request(path,token,signal)}/>
    :view==='server'?<ServerOperations request={(path,signal)=>request(path,token,signal)}/>
    :view==='coverage'?<TeamCoverage currentEmployeeId={employeeId} request={(path,signal)=>request(path,token,signal)} onEvidence={()=>navigate('archive')}/>
    :view==='analysis'?<AnalysisOperations request={(path,signal)=>request(path,token,signal)}/>
    :view==='work'?<WorkViews currentEmployeeId={employeeId} request={(path,signal,method)=>request(path,token,signal,method)} onEvidence={()=>navigate('archive')}/>
    :view==='daily'?<DailyReports currentEmployeeId={employeeId} request={(path,signal,method,body)=>request(path,token,signal,method,body)} onEvidence={()=>navigate('archive')}/>
    :view==='delivery'?<DeviceDelivery token={token} onUnauthorized={()=>logout('身份已停用或凭据失效，请重新登录。')}/>
    :view==='recovery'?<RecoveryFlow key={conversationHash} sessions={sessions} hasMore={!!nextSessionCursor} onLoadMore={()=>{setSessionCursor(nextSessionCursor);setSessionRetry(value=>value+1);}} request={(path,signal)=>request(path,token,signal)}/>
    :view==='identities'&&canManageIdentities?<IdentityManagement token={token} currentEmployeeId={employeeId} onDelivery={()=>navigate('delivery')} onUnauthorized={()=>logout('身份已停用或凭据失效，请重新登录。')}/>
    :selected?<>{detailLoading?<p role="status">正在读取会话…</p>:detailError?<><p className="error" role="alert">{detailError}</p><button onClick={()=>setDetailRetry(value=>value+1)}>重试读取会话</button></>:detail&&<SessionDetail detail={detail} reading={reading} conversationHash={conversationHash} refresh={refresh} offset={offset} evidenceLocation={evidenceLocation} setOffset={setOffset} request={(path,signal,method,body)=>request(path,token,signal,method,body)} download={download} exporting={exporting} exportStatus={exportStatus} exportError={exportError}/>}</>
    :<SessionIndex sessions={sessions} busy={busy} recovery={false} hasMore={!!nextSessionCursor} onLoadMore={()=>{setSessionCursor(nextSessionCursor);setSessionRetry(value=>value+1);}} onRefresh={()=>{setSessionCursor(null);setRefresh(value=>value+1);}} onSearch={openSearch}/>}
    <dialog className="archive-search-dialog" ref={searchDialog} onCancel={()=>setSearchOpen(false)} onClose={event=>{if(!event.currentTarget.open)setSearchOpen(false);}} onClick={event=>{if(event.target===event.currentTarget)setSearchOpen(false);}} aria-label="搜索存档"><div><div className="search-dialog-heading"><h2>搜索存档</h2><button aria-label="关闭搜索" onClick={()=>setSearchOpen(false)}>关闭</button></div>{searchOpen&&<ArchiveSearch key={token} request={(path,signal)=>request(path,token,signal)}/>}</div></dialog>
    </>}{error&&<p className="error" role="alert">{error}</p>}
  </PlatformShell>;
}
createRoot(document.getElementById('root')!).render(<App/>);
