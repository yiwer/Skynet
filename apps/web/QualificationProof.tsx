import type { EventOrigin } from '../../packages/contracts/provenance.js';
import { evidenceLink } from '../../packages/contracts/search.js';

export function QualificationProof({ origin }: { origin?: EventOrigin }) {
  const proof = origin?.qualification;
  if (!proof) return null;
  return <p className="muted small"><a href={evidenceLink(proof.proofSnapshotId,
    { kind: 'raw', line: proof.proofLine, textOffset: 0 })}>采集来源</a></p>;
}
