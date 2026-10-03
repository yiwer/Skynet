import { useEffect, useState } from 'react';

type Device = { id: string; name: string; active: boolean; effectiveActive: boolean };
type Employee = { id: string; name: string; active: boolean; canManageIdentities: boolean; devices: Device[] };
type Audit = { id: string; action: string; occurredAt: string; actorName: string; employeeName: string; deviceName: string | null };
type Target = { id: string; kind: 'employee' | 'device'; name: string };
const date = (value: string) => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });

export function IdentityManagement({ token, currentEmployeeId, onUnauthorized }: {
  token: string; currentEmployeeId: string; onUnauthorized: () => void;
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

  return <section aria-label="接入与设备维护"><div className="heading"><div><p className="eyebrow">账号与设备</p><h1>接入与设备</h1></div>
    <button disabled={loading || saving} onClick={() => setRefresh(value => value + 1)}>{loading ? '正在刷新…' : '刷新接入状态'}</button></div>
    <p>维护权限由服务器离线入口授予。有效读者仍可查看所有员工和项目，停用不会删除历史材料。</p>
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
      <div className="identity-row"><div><h2>{employee.name}{employee.id === currentEmployeeId ? '（当前登录）' : ''}</h2>
        <p className="small">账号：<strong>{employee.active ? '可用' : '已停用'}</strong>{employee.canManageIdentities ? ' · 可维护账号与设备' : ''}</p></div>
        <button disabled={!employee.active || saving || loading} onClick={() => { setTarget({ id: employee.id, kind: 'employee', name: employee.name }); setError(''); setNotice(''); }}>停用账号</button></div>
      {employee.devices.length === 0 ? <p className="muted small">尚无已接入设备。</p> : <ul className="device-list">{employee.devices.map(device =>
        <li key={device.id} aria-label={`设备 ${device.name}`}><div><strong>{device.name}</strong><p className="small muted">{device.effectiveActive ? '可上传' : device.active ? '账号已停用，上传被拒绝' : '设备已停用'}</p>
          <p className="device-id">{device.id}</p></div><button disabled={!device.effectiveActive || saving || loading}
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
