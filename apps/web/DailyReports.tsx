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
  return <section className="work-report daily-report" aria-label="日工作">
    <nav className="report-people" aria-label="切换员工">{employees.map(employee => <button key={employee.id} aria-pressed={employee.id === employeeId} onClick={() => { setEmployeeId(employee.id); setRevision(''); }}><span className="report-avatar" aria-hidden="true">{Array.from(employee.name)[0]}</span>{employee.name}</button>)}</nav>
    <header className="report-page-heading"><div><p className="report-crumbs"><a href="#coverage">团队概览</a><span>/</span>{employeeName}</p><h1><span className="report-avatar report-avatar-large" aria-hidden="true">{Array.from(employeeName)[0]}</span>{employeeName}</h1><p className="report-page-subtitle">日工作 · 原始来源日期 · 北京时间</p></div><div className="report-actions"><button disabled={busy} onClick={() => {reader.retry();setRefresh(value => value + 1);}}>刷新日报</button><button disabled={busy} onClick={generate}>请求本日生成</button></div></header>
    <div className="report-control-row"><nav className="report-mode" aria-label="查看方式"><button disabled title="完整员工画像尚未实现">画像</button><a href={`#daily?${new URLSearchParams({ employeeId, date })}`} aria-current="page">日报</a><a href={`#work?${new URLSearchParams({ kind: 'weekly', subject: employeeId, from: weekStart, to: addDays(weekStart, 6) })}`}>周视图</a></nav>
      <div className="report-day-strip" role="group" aria-label="选择日期">{days.map(day => <button key={day} disabled={day > beijingDate()} aria-pressed={day === date} aria-label={`选择 ${day}`} onClick={() => { setDate(day); setRevision(''); }}><span>周{['日', '一', '二', '三', '四', '五', '六'][new Date(`${day}T00:00:00Z`).getUTCDay()]}</span><b>{Number(day.slice(8))}</b></button>)}</div>
    </div>
    <div className="report-filter-bar">
    <label>员工<select value={employeeId} onChange={event => { setEmployeeId(event.target.value); setRevision(''); }}>{employees.map(employee => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></label>
    {employeeOffset !== null && <button onClick={async () => { try { const value = await (await request(`/api/daily-report-employees?offset=${employeeOffset}`)).json(); setEmployees(previous => [...previous, ...value.employees]); setEmployeeOffset(value.nextOffset); } catch (failure) { setError((failure as Error).message); } }}>更多员工</button>}
    <label>来源日期<input type="date" value={date} max={beijingDate()} onChange={event => { if (event.target.value) { setDate(event.target.value); setRevision(''); } }} /></label>
    <label>历史版本（留空读取最新）<input type="number" min="1" value={revision} onChange={event => setRevision(event.target.value)} /></label>
    </div>
    <details className="report-periods"><summary>已入队日报</summary>{periods.map(period => <button key={`${period.employeeId}/${period.date}`} onClick={() => { setEmployeeId(period.employeeId); setDate(period.date); setRevision(''); }}>{period.employee} · {period.date} · v{period.revision}</button>)}
      {periodOffset !== null && <button onClick={async () => { try { const value = await (await request(`/api/daily-reports?offset=${periodOffset}`)).json(); setPeriods(previous => [...previous, ...value.reports]); setPeriodOffset(value.nextOffset); } catch (failure) { setError((failure as Error).message); } }}>更多日报</button>}</details>
    {busy && <p role="status">正在读取日报…</p>}{error && <p role="alert" className="error">{error}</p>}
    {report && <div className="report-split"><div className="report-main"><div className="report-version"><h2>{report.employee} · {report.date}</h2><p role="status">{states[report.state]} · 版本 {report.revision}</p></div>
      {report.refreshPending && <p role="status">刷新已入队；当前显示已保存版本。</p>}
      {report.coverage?.fixture && <p className="notice">合成演示，非正式验收；没有调用真实千问。</p>}
      {report.coverage?.messages.map(message => <p className="notice" key={message}>{message}</p>)}
      <p className="report-boundary-note">未显示的目标、成果或阻塞表示尚无本日证据支持，不表示这些事项为零；主题关联和结论保留分析分级。</p>
      {[...groups].map(([key, items]) => <section className="report-theme" key={key} aria-label={`${items[0]!.project} · ${items[0]!.theme}`}><header><h3>{items[0]!.theme}</h3><p className="report-project-chip">{items[0]!.project || '未归类项目'}</p></header>
        {items.map((item, index) => <div className="report-item" key={`${item.analysisId}/${index}`}><h4>{analysisLabels[item.category]} <span>{assessmentLabels[item.assessment]}</span></h4><div className="report-item-content"><p className="report-narrative">{item.text}</p>
          {item.projectCorrectionId&&<p>人工显示项目归类；来源项目：{item.originalProject||'未归类项目'}。原句与原员工、日期不变。</p>}
          <p className="muted">{item.themeAssociation==='manual-correction'?`人工主题归类；原分析主题：${item.originalTheme}。原项目、引用和统计保留。`:item.themeAssociation === 'inferred-single-topic' ? '主题关联为推断；当前分析仅有一个合格主题，尚无逐事项关系证据。' : item.themeAssociation === 'unassigned' ? '主题关联尚不确定；未任意归入首个主题。' : '分析中的主题记录。'}</p>
          {item.citations.map((citation, ci) => <p className="report-citation" key={ci}><a href={citation.webPath} onClick={onEvidence}>核查本日原句 · {citation.origin?.employee} · {citation.origin?.sourceDate}</a><q>{citation.quote}</q></p>)}
          {!!item.backgroundCitations.length && <details><summary>背景或其他项目引用（不计本项活动）</summary>{item.backgroundCitations.map((citation, ci) => <p key={ci}><a href={citation.webPath} onClick={onEvidence}>{citation.origin?.employee ?? '归属未知'} · {citation.origin?.sourceDate ?? '日期未知'} · {citation.origin?.project}</a><q>{citation.quote}</q></p>)}</details>}
        </div></div>)}</section>)}
      {!report.items.length && <div className="report-empty"><h3>工作主题尚未生成</h3><p>尚无有本日证据支持的工作主题；不能推断目标、成果或阻塞为零。</p></div>}
      {report.nextOffset !== null && <button disabled={busy} onClick={more}>读取本版更多主题</button>}
      <div className="report-corrections"><ReportCorrections report={report} fixed={!!revision} request={request} onChanged={value=>{reader.replace(value);setRefresh(current=>current+1);}} /></div>
      </div><aside className="report-side" aria-label="统计与覆盖"><section><h2>活动统计</h2>
      {report.statistics ? <><dl><div><dt>已确认记录</dt><dd>{report.statistics.records}</dd></div><div><dt>用户轮次</dt><dd>{report.statistics.userTurns}</dd></div>
        <div><dt>工具调用</dt><dd>{report.statistics.toolCalls}</dd></div><div><dt>历史 / 关联上下文</dt><dd>{report.statistics.historicalRecords}</dd></div><div><dt>时间或接入边界未知</dt><dd>{report.statistics.unknownRecords}</dd></div>
        <div><dt>文件路径观测</dt><dd>{report.statistics.files?.observedCount??'未知'}{report.statistics.files&&!report.statistics.files.complete?' · 不完整':''}</dd></div>
          <div><dt>来源 Token 总量</dt><dd>{report.statistics.tokens?.total??'未知'}</dd></div><div><dt>活动时间段</dt><dd>{report.statistics.activityIntervals?`${report.statistics.activityIntervals.length} 段`:'未知'}</dd></div></dl>
        <p>人工工时未知；文件为来源路径观测，Token 为来源记录量，区间是已记录活动点。</p><p className="muted">{report.statistics.definition}</p></> : <p>当前版本尚无统计，保留未知。</p>}</section>
      <section><h2>固定统计与证据</h2>{report.coverage?.workStatistics?<FrozenStatistics key={report.coverage.workStatistics.version} reference={report.coverage.workStatistics} request={request} onEvidence={onEvidence}/>:report.version&&<p>旧版未绑定固定统计；保留该版本的未知值。</p>}</section>
      <section><h2>报告版本</h2><p>每天 09:00 将前一自然日入队。分析完成时间取决于运行时与队列；无需逐会话申请分析。</p>{report.version && <p className="muted small">不可变版本标识：{report.version}</p>}</section>
      </aside></div>}
  </section>;
}
