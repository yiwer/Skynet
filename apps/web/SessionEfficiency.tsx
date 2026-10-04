import {useEffect,useState,type CSSProperties,type FormEvent} from 'react';
import {sourceLabel,type Source} from '../../packages/contracts/archive.js';
import {taskTypeLabels} from '../../packages/contracts/session-insights.js';
import type {EfficiencyQuery,EfficiencySession,SessionEfficiencyPage,EfficiencyRatio,EfficiencySegment} from '../../packages/contracts/session-efficiency.js';
import './usage-metrics.css';
import './session-efficiency.css';

type Props={request:(path:string,signal?:AbortSignal,method?:'POST',body?:unknown)=>Promise<Response>};
const params=(q:Partial<EfficiencyQuery>)=>new URLSearchParams(Object.entries(q).filter(([,v])=>v!==undefined).map(([k,v])=>[k,String(v)]));
const number=(n:number|null)=>n===null?'未知':n.toLocaleString('zh-CN',{maximumFractionDigits:2});
const time=(n:number|null)=>n===null?'未知':n<60000?`${number(n/1000)} 秒`:`${number(n/60000)} 分钟`;
const sources:Source[]=['codex-cli','claude-code-cli','codex-desktop'];
const names:Record<EfficiencySegment['kind'],string>={agent:'Agent 工作',reply:'等待回复',permission:'等待权限',gap:'缺口'};

function Distribution({rows}: {rows:SessionEfficiencyPage['distributions']}){
  const [chart,setChart]=useState(true),[tooltip,setTooltip]=useState('');
  const maximum=Math.max(1,...rows.flatMap(r=>r.maximum===null?[]:[r.maximum]));
  return <section className="eff-card" aria-label="任务类型分布" onKeyDown={e=>{if(e.key==='Escape')setTooltip('');}}>
    <header><div><h2>按任务类型的产效分布</h2><p>已验证结果 / 百万 Token · 竖线为中位数</p></div><div className="usage-view-toggle" role="group" aria-label="产效分布显示方式"><button aria-label="产效分布图表" aria-pressed={chart} onClick={()=>setChart(true)}>图表</button><button aria-label="产效分布表格" aria-pressed={!chart} onClick={()=>{setChart(false);setTooltip('');}}>表格</button></div></header>
    {chart?<div className="eff-chart-scroll"><svg viewBox={`0 0 760 ${Math.max(110,rows.length*54+40)}`} className="eff-distribution" role="group" aria-label="按任务类型产效分布图">
      {[0,.25,.5,.75,1].map(f=><g key={f}><line x1={90+f*550} x2={90+f*550} y1="8" y2={rows.length*54+8}/><text x={90+f*550} y={rows.length*54+32} textAnchor="middle">{number(f*maximum)}</text></g>)}
      {rows.map((row,i)=><g key={row.taskType}><text x="75" y={35+i*54} textAnchor="end">{taskTypeLabels[row.taskType]}</text><line x1="90" x2="640" y1={30+i*54} y2={30+i*54}/>
        {row.median!==null&&<line className="eff-median" x1={90+row.median/maximum*550} x2={90+row.median/maximum*550} y1={14+i*54} y2={46+i*54}/>}
        {row.points.map(point=>{const label=`${taskTypeLabels[row.taskType]} · ${number(point.value)} · ${point.count} 个会话`;return <circle key={point.value} role="img" tabIndex={0} aria-label={label} cx={90+point.value/maximum*550} cy={30+i*54} r="5" onFocus={()=>setTooltip(label)} onBlur={()=>setTooltip('')} onMouseEnter={()=>setTooltip(label)} onMouseLeave={()=>setTooltip('')}/>;})}
        <text x="660" y={35+i*54}>{row.count?`n=${row.count}`:'未知'}{row.unknownCount>0&&row.count>0?` · 未知 ${row.unknownCount}`:''}</text>
      </g>)}
    </svg></div>:<div className="eff-table-scroll"><table aria-label="任务类型产效"><thead><tr><th>任务类型</th><th>已知会话</th><th>未知</th><th>中位数</th><th>范围</th></tr></thead><tbody>{rows.map(r=><tr key={r.taskType}><th>{taskTypeLabels[r.taskType]}</th><td>{r.count}</td><td>{r.unknownCount}</td><td>{number(r.median)}</td><td>{r.minimum===null?'未知':`${number(r.minimum)} — ${number(r.maximum)}`}</td></tr>)}</tbody></table></div>}
    {tooltip&&<p role="tooltip" className="eff-tooltip">{tooltip}</p>}
  </section>;
}

function Ratio({label,ratio}: {label:string;ratio:EfficiencyRatio}){return <div><dt>{label}</dt><dd>{number(ratio.value)}</dd><small>{number(ratio.numerator)} / {number(ratio.denominator)} Token</small></div>;}
function SelectedSession({row,onClose}: {row:EfficiencySession;onClose:()=>void}){
  const timing=row.timing,known=timing?.segments.filter(s=>s.durationMs!==null&&s.durationMs>0)??[],total=known.reduce((n,s)=>n+s.durationMs!,0);
  return <section className="eff-card eff-selected" aria-label="选中会话"><header><div><h2>会话分段</h2><p>{row.employees.map(e=>e.employee).join('、')} · {sourceLabel(row.source)}</p></div><button onClick={onClose} aria-label="关闭会话分段">关闭</button></header>
    <p className="eff-id">{row.sourceSessionId}</p><a href={row.webPath}>阅读原始对话</a>
    <dl className="eff-ratios"><Ratio label="产效比" ratio={row.efficiency}/><Ratio label="代码产出" ratio={row.codeOutput}/><div><dt>等待占比</dt><dd>{timing?.waitFraction.value===null||!timing?'未知':number(timing.waitFraction.value*100)+'%'}</dd><small>{time(timing?.waitFraction.numerator??null)} / {time(timing?.waitFraction.denominator??null)}</small></div></dl>
    {timing&&<><div className="eff-segment-bar" role="img" aria-label={`已确认分段：Agent 工作 ${time(timing.knownAgentMs)}，等待回复 ${time(timing.knownReplyMs)}`}>
      {known.map((s,i)=><i key={i} data-kind={s.kind} style={{'--segment-width':`${s.durationMs!/total*100}%`} as CSSProperties}/>)}
    </div><div className="eff-legend"><span data-kind="agent">Agent 工作</span><span data-kind="reply">等待回复</span><span data-kind="permission">等待权限 · 未知</span></div>
      <ol className="eff-segments">{timing.segments.map((s,i)=><li key={i} data-kind={s.kind}><div><strong>{names[s.kind]}</strong><span>{time(s.durationMs)}</span></div>
        {(s.startedAt||s.endedAt)&&<p>{s.startedAt?new Date(s.startedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'未知'} → {s.endedAt?new Date(s.endedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'未知'}</p>}
        {s.reason&&<details><summary>来源边界</summary><p>{s.reason}</p></details>}
        <div className="eff-evidence-links">{s.evidence.map((e,j)=><a key={j} href={e.conversationPath??e.webPath}>原件 #{e.line}</a>)}</div>
      </li>)}</ol></>}
    <details><summary>任务类型与返工证据</summary><p>模型推断 · {taskTypeLabels[row.taskType]} · 返工 {number(row.rework)}</p>{[...row.taskEvidence,...row.reworkEvidence].map((e,i)=><blockquote key={i}>{e.quote}<a href={e.webPath}>原句</a></blockquote>)}</details>
    <details><summary>固定输入版本</summary><p>等待 {timing?.waitVersion??'未知'}</p>{row.inputVersions.map(v=><p key={v.snapshotId}>{v.snapshotId} · {v.version}</p>)}</details>
  </section>;
}

export function SessionEfficiency({request}:Props){
  const [query,setQuery]=useState<EfficiencyQuery>({period:'this-week',offset:0,sort:'date',direction:'desc',reviewOnly:'false'});
  const [page,setPage]=useState<SessionEfficiencyPage|null>(null),[full,setFull]=useState<SessionEfficiencyPage|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  const [selected,setSelected]=useState(''),[project,setProject]=useState(''),[employees,setEmployees]=useState<EfficiencySession['employees']>([]),[exporting,setExporting]=useState(false);
  useEffect(()=>{const abort=new AbortController();setBusy(true);setError('');setPage(null);
    request('/api/session-efficiency?'+params(query),abort.signal).then(r=>r.json()).then(async(data:SessionEfficiencyPage)=>{
      if(abort.signal.aborted)return;setPage(data);
      const complete=data.total===data.sessions.length?data:await(await request('/api/session-efficiency/export?'+params({...query,offset:0,version:data.version}),abort.signal)).json() as SessionEfficiencyPage;
      if(abort.signal.aborted)return;setFull(complete);setEmployees(previous=>[...new Map([...previous,...complete.sessions.flatMap(s=>s.employees)].map(p=>[p.employeeId,p])).values()].sort((a,b)=>a.employee.localeCompare(b.employee,'zh-CN')||a.employeeId.localeCompare(b.employeeId)));
    }).catch(f=>{if(!abort.signal.aborted)setError(f.message);}).finally(()=>{if(!abort.signal.aborted)setBusy(false);});return()=>abort.abort();
  },[query,retry]);
  function scope(next:Partial<EfficiencyQuery>){setSelected('');setFull(null);setQuery({...query,...next,offset:0,version:undefined});}
  function apply(e:FormEvent){e.preventDefault();scope({project:project||undefined});}
  function sort(key:EfficiencyQuery['sort']){if(page)setQuery({...query,version:page.version,offset:0,sort:key,direction:query.sort===key&&query.direction==='desc'?'asc':'desc'});}
  async function download(){if(!page)return;setExporting(true);try{const response=await request('/api/session-efficiency/export?'+params({...query,offset:0,version:page.version}));const url=URL.createObjectURL(await response.blob()),link=document.createElement('a');link.href=url;link.download='skynet-session-efficiency-'+page.version+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){setError((e as Error).message);}finally{setExporting(false);}}
  async function recompute(){setBusy(true);try{const data=await(await request('/api/session-efficiency/recompute',undefined,'POST',{...query,offset:0,version:undefined})).json();setSelected('');setQuery({...query,offset:0,version:data.version});}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  const complete=full?.version===page?.version?full:null,selection=complete?.sessions.find(s=>s.sessionId===selected),reviews=complete?.sessions.filter(s=>s.reviewReasons.length)??[];
  const columns: {key:EfficiencyQuery['sort'];label:string}[]=[{key:'date',label:'日期'},{key:'tokens',label:'Token'},{key:'prompts',label:'提示词'},{key:'code',label:'代码变更'},{key:'verified',label:'已验证'},{key:'efficiency',label:'产效比'},{key:'rework',label:'返工'}];
  return <section className="usage-metrics efficiency-page workspace-page" aria-label="会话产效" aria-busy={busy}>
    <div className="usage-page-head"><h1>会话产效</h1><div className="usage-export-actions"><button disabled={busy||!page} onClick={recompute}>从原件重算</button><button disabled={busy||!page||exporting} onClick={download}>导出当前版本</button></div></div>
    <form className="usage-filters" aria-label="产效筛选" onSubmit={apply}><div className="usage-filter-row"><div className="usage-periods" role="group" aria-label="时间范围">{(['this-week','last-week','since-enrollment'] as const).map((p,i)=><button type="button" key={p} aria-pressed={query.period===p} onClick={()=>scope({period:p})}>{['本周','上周','接入至今'][i]}</button>)}</div>
      <label>员工<select aria-label="员工" value={query.employeeId??''} onChange={e=>scope({employeeId:e.target.value||undefined})}><option value="">全部员工</option>{employees.map(p=><option key={p.employeeId} value={p.employeeId}>{p.employee}</option>)}</select></label>
      <label>Agent<select aria-label="Agent" value={query.source??''} onChange={e=>scope({source:e.target.value as Source||undefined})}><option value="">全部 Agent</option>{sources.map(s=><option key={s} value={s}>{sourceLabel(s)}</option>)}</select></label>
      <label className="usage-project-field">项目<input aria-label="项目路径" value={project} onChange={e=>setProject(e.target.value)} placeholder="全部项目"/></label><button type="submit">应用</button></div>
      {page&&<p className="eff-asof">{page.scope.from} — {page.scope.to} · 北京时间 · 数据截至 {new Date(page.dataAsOf).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}</p>}
    </form>
    {error&&<div role="alert"><p>{error}</p><button onClick={()=>setRetry(v=>v+1)}>重试读取</button></div>}
    <div className="workspace-scroll eff-workspace"><details className="eff-definition"><summary>产效比 · 代码产出 · 等待占比</summary><p>{page?.definition}</p><p>等待占比 = 已记录等待 / 已记录活跃区间。边界缺失、未知权限等待和零区间不计算；任务类型为模型推断。</p>{page&&<p>版本 {page.version} · {page.algorithmVersion}</p>}</details>
      {busy&&!page?<p role="status">正在读取会话产效…</p>:page?.total===0?<p className="eff-empty">暂无会话</p>:page&&<><Distribution rows={page.distributions}/>
        <section className="eff-review" aria-label="值得复盘的会话"><header><h2>值得复盘的会话 <span>{page.reviewCount}</span></h2><details><summary>入选条件</summary><p>Token 高于 P75（{number(page.tokenP75)}）且已验证结果为 0；或声称多于已验证；或返工 ≥ 2。</p></details></header>
          {!complete?<p role="status">正在读取固定版本…</p>:!reviews.length?<p>暂无符合条件的会话</p>:<ul>{reviews.map(row=><li key={row.sessionId}><button onClick={()=>setSelected(row.sessionId)}><strong>{row.employees.map(e=>e.employee).join('、')}</strong><span>{row.projects.join(' · ')||sourceLabel(row.source)}</span><small>{row.reviewReasons.join(' · ')}</small></button></li>)}</ul>}
        </section>
        <div className="eff-detail-grid" data-selected={!!selection}><section className="eff-card" aria-label="会话列表"><header><h2>会话明细 <span>{page.filteredTotal}</span></h2><label className="eff-only-review"><input type="checkbox" checked={query.reviewOnly==='true'} onChange={e=>setQuery({...query,offset:0,version:page.version,reviewOnly:e.target.checked?'true':'false'})}/>仅复盘会话</label></header>
          <div className="eff-table-scroll"><table aria-label="会话明细"><thead><tr><th>员工 / 项目</th>{columns.map(c=><th key={c.key} aria-sort={query.sort===c.key?query.direction==='asc'?'ascending':'descending':'none'}><button onClick={()=>sort(c.key)} aria-label={`按 ${c.label} 排序`}>{c.label}{query.sort===c.key?query.direction==='asc'?' ↑':' ↓':''}</button></th>)}<th>详情</th></tr></thead>
            <tbody>{page.sessions.map(row=><tr key={row.sessionId} data-selected={row.sessionId===selected}><th><strong>{row.employees.map(e=>e.employee).join('、')}</strong><span>{row.projects.join(' · ')}</span><small>{sourceLabel(row.source)} · {taskTypeLabels[row.taskType]}</small></th><td>{row.dates.at(-1)??'未知'}</td><td>{number(row.tokens)}</td><td>{number(row.userTurns)}</td><td>{number(row.codeChanges)}</td><td>{number(row.verified)}</td><td><strong>{number(row.efficiency.value)}</strong><small>{number(row.efficiency.numerator)} / {number(row.efficiency.denominator)} Token</small></td><td>{number(row.rework)}</td><td><button onClick={()=>setSelected(row.sessionId)} aria-label="查看会话分段">分段</button></td></tr>)}</tbody></table></div>
          <nav className="eff-pagination" aria-label="产效会话分页"><button disabled={busy||query.offset===0} onClick={()=>setQuery({...query,version:page.version,offset:Math.max(0,query.offset-20)})}>上一页会话</button><span>第 {Math.floor(query.offset/20)+1} 页</span><button disabled={busy||page.nextOffset===null} onClick={()=>setQuery({...query,version:page.version,offset:page.nextOffset!})}>下一页会话</button></nav>
        </section>{selection&&<SelectedSession row={selection} onClose={()=>setSelected('')}/>}</div>
      </>}
    </div>
  </section>;
}
