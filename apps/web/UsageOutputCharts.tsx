import { useState, type CSSProperties, type ReactNode } from 'react';
import type { OutputAmount, UsageOutputPage, UsageSession } from '../../packages/contracts/usage-output.js';
import { sourceLabel } from '../../packages/contracts/archive.js';

const number = (n: number) => n.toLocaleString('zh-CN');
const compact = (n: number) => n >= 1e6 ? `${Number((n / 1e6).toFixed(2))}M` : n >= 1000 ? `${Number((n / 1000).toFixed(1))}k` : number(n);
export function Amount({ amount, children }: { amount: OutputAmount; children?: ReactNode }) {
  return <span>{amount.value === null && !amount.known ? '未知' : <>{children ?? number(amount.known)}{amount.value === null && <sup title={`${amount.unknownSessions} 个会话未知`} className="usage-partial">*</sup>}</>}</span>;
}
export function OutputKpis({ page }: { page: UsageOutputPage }) {
  const { outputs: o, totals: t } = page;
  return <dl className="usage-stats">
    <div className="usage-stat"><dt>输入 Token</dt><dd>{t.inputTokens === null && !t.knownInputTokens ? '未知' : compact(t.knownInputTokens)}{t.inputTokens === null && t.knownInputTokens > 0 && <sup>*</sup>}</dd><div className="usage-stat-sub">输出 {t.outputTokens === null && !t.knownOutputTokens ? '未知' : compact(t.knownOutputTokens)}{t.unknownTokenSessions > 0 && <> · {t.unknownTokenSessions} 个会话未知</>}</div></div>
    <div className="usage-stat"><dt>会话</dt><dd>{number(t.sessions)}</dd><div className="usage-stat-sub">{number(t.userTurns)} 轮提示词 · {number(t.toolCalls)} 次工具调用</div></div>
    <div className="usage-stat"><dt>已验证结果</dt><dd><Amount amount={o.verified} /></dd><div className="usage-stat-sub">仅声称 <Amount amount={o.claimed} /></div></div>
    <div className="usage-stat"><dt>代码变更</dt><dd><Amount amount={o.codeChanges}>+{number(o.codeChanges.added)}</Amount></dd><div className="usage-stat-sub">删除 {number(o.codeChanges.removed)} 行{o.codeChanges.unknownSessions > 0 && <> · {o.codeChanges.unknownSessions} 个会话未知</>}</div></div>
    <div className="usage-stat"><dt>测试通过</dt><dd>{o.tests.known ? `${Number((o.tests.passed / o.tests.known * 100).toFixed(1))}%` : o.tests.value === null ? '未知' : '—'}{o.tests.known > 0 && o.tests.value === null && <sup>*</sup>}</dd><div className="usage-stat-sub">{o.tests.known ? `${number(o.tests.passed)} / ${number(o.tests.known)}` : ''} · 会话内提交 <Amount amount={o.commits} /></div></div>
  </dl>;
}
function FigureToggle({ name, chart, setChart }: { name: string; chart: boolean; setChart: (v: boolean) => void }) {
  return <div className="usage-view-toggle" role="group" aria-label={`${name}显示方式`}><button type="button" aria-pressed={chart} aria-label={`${name}切换为图表`} onClick={() => setChart(true)}>图表</button><button type="button" aria-pressed={!chart} aria-label={`${name}切换为表格`} onClick={() => setChart(false)}>表格</button></div>;
}
export function OutputTable({ page }: { page: UsageOutputPage }) {
  const max = (kind: 'verified'|'claimed'|'codeChanges'|'tests') => Math.max(1, ...page.employees.map(row => row.outputs[kind].known));
  const cell = (amount: OutputAmount, maximum: number, children?: ReactNode, muted = false) => <td><span className="usage-output-cell" data-muted={muted} style={{ '--amount-width': `${amount.known / maximum * 100}%` } as CSSProperties}><i aria-hidden="true"/><span><Amount amount={amount}>{children}</Amount></span></span></td>;
  return <section className="usage-figure" aria-label="每人产出"><div className="usage-figure-head"><h2>每人产出</h2></div><div className="usage-table-scroll"><table><caption>各员工会话内产出</caption><thead><tr><th>员工</th><th>会话</th><th>已验证</th><th>仅声称</th><th>代码变更行</th><th>测试通过</th><th>提交</th></tr></thead><tbody>{page.employees.map(row => <tr key={row.employeeId}><th scope="row">{row.employee}</th><td>{row.sessions}</td>{cell(row.outputs.verified, max('verified'))}{cell(row.outputs.claimed, max('claimed'), undefined, true)}{cell(row.outputs.codeChanges, max('codeChanges'), <>+{number(row.outputs.codeChanges.added)} / −{number(row.outputs.codeChanges.removed)}</>)}{cell(row.outputs.tests, max('tests'), <>{number(row.outputs.tests.passed)} / {number(row.outputs.tests.known)}</>)}<td><Amount amount={row.outputs.commits}/></td></tr>)}</tbody></table></div></section>;
}
export function UsageScatter({ page }: { page: UsageOutputPage }) {
  const [chart, setChart] = useState(true), [tooltip, setTooltip] = useState('');
  const knownY = page.sessions.filter(row => row.outputs.verified.value !== null);
  const known = knownY.filter(row => row.inputTokens !== null), unknownX = knownY.filter(row => row.inputTokens === null), unknownY = page.sessions.filter(row => row.outputs.verified.value === null);
  const xmax = Math.max(1, ...known.map(row => row.knownInputTokens)), ymax = Math.max(1, ...knownY.map(row => row.outputs.verified.known));
  const label = (row: UsageSession) => `${row.employee} · ${sourceLabel(row.source)} · 输入 ${row.inputTokens === null ? '未知' : number(row.knownInputTokens)} · 已验证 ${row.outputs.verified.value === null ? '未知' : number(row.outputs.verified.known)}${!row.selected ? ' · 参照' : ''}`;
  const attrs = (row: UsageSession) => ({ 'aria-label': label(row), onFocus: () => setTooltip(label(row)), onBlur: () => setTooltip(''), onMouseEnter: () => setTooltip(label(row)), onMouseLeave: () => setTooltip(''), onKeyDown: (event: React.KeyboardEvent) => { if (event.key === 'Escape') setTooltip(''); } });
  return <section className="usage-figure" aria-label="会话散点"><div className="usage-figure-head"><h2>会话：Token 与已验证结果</h2><FigureToggle name="会话散点" chart={chart} setChart={setChart}/></div>
    {chart ? <><div className="usage-scatter-scroll"><svg viewBox="0 0 860 260" className="usage-scatter" role="group" aria-label="会话 Token 与已验证结果散点图">
      {[0,.25,.5,.75,1].map(t => <g key={t}><line className="usage-chart-grid" x1="52" x2="692" y1={214-t*180} y2={214-t*180}/><text x="40" y={218-t*180} textAnchor="end">{Number((t*ymax).toFixed(1))}</text><text x={52+t*640} y="236" textAnchor="middle">{compact(t*xmax)}</text></g>)}
      <text x="52" y="16">已验证结果</text><text x="380" y="257" textAnchor="middle">输入 Token</text><line className="usage-chart-grid" x1="728" x2="728" y1="28" y2="214"/><text x="790" y="16" textAnchor="middle">Token 未知</text>
      {[...known, ...unknownX].map((row, index) => <a key={`${row.sessionId}/${row.employeeId}/${row.project}`} href={row.webPath} {...attrs(row)}><circle data-reference={!row.selected} cx={row.inputTokens === null ? 768+(index%3)*16 : 52+row.knownInputTokens/xmax*640} cy={214-row.outputs.verified.known/ymax*180+(index%3-1)*3} r="6"/></a>)}
    </svg></div>{unknownY.length > 0 && <div className="usage-scatter-unknown"><h3>结果未知 · {unknownY.length}</h3><div>{unknownY.map(row => <a key={`${row.sessionId}/${row.employeeId}/${row.project}`} href={row.webPath} data-reference={!row.selected} {...attrs(row)}>{row.employee}<span>{row.inputTokens === null ? 'Token 未知' : `${compact(row.knownInputTokens)} Token`}</span></a>)}</div></div>}</>
      : <div className="usage-table-scroll"><table><caption>会话投入与已验证结果</caption><thead><tr><th>员工 / 项目</th><th>Agent</th><th>输入 Token</th><th>已验证</th><th>仅声称</th><th>会话</th></tr></thead><tbody>{page.sessions.map(row => <tr key={`${row.sessionId}/${row.employeeId}/${row.project}`} data-reference={!row.selected}><th>{row.employee}<span className="usage-cell-detail">{row.project || '未归类项目'}</span></th><td>{sourceLabel(row.source)}</td><td>{row.inputTokens === null ? '未知' : number(row.knownInputTokens)}</td><td><Amount amount={row.outputs.verified}/></td><td><Amount amount={row.outputs.claimed}/></td><td><a href={row.webPath}>查看会话</a></td></tr>)}</tbody></table></div>}
    {tooltip && <p className="usage-chart-tooltip" role="tooltip">{tooltip}</p>}
  </section>;
}
export function UsageDailyPeople({ page }: { page: UsageOutputPage }) {
  const [chart, setChart] = useState(true), [tooltip, setTooltip] = useState('');
  const days: string[] = []; for (let day = page.scope.from; day <= page.scope.to && days.length < 3660; ) { days.push(day); const next = new Date(day+'T00:00:00Z'); next.setUTCDate(next.getUTCDate()+1); day=next.toISOString().slice(0,10); }
  const maximum = Math.max(1, ...page.employees.flatMap(row => row.daily.map(day => day.tokenTrend?.inputTokens ?? 0)));
  const width = Math.max(300, days.length*22);
  return <section className="usage-figure" aria-label="每日用量"><div className="usage-figure-head"><h2>每日 Token 输入</h2><FigureToggle name="每日用量" chart={chart} setChart={setChart}/></div>
    {chart ? <div className="usage-small-multiples">{page.employees.map(person => <div className="usage-small" key={person.employeeId}><div className="usage-small-head"><strong>{person.employee}</strong><span>{compact(person.knownInputTokens)}{person.unknownTokenSessions > 0 && <span className="usage-unknown"> {person.unknownTokenSessions} 会话未知</span>}</span></div><div className="usage-daily-scroll"><svg viewBox={`0 0 ${width} 120`} style={{ minWidth: width }} role="group" aria-label={`${person.employee} 每日 Token`}>
      <line className="usage-chart-grid" x1="8" x2={width-8} y1="92" y2="92"/>{days.map((date, index) => { const day=person.daily.find(value=>value.date===date), value=day?.tokenTrend?.inputTokens, unknown=day?.tokenTrend?.excludedSessions ?? 0;
        const label=`${person.employee} · ${date} · ${value === null ? '未知' : number(value ?? 0)}${unknown ? ` · ${unknown} 个会话未知` : ''}`; const x=8+index*(width-16)/days.length,w=Math.max(2,(width-16)/days.length-6);
        return <g key={date} tabIndex={0} role="img" aria-label={label} onFocus={()=>setTooltip(label)} onBlur={()=>setTooltip('')} onMouseEnter={()=>setTooltip(label)} onMouseLeave={()=>setTooltip('')} onKeyDown={event=>{if(event.key==='Escape')setTooltip('');}}><rect data-series="1" x={x} y={92-(value??0)/maximum*70} width={w} height={(value??0)/maximum*70}/>{unknown>0&&<rect className="usage-daily-unknown" x={x} y="10" width={w} height="3"/>}<text x={x+w/2} y="112" textAnchor="middle">{date.slice(5)}</text></g>;
      })}</svg></div></div>)}</div> : <div className="usage-table-scroll"><table><caption>员工每日输入 Token</caption><thead><tr><th>员工</th>{days.map(day=><th key={day}>{day.slice(5)}</th>)}</tr></thead><tbody>{page.employees.map(person=><tr key={person.employeeId}><th scope="row">{person.employee}</th>{days.map(date=>{const day=person.daily.find(value=>value.date===date);return <td key={date}>{day?.tokenTrend?.inputTokens === null ? '未知' : number(day?.tokenTrend?.inputTokens ?? 0)}{(day?.tokenTrend?.excludedSessions??0)>0&&<span className="usage-cell-detail">{day!.tokenTrend!.excludedSessions} 会话未知</span>}</td>;})}</tr>)}</tbody></table></div>}
    {tooltip && <p className="usage-chart-tooltip" role="tooltip">{tooltip}</p>}
  </section>;
}
