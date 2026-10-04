import {useRef,useState,type PointerEvent} from 'react';
import type {CapabilityProfilePage} from '../../packages/contracts/capability-profile.js';
import type {ProfileCoaching,CoachingExample} from '../../packages/contracts/profile-coaching.js';
import {dimKeys} from '../../packages/contracts/assessment.js';
import './profile-coaching.css';

const number=(value:number|null)=>value===null?'未知':Number(value.toFixed(1)).toLocaleString('zh-CN');
const percent=(value:number|null)=>value===null?'未知':number(value*100)+'%';
const minutes=(value:number|null)=>value===null?'未知':value<60000?number(value/1000)+' 秒':number(value/60000)+' 分钟';
const labels={goal:'目标明确',constraints:'给出约束',context:'提供上下文',acceptance:'验收标准'};
function usePointTip(){const [tip,setTip]=useState<string>(),clicked=useRef<string|undefined>(undefined);const close=()=>{clicked.current=undefined;setTip(undefined);};return {tip,close,props:(key:string)=>({
  'aria-expanded':tip===key,onFocus:()=>setTip(key),onBlur:close,onPointerEnter:(event:PointerEvent<HTMLButtonElement>)=>{if(event.pointerType==='mouse')setTip(key);},
  onPointerLeave:(event:PointerEvent<HTMLButtonElement>)=>{if(event.pointerType==='mouse')close();},onClick:()=>{clicked.current=clicked.current===key?undefined:key;setTip(clicked.current);},
})};}
function FirstPrompts({value}:{value:ProfileCoaching['communication']['firstPrompts']}){
  const [table,setTable]=useState(false),tip=usePointTip(),keys=Object.keys(labels) as (keyof typeof labels)[];
  const observation=(key:keyof typeof labels,who:'person'|'team')=>{const row=value[who].elements[key];return `${who==='person'?'本人':'团队'} ${percent(row.value)} · ${row.numerator}/${row.denominator} 条${row.unknown?' · 未知 '+row.unknown:''}`;};
  return <section aria-label="首条提示词要素" onKeyDown={event=>{if(event.key==='Escape')tip.close();}}><header className="coaching-chart-heading"><h3>首条提示词要素</h3><button aria-label="首条提示词要素表格" aria-pressed={table} onClick={()=>setTable(!table)}>{table?'图表':'表格'}</button></header>
    {table?<div className="profile-table"><table aria-label="首条提示词要素"><thead><tr><th>要素</th><th>本人</th><th>团队</th><th>本人样本</th><th>未知</th></tr></thead><tbody>{keys.map(key=><tr key={key}><th>{labels[key]}</th><td>{percent(value.person.elements[key].value)}</td><td>{percent(value.team.elements[key].value)}</td><td>{value.person.elements[key].numerator}/{value.person.elements[key].denominator}</td><td>{value.person.elements[key].unknown}</td></tr>)}</tbody></table></div>
      :<div className="coaching-elements">{keys.map(key=><button key={key} {...tip.props(key)} aria-label={`${labels[key]}，${observation(key,'person')}，${observation(key,'team')}`}><span>{labels[key]}</span><i aria-hidden="true">{value.person.elements[key].value!==null&&<b style={{width:value.person.elements[key].value!*100+'%'}}/>}{value.team.elements[key].value!==null&&<em style={{left:value.team.elements[key].value!*100+'%'}}/>}</i><strong>{percent(value.person.elements[key].value)}</strong></button>)}<p className="coaching-reference">本人 {value.person.count} 条 · 团队 {value.team.count} 条 <i/> 团队水平</p>
        {tip.tip&&<p role="tooltip" className="coaching-tooltip">{observation(tip.tip as keyof typeof labels,'person')}<br/>{observation(tip.tip as keyof typeof labels,'team')}</p>}</div>}
  </section>;
}
function Example({value,kind}:{value:CoachingExample|null;kind:'best'|'rework'}){return value?<article className={'coaching-example coaching-example-'+kind}><h4>{kind==='best'?'代表性会话':'返工较多的会话'}</h4><blockquote>{value.citation.quote}</blockquote><p>已验证 {number(value.verified)} · {kind==='best'?'无返工':`返工 ${number(value.rework)} 次 · 仅声称 ${number(value.claimed)}`}{value.correctionIds.length?' · 已更正':''}</p><a href={value.citation.webPath}>{kind==='best'?'查看代表原句':'查看返工原句'}</a></article>:null;}
function HourChart({rows}:{rows:ProfileCoaching['waiting']['hours']}){
  const [table,setTable]=useState(false),tip=usePointTip(),max=Math.max(1,...rows.map(row=>row.medianMs??0));
  return <section aria-label="各时段等待" className="coaching-hours" onKeyDown={event=>{if(event.key==='Escape')tip.close();}}><header className="coaching-chart-heading"><h3>各时段等待中位数</h3><div><button aria-label="各时段等待详情" {...tip.props('hours')}>详情</button><button aria-label="各时段等待表格" aria-pressed={table} onClick={()=>setTable(!table)}>{table?'图表':'表格'}</button></div></header>
    {table?<div className="profile-table coaching-scroll-table"><table aria-label="各时段等待"><thead><tr><th>北京时间</th><th>中位数</th><th>样本</th></tr></thead><tbody>{rows.map(row=><tr key={row.hour}><th>{row.hour}:00—{row.hour+1}:00</th><td>{minutes(row.medianMs)}</td><td>{row.count}</td></tr>)}</tbody></table></div>
      :<><svg viewBox="0 0 288 80" role="img" aria-label="按等待起点的北京时间小时归组，未知不绘为零">{rows.map(row=>row.medianMs===null?null:<rect key={row.hour} x={row.hour*12+2} y={70-row.medianMs/max*64} width="8" height={Math.max(1,row.medianMs/max*64)}/>)}<path d="M0 71H288"/></svg><div className="coaching-hour-axis"><span>0:00</span><span>6:00</span><span>12:00</span><span>18:00</span><span>23:00</span></div></>}
    {tip.tip&&<div className="coaching-tooltip coaching-hour-tooltip" role="tooltip">{rows.map(row=><span key={row.hour}>{row.hour}:00 · {minutes(row.medianMs)} · {row.count} 次</span>)}</div>}
  </section>;
}
export function ProfileCollaboration({profile}:{profile:CapabilityProfilePage}){
  const data=profile.coaching;if(!data)return null;const {communication:value,waiting}=data;
  const metric=(label:string,display:string,team?:string)=><div><dt>{label}</dt><dd>{display}{team&&<small>团队 {team}</small>}</dd></div>;
  return <section id="profile-collaboration" tabIndex={-1} className="profile-section" aria-label="协作方式"><h2>协作方式</h2><div className="coaching-pair"><div className="coaching-panel"><header className="coaching-panel-heading"><h3>怎么写提示词</h3><span>模型推断{value.correctionIds.length?' · 已更正':''}</span></header>
    <FirstPrompts value={value.firstPrompts}/><dl className="coaching-kpis">{metric('返工率',percent(value.rework.value),percent(value.team.rework.value))}{metric('Agent 追问率',percent(value.clarification.value),percent(value.team.clarification.value))}{metric('无返工会话',percent(value.cleanSessions.value))}{metric('提示词中位长度',value.medianLength.value===null?'未知':number(value.medianLength.value)+' 字')}</dl>
    <Example value={data.representatives.best} kind="best"/><Example value={data.representatives.rework} kind="rework"/>
    {!data.representatives.best&&!data.representatives.rework&&<p className="profile-empty">当前范围没有符合条件的代表会话。</p>}
    <details className="coaching-rules"><summary>提示词依据与样本</summary><p>只比较原始首条提示词；团队按首条消息合并计算。返工排除首条，追问按每条用户消息对应的 Agent 追问次数计算。未知不进入已知分母。</p><dl>{[['返工',value.rework],['追问',value.clarification],['无返工会话',value.cleanSessions]].map(([label,row])=>{const item=row as typeof value.rework;return <div key={String(label)}><dt>{String(label)}</dt><dd>{item.numerator}/{item.denominator} · 未知 {item.unknown}</dd></div>;})}</dl><p>长度样本 {value.medianLength.knownCount} · 未知 {value.medianLength.unknownCount}；首条边界未知 {value.firstPrompts.person.unknownFirst}。</p>{value.unknownReasons.map(reason=><p key={reason}>{reason}</p>)}<p>最佳示例按已验证结果最多、Token 较少选择；返工示例按返工次数 + 仅声称 − 已验证选择。完全并列时按固定会话身份确定。</p></details>
    </div><div className="coaching-panel"><header className="coaching-panel-heading"><h3>怎么回应 Agent</h3><span>来源时间</span></header><dl className="coaching-kpis">{metric('等待回复中位数',minutes(waiting.summary.medianMs),minutes(waiting.teamMedianMs))}{metric('P90',minutes(waiting.summary.p90Ms))}{metric('10 分钟以上',percent(waiting.summary.longFraction.value))}{metric('期间在别处工作',percent(waiting.summary.parallelFraction.value))}{metric('权限等待中位数',minutes(waiting.summary.permissionMedianMs))}</dl>
      <HourChart rows={waiting.hours}/><details className="coaching-rules"><summary>等待依据与样本</summary><p>已知 {waiting.summary.knownCount} 次 · 未知 {waiting.summary.unknownCount} 次。按等待起点归入北京时间小时，各小时合并原始间隔计算。末尾空闲不计入。</p><p>长等待 {waiting.summary.longFraction.numerator}/{waiting.summary.longFraction.denominator}；其他会话活动 {waiting.summary.parallelFraction.numerator}/{waiting.summary.parallelFraction.denominator}。能力维度会排除已观察到并行活动的长等待。</p><p>权限请求：未知。{waiting.permissions.reason}。</p>{waiting.evidence.map(item=><div className="coaching-wait-evidence" key={item.id}><span>{minutes(item.durationMs)} · {item.parallel==='observed'?'有其他会话活动':item.parallel==='unknown'?'并行状态未知':'未观察到其他会话活动'}</span>{item.start&&<a href={item.start.webPath}>轮次结束原句</a>}<a href={item.end.webPath}>用户回复原句</a></div>)}<p className="coaching-hash">等待版本 {waiting.waitVersion}</p></details>
    </div></div></section>;
}
export function ProfileTrend({profile}:{profile:CapabilityProfilePage}){
  const [table,setTable]=useState(false),tip=usePointTip(),data=profile.coaching?.trend;if(!data)return null;
  const {previous,current}=data,rows=[{key:'index',label:'综合指数',a:previous.index,b:current.index},...dimKeys.map(key=>({key,label:profile.assessment.dims[key].label,a:previous.dimensions[key],b:current.dimensions[key]}))];
  const delta=(a:number|null,b:number|null)=>a===null||b===null?'未知':(b-a>0?'+':'')+number(b-a);
  const describe=(row:typeof rows[number])=>`${row.label} · 上周 ${number(row.a)} · 本周 ${number(row.b)} · 变化 ${delta(row.a,row.b)}`;
  const link=(version:string)=>'#profile?'+new URLSearchParams({employeeId:profile.employeeId,version});
  return <section id="profile-trend" tabIndex={-1} className="profile-section coaching-trend" aria-label="周趋势" onKeyDown={event=>{if(event.key==='Escape')tip.close();}}><header className="profile-section-heading"><div><h2>趋势</h2><p>{previous.range.from}—{previous.range.to} → {current.range.from}—{current.range.to}</p></div><button aria-label="周趋势表格" aria-pressed={table} onClick={()=>setTable(!table)}>{table?'图表':'表格'}</button></header>
    {previous.state==='empty'&&<p className="coaching-empty-week">上周没有会话</p>}{current.state==='empty'&&<p className="coaching-empty-week">本周没有会话</p>}
    {table?<div className="profile-table"><table aria-label="上周与本周"><thead><tr><th>指标</th><th>上周</th><th>本周</th><th>变化</th></tr></thead><tbody>{rows.map(row=><tr key={row.key}><th>{row.label}</th><td>{number(row.a)}</td><td>{number(row.b)}</td><td>{delta(row.a,row.b)}</td></tr>)}</tbody></table></div>
      :<div className="coaching-dumbbells">{rows.map(row=><button key={row.key} {...tip.props(row.key)} aria-label={describe(row)}><span>{row.label}</span><i aria-hidden="true">{row.a!==null&&row.b!==null&&<b style={{left:Math.min(row.a,row.b)+'%',width:Math.abs(row.b-row.a)+'%'}}/>}{row.a!==null&&<em className="previous" style={{left:row.a+'%'}}/>}{row.b!==null&&<em className="current" style={{left:row.b+'%'}}/>}</i><strong>{number(row.b)}<small>{delta(row.a,row.b)}</small></strong></button>)}{tip.tip&&<p className="coaching-tooltip" role="tooltip">{describe(rows.find(row=>row.key===tip.tip)!)}</p>}</div>}
    <div className="coaching-legend"><span><i/>上周 · {previous.sessions} 会话 · 可信度{previous.confidence}</span><span><i/>本周 · {current.sessions} 会话 · 可信度{current.confidence}</span></div>
    <details className="coaching-rules"><summary>趋势口径与固定版本</summary><p>{data.preset}方案；两周使用同一模型和同一团队任务基线。缺失指标保留未知，图中不补零。</p><div className="coaching-week-links"><a href={link(previous.assessmentVersion)}>上周评估</a><a href={link(current.assessmentVersion)}>本周评估</a></div><p className="coaching-hash">模型 {current.modelVersion}<br/>基线 {current.baselineVersion}</p></details>
  </section>;
}
