import type pg from 'pg';
import { digest } from './database.js';
import { readEvidence } from './evidence.js';
import { conversationContext } from './conversation-trace.js';
import { nativeTurnBoundaries, type TurnBoundary } from '../../packages/native/waits.js';
import type { EvidenceLine, Source } from '../../packages/contracts/archive.js';

export const waitAlgorithmVersion = 'recorded-waits-3';
export interface WaitInput {
  parserVersion: string; boundaries: TurnBoundary[]; messages: EvidenceLine[];
  pairs: { start: TurnBoundary | null; end: EvidenceLine; beforeLine: number | null }[];
}
type Identity={snapshotId:string;source:Source;hash:string};
function identify(input:Identity){
  const parserVersion = readEvidence(Buffer.alloc(0), input.source).parserVersion;
  const key = digest(JSON.stringify([waitAlgorithmVersion, input.snapshotId, input.hash, input.source, parserVersion]));
  return {parserVersion,key};
}
export async function waitInputBatch(client:pg.PoolClient,identities:Identity[],full:boolean){
  const keys=identities.map(input=>identify(input).key);
  const rows=full||!keys.length?[]:(await client.query('SELECT version,payload FROM wait_input_revisions WHERE version=ANY($1::text[])',[keys])).rows;
  const saved=new Map<string,WaitInput>(rows.map(row=>[row.version,row.payload])),pending=new Map<string,{version:string;snapshot_id:string;payload:WaitInput}>();
  function read(input:Identity&{bytes:Buffer}){
    const {key,parserVersion}=identify(input),known=saved.get(key);if(known)return known;
    const value=parseWaitInput(input.bytes,input.source,parserVersion);saved.set(key,value);pending.set(key,{version:key,snapshot_id:input.snapshotId,payload:value});return value;
  }
  async function flush(){const rows=[...pending.values()];for(let offset=0;offset<rows.length;offset+=100)await client.query(`INSERT INTO wait_input_revisions(version,snapshot_id,payload)
    SELECT version,snapshot_id,payload FROM jsonb_to_recordset($1::jsonb) AS x(version text,snapshot_id uuid,payload jsonb) ON CONFLICT DO NOTHING`,[JSON.stringify(rows.slice(offset,offset+100))]);pending.clear();}
  return {read,flush};
}
export async function waitInput(client: pg.PoolClient, input: Identity & { bytes: Buffer; full: boolean }): Promise<WaitInput> {
  const batch=await waitInputBatch(client,[input],input.full),value=batch.read(input);await batch.flush();return value;
}
function parseWaitInput(bytes:Buffer,source:Source,parserVersion:string):WaitInput {
  const input={bytes,source};
  const evidence = readEvidence(input.bytes, input.source);
  const excluded = new Set<number>();
  if (input.source === 'claude-code-cli') for (const [index, text] of input.bytes.toString('utf8').split('\n').entries()) {
    try { const row = JSON.parse(text); if (row.isCompactSummary === true || row.isMeta === true) excluded.add(index + 1); } catch {}
  }
  // Persist only the timing/role projection. The immutable raw store already owns
  // the message text; repeating long bodies in every revision is unnecessary.
  const messages = evidence.events.filter(event => !conversationContext(event) && !excluded.has(event.line)).map(event => ({ ...event, text: '' }));
  const boundaries = nativeTurnBoundaries(input.bytes, input.source);
  const rows = [...messages.map(message => ({ line: message.line, message })), ...boundaries.map(boundary => ({ line: boundary.line, boundary }))]
    .sort((a, b) => a.line - b.line) as { line: number; message?: EvidenceLine; boundary?: TurnBoundary }[];
  let pending: TurnBoundary | null = null, agentSeen = false, beforeLine: number | null = null;
  const pairs: WaitInput['pairs'] = [];
  const active = new Set<string>(), completed = new Map<string, TurnBoundary>(), conflicts = new Set<string>();
  for (const row of rows) {
    if (row.boundary) {
      const boundary = row.boundary, id = boundary.turnId;
      if (boundary.kind === 'completed') {
        if (id && completed.has(id)) {
          if (completed.get(id)!.timestamp !== boundary.timestamp) conflicts.add(id);
          continue;
        }
        if (id) { completed.set(id, boundary); active.delete(id); }
        pending = active.size === 0 ? boundary : null;
      } else if (boundary.kind === 'started') {
        if (id && completed.has(id)) continue;
        if (id) active.add(id);
        // Native Codex records started before the submitted user message. Keep
        // the previous completion until that message; concurrent/unknown turns
        // cannot establish an unambiguous waiting boundary.
        if (!id || active.size > 1) pending = null;
      } else { if (id) active.delete(id); pending = null; agentSeen = false; }
      continue;
    }
    const message = row.message!;
    if (message.role === 'user') {
      if (pending || agentSeen) pairs.push({ start: pending, end: message, beforeLine });
      pending = null; agentSeen = false;
    } else if (message.role === 'assistant' || message.role === 'tool request') {
      agentSeen = true;
      if (active.size > 0) pending = null;
    }
    beforeLine = message.line;
  }
  for (const pair of pairs) if (pair.start?.turnId && conflicts.has(pair.start.turnId)) pair.start = { ...pair.start, timestamp: null };
  const result = { parserVersion, boundaries, messages, pairs };
  return result;
}
