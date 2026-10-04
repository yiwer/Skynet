import type pg from 'pg';
import { digest } from './database.js';
import { HttpError } from './identities.js';
import { RawUnavailableError, type RawStore } from './raw-store.js';
import { readEvidence } from './evidence.js';
import { eventOrigins, eventOriginsBatch } from './provenance.js';
import { attributionRevisions } from './qualification.js';
import { verifySnapshotsIntegrity } from './evidence-integrity.js';
import { waitInputBatch, type WaitInput } from './wait-inputs.js';
import { materialSource } from './material-provenance.js';
import type { Manifest, Source } from '../../packages/contracts/archive.js';
import type { Provenance } from '../../packages/contracts/provenance.js';
import type { WaitEvidence } from '../../packages/contracts/waits.js';
import { conversationLink } from '../../packages/contracts/conversation.js';
import { evidenceLink } from '../../packages/contracts/search.js';

type Snapshot = { id: string; device_id: string; source: Source; source_session_id: string; manifest: Manifest;
  hash: string; committed_at: Date; provenance: Provenance | null;employee_id:string;employee:string };
export type WaitOriginal = { record: Snapshot; sessionId: string; facts: WaitInput; origins: Awaited<ReturnType<typeof eventOrigins>>; revision: string; unavailable?:RawUnavailableError['reason']; ownerFallback?:Snapshot };
export const waitBounded = () => new HttpError(413, '等待记录超过单次计算上限，未返回截断汇总');
const nativeKey = (record: Snapshot) => JSON.stringify([record.device_id, record.source, record.source_session_id]);

/** Read committed originals once, preserving each immutable history. Parallel
 * activity deliberately uses all projects/Agents, independent of report filters. */
export async function waitDataset(client: pg.PoolClient, raw: RawStore, full: boolean, employees: string[] | null, observe?: (record:Snapshot,bytes:Buffer,facts:WaitInput)=>void): Promise<WaitOriginal[]> {
  // Build both ownership sources once. A correlated EXISTS inside the owner
  // OR can repeatedly join every scoped event against each other snapshot.
  // Registered owners also retain sources with no readable business events.
  const records = (await client.query(`WITH RECURSIVE seeds(id) AS (
    SELECT s.id FROM snapshots s JOIN devices d ON d.id=s.device_id WHERE $1::uuid[] IS NULL OR d.employee_id=ANY($1)
    UNION
    SELECT se.snapshot_id FROM effective_snapshot_events se JOIN effective_event_origins o ON o.event_id=se.event_id
      WHERE $1::uuid[] IS NOT NULL AND o.employee_id=ANY($1)
    ), selected(id) AS (
    SELECT id FROM seeds
    UNION SELECT p.id FROM selected x JOIN snapshots s ON s.id=x.id JOIN snapshots p ON p.id=(s.provenance->>'sourceSnapshotId')::uuid
      WHERE s.provenance->>'relation' IN ('verified-restoration','same-device-continuation')
    ) SELECT s.*,d.employee_id,e.name AS employee FROM selected x JOIN snapshots s ON s.id=x.id JOIN devices d ON d.id=s.device_id JOIN employees e ON e.id=d.employee_id ORDER BY s.committed_at,s.id LIMIT 20001`, [employees])).rows as Snapshot[];
  if (records.length > 20000 || records.reduce((sum, row) => sum + row.manifest.byteLength, 0) > 128 * 1024 * 1024) throw waitBounded();
  const byId = new Map(records.map(record => [record.id, record])), latest = new Map(records.map(record => [nativeKey(record), record]));
  const roots = new Map<string, string>();
  const ownerFallbacks=new Map<string,Snapshot>();
  for (const record of latest.values()) {
    let current = record; const seen = new Set<string>(); let root: string | undefined;
    while (current.provenance?.sourceSnapshotId && current.provenance.relation !== 'unconfirmed') {
      if (seen.has(current.id) || seen.size >= 128) throw new HttpError(409, '会话谱系循环或过长');
      seen.add(current.id); const prior = byId.get(current.provenance.sourceSnapshotId);
      if (!prior) throw new HttpError(409, '会话谱系来源缺失');
      if (current.manifest.restoredFrom?.materialId) {
        const original = await materialSource(client, prior, current.manifest.restoredFrom.materialId);
        current=byId.get(original.origin.id)??prior;
        root = digest(JSON.stringify([original.origin.device_id, prior.source, original.material.sourceSessionId])); break;
      }
      if (prior.source_session_id !== current.source_session_id) break;
      current = prior;
    }
    roots.set(nativeKey(record), root ?? digest(nativeKey(current)));
    ownerFallbacks.set(nativeKey(record),current);
  }
  const failures=new Map<string,RawUnavailableError>();
  await verifySnapshotsIntegrity(client,raw,records.map(record=>record.id),(error,ids)=>{for(const id of ids)failures.set(id,error);});
  const origins=await eventOriginsBatch(client,records.map(record=>record.id));
  const inputs=await waitInputBatch(client,records.map(record=>({snapshotId:record.id,source:record.source,hash:record.hash})),full);
  const verified=new Map<string,Buffer>();let next=0;
  await Promise.all(Array.from({length:Math.min(4,records.length)},async()=>{
    while(next<records.length){const record=records[next++]!;if(failures.has(record.id))continue;
      try{verified.set(record.id,await raw.read(record.device_id,record.hash));}
      catch(error){if(!(error instanceof RawUnavailableError))throw error;failures.set(record.id,error);}
    }
  }));
  const result: WaitOriginal[] = []; let events = 0;
  for (const record of records) {
    const bytes=verified.get(record.id),unavailable=failures.get(record.id)?.reason;
    if(bytes&&bytes.length!==record.manifest.byteLength)throw new HttpError(409,'等待原件大小不一致');
    const facts:WaitInput = bytes?inputs.read({ snapshotId: record.id, source: record.source, hash: record.hash, bytes }):
      {parserVersion:readEvidence(Buffer.alloc(0),record.source).parserVersion,boundaries:[],messages:[],pairs:[]};
    if ((events += facts.messages.length) > 100000) throw waitBounded();
    if(bytes)observe?.(record,bytes,facts);
    result.push({ record, sessionId: roots.get(nativeKey(record))!, facts, origins: origins.get(record.id)!, revision: '',...(unavailable?{unavailable}:{}),ownerFallback:ownerFallbacks.get(nativeKey(record)) });
    verified.delete(record.id);
  }
  await inputs.flush();
  const revisions=await attributionRevisions(client,records.map(record=>record.id));
  for(const original of result)original.revision=revisions.get(original.record.id)!;
  return result;
}

/** Registered ownership scopes an unavailable source, never its missing dates,
 * messages, durations or current native turn state. Restored copies retain the
 * original owners; the verified ancestry is the fallback for zero-event input. */
export function unavailableOwners(original:WaitOriginal,scope:{employeeId?:string;project?:string}={}){
  if(!original.unavailable)return [];
  const fallback=original.ownerFallback??original.record;
  const owners=original.origins.length?original.origins:[{employeeId:fallback.employee_id,employee:fallback.employee,project:fallback.manifest.project,snapshotId:fallback.id}];
  return [...new Map(owners.filter(owner=>(!scope.employeeId||owner.employeeId===scope.employeeId)&&(scope.project===undefined||owner.project===scope.project))
    .map(owner=>[JSON.stringify([owner.employeeId,owner.project]),{employeeId:owner.employeeId,employee:owner.employee,project:owner.project,snapshotId:owner.snapshotId}])).values()];
}

export function waitEvidence(original: WaitOriginal, line: number, block = 0, rawEvent = false): WaitEvidence {
  const snapshotId = original.record.id;
  return { snapshotId, line, block,
    webPath: evidenceLink(snapshotId, rawEvent ? { kind: 'raw', line, textOffset: 0 }
      : { kind: 'event', offset: 0, line, block, textOffset: 0, parserVersion: original.facts.parserVersion }),
    conversationPath: rawEvent ? null : conversationLink(snapshotId, { line, block, textOffset: 0, parserVersion: original.facts.parserVersion }) };
}
