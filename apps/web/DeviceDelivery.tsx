import { useEffect, useState } from 'react';
import type { DeliveryHealth, DeliveryFailure } from '../../packages/contracts/delivery.js';
import { sourceLabel, type Source } from '../../packages/contracts/archive.js';
import { CaptureCoverage, type Coverage } from './CaptureCoverage.js';

type Device = { id: string; name: string; employee: string; active: boolean; lastSeenAt: string | null; connected: boolean | null;
  sources: { source: Source; receivedAt: string; report: DeliveryHealth }[]; capture: Coverage[] };
const date = (value: string | null) => value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '尚无记录';
const bytes = (value: number) => `${(value / 1024 / 1024).toFixed(2)} MiB`;
const reasons: Record<DeliveryFailure['kind'], string> = { disconnected: '网络不可达', 'rate-limited': '服务器限流',
  'credentials-rejected': '设备凭据被拒绝', 'server-unavailable': '服务器暂不可用', 'request-rejected': '上传请求被拒绝',
  'invalid-ack': '服务器确认不匹配', 'local-data': '本地队列需修复' };
const failure = (value: DeliveryFailure | null) => value ? `${reasons[value.kind]}${value.status ? ` (${value.status})` : ''} · ${date(value.at)}` : '无';

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
  return <section aria-label="设备同步状态"><div className="heading"><h1>设备同步</h1>
    <button disabled={loading} onClick={() => setRefresh(value => value + 1)}>{loading ? '正在读取…' : '刷新设备状态'}</button></div>
    <p className="notice">显示设备最近一次成功上报的状态。超过 90 秒没有连接确认时显示离线或状态过期；离线时服务器无法获知新增积压和本机拒绝原因，恢复连接后补报。这里的连接确认不代表宿主信任或完整备份。</p>
    {error && <p role="alert">{error}</p>}{!loading && !error && !devices.length && <p>尚未登记设备。</p>}
    {devices.map(device => <article className="device-delivery" key={device.id}><h2>{device.employee} · {device.name}</h2>
      <p><strong>{!device.active ? '已停用' : device.connected ? '最近连接正常' : device.lastSeenAt ? '设备离线或状态已过期' : '尚未收到连接确认'}</strong> · 最后连接：{date(device.lastSeenAt)}</p>
      {!device.sources.length && <p>尚无来源同步报告，不能据此判断没有活动。</p>}
      {device.capture.map(coverage => <div key={`${coverage.source}-${refresh}`}><h3>{sourceLabel(coverage.source as Source)}</h3><CaptureCoverage initial={coverage}
        path={`/api/devices/${device.id}/capture-status?source=${coverage.source}`} request={async path => {
          const response = await fetch(path, { headers: { Authorization: `Bearer ${token}` } }); if (response.status === 401) onUnauthorized(); return response;
        }} /></div>)}
      {device.sources.map(({ source, receivedAt, report }) => <section key={source} aria-label={`${sourceLabel(source)}同步`}>
        <h3>{sourceLabel(source)}</h3><p>状态收到时间：{date(receivedAt)}</p>
        <p>{report.pendingSnapshots ? '同步中：存在未确认材料' : '当前报告没有待确认材料；不代表没有活动或完整存档。'}</p>
        <dl className="delivery-facts"><div><dt>待确认存档</dt><dd>{report.pendingSnapshots} 份 · {bytes(report.pendingBytes)}</dd></div>
          <div><dt>最早积压</dt><dd>{date(report.oldestPendingAt)}</dd></div><div><dt>最后成功上传</dt><dd>{date(report.lastSuccessAt)}</dd></div>
          <div><dt>连续失败</dt><dd>{report.attempts} 次</dd></div><div><dt>下次重试</dt><dd>{date(report.nextAttemptAt)}</dd></div>
          <div><dt>当前故障</dt><dd>{failure(report.lastFailure)}</dd></div><div><dt>最近拒绝记录</dt><dd>{failure(report.lastRejection)}</dd></div>
          <div><dt>本地队列上限</dt><dd>{bytes(report.quotaBytes)} · {report.quotaSnapshots} 份</dd></div></dl>
        {report.quotaBlocked && <p role="alert">队列已达到上限；已冻结的未确认材料仍保留，新的材料尚未入队。请恢复连接或修复存储，并检查源头尚存的材料。</p>}
      </section>)}
    </article>)}
    <div className="pagination"><button disabled={loading || offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>上一批设备</button>
      <button disabled={loading || next === null} onClick={() => next !== null && setOffset(next)}>下一批设备</button></div>
  </section>;
}
