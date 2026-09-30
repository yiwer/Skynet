import { useEffect, useState } from 'react';
import { analysisLabels, assessmentLabels } from '../../packages/contracts/analysis.js';
import { beijingDate } from '../../packages/contracts/reports.js';
import { addDays, dueWeek, monday, type WorkView, type WorkViewItem } from '../../packages/contracts/work-views.js';
import {FrozenStatistics} from './FrozenStatistics.js';
import {useFixedRevisionReader} from './useFixedRevisionReader.js';

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
  const [listError, setError] = useState('');
  const params = new URLSearchParams({ kind, subject: kind === 'weekly' ? employeeId : project, from, to }); const path = `/api/work-view?${params}`;
  const reader=useFixedRevisionReader<WorkView>({identity:`${path}/${revision}`,load:async signal=>(await request(`${path}${revision ? `&revision=${revision}` : ''}`,signal)).json(),
    poll:value=>!revision&&(!!value.refreshPending||['queued','waiting-analysis'].includes(value.state))});
  const view=reader.data,busy=reader.loading,error=reader.error||listError;
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
    <button disabled={busy} onClick={reader.retry}>刷新视图</button><button disabled={busy} onClick={generate}>请求区间生成</button>
    {busy && <p role="status">正在读取…</p>}{error && <p role="alert">{error}</p>}
    {view && <><h2>{view.subjectLabel} · {view.from} 至 {view.to}</h2><p role="status">{states[view.state]} · 版本 {view.revision}</p>
      {view.refreshPending && <p>刷新已入队，当前显示已保存版本。</p>}{view.coverage?.fixture && <p className="notice">合成演示，非正式验收；没有调用真实千问。</p>}
      <p>参与者：{view.participants.map(participant => `${participant.employee}（${participant.dates.join('、')}）`).join('；') || '尚无已确认参与活动，不能推断无工作。'}</p>
      {view.statistics && !view.statistics.complete && <p>统计仅为当前已选日报版本的已知计数；未覆盖部分未知。</p>}
      {view.statistics && <><dl><div><dt>已确认记录</dt><dd>{view.statistics.records ?? '未知'}</dd></div><div><dt>用户轮次</dt><dd>{view.statistics.userTurns ?? '未知'}</dd></div><div><dt>工具调用</dt><dd>{view.statistics.toolCalls ?? '未知'}</dd></div></dl><p className="muted">{view.statistics.definition}</p><p>{view.kind==='weekly'?'文件、Token 和活动点按下面各固定日报逐日核查；跨日唯一文件、会话和人工工时不任意合计。':'项目文件、Token 和工时尚未知；不把员工整日 Token 分摊给项目。'}</p></>}
      {view.kind==='weekly'&&view.coverage?.days.filter(day=>day.revision>0).map(day=><section key={`${day.employeeId}/${day.date}`} aria-label={`${day.date}固定日统计`}><h3>{day.date} · 固定日报 v{day.revision}</h3>
        {day.statistics&&<p>文件路径观测 {day.statistics.files?.observedCount??'未知'}；来源 Token {day.statistics.tokens?.total??'未知'}；活动时间段 {day.statistics.activityIntervalCount??'未知'}；{day.statistics.sourceInputsComplete?'已选统计输入可读':'仍有未知范围'}。</p>}
        {day.workStatistics?<FrozenStatistics key={day.workStatistics.version} reference={day.workStatistics} request={request} onEvidence={onEvidence}/>:<p>旧版未绑定固定统计；保留未知值。</p>}</section>)}
      {view.coverage?.messages.map(message => <p className="notice" key={message}>{message}</p>)}
      {!!view.corrections?.length&&<section aria-label="期间人工说明"><h3>引用日报的人工说明与更正</h3><p>说明不是原活动或已核验交付；至多展示32条，完整历史在对应日报查看。</p>{view.corrections.map(value=><p key={value.id}><a href={value.dailyPath}>{value.sourceDate} · 查看固定日报</a> · {value.actor} · {value.reason} · {value.kind==='note'?value.note:value.kind==='theme'?`主题归类：${value.theme}`:value.kind==='project'?`显示项目：${value.project||'未归类项目'}`:'请求重新分析'}</p>)}</section>}
      {[...groups].map(([key, items]) => <section key={key}><h3>{items[0]!.project || '未归类项目'} · {items[0]!.theme}</h3>
        <p className="muted">{items[0]!.continuation === 'unassigned' ? '主题关系未确认，保留独立事项。' : '跨日同主题为推断关联；保留逐日事项与证据。'}</p>
        {items.map((item, index) => <div key={`${item.analysisId}/${index}`}><h4>{item.sourceDate} · {item.employee} · {analysisLabels[item.category]} · {assessmentLabels[item.assessment]}</h4><p>{item.text}</p>
          {item.projectCorrectionId&&<p>人工显示项目归类；来源项目：{item.originalProject||'未归类项目'}。原员工、日期和原句保留。</p>}
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
