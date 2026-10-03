import { useMemo, useState } from 'react';
import { sourceLabel, type SessionSummary } from '../../packages/contracts/archive.js';

type Props = { sessions: SessionSummary[]; busy: boolean; recovery: boolean; hasMore: boolean;
  onLoadMore: () => void; onRefresh: () => void; onSearch: () => void };
export function SessionIndex({ sessions, busy, recovery, hasMore, onLoadMore, onRefresh, onSearch }: Props) {
  const [source, setSource] = useState(''); const [employee, setEmployee] = useState('');
  const employees = useMemo(() => [...new Map(sessions.map(s => [s.employeeId, { id: s.employeeId, name: s.employee }])).values()].sort((a,b)=>a.name.localeCompare(b.name,'zh-CN')), [sessions]);
  const visible = sessions.filter(s => (!source || s.source === source) && (!employee || s.employeeId === employee));
  return <section className="sessions-index" aria-label={recovery ? '会话找回' : '会话列表'}>
    <div className="session-index-heading"><div><h1>{recovery ? '会话找回' : '会话'}</h1><p>{recovery
      ? '找到原件，核对来源和恢复条件，再下载恢复包。原有会话与工作目录保持完整。'
      : '所有已存档会话。原件保存全部可获得的对话、工具记录与会话内代码变更；缺口会被标出。'}</p></div>
      <button onClick={onSearch}>搜索会话</button></div>
    {recovery && <ol className="recovery-steps" aria-label="找回步骤"><li aria-current="step"><b>1</b>选择会话</li><li><b>2</b>核对原件</li><li><b>3</b>准备恢复</li></ol>}
    <div className="session-list-controls"><div className="session-agent-filter" role="group" aria-label="按 Agent 筛选">{[
      ['', '全部'], ['claude-code-cli', 'Claude Code CLI'], ['codex-cli', 'Codex CLI'], ['codex-desktop', 'Codex Desktop'],
    ].map(([value,label]) => <button key={value} aria-pressed={source === value} onClick={() => setSource(value!)}>{label}</button>)}</div>
      <label>员工<select value={employee} onChange={event=>setEmployee(event.target.value)}><option value="">全部员工</option>{employees.map(person=><option key={person.id} value={person.id}>{person.name}{employees.filter(other=>other.name===person.name).length>1?` · ${person.id.slice(0,8)}`:''}</option>)}</select></label>
      <span className="muted">{visible.length} 个会话{hasMore ? '（已加载）' : ''}</span><button disabled={busy} onClick={onRefresh}>{busy ? '正在刷新…' : '刷新存档'}</button></div>
    {busy && <p role="status">正在读取存档…</p>}
    <div className="session-table-wrap"><table className="session-table"><thead><tr><th>提交日期</th><th>员工</th><th>会话</th><th>项目</th><th>Agent</th><th>原件大小</th><th>存档</th></tr></thead><tbody>{visible.map(session=>{
      const project = session.project.replaceAll('\\','/').split('/').filter(Boolean).at(-1) || '未归类项目';
      return <tr key={session.id}><td><time>{new Date(session.committed_at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false})}</time></td>
        <td><span className="session-person"><span className="session-avatar" aria-hidden="true">{session.employee.slice(0,1)}</span>{session.employee}</span></td>
        <td><a className="session-title-link" href={`#${session.id}${recovery?'?recover=true':''}`}><span className="hash">{session.source_session_id}</span><span>{project}</span></a></td>
        <td><span className="session-project-chip" title={session.project}>{project}</span></td><td>{sourceLabel(session.source)}</td><td>{session.byte_length.toLocaleString('zh-CN')} B</td><td><span className="badge">原件已提交</span></td></tr>;
    })}</tbody></table></div>
    {!busy && visible.length === 0 && <div className="empty"><h2>没有符合条件的会话</h2><p>已提交的会话会出现在这里。可调整筛选，或在后台上传后刷新。</p></div>}
    {hasMore && <button disabled={busy} onClick={onLoadMore}>加载更多会话</button>}
    <details className="archive-coverage-note"><summary>存档与完整性说明</summary><p>当前保存单副本。原件已提交与原生恢复已验证是不同状态；Desktop 原生能力待验证。按提交时间分页读取，筛选作用于已加载会话；全量搜索可通过侧栏搜索入口进行。</p></details>
  </section>;
}
