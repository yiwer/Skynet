import {ProfileSourceReturn,carryProfileSourceReturn} from './profile-source-navigation.js';
import {WeeklyUsage} from './TeamUsage.js';
import { useEffect, useState } from 'react';
import { analysisLabels, assessmentLabels } from '../../packages/contracts/analysis.js';
import { beijingDate } from '../../packages/contracts/reports.js';
import { addDays, dueWeek, monday, type WorkView, type WorkViewItem } from '../../packages/contracts/work-views.js';
import {FrozenStatistics} from './FrozenStatistics.js';
import {useFixedRevisionReader} from './useFixedRevisionReader.js';
import './work-reports.css';

export function WorkViews({ request, currentEmployeeId, onEvidence }: {
  request: (path: string, signal?: AbortSignal, method?: 'POST') => Promise<Response>; currentEmployeeId: string; onEvidence: () => void;
}) {
  const query = () => new URLSearchParams(location.hash.startsWith('#work?') ? location.hash.slice(6) : '');
  const [kind, setKind] = useState<'weekly' | 'project'>(query().get('kind') === 'weekly' ? 'weekly' : 'project');
  const [browsingProjects, setBrowsingProjects] = useState(!query().has('subject') && query().get('kind') !== 'weekly');
  const [employeeId, setEmployeeId] = useState(query().get('kind') === 'weekly' ? query().get('subject') ?? currentEmployeeId : currentEmployeeId);
  const [project, setProject] = useState(query().get('kind') === 'project' ? query().get('subject') ?? '' : '');
  const [from, setFrom] = useState(query().get('from') ?? dueWeek());
  const [to, setTo] = useState(query().get('to') ?? addDays(dueWeek(), 6));
  const [revision, setRevision] = useState(query().get('revision') ?? '');const [usageRefresh,setUsageRefresh]=useState(0);
  const [employees, setEmployees] = useState<{ id: string; name: string }[]>([]); const [employeeOffset, setEmployeeOffset] = useState<number | null>(null);
  const [projects, setProjects] = useState<{ project: string; label: string }[]>([]); const [projectOffset, setProjectOffset] = useState<number | null>(null);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [listError, setError] = useState('');
  const params = new URLSearchParams({ kind, subject: kind === 'weekly' ? employeeId : project, from, to }); const path = `/api/work-view?${params}`;
  const reader=useFixedRevisionReader<WorkView>({identity:`${path}/${revision}`,enabled:!browsingProjects,load:async signal=>(await request(`${path}${revision ? `&revision=${revision}` : ''}`,signal)).json(),
    poll:value=>!revision&&(!!value.refreshPending||['queued','waiting-analysis'].includes(value.state))});
  const view=reader.data,busy=reader.loading,error=reader.error||listError;
  useEffect(() => {
    const change = () => { if (location.hash === '#work') { setKind('project'); setBrowsingProjects(true); return; } if (!location.hash.startsWith('#work?')) return; const value = query(); const next = value.get('kind') === 'project' ? 'project' : 'weekly';
      setBrowsingProjects(false);
      setKind(next); if (next === 'weekly') setEmployeeId(value.get('subject') ?? currentEmployeeId); else setProject(value.get('subject') ?? '');
      setFrom(value.get('from') ?? dueWeek()); setTo(value.get('to') ?? addDays(dueWeek(), 6)); setRevision(value.get('revision') ?? ''); };
    window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change);
  }, [currentEmployeeId]);
  useEffect(() => {
    const abort = new AbortController();
    request('/api/daily-report-employees', abort.signal).then(response => response.json()).then(value => { if (!abort.signal.aborted) { setEmployees(value.employees); setEmployeeOffset(value.nextOffset); } }).catch(failure => { if (!abort.signal.aborted) setError(failure.message); });
    request('/api/work-projects', abort.signal).then(response => response.json()).then(value => { if (!abort.signal.aborted) { setProjects(value.projects); setProjectOffset(value.nextOffset); setProjectsLoaded(true); } }).catch(failure => { if (!abort.signal.aborted) setError(failure.message); });
    return () => abort.abort();
  }, []);
  async function generate(){if(await reader.run(async signal=>(await request(path,signal,'POST')).json())){setRevision('');reader.retry();}}
  async function more(){if(!view||view.nextOffset===null)return;
    await reader.run(async signal=>{const next:WorkView=await (await request(`${path}&revision=${view.revision}&offset=${view.nextOffset}`,signal)).json();
      if(next.version!==view.version||next.revision!==view.revision)throw new Error('固定工作视图版本不匹配，请重试本版');return {...next,items:[...view.items,...next.items]};});}
  const groups = new Map<string, WorkViewItem[]>();
  for (const item of view?.items ?? []) {
    const key = JSON.stringify([item.project, item.theme, ...(item.continuation === 'unassigned' ? [item.employeeId, item.sourceDate, item.analysisId, item.text] : [])]);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const states = { 'not-scheduled': '尚未入队', queued: '已入队', 'waiting-analysis': '等待分析', ready: '本版已生成', partial: '材料或分析不完整', unavailable: '尚无法生成主题' };
  const employeeName = employees.find(employee => employee.id === employeeId)?.name ?? '员工';
  const subjectName = kind === 'weekly' ? employeeName : (projects.find(value => value.project === project)?.label ?? project) || '未归类项目';
  const hasStatistics = !!view?.statistics && (view.statistics.records ?? 0) > 0;
  const sourceDays = view?.kind === 'weekly' ? view.coverage?.days.filter(day => day.revision > 0 && day.workStatistics) ?? [] : [];
  return <section className="work-report workspace-page" aria-label="周工作与项目"><ProfileSourceReturn/>
    {kind === 'weekly' && employees.length > 1 && <nav className="report-people" aria-label="切换员工">{employees.map(employee => <button key={employee.id} aria-pressed={employee.id === employeeId} onClick={() => { setEmployeeId(employee.id); setRevision(''); }}><span className="report-avatar" aria-hidden="true">{Array.from(employee.name)[0]}</span>{employee.name}</button>)}</nav>}
    <header className="report-page-heading"><div>{!browsingProjects && <p className="report-crumbs"><a href={kind === 'weekly' ? '#coverage' : '#work'}>{kind === 'weekly' ? '团队概览' : '项目'}</a><span>/</span>{kind === 'weekly' ? '周视图' : subjectName}</p>}<h1>{!browsingProjects && kind === 'weekly' && <span className="report-avatar report-avatar-large" aria-hidden="true">{Array.from(employeeName)[0]}</span>}{browsingProjects ? '项目' : subjectName}</h1></div><div className="report-actions">{!browsingProjects && <><button disabled={busy} onClick={()=>{reader.retry();setUsageRefresh(value=>value+1);}}>刷新视图</button><button disabled={busy} onClick={generate}>生成报告</button></>}</div></header>
    <div className="report-control-row"><nav className="report-mode" aria-label="工作视图类型"><button aria-pressed={kind === 'project'} onClick={() => { setKind('project'); setBrowsingProjects(true); setRevision(''); }}>项目</button><button aria-pressed={kind === 'weekly'} onClick={() => { setKind('weekly'); setBrowsingProjects(false); setFrom(monday(from)); setTo(addDays(monday(from), 6)); setRevision(''); }}>员工周工作</button></nav>{kind === 'weekly' && <nav className="report-mode" aria-label="查看方式"><a href={carryProfileSourceReturn(`#daily?${new URLSearchParams({ employeeId, date: from })}`)}>日报</a><span aria-current="page">周视图</span></nav>}</div>
    {!browsingProjects && <div className="report-filter-bar">
      {kind === 'weekly' ? <><label>员工<select value={employeeId} onChange={event => { setEmployeeId(event.target.value); setRevision(''); }}>{!employees.some(employee => employee.id === employeeId) && <option value={employeeId}>当前员工</option>}{employees.map(employee => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></label>{employeeOffset !== null && <button onClick={async () => { try { const value = await (await request(`/api/daily-report-employees?offset=${employeeOffset}`)).json(); setEmployees(previous => [...previous, ...value.employees]); setEmployeeOffset(value.nextOffset); } catch (failure) { setError((failure as Error).message); } }}>更多员工</button>}</>
      : <><label>项目<select value={project} onChange={event => { setProject(event.target.value); setRevision(''); }}>{!projects.some(value => value.project === project) && <option value={project}>{project || '未归类项目'}</option>}{projects.map(value => <option key={value.project} value={value.project}>{value.label}</option>)}</select></label>{projectOffset !== null && <button onClick={async () => { try { const value = await (await request(`/api/work-projects?offset=${projectOffset}`)).json(); setProjects(previous => [...previous, ...value.projects]); setProjectOffset(value.nextOffset); } catch (failure) { setError((failure as Error).message); } }}>更多项目</button>}</>}
      <label>{kind === 'weekly' ? '周起始日期（周一）' : '起始来源日期'}<input type="date" value={from} max={beijingDate()} onChange={event => { if (!event.target.value) return; const date = kind === 'weekly' ? monday(event.target.value) : event.target.value; setFrom(date); if (kind === 'weekly') setTo(addDays(date, 6)); setRevision(''); }} /></label>
      {kind === 'project' ? <label>结束来源日期<input type="date" value={to} onChange={event => { if (event.target.value) { setTo(event.target.value); setRevision(''); } }} /></label> : <span className="report-range-end">至 {to}</span>}
    </div>}
    <div className="workspace-scroll report-scroll">
    {browsingProjects ? <><ul className="report-project-list">{projects.map(value => <li key={value.project}><button onClick={() => { setProject(value.project); setBrowsingProjects(false); setRevision(''); }}><span><span><b>{value.label}</b>{value.project !== value.label && value.project && <small className="report-project-path">{value.project}</small>}</span></span><span className="report-project-arrow" aria-hidden="true">→</span></button></li>)}</ul>{!projectsLoaded && !error && <p role="status">加载中…</p>}{projectsLoaded && !projects.length && !error && <div className="report-empty"><h3>暂无项目</h3></div>}{projectOffset !== null && <button onClick={async () => { try { const value = await (await request(`/api/work-projects?offset=${projectOffset}`)).json(); setProjects(previous => [...previous, ...value.projects]); setProjectOffset(value.nextOffset); } catch (failure) { setError((failure as Error).message); } }}>更多项目</button>}{error && <p role="alert" className="error">{error}</p>}</> : <>
    {busy && <p role="status">加载中…</p>}{error && <p role="alert" className="error">{error}</p>}
    {kind==='weekly'&&<WeeklyUsage request={request} employeeId={employeeId} week={from} refresh={usageRefresh}/>}
    {view && <div className={`report-split${hasStatistics || sourceDays.length > 0 ? '' : ' report-split-single'}`}><div className="report-main">
      {view.refreshPending && <p className="report-progress" role="status">正在更新</p>}
      {!!view.participants.length && <div className="report-participants">{view.participants.map(participant => <span key={participant.employeeId}><span className="report-avatar" aria-hidden="true">{Array.from(participant.employee)[0]}</span>{participant.employee}</span>)}</div>}
      {[...groups].map(([key, items]) => <section className="report-theme" key={key}><header><h3>{items[0]!.theme}</h3>{kind === 'weekly' && <p className="report-project-chip">{items[0]!.project || '未归类项目'}</p>}</header>
        {items.map((item, index) => <div className="report-item" key={`${item.analysisId}/${index}`}><h4>{analysisLabels[item.category]}<span>{assessmentLabels[item.assessment]}</span><span>{item.sourceDate} · {item.employee}</span></h4><div className="report-item-content"><p className="report-narrative">{item.text}</p>
          {item.projectCorrectionId && <p className="report-item-meta">来源项目：{item.originalProject || '未归类项目'}</p>}
          <a className="report-daily-reference" href={item.dailyPath}>日报 v{item.dailyRevision} ↗</a>{item.citations.length > 0 && <details className="report-evidence"><summary>原文 · {item.citations.length}</summary>{item.citations.map((citation, i) => <p className="report-citation" key={i}><a href={citation.webPath} onClick={onEvidence}>{citation.origin?.employee} · {citation.origin?.sourceDate}</a><q>{citation.quote}</q></p>)}</details>}
          {!!item.backgroundCitations.length && <details><summary>背景引用 · {item.backgroundCitations.length}</summary>{item.backgroundCitations.map((citation, i) => <p className="report-citation" key={i}><a href={citation.webPath} onClick={onEvidence}>{[citation.origin?.employee, citation.origin?.sourceDate].filter(Boolean).join(' · ') || '查看原文'}</a><q>{citation.quote}</q></p>)}</details>}
        </div></div>)}</section>)}
      {!view.items.length && <div className="report-empty"><h3>{['queued', 'waiting-analysis'].includes(view.state) ? '报告生成中' : '暂无工作内容'}</h3></div>}
      {view.nextOffset !== null && <button disabled={busy} onClick={more}>更多事项</button>}
      </div>{(hasStatistics || sourceDays.length > 0) && <aside className="report-side" aria-label="统计与覆盖">{hasStatistics && view.statistics && <section><h2>活动统计</h2><dl>{view.statistics.records != null && <div><dt>记录</dt><dd>{view.statistics.records}</dd></div>}{view.statistics.userTurns != null && <div><dt>用户轮次</dt><dd>{view.statistics.userTurns}</dd></div>}{view.statistics.toolCalls != null && <div><dt>工具调用</dt><dd>{view.statistics.toolCalls}</dd></div>}</dl></section>}
      {sourceDays.map(day => <FrozenStatistics key={`${day.employeeId}/${day.date}/${day.workStatistics!.version}`} reference={day.workStatistics!} request={request} onEvidence={onEvidence}/>)}</aside>}</div>}
      <details className="report-advanced"><summary>版本与来源{view && view.revision > 0 ? ` · v${view.revision}` : ''}</summary><div className="report-advanced-body"><label>历史版本（留空读取最新）<input type="number" min="1" value={revision} onChange={event => setRevision(event.target.value)} /></label>
      {view && <><p className="report-item-meta">{states[view.state]}</p>{!!view.coverage?.days.length && <details><summary>来源日报</summary>{view.coverage.days.map(day => <p key={`${day.employeeId}/${day.date}`}><a href={day.dailyPath}>{day.employee} · {day.date}{day.revision > 0 && ` · v${day.revision}`}</a></p>)}</details>}{!!view.corrections?.length && <details aria-label="期间人工说明"><summary>人工更正 · {view.corrections.length}</summary>{view.corrections.map(value => <p key={value.id}><a href={value.dailyPath}>{value.sourceDate}</a> · {value.actor} · {value.reason} · {value.kind === 'note' ? value.note : value.kind === 'theme' ? `主题：${value.theme}` : value.kind === 'project' ? `项目：${value.project || '未归类项目'}` : '重新分析'}</p>)}</details>}{view.version && <><p><a href={`#work?${params}&revision=${view.revision}`}>本版永久链接</a></p><p className="report-item-meta">{view.version}</p></>}</>}
      </div></details>
    </>}
    </div>
  </section>;
}
