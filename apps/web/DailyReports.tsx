import { useEffect, useState } from 'react';
import { analysisLabels, assessmentLabels } from '../../packages/contracts/analysis.js';
import { beijingDate, previousDate, type DailyReport, type DailyItem } from '../../packages/contracts/reports.js';
import {ReportCorrections} from './ReportCorrections.js';

export function DailyReports({ request, currentEmployeeId, onEvidence }: {
  request: (path: string, signal?: AbortSignal, method?: 'POST',body?:unknown) => Promise<Response>;
  currentEmployeeId: string; onEvidence: () => void;
}) {
  const selection = () => new URLSearchParams(location.hash.startsWith('#daily?') ? location.hash.slice(7) : '');
  const [employeeId, setEmployeeId] = useState(selection().get('employeeId') ?? currentEmployeeId);
  const [date, setDate] = useState(selection().get('date') ?? previousDate(beijingDate()));
  const [report, setReport] = useState<DailyReport | null>(null);
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
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [refresh, setRefresh] = useState(0);
  const path = `/api/daily-reports/${employeeId}/${date}`;
  useEffect(() => {
    const abort = new AbortController(); setBusy(true); setError(''); setReport(null);
    request(`${path}${revision ? `?revision=${revision}` : ''}`, abort.signal).then(response => response.json()).then(value => { if (!abort.signal.aborted) setReport(value); })
      .catch(failure => { if (!abort.signal.aborted) setError(failure.message); }).finally(() => { if (!abort.signal.aborted) setBusy(false); });
    return () => abort.abort();
  }, [path, refresh, revision]);
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
  useEffect(() => {
    if (revision || !report || !report.refreshPending && !['queued', 'waiting-analysis'].includes(report.state)) return;
    const timer = setTimeout(() => setRefresh(value => value + 1), 5000); return () => clearTimeout(timer);
  }, [report]);
  async function generate() {
    setBusy(true); setError('');
      try { setRevision(''); setReport(await (await request(path, undefined, 'POST')).json()); setRefresh(value => value + 1); }
    catch (failure) { setError((failure as Error).message); } finally { setBusy(false); }
  }
  async function more() {
    if (!report || report.nextOffset === null) return; setBusy(true);
    try {
      const next: DailyReport = await (await request(`${path}?offset=${report.nextOffset}&revision=${report.revision}`)).json();
      setReport({ ...next, items: [...report.items, ...next.items] });
    } catch (failure) { setError((failure as Error).message); } finally { setBusy(false); }
  }
  const states: Record<DailyReport['state'], string> = { 'not-scheduled': '尚未入队', queued: '已入队', 'waiting-analysis': '等待分析',
    ready: '本版已生成', partial: '材料或分析不完整', unavailable: '尚无法生成主题' };
  const groups = new Map<string, DailyItem[]>();
  for (const item of report?.items ?? []) { const key = JSON.stringify([item.project, item.theme]); groups.set(key, [...(groups.get(key) ?? []), item]); }
  return <section aria-label="日工作"><p className="eyebrow">北京时间 · 工作证据</p><h1>日工作</h1>
    <p>每天 09:00 将前一自然日入队。分析完成时间取决于运行时与队列；无需逐会话申请分析。</p>
    <p>未显示的目标、成果或阻塞表示尚无本日证据支持，不表示这些事项为零；主题关联和结论保留分析分级。</p>
    <label>员工<select value={employeeId} onChange={event => { setEmployeeId(event.target.value); setRevision(''); }}>{employees.map(employee => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></label>
    {employeeOffset !== null && <button onClick={async () => { try { const value = await (await request(`/api/daily-report-employees?offset=${employeeOffset}`)).json(); setEmployees(previous => [...previous, ...value.employees]); setEmployeeOffset(value.nextOffset); } catch (failure) { setError((failure as Error).message); } }}>更多员工</button>}
    <label>来源日期<input type="date" value={date} max={beijingDate()} onChange={event => { setDate(event.target.value); setRevision(''); }} /></label>
    <label>历史版本（留空读取最新）<input type="number" min="1" value={revision} onChange={event => setRevision(event.target.value)} /></label>
    <button disabled={busy} onClick={() => setRefresh(value => value + 1)}>刷新日报</button>
    <button disabled={busy} onClick={generate}>请求本日生成</button>
    <details><summary>已入队日报</summary>{periods.map(period => <button key={`${period.employeeId}/${period.date}`} onClick={() => { setEmployeeId(period.employeeId); setDate(period.date); }}>{period.employee} · {period.date} · v{period.revision}</button>)}
      {periodOffset !== null && <button onClick={async () => { try { const value = await (await request(`/api/daily-reports?offset=${periodOffset}`)).json(); setPeriods(previous => [...previous, ...value.reports]); setPeriodOffset(value.nextOffset); } catch (failure) { setError((failure as Error).message); } }}>更多日报</button>}</details>
    {busy && <p role="status">正在读取日报…</p>}{error && <p role="alert" className="error">{error}</p>}
    {report && <><h2>{report.employee} · {report.date}</h2><p role="status">{states[report.state]} · 版本 {report.revision}</p>
      {report.refreshPending && <p role="status">刷新已入队；当前显示已保存版本。</p>}
      {report.coverage?.fixture && <p className="notice">合成演示，非正式验收；没有调用真实千问。</p>}
      {report.statistics && <><dl><div><dt>已确认记录</dt><dd>{report.statistics.records}</dd></div><div><dt>用户轮次</dt><dd>{report.statistics.userTurns}</dd></div>
        <div><dt>工具调用</dt><dd>{report.statistics.toolCalls}</dd></div><div><dt>历史 / 关联上下文</dt><dd>{report.statistics.historicalRecords}</dd></div><div><dt>时间或接入边界未知</dt><dd>{report.statistics.unknownRecords}</dd></div></dl>
        <p>文件数、原生 token、活动区间、人工工时：未知。</p><p className="muted">{report.statistics.definition}</p></>}
      {report.coverage?.messages.map(message => <p className="notice" key={message}>{message}</p>)}
      <ReportCorrections report={report} fixed={!!revision} request={request} onChanged={value=>{setReport(value);setRefresh(current=>current+1);}} />
      {[...groups].map(([key, items]) => <section key={key} aria-label={`${items[0]!.project} · ${items[0]!.theme}`}><h3>{items[0]!.project || '未归类项目'} · {items[0]!.theme}</h3>
        {items.map((item, index) => <div key={`${item.analysisId}/${index}`}><h4>{analysisLabels[item.category]} · {assessmentLabels[item.assessment]}</h4><p>{item.text}</p>
          {item.projectCorrectionId&&<p>人工显示项目归类；来源项目：{item.originalProject||'未归类项目'}。原句与原员工、日期不变。</p>}
          <p className="muted">{item.themeAssociation==='manual-correction'?`人工主题归类；原分析主题：${item.originalTheme}。原项目、引用和统计保留。`:item.themeAssociation === 'inferred-single-topic' ? '主题关联为推断；当前分析仅有一个合格主题，尚无逐事项关系证据。' : item.themeAssociation === 'unassigned' ? '主题关联尚不确定；未任意归入首个主题。' : '分析中的主题记录。'}</p>
          {item.citations.map((citation, ci) => <p key={ci}><a href={citation.webPath} onClick={onEvidence}>核查本日原句 · {citation.origin?.employee} · {citation.origin?.sourceDate}</a><q>{citation.quote}</q></p>)}
          {!!item.backgroundCitations.length && <details><summary>背景或其他项目引用（不计本项活动）</summary>{item.backgroundCitations.map((citation, ci) => <p key={ci}><a href={citation.webPath} onClick={onEvidence}>{citation.origin?.employee ?? '归属未知'} · {citation.origin?.sourceDate ?? '日期未知'} · {citation.origin?.project}</a><q>{citation.quote}</q></p>)}</details>}
        </div>)}</section>)}
      {!report.items.length && <p>尚无有本日证据支持的工作主题；不能推断目标、成果或阻塞为零。</p>}
      {report.nextOffset !== null && <button disabled={busy} onClick={more}>读取本版更多主题</button>}
      {report.version && <p className="muted small">不可变版本标识：{report.version}</p>}
    </>}
  </section>;
}
