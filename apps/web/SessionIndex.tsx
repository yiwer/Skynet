import { useMemo, useState } from 'react';
import { sourceLabel, type SessionSummary } from '../../packages/contracts/archive.js';

type Props = { sessions: SessionSummary[]; busy: boolean; recovery: boolean; hasMore: boolean;
  onLoadMore: () => void; onRefresh: () => void; onSearch: () => void };
export function SessionIndex({ sessions, busy, recovery, hasMore, onLoadMore, onRefresh, onSearch }: Props) {
  const [source, setSource] = useState(''); const [employee, setEmployee] = useState('');
  const employees = useMemo(() => [...new Map(sessions.map(s => [s.employeeId, { id: s.employeeId, name: s.employee }])).values()].sort((a,b)=>a.name.localeCompare(b.name,'zh-CN')), [sessions]);
  const visible = sessions.filter(s => (!source || s.source === source) && (!employee || s.employeeId === employee));
  return <section className="sessions-index" aria-label={recovery ? '会话找回' : '会话列表'}>
    <div className="session-index-heading"><div><h1>{recovery ? '会话找回' : '会话'}</h1></div>
      <button onClick={onSearch}>搜索会话</button></div>
    {recovery && <ol className="recovery-steps" aria-label="找回步骤"><li aria-current="step"><b>1</b>选择会话</li><li><b>2</b>核对原件</li><li><b>3</b>准备恢复</li></ol>}
    <div className="session-list-controls"><div className="session-agent-filter" role="group" aria-label="按 Agent 筛选">{[
      ['', '全部'], ['claude-code-cli', 'Claude Code CLI'], ['codex-cli', 'Codex CLI'], ['codex-desktop', 'Codex Desktop'],
    ].map(([value,label]) => <button key={value} aria-pressed={source === value} onClick={() => setSource(value!)}>{label}</button>)}</div>
      <label>员工<select value={employee} onChange={event=>setEmployee(event.target.value)}><option value="">全部员工</option>{employees.map(person=><option key={person.id} value={person.id}>{person.name}{employees.filter(other=>other.name===person.name).length>1?` · ${person.id.slice(0,8)}`:''}</option>)}</select></label>
      <span className="muted">{visible.length} 个会话{hasMore ? '（已加载）' : ''}</span><button disabled={busy} onClick={onRefresh}>{busy ? '正在刷新…' : '刷新存档'}</button></div>
    {busy && <p role="status">正在读取存档…</p>}
    {visible.length>0&&<div className="session-table-wrap" data-scroll-region="session-list"><table className="session-table"><thead><tr><th>提交日期</th><th>员工</th><th>会话</th><th>项目</th><th>Agent</th><th>大小</th></tr></thead><tbody>{visible.map(session=>{
      const project = session.project.replaceAll('\\','/').split('/').filter(Boolean).at(-1) || '未归类项目';
      return <tr key={session.id}><td><time>{new Date(session.committed_at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false})}</time></td>
        <td><span className="session-person"><span className="session-avatar" aria-hidden="true">{session.employee.slice(0,1)}</span>{session.employee}</span></td>
        <td><a className="session-title-link" href={`#${session.id}${recovery?'?recover=true':''}`}><span className="hash">{session.source_session_id}</span><span>{project}</span></a></td>
        <td><span className="session-project-chip" title={session.project}>{project}</span></td><td>{sourceLabel(session.source)}</td><td>{session.byte_length.toLocaleString('zh-CN')} B</td></tr>;
    })}</tbody></table></div>}
    {!busy && visible.length === 0 && <div className="empty"><h2>{sessions.length?'没有匹配会话':'暂无会话'}</h2></div>}
    {hasMore && <button disabled={busy} onClick={onLoadMore}>加载更多会话</button>}
  </section>;
}
