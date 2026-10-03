import { useEffect, useState } from 'react';
import type { DeliveryHealth, DeliveryFailure } from '../../packages/contracts/delivery.js';
import { sourceLabel, type Source } from '../../packages/contracts/archive.js';
import type { Coverage } from './CaptureCoverage.js';
import { captureRepair, type CaptureFault } from '../../packages/contracts/capture-health.js';
import './device-management.css';

type Device = { id: string; name: string; employee: string; active: boolean; lastSeenAt: string | null; connected: boolean | null;
  sources: { source: Source; receivedAt: string; report: DeliveryHealth }[]; capture: Coverage[] };
const date = (value: string | null) => value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '尚无记录';
const bytes = (value: number) => `${(value / 1024 / 1024).toFixed(2)} MiB`;
const reasons: Record<DeliveryFailure['kind'], string> = { disconnected: '网络不可达', 'rate-limited': '服务器限流',
  'credentials-rejected': '设备凭据被拒绝', 'server-unavailable': '服务器暂不可用', 'request-rejected': '上传请求被拒绝',
  'invalid-ack': '服务器确认不匹配', 'local-data': '本地队列需修复' };
const failure = (value: DeliveryFailure | null) => value ? `${reasons[value.kind]}${value.status ? ` (${value.status})` : ''} · ${date(value.at)}` : '无';
const captureLabels: Record<CaptureFault['code'], string> = { 'storage-full': '本地存储不足', 'permission-denied': '本地权限拒绝', 'source-missing': '来源已消失',
  'queue-limit': '未确认队列已满', 'capture-unavailable': '采集不可用', 'hook-unobserved': '宿主事件未登记', 'diagnostic-limit': '故障明细已达上限' };
function CaptureStatus({ initial, request }: { initial: Coverage; request: (offset: number) => Promise<Response> }) {
  const [data, setData] = useState(initial), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function read(offset: number) {
    setBusy(true); setError('');
    try { const response = await request(offset); if (!response.ok) throw new Error('读取采集状态失败'); setData(await response.json()); }
    catch (failure) { setError((failure as Error).message); } finally { setBusy(false); }
  }
  return <div className="device-capture-status"><div className="device-capture-meta">
    <span>{data.report?.captureEnabled === false ? '采集已停止' : data.report?.observation === 'host-event-observed' ? '已收到宿主事件' : '尚无宿主事件'}</span>
    {data.receivedAt && <time dateTime={data.receivedAt}>{date(data.receivedAt)}{Date.now() - Date.parse(data.receivedAt) > 90000 ? ' · 已过期' : ''}</time>}
    <button disabled={busy} onClick={() => read(0)}>刷新采集覆盖</button></div>
    {data.report && !data.report.locallyPersisted && <p role="alert">诊断未保存到本机</p>}
    {data.faults.length > 0 && <ul className="device-capture-faults">{data.faults.map(fault => <li key={fault.id}><strong>{captureLabels[fault.code]}</strong><span>{fault.recoveredAt ? '已恢复 · 范围待核实' : '待修复'}</span>
      <p>{fault.sessionId && <>{fault.sessionId} · </>}{date(fault.lastObservedAt)}</p><p>{captureRepair[fault.code]}</p></li>)}</ul>}
    {error && <p role="alert">{error}</p>}{data.nextOffset !== null && <button disabled={busy} onClick={() => read(data.nextOffset!)}>更多采集缺口</button>}
  </div>;
}

export function DeviceDelivery({ token, onUnauthorized }: { token: string; onUnauthorized: () => void }) {
  const [devices, setDevices] = useState<Device[]>([]); const [offset, setOffset] = useState(0);
  const [next, setNext] = useState<number | null>(null); const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(false); const [error, setError] = useState('');
  useEffect(() => {
    const abort = new AbortController(); setLoading(true); setError('');
    fetch(`/api/devices/status?offset=${offset}`, { headers: { Authorization: `Bearer ${token}` }, signal: abort.signal }).then(async response => {
      if (response.status === 401) onUnauthorized();
      if (!response.ok) throw new Error('设备状态暂时无法读取，请重试。');
      const data = await response.json(); if (!abort.signal.aborted) { setDevices(data.devices); setNext(data.nextOffset); }
    }).catch(failure => { if (!abort.signal.aborted) setError(failure.message); }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [token, offset, refresh]);
  return <section className="device-management device-sync-page workspace-page" aria-label="设备同步状态"><div className="device-page-head"><div><h1>设备同步</h1></div>
    <button disabled={loading} onClick={() => setRefresh(value => value + 1)}>{loading ? '正在读取…' : '刷新设备状态'}</button></div>
    <div className="workspace-scroll">
    {error && <p role="alert">{error}</p>}{!loading && !error && !devices.length && <p className="device-empty">暂无设备</p>}
    {devices.map(device => <article className="device-delivery device-status-card" key={device.id} data-state={!device.active ? 'disabled' : device.connected ? 'connected' : 'unknown'}><div className="device-status-heading"><div><p className="device-owner">{device.employee}</p><h2>{device.name}</h2></div>
      <span className="device-connection-state">{!device.active ? '已停用' : device.connected ? '最近连接正常' : device.lastSeenAt ? '设备离线或状态已过期' : '尚未收到连接确认'}</span></div><p className="device-last-seen">最后连接：{date(device.lastSeenAt)}</p>
      {!device.sources.length && <p className="device-last-seen">尚无同步报告</p>}
      {device.capture.filter(coverage => coverage.receivedAt || coverage.faults.length).map(coverage => <details className="device-source-block device-capture-panel" key={`${coverage.source}-${refresh}`}><summary>{sourceLabel(coverage.source as Source)} · 采集状态{coverage.total > 0 ? ` · ${coverage.total} 项缺口` : ''}</summary><CaptureStatus initial={coverage}
        request={async offset => {
          const response = await fetch(`/api/devices/${device.id}/capture-status?source=${coverage.source}&offset=${offset}`, { headers: { Authorization: `Bearer ${token}` } }); if (response.status === 401) onUnauthorized(); return response;
        }} /></details>)}
      {device.sources.map(({ source, receivedAt, report }) => <section className="device-source-block" key={source} aria-label={`${sourceLabel(source)}同步`}>
        <div className="device-source-heading"><h3>{sourceLabel(source)}</h3><p>{date(receivedAt)}</p></div>
        <p className="device-sync-summary">{report.pendingSnapshots ? '报告中有待传材料' : '报告队列为空'}</p>
        <dl className="delivery-facts"><div><dt>待确认存档</dt><dd>{report.pendingSnapshots} 份 · {bytes(report.pendingBytes)}</dd></div>
          {report.oldestPendingAt && <div><dt>最早积压</dt><dd>{date(report.oldestPendingAt)}</dd></div>}{report.lastSuccessAt && <div><dt>最后成功上传</dt><dd>{date(report.lastSuccessAt)}</dd></div>}
          {report.attempts > 0 && <div><dt>连续失败</dt><dd>{report.attempts} 次</dd></div>}{report.nextAttemptAt && <div><dt>下次重试</dt><dd>{date(report.nextAttemptAt)}</dd></div>}
          {report.lastFailure && <div><dt>当前故障</dt><dd>{failure(report.lastFailure)}</dd></div>}{report.lastRejection && <div><dt>最近拒绝记录</dt><dd>{failure(report.lastRejection)}</dd></div>}
          <div><dt>本地队列上限</dt><dd>{bytes(report.quotaBytes)} · {report.quotaSnapshots} 份</dd></div></dl>
        {report.quotaBlocked && <p role="alert">队列已满，新材料尚未入队。请恢复连接或修复存储。</p>}
      </section>)}
    </article>)}
    {(offset > 0 || next !== null) && <div className="pagination"><button disabled={loading || offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>上一批设备</button>
      <button disabled={loading || next === null} onClick={() => next !== null && setOffset(next)}>下一批设备</button></div>}
    </div>
  </section>;
}
