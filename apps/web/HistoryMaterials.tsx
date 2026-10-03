import { useEffect, useState } from 'react';
import type { Manifest } from '../../packages/contracts/archive.js';
import type { Capture, Material } from '../../packages/contracts/materials.js';

type Request = (path: string, signal?: AbortSignal) => Promise<Response>;
const changeLabel = { initial: '首次捕获', append: '增长', rewrite: '重写', truncate: '截断', materials: '关联材料变化' };
const gapLabel = { missing: '缺失', unreadable: '无法读取', 'unsafe-path': '路径不安全，已排除', 'size-limit': '超出上限，仍待处理', 'unknown-format': '格式未知', 'partial-line': '末行未闭合', 'history-unavailable': '此前历史不可取得', 'native-mapping-unverified': '原生映射未验证' };

export function HistoryMaterials({ snapshotId, capture, request }: { snapshotId: string; capture?: Capture; request: Request }) {
  const [history, setHistory] = useState<{ id: string; committed_at: string; manifest: Manifest }[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<{ material: Material; text: string; encoding: string; nextOffset: number | null;
    ownership: { employee: string; snapshotId: string; limitation: string; warning: string | null } } | null>(null);
  const [busy, setBusy] = useState(false);
  async function loadHistory(offset: number, signal?: AbortSignal) {
    const result = await (await request(`/api/snapshots/${snapshotId}/history?offset=${offset}`, signal)).json();
    if (signal?.aborted) return;
    setHistory(current => offset ? [...current, ...result.snapshots] : result.snapshots); setNext(result.nextOffset);
  }
  useEffect(() => {
    const abort = new AbortController();
    loadHistory(0, abort.signal).catch(failure => { if (!abort.signal.aborted) setError(failure.message); });
    return () => abort.abort();
  }, [snapshotId]);
  async function view(material: Material, offset = 0) {
    setBusy(true); setError('');
    try { setPreview(await (await request(`/api/snapshots/${snapshotId}/materials/${material.id}/view?offset=${offset}`)).json()); }
    catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }
  async function download(material: Material) {
    setBusy(true); setError('');
    try {
      const response = await request(`/api/snapshots/${snapshotId}/materials/${material.id}`);
      const url = URL.createObjectURL(await response.blob()); const link = document.createElement('a');
      link.href = url; link.download = material.name.split('/').at(-1)!; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }
  if(!error&&history.length<=1&&next===null&&!(capture?.materials.length)&&!(capture?.gaps.length))return null;
  return <section className="recovery" aria-label="快照历史与关联材料"><h3>快照历史与关联材料</h3>
    {capture ? <p>修订 {capture.revision} · {changeLabel[capture.change]}{capture.compacted ? ' · 来源包含压缩记录' : ''}<br /><span className="hash small">代次 {capture.generation}</span></p>
      : null}
    <details><summary>查看旧快照（{history.length}{next !== null ? '+' : ''}）</summary>
      <ol>{history.map(item => <li key={item.id}><a href={`#${item.id}`} aria-current={item.id === snapshotId ? 'page' : undefined}>
        {item.manifest.capture ? `修订 ${item.manifest.capture.revision} · ${changeLabel[item.manifest.capture.change]}` : '旧快照'} · {new Date(item.committed_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}
      </a> · {item.manifest.byteLength} 字节</li>)}</ol>
      {next !== null && <button onClick={() => loadHistory(next).catch(failure => setError(failure.message))}>更多旧快照</button>}
    </details>

    {(capture?.lineage.length ?? 0) > 0 && <ul aria-label="来源谱系">{capture!.lineage.map((item, index) => <li key={index}>
      {item.relation} · <span className="hash">{item.sessionId}</span> · {item.materialId ? '关联原件已保存' : '关联原件缺失'}
      {item.endByteOffset !== undefined && ` · 字节边界 ${item.endByteOffset}`}{item.endOrdinalExclusive !== undefined && ` · 序号边界 ${item.endOrdinalExclusive}`}
    </li>)}</ul>}
    {(capture?.materials.length ?? 0) === 0 ? null
      : <ul className="materials">{capture!.materials.map(material => <li key={material.id}>
        <strong>{material.name}</strong><p className="small">{material.role} · {material.byteLength.toLocaleString()} 字节<br /><span className="hash">{material.hash}</span></p>
        <button disabled={busy} aria-label={`阅读 ${material.name}`} onClick={() => view(material)}>阅读材料</button>{' '}
        <button disabled={busy} aria-label={`下载 ${material.name}`} onClick={() => download(material)}>下载原件</button>
      </li>)}</ul>}
    {(capture?.gaps.length ?? 0) > 0 && <div className="notice" aria-label="材料缺口"><strong>材料缺口</strong><ul>{capture!.gaps.map((gap, index) => <li key={index}>{gapLabel[gap.code]}：{gap.reference}</li>)}</ul></div>}
    {preview && <section aria-label="关联材料阅读"><h4>{preview.material.name}</h4>
      <p className="small">已确认捕获来源：{preview.ownership.employee} · <a href={`#${preview.ownership.snapshotId}`}>来源快照</a></p>
      {preview.ownership.warning && <p className="notice">{preview.ownership.warning}</p>}<pre>{preview.text}</pre>
      <button disabled={busy} onClick={() => view(preview.material)}>从头阅读材料</button>{' '}
      {preview.nextOffset !== null && <button disabled={busy} onClick={() => view(preview.material, preview.nextOffset!)}>继续阅读材料</button>}
      <button onClick={() => setPreview(null)}>关闭材料</button></section>}
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}
