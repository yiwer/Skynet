import { useEffect, useState } from 'react';
import './device-management.css';

type Device = { id: string; name: string; active: boolean; effectiveActive: boolean };
type Employee = { id: string; name: string; active: boolean; canManageIdentities: boolean; devices: Device[] };
type Audit = { id: string; action: string; occurredAt: string; actorName: string; employeeName: string; deviceName: string | null };
type Target = { id: string; kind: 'employee' | 'device'; name: string };
const date = (value: string) => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });

export function IdentityManagement({ token, currentEmployeeId, onUnauthorized, onDelivery }: {
  token: string; currentEmployeeId: string; onUnauthorized: () => void; onDelivery?: () => void;
}) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [offset, setOffset] = useState(0); const [auditOffset, setAuditOffset] = useState(0);
  const [next, setNext] = useState<number | null>(null); const [auditNext, setAuditNext] = useState<number | null>(null);
  const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false);
  const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [target, setTarget] = useState<Target | null>(null); const [refresh, setRefresh] = useState(0);

  async function request(path: string, method = 'GET', signal?: AbortSignal) {
    const response = await fetch(path, { method, headers: { Authorization: `Bearer ${token}` }, signal });
    if (!response.ok) {
      if (response.status === 401) { onUnauthorized(); throw new Error('身份已停用或凭据失效，请重新登录。'); }
      throw new Error(response.status === 403 ? '当前身份没有账号与设备维护权限。' : '暂时无法读取或更新接入状态，请重试。');
    }
    return response.json();
  }
  useEffect(() => {
    const abort = new AbortController(); setLoading(true); setError('');
    Promise.all([request(`/api/identities?offset=${offset}`, 'GET', abort.signal), request(`/api/identity-audit?offset=${auditOffset}`, 'GET', abort.signal)])
      .then(([identities, history]) => {
        if (!abort.signal.aborted) { setEmployees(identities.employees); setNext(identities.nextOffset); setAudit(history.events); setAuditNext(history.nextOffset); }
      }).catch(failure => { if (!abort.signal.aborted) setError(failure.message); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [token, offset, auditOffset, refresh]);

  async function disable() {
    if (!target || saving) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const result = await request(`/api/identities/${target.kind}s/${target.id}/disable`, 'POST');
      setEmployees(previous => previous.map(employee => target.kind === 'employee' && employee.id === target.id
        ? { ...employee, active: false, devices: employee.devices.map(device => ({ ...device, effectiveActive: false })) }
        : { ...employee, devices: employee.devices.map(device => target.kind === 'device' && device.id === target.id ? { ...device, active: false, effectiveActive: false } : device) }));
      setNotice(`${target.name}${result.changed ? '已停用。' : '此前已停用，无需重复处理。'}历史会话与导出仍保留。`);
      if (target.kind === 'employee' && target.id === currentEmployeeId) { onUnauthorized(); return; }
      setTarget(null); setRefresh(value => value + 1);
    } catch (failure) { setError((failure as Error).message); }
    finally { setSaving(false); }
  }

  return <section className="device-management" aria-label="接入与设备维护"><div className="device-page-head"><div><h1>接入与设备</h1>
    <p>取得个人接入授权，完成一次初始化与宿主信任，之后照常使用 Claude Code CLI、Codex CLI 与 Codex Desktop。</p></div>
    <div className="export-actions">{onDelivery && <button onClick={onDelivery}>设备同步</button>}<button disabled={loading || saving} onClick={() => setRefresh(value => value + 1)}>{loading ? '正在刷新…' : '刷新接入状态'}</button></div></div>
    <section className="device-block" aria-label="接入步骤"><h2>接入步骤</h2><ol className="device-onboarding">
      <li><span>1</span><div><h3>取得个人授权值</h3><p>由管理员通过服务器离线入口创建。只在本机终端受控输入，不要粘贴进 Agent 对话。</p></div></li>
      <li><span>2</span><div><h3>安装</h3><p>取得本部署的 npm 包或内部插件。两种入口共用后台与设备身份，当前没有公开发行包。</p></div></li>
      <li><span>3</span><div><h3>初始化</h3><p>在本地设置 SKYNET_KEY，执行 skynet setup，绑定员工身份并注册当前用户后台。</p></div></li>
      <li><span>4</span><div><h3>宿主信任</h3><p>按 Agent 正常流程确认 hooks 与工作目录，必要时重启宿主；信任状态以本机检查为准。</p></div></li>
      <li><span>5</span><div><h3>首次采集</h3><p>开始一次会话，再运行 skynet status，确认首次事件与上传。已上传与原生恢复验证分别检查。</p></div></li>
    </ol><div className="device-prerequisites"><div><h3>开始前确认</h3><ul><li>Node 24 与需要使用的 Agent 已安装</li><li>可下载管理员提供的包或内部插件</li><li>允许当前用户写配置并运行后台</li></ul></div><div className="device-commands"><div><code>skynet setup</code><span>在本机终端提供个人接入 Key</span></div><div><code>skynet status</code><span>分别检查后台、宿主事件与已确认上传</span></div><p>安装、修复与卸载的完整步骤见页面下方说明。</p></div></div></section>
    <div className="device-section-head"><h2>设备与账号</h2><p>维护权限由服务器离线入口授予。有效读者仍可查看所有员工和项目，停用不会删除历史材料。</p></div>
    {target && <div className="identity-confirm" role="group" aria-label="确认停用身份"><h2>停用{target.kind === 'employee' ? '账号' : '设备'}：{target.name}</h2>
      <p>{target.kind === 'employee' ? '该账号的读取、下载、新设备接入和全部设备上传将被拒绝。' : '仅此设备的后续上传被拒绝；同员工的其他设备与读取凭据继续可用。'}
        {target.id === currentEmployeeId && target.kind === 'employee' ? ' 这也是当前登录账号，确认后会退出页面。' : ''}</p>
      <div className="export-actions"><button className="danger-action" autoFocus disabled={saving} onClick={disable}>{saving ? '正在停用…' : '确认停用'}</button>
        <button disabled={saving} onClick={() => setTarget(null)}>取消</button></div></div>}
    {notice && <p role="status" className="identity-notice">{notice}</p>}
    {error && <p role="alert" className="error">{error}</p>}
    {loading && <p role="status">正在读取账号、设备与操作记录…</p>}
    {!loading && employees.length === 0 && !error && <p>当前没有账号。</p>}
    <div className="identity-list">{employees.map(employee => <section key={employee.id} className="identity-card" aria-label={`账号 ${employee.name}`}>
      <div className="identity-row"><div className="device-employee-heading"><span className="device-employee-avatar" aria-hidden="true">{Array.from(employee.name)[0]}</span><div><h2>{employee.name}{employee.id === currentEmployeeId ? '（当前登录）' : ''}</h2>
        <p className="small">账号：<strong>{employee.active ? '可用' : '已停用'}</strong>{employee.canManageIdentities ? ' · 可维护账号与设备' : ''}</p></div>
        </div><button className="device-quiet-danger" disabled={!employee.active || saving || loading} onClick={() => { setTarget({ id: employee.id, kind: 'employee', name: employee.name }); setError(''); setNotice(''); }}>停用账号</button></div>
      {employee.devices.length === 0 ? <p className="muted small">尚无已接入设备。</p> : <ul className="device-list">{employee.devices.map(device =>
        <li key={device.id} aria-label={`设备 ${device.name}`} data-state={device.effectiveActive ? 'active' : 'disabled'}><div><strong>{device.name}</strong><p className="device-access-state">{device.effectiveActive ? '可上传' : device.active ? '账号已停用，上传被拒绝' : '设备已停用'}</p>
          <p className="device-id">{device.id}</p></div><button className="device-quiet-danger" disabled={!device.effectiveActive || saving || loading}
            onClick={() => { setTarget({ id: device.id, kind: 'device', name: `${employee.name} / ${device.name}` }); setError(''); setNotice(''); }}>停用设备</button></li>)}</ul>}
    </section>)}</div>
    <div className="pagination" aria-label="账号分页"><button disabled={loading || saving || offset === 0} onClick={() => setOffset(value => Math.max(0, value - 50))}>上一页账号</button>
      <button disabled={loading || saving || next === null} onClick={() => setOffset(next ?? 0)}>下一页账号</button></div>
    <section className="identity-audit" aria-label="身份维护记录"><h2>维护记录</h2><p className="muted small">仅记录确实改变状态的操作；重复停用不会产生重复记录。时间为北京时间。</p>
      {!loading && audit.length === 0 && <p>尚无停用记录。</p>}
      <ol>{audit.map(item => <li key={item.id}><strong>{item.actorName}</strong> 停用{item.action === 'disable-device' ? '设备' : '账号'}：{item.employeeName}{item.deviceName ? ` / ${item.deviceName}` : ''}
        <time dateTime={item.occurredAt}>{date(item.occurredAt)}</time></li>)}</ol>
      <div className="pagination"><button disabled={loading || saving || auditOffset === 0} onClick={() => setAuditOffset(value => Math.max(0, value - 50))}>上一页记录</button>
        <button disabled={loading || saving || auditNext === null} onClick={() => setAuditOffset(auditNext ?? 0)}>下一页记录</button></div></section>
  </section>;
}
