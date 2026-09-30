import type { EventOrigin } from '../../packages/contracts/provenance.js';
import { evidenceLink } from '../../packages/contracts/search.js';

export function QualificationProof({ origin }: { origin?: EventOrigin }) {
  const proof = origin?.qualification;
  if (!proof) return null;
  return <p className="muted small">原来源已独立采集 · 资格版本 {proof.revision} · <a href={evidenceLink(proof.proofSnapshotId,
    { kind: 'raw', line: proof.proofLine, textOffset: 0 })}>查看采集资格原件</a>。活动分类仍按原始来源时间与原设备接入边界判断。</p>;
}
