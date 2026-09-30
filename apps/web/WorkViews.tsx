import { useEffect, useState } from 'react';
import { analysisLabels, assessmentLabels } from '../../packages/contracts/analysis.js';
import { beijingDate } from '../../packages/contracts/reports.js';
import { addDays, dueWeek, monday, type WorkView, type WorkViewItem } from '../../packages/contracts/work-views.js';

export function WorkViews({ request, currentEmployeeId, onEvidence }: {
  request: (path: string, signal?: AbortSignal, method?: 'POST') => Promise<Response>; currentEmployeeId: string; onEvidence: () => void;
}) {
  const query = () => new URLSearchParams(location.hash.startsWith('#work?') ? location.hash.slice(6) : '');
  const [kind, setKind] = useState<'weekly' | 'project'>(query().get('kind') === 'project' ? 'project' : 'weekly');
  const [employeeId, setEmployeeId] = useState(query().get('kind') === 'weekly' ? query().get('subject') ?? currentEmployeeId : currentEmployeeId);
  const [project, setProject] = useState(query().get('kind') === 'project' ? query().get('subject') ?? '' : '');
  const [from, setFrom] = useState(query().get('from') ?? dueWeek());
  const [to, setTo] = useState(query().get('to') ?? addDays(dueWeek(), 6));
  const [revision, setRevision] = useState(query().get('revision') ?? '');
  const [employees, setEmployees] = useState<{ id: string; name: string }[]>([]); const [employeeOffset, setEmployeeOffset] = useState<number | null>(null);
  const [projects, setProjects] = useState<{ project: string; label: string }[]>([]); const [projectOffset, setProjectOffset] = useState<number | null>(null);
  const [view, setView] = useState<WorkView | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [refresh, setRefresh] = useState(0);
  const params = new URLSearchParams({ kind, subject: kind === 'weekly' ? employeeId : project, from, to }); const path = `/api/work-view?${params}`;
  useEffect(() => {
    const change = () => { if (!location.hash.startsWith('#work?')) return; const value = query(); const next = value.get('kind') === 'project' ? 'project' : 'weekly';
      setKind(next); if (next === 'weekly') setEmployeeId(value.get('subject') ?? currentEmployeeId); else setProject(value.get('subject') ?? '');
      setFrom(value.get('from') ?? dueWeek()); setTo(value.get('to') ?? addDays(dueWeek(), 6)); setRevision(value.get('revision') ?? ''); };
    window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change);
  }, [currentEmployeeId]);
  useEffect(() => {
    const abort = new AbortController();
    request('/api/daily-report-employees', abort.signal).then(response => response.json()).then(value => { if (!abort.signal.aborted) { setEmployees(value.employees); setEmployeeOffset(value.nextOffset); } }).catch(failure => { if (!abort.signal.aborted) setError(failure.message); });
    request('/api/work-projects', abort.signal).then(response => response.json()).then(value => { if (!abort.signal.aborted) { setProjects(value.projects); setProjectOffset(value.nextOffset); } }).catch(failure => { if (!abort.signal.aborted) setError(failure.message); });
    return () => abort.abort();
  }, []);
  useEffect(() => {
    const abort = new AbortController(); setBusy(true); setError(''); setView(null);
    request(`${path}${revision ? `&revision=${revision}` : ''}`, abort.signal).then(response => response.json()).then(value => { if (!abort.signal.aborted) setView(value); })
      .catch(failure => { if (!abort.signal.aborted) setError(failure.message); }).finally(() => { if (!abort.signal.aborted) setBusy(false); });
    return () => abort.abort();
  }, [path, revision, refresh]);
  useEffect(() => { if (revision || !view || !view.refreshPending && !['queued', 'waiting-analysis'].includes(view.state)) return;
    const timer = setTimeout(() => setRefresh(value => value + 1), 5000); return () => clearTimeout(timer); }, [view]);
  async function generate() { setBusy(true); setError(''); try { setRevision(''); setView(await (await request(path, undefined, 'POST')).json()); }
    catch (failure) { setError((failure as Error).message); } finally { setBusy(false); } }
  async function more() { if (!view || view.nextOffset === null) return; setBusy(true); try {
    const next: WorkView = await (await request(`${path}&revision=${view.revision}&offset=${view.nextOffset}`)).json(); setView({ ...next, items: [...view.items, ...next.items] });
  } catch (failure) { setError((failure as Error).message); } finally { setBusy(false); } }
  const groups = new Map<string, WorkViewItem[]>();
  for (const item of view?.items ?? []) {
    const key = JSON.stringify([item.project, item.theme, ...(item.continuation === 'unassigned' ? [item.employeeId, item.sourceDate, item.analysisId, item.text] : [])]);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const states = { 'not-scheduled': '尚未入队', queued: '已入队', 'waiting-analysis': '等待分析', ready: '本版已生成', partial: '材料或分析不完整', unavailable: '尚无法生成主题' };
  return <section aria-label="周工作与项目"><h1>周工作与项目</h1><p>周一北京时间 09:00 入队前一周（周一至周日），入队不保证届时完成。工作主题引用原始员工和来源日期。</p>
    <label>查看范围<select value={kind} onChange={event => { setKind(event.target.value as typeof kind); setRevision(''); }}><option value="weekly">员工周工作</option><option value="project">项目进展</option></select></label>
    {kind === 'weekly' ? <><label>员工<select value={employeeId} onChange={event => { setEmployeeId(event.target.value); setRevision(''); }}>
      {!employees.some(employee => employee.id === employeeId) && <option value={employeeId}>当前员工</option>}{employees.map(employee => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></label>
      {employeeOffset !== null && <button onClick={async () => { try { const value = await (await request(`/api/daily-report-employees?offset=${employeeOffset}`)).json(); setEmployees(previous => [...previous, ...value.employees]); setEmployeeOffset(value.nextOffset); } catch (failure) { setError((failure as Error).message); } }}>更多员工</button>}</>
      : <><label>项目<select value={project} onChange={event => { setProject(event.target.value); setRevision(''); }}>{!projects.some(value => value.project === project) && <option value={project}>{project || '未归类项目'}</option>}{projects.map(value => <option key={value.project} value={value.project}>{value.label}</option>)}</select></label>
        {projectOffset !== null && <button onClick={async () => { try { const value = await (await request(`/api/work-projects?offset=${projectOffset}`)).json(); setProjects(previous => [...previous, ...value.projects]); setProjectOffset(value.nextOffset); } catch (failure) { setError((failure as Error).message); } }}>更多项目</button>}</>}
    <label>{kind === 'weekly' ? '周起始日期（周一）' : '起始来源日期'}<input type="date" value={from} max={beijingDate()} onChange={event => { if (!event.target.value) return; const date = kind === 'weekly' ? monday(event.target.value) : event.target.value; setFrom(date); if (kind === 'weekly') setTo(addDays(date, 6)); setRevision(''); }} /></label>
    <label>结束来源日期<input type="date" value={to} disabled={kind === 'weekly'} onChange={event => { setTo(event.target.value); setRevision(''); }} /></label>
    <label>历史版本（留空读取最新）<input type="number" min="1" value={revision} onChange={event => setRevision(event.target.value)} /></label>
    <button disabled={busy} onClick={() => setRefresh(value => value + 1)}>刷新视图</button><button disabled={busy} onClick={generate}>请求区间生成</button>
    {busy && <p role="status">正在读取…</p>}{error && <p role="alert">{error}</p>}
    {view && <><h2>{view.subjectLabel} · {view.from} 至 {view.to}</h2><p role="status">{states[view.state]} · 版本 {view.revision}</p>
      {view.refreshPending && <p>刷新已入队，当前显示已保存版本。</p>}{view.coverage?.fixture && <p className="notice">合成演示，非正式验收；没有调用真实千问。</p>}
      <p>参与者：{view.participants.map(participant => `${participant.employee}（${participant.dates.join('、')}）`).join('；') || '尚无已确认参与活动，不能推断无工作。'}</p>
      {view.statistics && !view.statistics.complete && <p>统计仅为当前已选日报版本的已知计数；未覆盖部分未知。</p>}
      {view.statistics && <><dl><div><dt>已确认记录</dt><dd>{view.statistics.records ?? '未知'}</dd></div><div><dt>用户轮次</dt><dd>{view.statistics.userTurns ?? '未知'}</dd></div><div><dt>工具调用</dt><dd>{view.statistics.toolCalls ?? '未知'}</dd></div></dl><p className="muted">{view.statistics.definition}</p><p>文件数、原生 token、活动区间、人工工时：未知。</p></>}
      {view.coverage?.messages.map(message => <p className="notice" key={message}>{message}</p>)}
      {[...groups].map(([key, items]) => <section key={key}><h3>{items[0]!.project || '未归类项目'} · {items[0]!.theme}</h3>
        <p className="muted">{items[0]!.continuation === 'unassigned' ? '主题关系未确认，保留独立事项。' : '跨日同主题为推断关联；保留逐日事项与证据。'}</p>
        {items.map((item, index) => <div key={`${item.analysisId}/${index}`}><h4>{item.sourceDate} · {item.employee} · {analysisLabels[item.category]} · {assessmentLabels[item.assessment]}</h4><p>{item.text}</p>
          <p><a href={item.dailyPath}>核查日报 v{item.dailyRevision}</a></p>{item.citations.map((citation, i) => <p key={i}><a href={citation.webPath} onClick={onEvidence}>核查原句 · {citation.origin?.employee} · {citation.origin?.sourceDate}</a><q>{citation.quote}</q></p>)}
          {!!item.backgroundCitations.length && <details><summary>背景引用（不计本项活动）</summary>{item.backgroundCitations.map((citation, i) => <p key={i}><a href={citation.webPath} onClick={onEvidence}>{citation.origin?.employee ?? '归属未知'} · {citation.origin?.sourceDate ?? '日期未知'}</a><q>{citation.quote}</q></p>)}</details>}
        </div>)}</section>)}
      {!view.items.length && <p>尚无区间证据支持的工作主题；不能推断目标、成果、阻塞或待继续事项为零。</p>}
      {view.nextOffset !== null && <button disabled={busy} onClick={more}>读取本版更多事项</button>}
      {!!view.coverage?.days.length && <details><summary>固定日报来源与覆盖</summary>{view.coverage.days.map(day => <p key={`${day.employeeId}/${day.date}`}><a href={day.dailyPath}>{day.employee} · {day.date} · 日报 v{day.revision}</a> · {day.state} · {day.eligibleInputsComplete ? '已选输入已处理' : '仍有未知范围'}</p>)}</details>}
      {view.version && <><p><a href={`#work?${params}&revision=${view.revision}`}>本版永久链接</a></p><p className="muted small">不可变版本标识：{view.version}</p></>}
    </>}
  </section>;
}
