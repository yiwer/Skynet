import type pg from 'pg';
import { digest } from './database.js';
import { HttpError } from './identities.js';
import type { RawStore } from './raw-store.js';
import { eventOrigins } from './provenance.js';
import { attributionRevisions } from './qualification.js';
import { verifySnapshotIntegrity } from './evidence-integrity.js';
import { waitInput, type WaitInput } from './wait-inputs.js';
import { materialSource } from './material-provenance.js';
import type { Manifest, Source } from '../../packages/contracts/archive.js';
import type { Provenance } from '../../packages/contracts/provenance.js';
import type { WaitEvidence } from '../../packages/contracts/waits.js';
import { conversationLink } from '../../packages/contracts/conversation.js';
import { evidenceLink } from '../../packages/contracts/search.js';

type Snapshot = { id: string; device_id: string; source: Source; source_session_id: string; manifest: Manifest;
  hash: string; committed_at: Date; provenance: Provenance | null;employee_id:string;employee:string };
export type WaitOriginal = { record: Snapshot; sessionId: string; facts: WaitInput; origins: Awaited<ReturnType<typeof eventOrigins>>; revision: string };
export const waitBounded = () => new HttpError(413, '等待记录超过单次计算上限，未返回截断汇总');
const nativeKey = (record: Snapshot) => JSON.stringify([record.device_id, record.source, record.source_session_id]);

/** Read committed originals once, preserving each immutable history. Parallel
 * activity deliberately uses all projects/Agents, independent of report filters. */
export async function waitDataset(client: pg.PoolClient, raw: RawStore, full: boolean, employees: string[] | null, observe?: (record:Snapshot,bytes:Buffer,facts:WaitInput)=>void): Promise<WaitOriginal[]> {
  const records = (await client.query(`WITH RECURSIVE selected(id) AS (
    SELECT s.id FROM snapshots s JOIN devices d ON d.id=s.device_id WHERE $1::uuid[] IS NULL OR d.employee_id=ANY($1)
      OR EXISTS(SELECT 1 FROM effective_snapshot_events se JOIN effective_event_origins o ON o.event_id=se.event_id
        WHERE se.snapshot_id=s.id AND o.employee_id=ANY($1))
    UNION SELECT p.id FROM selected x JOIN snapshots s ON s.id=x.id JOIN snapshots p ON p.id=(s.provenance->>'sourceSnapshotId')::uuid
      WHERE s.provenance->>'relation' IN ('verified-restoration','same-device-continuation')
    ) SELECT s.*,d.employee_id,e.name AS employee FROM selected x JOIN snapshots s ON s.id=x.id JOIN devices d ON d.id=s.device_id JOIN employees e ON e.id=d.employee_id ORDER BY s.committed_at,s.id LIMIT 20001`, [employees])).rows as Snapshot[];
  if (records.length > 20000 || records.reduce((sum, row) => sum + row.manifest.byteLength, 0) > 128 * 1024 * 1024) throw waitBounded();
  const byId = new Map(records.map(record => [record.id, record])), latest = new Map(records.map(record => [nativeKey(record), record]));
  const roots = new Map<string, string>();
  for (const record of latest.values()) {
    let current = record; const seen = new Set<string>(); let root: string | undefined;
    while (current.provenance?.sourceSnapshotId && current.provenance.relation !== 'unconfirmed') {
      if (seen.has(current.id) || seen.size >= 128) throw new HttpError(409, '会话谱系循环或过长');
      seen.add(current.id); const prior = byId.get(current.provenance.sourceSnapshotId);
      if (!prior) throw new HttpError(409, '会话谱系来源缺失');
      if (current.manifest.restoredFrom?.materialId) {
        const original = await materialSource(client, prior, current.manifest.restoredFrom.materialId);
        root = digest(JSON.stringify([original.origin.device_id, prior.source, original.material.sourceSessionId])); break;
      }
      if (prior.source_session_id !== current.source_session_id) break;
      current = prior;
    }
    roots.set(nativeKey(record), root ?? digest(nativeKey(current)));
  }
  const result: WaitOriginal[] = []; let events = 0;
  for (const record of records) {
    await verifySnapshotIntegrity(client, raw, record.id);
    const bytes = await raw.read(record.device_id, record.hash);
    const facts = await waitInput(client, { snapshotId: record.id, source: record.source, hash: record.hash, bytes, full });
    if ((events += facts.messages.length) > 100000) throw waitBounded();
    observe?.(record,bytes,facts);
    result.push({ record, sessionId: roots.get(nativeKey(record))!, facts, origins: await eventOrigins(client, record.id), revision: '' });
  }
  const revisions=await attributionRevisions(client,records.map(record=>record.id));
  for(const original of result)original.revision=revisions.get(original.record.id)!;
  return result;
}

export function waitEvidence(original: WaitOriginal, line: number, block = 0, rawEvent = false): WaitEvidence {
  const snapshotId = original.record.id;
  return { snapshotId, line, block,
    webPath: evidenceLink(snapshotId, rawEvent ? { kind: 'raw', line, textOffset: 0 }
      : { kind: 'event', offset: 0, line, block, textOffset: 0, parserVersion: original.facts.parserVersion }),
    conversationPath: rawEvent ? null : conversationLink(snapshotId, { line, block, textOffset: 0, parserVersion: original.facts.parserVersion }) };
}
