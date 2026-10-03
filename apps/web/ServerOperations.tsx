import { useEffect, useState } from 'react';
import type { ServerOperations as Operations } from '../../packages/contracts/server-operations.js';
import './operations.css';
const bytes = (value: number) => value >= 1073741824 ? `${(value / 1073741824).toFixed(1)} GB` : value >= 1048576 ? `${(value / 1048576).toFixed(1)} MB` : `${value.toLocaleString('zh-CN')} B`;
const at = (value: string) => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
const states: Record<string, string> = { 'in-progress': '进行中', completed: '已完成', failed: '失败', interrupted: '已中断', unknown: '未知' };
export function ServerOperations({ request }: { request: (path: string, signal?: AbortSignal) => Promise<Response> }) {
  const [data, setData] = useState<Operations>(), [error, setError] = useState('');
  useEffect(() => {
    const abort = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    async function read() {
      try { const value = await (await request('/api/server/operations', abort.signal)).json(); if (!abort.signal.aborted) { setData(value); setError(''); } }
      catch (failure) { if (!abort.signal.aborted) setError((failure as Error).message); }
      if (!abort.signal.aborted) timer = setTimeout(read, 5000);
    }
    void read(); return () => { abort.abort(); clearTimeout(timer); };
  }, []);
  const hasStorage = data && [data.storage.committedBytes, data.storage.freeBytes, data.storage.filesystemBytes, data.storage.stagedObjects].some(value => value !== null);
  return <section className="server-operations workspace-page" aria-label="服务器运行与备份">
    <div className="operations-page-head"><h1>服务器运行与备份</h1><a href="#analysis">分析与运行</a></div>
    <div className="workspace-scroll">
      {error && <p role="alert">{error}{data ? ' · 显示上次记录' : ''}</p>}
      {!data && !error && <p role="status">正在读取…</p>}
      {data && <>
        {data.storage.capacityError && <p role="alert">{data.storage.capacityError}</p>}
        {hasStorage && <section className="operations-storage" aria-label="原件容量"><h2>原件容量</h2>
          <dl className="operations-storage-facts">
            {data.storage.committedBytes !== null && <div><dt>已提交原件</dt><dd>{bytes(data.storage.committedBytes)}</dd>{data.storage.committedObjects !== null && <span>{data.storage.committedObjects.toLocaleString('zh-CN')} 个对象</span>}</div>}
            {data.storage.freeBytes !== null && <div><dt>可用空间</dt><dd>{bytes(data.storage.freeBytes)}</dd></div>}
            {data.storage.filesystemBytes !== null && <div><dt>文件系统容量</dt><dd>{bytes(data.storage.filesystemBytes)}</dd></div>}
            {data.storage.stagedObjects !== null && <div><dt>暂存对象</dt><dd>{data.storage.stagedObjects.toLocaleString('zh-CN')}</dd></div>}
          </dl>
          {data.storage.filesystemBytes !== null && data.storage.freeBytes !== null && data.storage.filesystemBytes > 0 && <meter min={0} max={data.storage.filesystemBytes} value={data.storage.filesystemBytes - data.storage.freeBytes} aria-label="原件所在文件系统已用容量" />}
        </section>}
        <section className="operations-backups" aria-label="备份记录"><h2>备份记录</h2>
          {data.latestBackup ? <dl className="operations-record"><div><dt>最近备份</dt><dd>{at(data.latestBackup.completedAt)}</dd></div><div><dt>范围</dt><dd>{data.latestBackup.objects.toLocaleString('zh-CN')} 个对象 · {bytes(data.latestBackup.bytes)}</dd></div>
            <div><dt>存放位置</dt><dd>{data.latestBackup.failureDomain === 'same-host' ? '同机' : data.latestBackup.failureDomain === 'off-host-declared' ? '异机（维护者声明）' : '未知'}</dd></div><div><dt>快照时间</dt><dd>{at(data.latestBackup.snapshotAt)}</dd></div><div><dt>备份编号</dt><dd className="hash">{data.latestBackup.id}</dd></div></dl> : <p className="operations-inline-empty">暂无成功备份</p>}
          {data.latestAttempt && <div className="operations-backup-attempt"><span className={`operations-state state-${data.latestAttempt.state}`}>{states[data.latestAttempt.state] ?? '未知'}</span><time dateTime={data.latestAttempt.startedAt}>{at(data.latestAttempt.startedAt)}</time>{data.latestAttempt.error && <p role="alert">{data.latestAttempt.error}</p>}</div>}
          {data.latestRestore && <div className="operations-restore"><h3>恢复完整性校验</h3><dl className="operations-record"><div><dt>校验时间</dt><dd>{at(data.latestRestore.verifiedAt)}</dd></div><div><dt>来源备份</dt><dd className="hash">{data.latestRestore.backupId}</dd></div></dl></div>}
        </section>
        <p className="operations-updated">更新于 {at(data.observedAt)}</p>
      </>}
    </div>
  </section>;
}
