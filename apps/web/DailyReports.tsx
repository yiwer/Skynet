import {ProfileSourceReturn,carryProfileSourceReturn} from './profile-source-navigation.js';
import { useEffect, useState } from 'react';
import { analysisLabels, assessmentLabels } from '../../packages/contracts/analysis.js';
import { beijingDate, previousDate, type DailyReport, type DailyItem } from '../../packages/contracts/reports.js';
import {ReportCorrections} from './ReportCorrections.js';
import {FrozenStatistics} from './FrozenStatistics.js';
import {useFixedRevisionReader} from './useFixedRevisionReader.js';
import { addDays, monday } from '../../packages/contracts/work-views.js';
import './work-reports.css';

export function DailyReports({ request, currentEmployeeId, onEvidence }: {
  request: (path: string, signal?: AbortSignal, method?: 'POST',body?:unknown) => Promise<Response>;
  currentEmployeeId: string; onEvidence: () => void;
}) {
  const selection = () => new URLSearchParams(location.hash.startsWith('#daily?') ? location.hash.slice(7) : '');
  const [employeeId, setEmployeeId] = useState(selection().get('employeeId') ?? currentEmployeeId);
  const [date, setDate] = useState(selection().get('date') ?? previousDate(beijingDate()));
  const [periods, setPeriods] = useState<{ employeeId: string; employee: string; date: string; state: string; revision: number }[]>([]);
  const [periodOffset, setPeriodOffset] = useState<number | null>(0);
  const [employees, setEmployees] = useState<{ id: string; name: string }[]>([]);
  const [employeeOffset, setEmployeeOffset] = useState<number | null>(null);
  const [revision, setRevision] = useState(selection().get('revision') ?? '');
  useEffect(() => {
    const change = () => { if (!location.hash.startsWith('#daily?')) return; const query = selection();
      setEmployeeId(query.get('employeeId') ?? currentEmployeeId); setDate(query.get('date') ?? previousDate(beijingDate())); setRevision(query.get('revision') ?? ''); };
    window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change);
  }, [currentEmployeeId]);
  const [listError, setError] = useState(''); const [refresh, setRefresh] = useState(0);
  const path = `/api/daily-reports/${employeeId}/${date}`;
  const reader=useFixedRevisionReader<DailyReport>({identity:`${path}/${revision}`,load:async signal=>(await request(`${path}${revision ? `?revision=${revision}` : ''}`,signal)).json(),
    poll:value=>!revision&&(!!value.refreshPending||['queued','waiting-analysis'].includes(value.state))});
  const report=reader.data,busy=reader.loading,error=reader.error||listError;
  useEffect(() => {
    const abort = new AbortController();
    request('/api/daily-reports', abort.signal).then(response => response.json()).then(value => {
      if (!abort.signal.aborted) { setPeriods(value.reports); setPeriodOffset(value.nextOffset); }
    }).catch(failure => { if (!abort.signal.aborted) setError(failure.message); });
    request('/api/daily-report-employees', abort.signal).then(response => response.json()).then(value => {
      if (!abort.signal.aborted) { setEmployees(value.employees); setEmployeeOffset(value.nextOffset); }
    }).catch(failure => { if (!abort.signal.aborted) setError(failure.message); });
    return () => abort.abort();
  }, [refresh]);
  async function generate() {
    if(await reader.run(async signal=>(await request(path,signal,'POST')).json())){setRevision('');reader.retry();setRefresh(value=>value+1);}
  }
  async function more() {
    if (!report || report.nextOffset === null) return;
    await reader.run(async signal=>{const next:DailyReport=await (await request(`${path}?offset=${report.nextOffset}&revision=${report.revision}`,signal)).json();
      if(next.version!==report.version||next.revision!==report.revision)throw new Error('固定日报版本不匹配，请重试本版');return {...next,items:[...report.items,...next.items]};});
  }
  const states: Record<DailyReport['state'], string> = { 'not-scheduled': '尚未入队', queued: '已入队', 'waiting-analysis': '等待分析',
    ready: '本版已生成', partial: '材料或分析不完整', unavailable: '尚无法生成主题' };
  const groups = new Map<string, DailyItem[]>();
  for (const item of report?.items ?? []) { const key = JSON.stringify([item.project, item.theme]); groups.set(key, [...(groups.get(key) ?? []), item]); }
  const employeeName = employees.find(employee => employee.id === employeeId)?.name ?? report?.employee ?? '员工';
  const calendarDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(new Date(date).getTime()) ? date : beijingDate();
  const weekStart = monday(calendarDate), days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const hasStatistics = !!report?.statistics && report.statistics.records > 0;
  return <section className="work-report daily-report workspace-page" aria-label="日工作"><ProfileSourceReturn/>
    {employees.length > 1 && <nav className="report-people" aria-label="切换员工">{employees.map(employee => <button key={employee.id} aria-pressed={employee.id === employeeId} onClick={() => { setEmployeeId(employee.id); setRevision(''); }}><span className="report-avatar" aria-hidden="true">{Array.from(employee.name)[0]}</span>{employee.name}</button>)}</nav>}
    <header className="report-page-heading"><div><p className="report-crumbs"><a href="#coverage">团队概览</a><span>/</span>日报</p><h1><span className="report-avatar report-avatar-large" aria-hidden="true">{Array.from(employeeName)[0]}</span>{employeeName}</h1></div><div className="report-actions"><button disabled={busy} onClick={() => {reader.retry();setRefresh(value => value + 1);}}>刷新日报</button><button disabled={busy} onClick={generate}>生成日报</button></div></header>
    <div className="report-control-row"><nav className="report-mode" aria-label="查看方式"><a href={carryProfileSourceReturn(`#daily?${new URLSearchParams({ employeeId, date })}`)} aria-current="page">日报</a><a href={carryProfileSourceReturn(`#work?${new URLSearchParams({ kind: 'weekly', subject: employeeId, from: weekStart, to: addDays(weekStart, 6) })}`)}>周视图</a></nav><label className="report-date-control">来源日期<input type="date" value={date} max={beijingDate()} onChange={event => { if (event.target.value) { setDate(event.target.value); setRevision(''); } }} /></label>
      <div className="report-day-strip" role="group" aria-label="选择日期">{days.map(day => <button key={day} disabled={day > beijingDate()} aria-pressed={day === date} aria-label={`选择 ${day}`} onClick={() => { setDate(day); setRevision(''); }}><span>周{['日', '一', '二', '三', '四', '五', '六'][new Date(`${day}T00:00:00Z`).getUTCDay()]}</span><b>{Number(day.slice(8))}</b></button>)}</div>
    </div>
    <div className="workspace-scroll report-scroll">
    {busy && <p role="status">加载中…</p>}{error && <p role="alert" className="error">{error}</p>}
    {report && <><div className={`report-split${hasStatistics || report.coverage?.workStatistics ? '' : ' report-split-single'}`}><div className="report-main">
      {report.refreshPending && <p className="report-progress" role="status">正在更新</p>}
      {[...groups].map(([key, items]) => <section className="report-theme" key={key} aria-label={`${items[0]!.project} · ${items[0]!.theme}`}><header><h3>{items[0]!.theme}</h3><p className="report-project-chip">{items[0]!.project || '未归类项目'}</p></header>
        {items.map((item, index) => <div className="report-item" key={`${item.analysisId}/${index}`}><h4>{analysisLabels[item.category]} <span>{assessmentLabels[item.assessment]}</span></h4><div className="report-item-content"><p className="report-narrative">{item.text}</p>
          {(item.projectCorrectionId || item.themeAssociation === 'manual-correction') && <p className="report-item-meta">{item.projectCorrectionId && `来源项目：${item.originalProject || '未归类项目'}`}{item.projectCorrectionId && item.themeAssociation === 'manual-correction' && ' · '}{item.themeAssociation === 'manual-correction' && `原主题：${item.originalTheme}`}</p>}
          {item.citations.length > 0 && <details className="report-evidence"><summary>原文 · {item.citations.length}</summary>{item.citations.map((citation, ci) => <p className="report-citation" key={ci}><a href={citation.webPath} onClick={onEvidence}>{citation.origin?.employee} · {citation.origin?.sourceDate}</a><q>{citation.quote}</q></p>)}</details>}
          {!!item.backgroundCitations.length && <details><summary>背景引用 · {item.backgroundCitations.length}</summary>{item.backgroundCitations.map((citation, ci) => <p className="report-citation" key={ci}><a href={citation.webPath} onClick={onEvidence}>{[citation.origin?.employee, citation.origin?.sourceDate, citation.origin?.project].filter(Boolean).join(' · ') || '查看原文'}</a><q>{citation.quote}</q></p>)}</details>}
        </div></div>)}</section>)}
      {!report.items.length && <div className="report-empty"><h3>{['queued', 'waiting-analysis'].includes(report.state) ? '日报生成中' : '暂无日报内容'}</h3></div>}
      {report.nextOffset !== null && <button disabled={busy} onClick={more}>更多主题</button>}
      </div>{(hasStatistics || report.coverage?.workStatistics) && <aside className="report-side" aria-label="统计与覆盖">
      {hasStatistics && report.statistics && <section><h2>活动统计</h2><dl><div><dt>记录</dt><dd>{report.statistics.records}</dd></div><div><dt>用户轮次</dt><dd>{report.statistics.userTurns}</dd></div><div><dt>工具调用</dt><dd>{report.statistics.toolCalls}</dd></div>
        {report.statistics.historicalRecords > 0 && <div><dt>关联上下文</dt><dd>{report.statistics.historicalRecords}</dd></div>}{report.statistics.files && report.statistics.files.observedCount > 0 && <div><dt>文件路径</dt><dd>{report.statistics.files.observedCount}{!report.statistics.files.complete && '+'}</dd></div>}{report.statistics.tokens?.total != null && <div><dt>来源 Token</dt><dd>{report.statistics.tokens.total}</dd></div>}{!!report.statistics.activityIntervals?.length && <div><dt>活动区间</dt><dd>{report.statistics.activityIntervals.length}</dd></div>}</dl></section>}
      {report.coverage?.workStatistics && <FrozenStatistics key={report.coverage.workStatistics.version} reference={report.coverage.workStatistics} request={request} onEvidence={onEvidence}/>}</aside>}</div></>}
      <details className="report-advanced"><summary>版本与更正{report && report.revision > 0 ? ` · v${report.revision}` : ''}</summary><div className="report-advanced-body"><div className="report-filter-bar"><label>员工<select value={employeeId} onChange={event => { setEmployeeId(event.target.value); setRevision(''); }}>{employees.map(employee => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></label>{employeeOffset !== null && <button onClick={async () => { try { const value = await (await request(`/api/daily-report-employees?offset=${employeeOffset}`)).json(); setEmployees(previous => [...previous, ...value.employees]); setEmployeeOffset(value.nextOffset); } catch (failure) { setError((failure as Error).message); } }}>更多员工</button>}<label>历史版本（留空读取最新）<input type="number" min="1" value={revision} onChange={event => setRevision(event.target.value)} /></label></div>
      {report && <><p className="report-item-meta">{states[report.state]}{report.version && ` · ${report.version}`}</p>
      <ReportCorrections report={report} fixed={!!revision} request={request} onChanged={value=>{reader.replace(value);setRefresh(current=>current+1);}} /></>}
      </div></details>
      {(periods.length > 0 || periodOffset !== null) && <details className="report-periods"><summary>历史日报</summary><div className="report-period-list">{periods.map(period => <button key={`${period.employeeId}/${period.date}`} onClick={() => { setEmployeeId(period.employeeId); setDate(period.date); setRevision(''); }}>{period.employee} · {period.date} · v{period.revision}</button>)}{periodOffset !== null && <button onClick={async () => { try { const value = await (await request(`/api/daily-reports?offset=${periodOffset}`)).json(); setPeriods(previous => [...previous, ...value.reports]); setPeriodOffset(value.nextOffset); } catch (failure) { setError((failure as Error).message); } }}>更多日报</button>}</div></details>}
    </div>
  </section>;
}
