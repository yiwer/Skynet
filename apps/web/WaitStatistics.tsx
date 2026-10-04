import {useState,useRef} from 'react';
import type {WaitReport,WaitFraction} from '../../packages/contracts/wait-report.js';
const weekdays=['周一','周二','周三','周四','周五','周六','周日'];
const duration=(ms:number|null)=>ms===null?'未知':`${Math.floor(ms/60000)} 分 ${Number((ms%60000/1000).toFixed(3))} 秒`;
const percent=(f:WaitFraction)=>f.value===null?'未知':`${Number((f.value*100).toFixed(1))}%`;
function Toggle({label,table,onChange}:{label:string;table:boolean;onChange:(v:boolean)=>void}){return <div className="usage-view-toggle" role="group" aria-label={label}>{[false,true].map(v=><button type="button" key={String(v)} aria-label={label+(v?'表格':'图表')} aria-pressed={table===v} onClick={()=>onChange(v)}>{v?'表格':'图表'}</button>)}</div>;}
export function WaitStatistics({report,sourceUnavailable=false}:{report:WaitReport;sourceUnavailable?:boolean}){
  const [heatTable,setHeatTable]=useState(false),[peopleTable,setPeopleTable]=useState(false),[focus,setFocus]=useState(''),[personFocus,setPersonFocus]=useState('');
  const heatClicked=useRef(''),closeHeat=()=>{heatClicked.current='';setFocus('');};
  const personClicked=useRef(''),closePerson=()=>{personClicked.current='';setPersonFocus('');};
  const s=report.summary,maxHeat=Math.max(1,...report.heatmap.map(c=>c.medianMs??0)),maxPerson=Math.max(1,...report.people.map(p=>p.maximumMs??0));
  const cellText=(c:WaitReport['heatmap'][number])=>`${weekdays[c.weekday]} ${String(c.hour).padStart(2,'0')}:00 · ${c.count} 条等待 · 中位数 ${duration(c.medianMs)}`;
  return <>
    <dl className="usage-stats wait-stats wait-report-stats">
      <div className="usage-stat"><dt>等待中位数</dt><dd data-testid="wait-report-median">{duration(s.medianMs)}</dd><span>{s.knownCount} 段已知 · {sourceUnavailable?'区间总数未知':`${s.unknownCount} 段未知`}</span></div>
      <div className="usage-stat"><dt>等待 P90</dt><dd data-testid="wait-report-p90">{duration(s.p90Ms)}</dd><span>{s.knownCount} 段已知</span></div>
      <div className="usage-stat"><dt>长等待占比</dt><dd data-testid="wait-report-long">{percent(s.longFraction)}</dd><span>{s.longFraction.numerator} / {s.longFraction.denominator} 段 · ≥ 10 分钟</span></div>
      <div className="usage-stat"><dt>权限等待中位数</dt><dd data-testid="wait-permission-total"><span data-testid="wait-report-permission">{duration(s.permissionMedianMs)}</span></dd></div>
      <div className="usage-stat"><dt>期间在其他会话中活动</dt><dd data-testid="wait-report-parallel">{percent(s.parallelFraction)}</dd><span>{s.parallelFraction.numerator} / {s.parallelFraction.denominator} 段</span></div>
    </dl>
    <section className="usage-figure" aria-label="星期与小时" onKeyDown={event=>{if(event.key==='Escape')closeHeat();}}><div className="usage-figure-head"><div><h2>星期与小时</h2><p>等待中位数 · 北京时间</p></div><Toggle label="热力图" table={heatTable} onChange={value=>{closeHeat();setHeatTable(value);}}/></div>
      {heatTable?<div className="usage-table-scroll wait-stat-table"><table aria-label="星期与小时等待中位数"><thead><tr><th>星期</th><th>小时</th><th>等待段数</th><th>中位数</th></tr></thead><tbody>{report.heatmap.map(c=><tr key={`${c.weekday}:${c.hour}`}><th>{weekdays[c.weekday]}</th><td>{String(c.hour).padStart(2,'0')}:00</td><td>{c.count}</td><td>{c.count?duration(c.medianMs):'无记录'}</td></tr>)}</tbody></table></div>:<>
        <div className="wait-heat-scroll" tabIndex={0} aria-label="小时热力图横向滚动区"><div className="wait-heat-grid"><span/>{Array.from({length:24},(_,h)=><span className="wait-hour" key={h}>{String(h).padStart(2,'0')}</span>)}
          {weekdays.map((label,day)=><div className="wait-heat-row" key={label}><span>{label}</span>{report.heatmap.filter(c=>c.weekday===day).map(c=>c.count?<button type="button" key={c.hour} className="wait-heat-cell" data-level={Math.min(4,Math.max(1,Math.ceil((c.medianMs??0)/maxHeat*4)))} aria-label={cellText(c)} aria-expanded={focus===cellText(c)} onFocus={()=>setFocus(cellText(c))} onBlur={closeHeat} onPointerEnter={event=>{if(event.pointerType==='mouse')setFocus(cellText(c));}} onPointerLeave={event=>{if(event.pointerType==='mouse')closeHeat();}} onClick={()=>{heatClicked.current=heatClicked.current===cellText(c)?'':cellText(c);setFocus(heatClicked.current);}}/>:<span className="wait-heat-cell" key={c.hour} aria-label={`${label} ${c.hour}:00 无记录`}/>)}</div>)}
        </div></div><p className="wait-chart-legend"><span>浅 → 深：等待较短 → 较长</span><span>空格：无记录</span></p>{focus&&<div className="usage-chart-tooltip wait-heat-tooltip" role="status">{focus}</div>}
      </>}
    </section>
    <section className="usage-figure" aria-label="按人等待分布" onKeyDown={event=>{if(event.key==='Escape')closePerson();}}><div className="usage-figure-head"><div><h2>按人等待分布</h2><p>范围、四分位与中位数</p></div><Toggle label="人员分布" table={peopleTable} onChange={value=>{closePerson();setPeopleTable(value);}}/></div>
      {peopleTable?<div className="usage-table-scroll wait-stat-table"><table aria-label="按人等待分布"><thead><tr><th>员工</th><th>已知 / 未知</th><th>最短</th><th>Q1</th><th>中位数</th><th>Q3</th><th>最长</th><th>P90</th><th>其他会话活动</th></tr></thead><tbody>{report.people.map(p=><tr key={p.employeeId}><th>{p.employee}</th><td>{p.count} / {p.unknownCount}</td>{[p.minimumMs,p.q1Ms,p.medianMs,p.q3Ms,p.maximumMs,p.p90Ms].map((v,i)=><td key={i}>{duration(v)}</td>)}<td>{percent(p.parallelFraction)} · {p.parallelFraction.numerator}/{p.parallelFraction.denominator}</td></tr>)}</tbody></table></div>:<div className="wait-person-plots">{report.people.map(p=>{
        const x=(v:number|null)=>8+(v??0)/maxPerson*584;
        const text=`${p.employee} · ${p.count} 段已知，${p.unknownCount} 段未知 · 最短 ${duration(p.minimumMs)} · Q1 ${duration(p.q1Ms)} · 中位数 ${duration(p.medianMs)} · Q3 ${duration(p.q3Ms)} · 最长 ${duration(p.maximumMs)} · P90 ${duration(p.p90Ms)}`;
        return <div key={p.employeeId} className="wait-person-row"><span>{p.employee}</span>{p.count?<button type="button" className="wait-person-plot" aria-label={text} aria-expanded={personFocus===text} onFocus={()=>setPersonFocus(text)} onBlur={closePerson} onPointerEnter={event=>{if(event.pointerType==='mouse')setPersonFocus(text);}} onPointerLeave={event=>{if(event.pointerType==='mouse')closePerson();}} onClick={()=>{personClicked.current=personClicked.current===text?'':text;setPersonFocus(personClicked.current);}}>
          <svg viewBox="0 0 600 32" aria-hidden="true"><line x1={x(p.minimumMs)} x2={x(p.maximumMs)} y1="16" y2="16"/><line x1={x(p.minimumMs)} x2={x(p.minimumMs)} y1="10" y2="22"/><line x1={x(p.maximumMs)} x2={x(p.maximumMs)} y1="10" y2="22"/><rect x={x(p.q1Ms)} y="8" width={Math.max(2,x(p.q3Ms)-x(p.q1Ms))} height="16"/><line className="wait-person-median" x1={x(p.medianMs)} x2={x(p.medianMs)} y1="6" y2="26"/></svg>
          <span>中位数 {duration(p.medianMs)} · {p.count} 段{p.unknownCount?` · 未知 ${p.unknownCount} 段`:''}</span></button>:<span>未知 · {p.unknownCount} 段</span>}</div>;
      })}{personFocus&&<div className="usage-chart-tooltip" role="status">{personFocus}</div>}</div>}
      {report.people.length===0&&<p className="usage-empty">{sourceUnavailable?'原件不可读取，等待分布未知':'暂无等待分布'}</p>}
    </section>
    <section className="usage-figure" aria-label="权限请求"><div className="usage-figure-head"><h2>权限请求</h2><span>未知</span></div><p className="usage-empty">尚无可核对的权限请求记录</p><details className="usage-data-status"><summary>权限来源</summary><p>{report.permissions.reason}</p></details></section>
    <details className="usage-data-status"><summary>统计口径与版本</summary><p>{report.definition}</p><p>{report.algorithmVersion} · 等待来源 {report.waitVersion}</p>{report.unknownReasons.map(reason=><p key={reason}>{reason}</p>)}</details>
  </>;
}
