import { useState } from 'react';
import { captureRepair, type CaptureFault, type CaptureHealth } from '../../packages/contracts/capture-health.js';

export type Coverage = { source: string; report?: Omit<CaptureHealth, 'faults'>; receivedAt?: string; faults: CaptureFault[]; total: number; nextOffset: number | null; notice: string };
const date = (value: string) => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
const labels: Record<CaptureFault['code'], string> = { 'storage-full': '本地存储不足', 'permission-denied': '本地权限拒绝', 'source-missing': '来源已消失',
  'queue-limit': '未确认队列已满', 'capture-unavailable': '采集不可用', 'hook-unobserved': '宿主事件未能登记', 'diagnostic-limit': '故障明细达到上限' };

export function CaptureCoverage({ initial, path, request }: { initial: Coverage; path: string; request: (path: string) => Promise<Response> }) {
  const [data, setData] = useState(initial); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function load(offset: number) {
    setBusy(true); setError('');
    try { const response = await request(`${path}${path.includes('?') ? '&' : '?'}offset=${offset}`); if (!response.ok) throw new Error('采集覆盖暂时无法读取。'); setData(await response.json()); }
    catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  }
  return <section aria-label="后续采集覆盖" className="device-delivery"><h3>后续采集覆盖</h3>
    <p>{data.receivedAt ? `最近收到：${date(data.receivedAt)}` : '尚无采集覆盖报告。'}</p>
    {data.receivedAt && Date.now() - Date.parse(data.receivedAt) > 90_000 && <p className="notice">此覆盖报告已过期；当前设备可能离线，尚不知道是否新增缺口。</p>}
    <p>{data.report?.observation === 'host-event-observed' ? '已观察到宿主事件；不代表全部 hooks 已信任。'
      : '尚无宿主事件：待宿主信任与尚无活动暂不能区分，请按安装页完成信任并检查首次事件。'}</p>
    {data.report && !data.report.locallyPersisted && <p role="alert">本次诊断未能写入本机磁盘，仅服务器收到报告；离线或进程退出时可能无法保存进一步故障。</p>}
    <p className="notice">{data.notice}</p>
    {!data.total ? <p>尚未报告采集缺口；这不构成完整备份保证。</p> : <p>已记录 {data.total} 项采集缺口，故障期间范围仍待核实。</p>}
    <ul>{data.faults.map(fault => <li key={fault.id}><strong>{labels[fault.code]}</strong> · {fault.recoveredAt ? '故障已恢复，范围未核实' : '需要修复'}
      <p>{fault.sessionId ? `原生会话 ${fault.sessionId}` : '来源范围，可能涉及未登记会话'} · 首次观察 {date(fault.firstObservedAt)} · 最后观察 {date(fault.lastObservedAt)}</p>
      <p>{captureRepair[fault.code]}</p></li>)}</ul>
    {error && <p role="alert">{error}</p>}<button disabled={busy} onClick={() => load(0)}>刷新采集覆盖</button>{data.nextOffset !== null && <button disabled={busy} onClick={() => load(data.nextOffset!)}>更多采集缺口</button>}
  </section>;
}
