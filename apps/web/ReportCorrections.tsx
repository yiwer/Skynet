import {useEffect,useState} from 'react';
import type {DailyReport,ReportCorrection} from '../../packages/contracts/reports.js';

export function ReportCorrections({report,fixed,request,onChanged}:{report:DailyReport;fixed:boolean;request:(path:string,signal?:AbortSignal,method?:'POST',body?:unknown)=>Promise<Response>;onChanged:(report:DailyReport)=>void}){
  const [reason,setReason]=useState('');const [note,setNote]=useState('');const [theme,setTheme]=useState('');const [project,setProject]=useState('');const [selected,setSelected]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const [history,setHistory]=useState<ReportCorrection[]>([]);const [next,setNext]=useState<number|null>(0);
  const groups=[...new Set(report.items.map(item=>JSON.stringify([item.project,item.theme])))];
  const path=`/api/daily-reports/${report.employeeId}/${report.date}/corrections`;
  useEffect(()=>{setReason('');setNote('');setTheme('');setSelected('');setHistory([]);setNext(0);setError('');},[path]);
  async function submit(kind:'note'|'theme'|'project'|'reanalyze'){
    setBusy(true);setError('');try{
      const eventIds=[...new Set(report.items.filter(item=>JSON.stringify([item.project,item.theme])===selected).flatMap(item=>item.activityEventIds))];
      if((kind==='theme'||kind==='project')&&!eventIds.length)throw new Error('先选择有本日证据的主题');
      const body={requestId:crypto.randomUUID(),expectedRevision:report.revision,reason,kind,...(kind==='note'?{note}:kind==='theme'?{theme,eventIds}:kind==='project'?{project,eventIds}:{})};
      onChanged(await(await request(path,undefined,'POST',body)).json());setHistory([]);setNext(0);
    }catch(failure){setError((failure as Error).message);}finally{setBusy(false);}
  }
  const text=(value:ReportCorrection)=>value.kind==='note'?value.note:value.kind==='theme'?`工作主题：${value.theme}`:value.kind==='project'?`显示项目：${value.project||'未归类项目'}`:'请求重新分析';
  return <section className="report-corrections" aria-label="分析更正">
    {!fixed && report.revision > 0 && <><label>更正原因<input value={reason} maxLength={1000} onChange={event=>setReason(event.target.value)}/></label>
      <div className="report-correction-grid"><section><h3>追加说明</h3><label htmlFor="correction-note" className="platform-sr-only">追加说明</label><textarea id="correction-note" value={note} maxLength={2000} onChange={event=>setNote(event.target.value)}/><button disabled={busy||!reason.trim()||!note.trim()} onClick={()=>submit('note')}>保存说明并生成新版</button></section>
      <section><h3>调整归类</h3><label>待归类主题<select value={selected} onChange={event=>setSelected(event.target.value)}><option value="">选择主题</option>{groups.map(group=>{const [project,theme]=JSON.parse(group);return <option key={group} value={group}>{project||'未归类项目'} · {theme}</option>;})}</select></label>
      <label>更正后的工作主题<input value={theme} maxLength={500} onChange={event=>setTheme(event.target.value)}/></label><button disabled={busy||!reason.trim()||!theme.trim()||!selected} onClick={()=>submit('theme')}>保存主题归类</button>
      <label>更正后的显示项目<input value={project} maxLength={1024} onChange={event=>setProject(event.target.value)}/></label><button disabled={busy||!reason.trim()||!selected} onClick={()=>submit('project')}>保存项目归类</button></section></div>
      <button disabled={busy||!reason.trim()} onClick={()=>submit('reanalyze')}>请求重新分析</button></>}
    {busy && <p role="status">保存中…</p>}{error && <p role="alert">{error}</p>}
    {!!report.corrections?.length && <div className="report-correction-history">{report.corrections.map(value=><p key={value.id}><strong>{value.actor}</strong> · {new Date(value.createdAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}<br/>{value.reason} · {text(value)}</p>)}</div>}
    <details><summary>更正历史{report.correctionCount ? ` · ${report.correctionCount}` : ''}</summary>{history.map(value=><p key={value.id}>{value.sequence} · {value.actor} · {value.createdAt}<br/>{value.reason} · {text(value)}</p>)}
      {next!==null && <button onClick={async()=>{try{const value=await(await request(`${path}?offset=${next}`)).json();setHistory(old=>[...old,...value.corrections]);setNext(value.nextOffset);}catch(failure){setError((failure as Error).message);}}}>读取更多更正历史</button>}</details>
  </section>;
}
