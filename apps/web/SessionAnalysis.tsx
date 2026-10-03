import { useEffect, useState } from 'react';
import { analysisLabels, assessmentLabels, type AnalysisPage, type AnalysisRun } from '../../packages/contracts/analysis.js';
import { evidenceLink } from '../../packages/contracts/search.js';

export const analysisStates = { queued: '等待分析', running: '正在分析', 'retry-wait': '等待有限重试', superseded: '版本已过期', succeeded: '分析已完成', failed: '分析失败' };
export function SessionAnalysis({ snapshotId, request }: { snapshotId: string; request: (path: string, signal?: AbortSignal, method?: 'POST') => Promise<Response> }) {
  const [page, setPage] = useState<AnalysisPage | null>(null); const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0); const [busy, setBusy] = useState(false); const [offset, setOffset] = useState(0);
  useEffect(() => {
    const abort = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    async function read() {
      try {
        const value: AnalysisPage = await (await request(`/api/snapshots/${snapshotId}/analysis?offset=${offset}`, abort.signal)).json();
        if (abort.signal.aborted) return;
        setPage(previous => ({ ...value, runs: offset ? [...(previous?.runs ?? []).filter(run => !value.runs.some(next => next.id === run.id)), ...value.runs] : value.runs }));
        setError('');
        if (value.runs.some(run => ['queued', 'running', 'retry-wait'].includes(run.state))) timer = setTimeout(read, 1500);
      } catch (failure) { if (!abort.signal.aborted) setError((failure as Error).message); }
    }
    void read(); return () => { abort.abort(); clearTimeout(timer); };
  }, [snapshotId, offset, refresh]);
  async function start() {
    setBusy(true); setError('');
    try { await request(`/api/snapshots/${snapshotId}/analysis`, undefined, 'POST'); setOffset(0); setRefresh(value => value + 1); }
    catch (failure) { setError((failure as Error).message); } finally { setBusy(false); }
  }
  return <section className="recovery" aria-label="会话分析"><h3>会话分析</h3>
    <p>{page?.availability.reason ?? '正在读取分析状态…'}</p>
    <p className="muted small">分析固定主原件，长会话按有界原文段提取和汇总。历史材料保留原归属；未知、缺失、未处理范围及关联材料不代表没有活动。结论不是工时、评分或排名。</p>
    <button disabled={busy || !page?.availability.ready} onClick={start}>{busy ? '正在提交…' : '分析会话'}</button>
    <button onClick={() => setRefresh(value => value + 1)}>刷新分析状态</button>
    {error && <p role="alert" className="error">{error}</p>}
    {page?.runs.map(run => <AnalysisResult key={run.id} run={run} retry={async () => {
      try { await request(`/api/analysis/${run.id}/retry`, undefined, 'POST'); setRefresh(value => value + 1); }
      catch (failure) { setError((failure as Error).message); }
    }} />)}
    {page?.runs.length === 0 && <p className="muted">当前快照尚无分析结果。原件可继续查询和导出。</p>}
    {page?.nextOffset !== null && page?.nextOffset !== undefined && <button onClick={() => setOffset(page.nextOffset!)}>加载更多分析</button>}
  </section>;
}
function AnalysisResult({ run, retry }: { run: AnalysisRun; retry: () => Promise<void> }) {
  return <div className="analysis-result"><h4>{analysisStates[run.state]}{run.config.mode === 'fixture' ? ' · 合成演示，非正式验收' : ''}</h4>
    {run.result?.processing && <div aria-label="分析处理范围"><p>{run.result.processing.complete ? '选定的已解析事件已完成提取' : '部分处理，不能视为完整会话分析'} · 汇总：{run.result.processing.aggregation} · {run.result.processing.omittedFindings} 项提取结论未纳入汇总。</p>
      {run.result.processing.ranges.map((range, index) => <p key={index}>原事件 {range.start.event} 偏移 {range.start.textOffset} → {range.end.event} 偏移 {range.end.textOffset}：{range.state === 'extracted' ? '已提取' : range.state === 'failed' ? '失败' : '未处理'}{range.reason && ` · ${range.reason}`}</p>)}
      <p className="muted small">事件索引从 0 开始，偏移为 UTF-16；完成仅指已解析主原件范围，未知行、末行、材料和采集缺口另列。</p></div>}
    <p>版本 {run.generation} · 尝试 {run.attempts}/{run.maxAttempts} · {run.applicable ? '适用于当前输入' : '尚未适用或属于历史版本'} · {run.actorKind === 'system' ? '系统自动触发' : '认证用户触发'}</p>
    {run.state === 'retry-wait' && <p>下次尝试：{new Date(run.nextAttemptAt).toLocaleString('zh-CN')}</p>}
    {['failed', 'retry-wait'].includes(run.state) && run.attempts < run.maxAttempts && <button onClick={retry}>在剩余次数内重试</button>}
    <p className="muted small">{run.config.model} · Claude Code {run.config.runtimeVersion} · {run.config.promptVersion} · {run.input.parserVersion} · 原来源资格版本 {run.input.attributionRevision ?? '未记录（历史输入）'}</p>
    <p>输入覆盖：{run.input.eventCount} 条已解析事件；{run.input.coverage.unrecognizedLines} 行未解析；{run.input.coverage.partialLine ? '存在未闭合末行' : '无未闭合末行'}；
      {run.input.coverage.excludedMaterials} 项关联材料未分析；{run.input.coverage.captureGaps.length} 项存档缺口。</p>
    {run.error && <p className="error">{run.error}</p>}
    {run.result?.items.map((item, index) => <div key={index}><h4>{analysisLabels[item.category]} · {assessmentLabels[item.assessment]}</h4><p>{item.text}</p>
      {item.classificationAdjusted && <p className="muted small">原模型标记已按原句证据降级。</p>}
      {item.citations.map((citation, part) => <p key={part}><a href={citation.webPath}>查看原句{citation.location.kind === 'material' ? ' · 原关联材料' : ` · 第 ${citation.location.line} 行`}</a>：<q>{citation.quote}</q>
        <span className="muted small"> · {citation.origin?.employee ?? '归属未知'} · {citation.context === 'historical' ? '历史上下文' : citation.context === 'after-enrollment' ? '原员工接入后记录' : '活动归属边界未知'}</span></p>)}
      {item.citations.filter(citation => citation.location.kind !== 'event').map((citation, part) => <p key={`input-${part}`} className="muted small">
        原材料链接定位原始 JSON 行，保留转义；<a href={evidenceLink(citation.inputSnapshotId, citation.inputLocation)}>查看本次输入中的精确原句</a>。</p>)}
    </div>)}
    <p className="muted small">提供商实付人民币：未知；预算预留 ¥{run.config.reservationCny} 保留，未按未知用量退款。
      {run.result ? ` 请求 ${run.result.usage.requests} 次；输入 token ${run.result.usage.inputTokens ?? '未知'}；输出 token ${run.result.usage.outputTokens ?? '未知'}；CLI 美元估计 ${run.result.usage.runtimeCostUsd ?? '未知'}（不是千问账单）。` : ''}</p>
  </div>;
}
