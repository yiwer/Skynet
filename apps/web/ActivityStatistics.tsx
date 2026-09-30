import { useEffect, useState } from 'react';

type Row = { employeeId: string; employee: string; date: string | null; records: number; userTurns: number; toolCalls: number;
  historicalRecords: number; unknownRecords: number; activityRecords: number; activityUserTurns: number; activityToolCalls: number };
export function ActivityStatistics({ request }: { request: (path: string, signal?: AbortSignal) => Promise<Response> }) {
  const [offset, setOffset] = useState(0); const [data, setData] = useState<{ rows: Row[]; nextOffset: number | null; definition: string;
    warnings: { unconfirmedRelationSnapshots: number; uncertainRewriteSnapshots: number } }>();
  const [error, setError] = useState(''); const [retry, setRetry] = useState(0);
  useEffect(() => {
    const abort = new AbortController(); setData(undefined); setError('');
    void request(`/api/activity-statistics?offset=${offset}`, abort.signal).then(response => response.json()).then(value => { if (!abort.signal.aborted) setData(value); })
      .catch(() => { if (!abort.signal.aborted) setError('去重统计暂时不可用。'); });
    return () => abort.abort();
  }, [offset, retry]);
  return <section className="recovery" aria-label="跨设备去重统计"><h3>跨设备去重统计</h3>
    {error ? <><p role="alert">{error}</p><button onClick={() => setRetry(value => value + 1)}>重试去重统计</button></> : !data ? <p role="status">正在读取去重统计…</p> : <>
      <p className="muted small">{data.definition}</p>
      <p className="muted small">未声明已确认跨设备关系的快照 {data.warnings.unconfirmedRelationSnapshots}（含独立新会话）；重写或截断后仍有谱系不确定性的快照 {data.warnings.uncertainRewriteSnapshots}。未确认重复没有被自动合并。</p>
      <ul>{data.rows.map(row => <li key={`${row.employeeId}/${row.date}`}><strong>{row.employee} · {row.date ?? '来源日期未知'}</strong>：
        接入后用户轮次 {row.activityUserTurns}、工具调用 {row.activityToolCalls}、条目 {row.activityRecords}；
        历史上下文 {row.historicalRecords}、归期或接入边界未知 {row.unknownRecords}；全部唯一条目 {row.records}。</li>)}</ul>
      {!data.rows.length && <p>尚无可解析的归属记录。</p>}
      <div className="pagination"><button disabled={offset === 0} onClick={() => setOffset(value => Math.max(0, value - 50))}>上一页统计</button>
        <button disabled={data.nextOffset === null} onClick={() => setOffset(data.nextOffset!)}>下一页统计</button></div>
    </>}
  </section>;
}
