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
  return <section aria-label="分析更正"><h3>说明与分析更正</h3><p>人工说明、主题和显示项目归类单列保存。原件、来源项目、员工归属和本日总计数不变；新版项目计数按原事件唯一分配。重新分析保留原分析和预算预留。</p>
    {!fixed&&report.revision>0&&<><label>更正原因<input value={reason} maxLength={1000} onChange={event=>setReason(event.target.value)}/></label>
      <label>追加说明<textarea value={note} maxLength={2000} onChange={event=>setNote(event.target.value)}/></label><button disabled={busy||!reason.trim()||!note.trim()} onClick={()=>submit('note')}>保存说明并生成新版</button>
      <label>待归类主题<select value={selected} onChange={event=>setSelected(event.target.value)}><option value="">选择当前页主题</option>{groups.map(group=>{const [project,theme]=JSON.parse(group);return <option key={group} value={group}>{project||'未归类项目'} · {theme}</option>;})}</select></label>
      <label>更正后的工作主题<input value={theme} maxLength={500} onChange={event=>setTheme(event.target.value)}/></label><button disabled={busy||!reason.trim()||!theme.trim()||!selected} onClick={()=>submit('theme')}>保存主题归类</button>
      <label>更正后的显示项目<input value={project} maxLength={1024} onChange={event=>setProject(event.target.value)}/></label><button disabled={busy||!reason.trim()||!selected} onClick={()=>submit('project')}>保存项目归类</button><p>显示项目留空表示未归类；原始来源项目仍可核查。</p>
      <p>归类作用于当前页该主题引用的原活动；其他页须先读取后再归类。</p><button disabled={busy||!reason.trim()} onClick={()=>submit('reanalyze')}>请求重新分析</button></>}
    {fixed&&<p>固定历史版只读；切回最新版本后可追加更正。</p>}{busy&&<p role="status">更正正在保存或重算入队…</p>}{error&&<p role="alert">{error}</p>}
    <p>本版保存 {report.correctionCount??0} 条更正，最近至多8条展示；全部内容可分页查历史。</p>{report.corrections?.map(value=><p key={value.id}>{value.actor} · {value.createdAt} · {value.reason} · {text(value)}</p>)}
    <details><summary>全部更正历史（当前记录，不改写本版）</summary>{history.map(value=><p key={value.id}>{value.sequence} · {value.actor} · {value.createdAt} · {value.reason} · {text(value)}</p>)}
      {next!==null&&<button onClick={async()=>{try{const value=await(await request(`${path}?offset=${next}`)).json();setHistory(old=>[...old,...value.corrections]);setNext(value.nextOffset);}catch(failure){setError((failure as Error).message);}}}>读取更多更正历史</button>}</details>
  </section>;
}
