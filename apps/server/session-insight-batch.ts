import type { Database } from './database.js';
import { digest } from './database.js';
import type { RawStore } from './raw-store.js';
import { HttpError } from './identities.js';
import { readEvidence } from './evidence.js';
import { attributionRevisions } from './qualification.js';
import { verifyOriginIntegrity, repairLegacyCarriers, primaryInputCoverage, inputIntegrityVersion } from './evidence-integrity.js';
import { locatedOrigin } from './material-provenance.js';
import { activityFor } from '../../packages/activity.js';
import type { EventOrigin } from '../../packages/contracts/provenance.js';
import type { Manifest, Source } from '../../packages/contracts/archive.js';
import type { AnalysisInput } from './analysis.js';
import type { SessionInsights } from '../../packages/contracts/session-insights.js';
import type { AnalysisRun } from '../../packages/contracts/analysis.js';
import { readNativeTurnState } from '../../packages/native/turn-state.js';
import { recordedOutputFacts, outputFactsVersion } from './session-output-facts.js';
import { analysisTransaction, sweepQueue } from '../analysis/queue.js';
import { projectSessionInsights } from './session-insights.js';

type Record = { id: string; device_id: string; source: Source; hash: string; manifest: Manifest };
type Facts = { input: SessionInsights['input']; facts: SessionInsights['facts']; sourceState: NonNullable<SessionInsights['sourceState']> };
const unknown = () => ({ value: null, complete: false, evidence: [], contributions: [], scope: 'after-enrollment' as const });
const unknownFacts = () => ({ codeChanges: unknown(), tests: unknown(), commits: unknown() });

/** One bounded preparation for report/assessment consumers. Every current read
 * verifies original bytes; persisted projections contain no transcript copy. */
export async function readInsightBatch(db: Database, raw: RawStore, requested: string[], full = false): Promise<SessionInsights[]> {
  for(let attempt=0;;attempt++){
    try{return await readInsightBatchOnce(db,raw,requested,full);}catch(error){
      if(!['40001','40P01'].includes((error as {code?:string}).code??'')||attempt>=2)throw error;
    }
  }
}
async function readInsightBatchOnce(db: Database, raw: RawStore, requested: string[], full: boolean): Promise<SessionInsights[]> {
  const ids = [...new Set(requested)];
  if (!ids.length) return [];
  if (ids.length > 20000) throw new HttpError(413, '会话洞察数量超过范围上限');
  await analysisTransaction(db, sweepQueue);
  const records = (await db.query('SELECT id,device_id,source,hash,manifest FROM snapshots WHERE id=ANY($1::uuid[])', [ids])).rows as Record[];
  if (records.length !== ids.length) throw new HttpError(404, '会话洞察输入原件不存在');
  if (records.reduce((sum, row) => sum + row.manifest.byteLength, 0) > 128 * 1024 * 1024) throw new HttpError(413, '会话洞察原件超过范围上限');
  const missing = (await db.query(`SELECT DISTINCT se.event_id FROM snapshot_events se WHERE se.snapshot_id=ANY($1::uuid[])
    AND NOT EXISTS(SELECT 1 FROM event_integrity i WHERE i.event_id=se.event_id AND i.version='original-utf8-1')`, [ids])).rows;
  await verifyOriginIntegrity(db, raw, missing.map(row => row.event_id));
  await repairLegacyCarriers(db, raw);
  const client = await db.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    const revisions = await attributionRevisions(client,ids);
    const jobs = (await client.query(`SELECT j.id,j.snapshot_id AS "snapshotId",j.state,j.config,j.input-'events' AS input,j.result,j.target_generation AS generation,
      t.applicable_job_id,t.desired_snapshot_id,t.config_hash,t.generation AS desired_generation,t.parser_version,t.attribution_revision
      FROM (SELECT DISTINCT ON(snapshot_id) * FROM analysis_jobs WHERE snapshot_id=ANY($1::uuid[]) ORDER BY snapshot_id,created_at DESC,id DESC) j
      LEFT JOIN analysis_targets t ON t.id=j.target_id`, [ids])).rows;
    const runs = new Map<string, AnalysisRun>();
    for (const job of jobs) {
      job.applicable = job.applicable_job_id === job.id && job.desired_snapshot_id === job.snapshotId && job.config_hash === job.config.configurationHash
        && Number(job.desired_generation) === Number(job.generation) && job.parser_version === job.input.parserVersion
        && String(job.attribution_revision) === String(job.input.attributionRevision ?? '0') && String(job.attribution_revision) === revisions.get(job.snapshotId);
      runs.set(job.snapshotId, job as AnalysisRun);
    }
    const keys = new Map(records.map(record => [record.id, digest(JSON.stringify(['insight-input-1', outputFactsVersion, inputIntegrityVersion, 'native-turn-state-1',
      record.id, record.hash, readEvidence(Buffer.alloc(0), record.source).parserVersion, revisions.get(record.id)]))]));
    const cached = new Map<string, Facts>(full ? [] : (await client.query('SELECT version,payload FROM insight_fact_revisions WHERE version=ANY($1::text[])', [[...keys.values()]])).rows.map(row => [row.version, row.payload]));
    const missingIds = records.filter(record => !cached.has(keys.get(record.id)!)).map(record => record.id);
    const originRows = missingIds.length ? (await client.query(`SELECT se.snapshot_id AS carrier,se.line,se.block,o.event_id AS "eventId",o.snapshot_id AS "snapshotId",o.line AS "originLine",o.block AS "originBlock",
      o.employee_id AS "employeeId",e.name AS employee,o.device_id AS "deviceId",o.project,o.context,o.source_date AS "sourceDate",o.material_id AS "materialId",o.text_offset AS "textOffset",
      CASE WHEN o.qualification_revision>0 THEN jsonb_build_object('revision',o.qualification_revision::text,'proofSnapshotId',o.proof_snapshot_id,
        'proofLine',o.proof_line,'proofBlock',o.proof_block,'enrolledAt',o.proof_enrolled_at) ELSE NULL END AS qualification
      FROM effective_snapshot_events se JOIN effective_event_origins o ON o.event_id=se.event_id JOIN employees e ON e.id=o.employee_id
      WHERE se.snapshot_id=ANY($1::uuid[]) ORDER BY se.snapshot_id,se.line,se.block`, [missingIds])).rows : [];
    const origins = new Map<string, Map<string, EventOrigin>>();
    for (const row of originRows) { const map = origins.get(row.carrier) ?? new Map(); map.set(`${row.line}/${row.block}`, locatedOrigin({ ...row, line: row.originLine, block: row.originBlock })); origins.set(row.carrier, map); }
    const views: SessionInsights[] = [], inserted: { version: string; snapshotId: string; payload: Facts }[] = [];
    let parsedEvents = 0;
    for (const record of records) {
      const bytes = await raw.read(record.device_id, record.hash);
      if (bytes.length !== record.manifest.byteLength) throw new HttpError(409, '会话洞察原件大小不一致');
      const key = keys.get(record.id)!;
      let facts = cached.get(key);
      if (!facts) {
        const input = { hash: record.hash, parserVersion: readEvidence(Buffer.alloc(0), record.source).parserVersion, attributionRevision: revisions.get(record.id)! };
        facts = { input, facts: unknownFacts(), sourceState: { version: 'native-turn-state-1', turn: readNativeTurnState(bytes, record.source) } };
        let valid = true; try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { valid = false; }
        if (valid && bytes.length <= 8 * 1024 * 1024) {
          const parsed = readEvidence(bytes, record.source), mapped = origins.get(record.id) ?? new Map<string, EventOrigin>();
          parsedEvents += parsed.events.length; if (parsedEvents > 100000) throw new HttpError(413, '会话洞察事件超过范围上限');
          if (parsed.events.length && parsed.events.length <= 4096 && parsed.events.every(event => mapped.has(`${event.line}/${event.block ?? 0}`))) {
            const attributed = activityFor(parsed.events, record.manifest.enrolledAt, undefined, mapped);
            const prepared: AnalysisInput = { ...input, snapshotId: record.id, source: record.source, sourceVersion: record.manifest.sourceVersion,
              eventCount: parsed.events.length, events: attributed.events, coverage: { unrecognizedLines: primaryInputCoverage(bytes,record.source,parsed).unrecognizedLines, partialLine: parsed.partialLine,
                excludedMaterials: record.manifest.capture?.materials.length ?? 0, captureGaps: record.manifest.capture?.gaps ?? [], scope: '当前不可变主原件的全部已解析事件' } };
            facts.facts = recordedOutputFacts(bytes, prepared);
          }
        }
        inserted.push({ version: key, snapshotId: record.id, payload: facts });
      }
      views.push(projectSessionInsights(record.id, facts.input, runs.get(record.id), facts.facts, facts.sourceState));
    }
    for (let offset = 0; offset < inserted.length; offset += 100) await client.query(`INSERT INTO insight_fact_revisions(version,snapshot_id,payload)
      SELECT x.version,x."snapshotId",x.payload FROM jsonb_to_recordset($1::jsonb) AS x(version text,"snapshotId" uuid,payload jsonb) ON CONFLICT DO NOTHING`, [JSON.stringify(inserted.slice(offset,offset+100))]);
    for (let offset = 0; offset < views.length; offset += 100) await client.query(`INSERT INTO session_insight_revisions(version,snapshot_id,analysis_id,payload)
      SELECT x.version,x."snapshotId",(x."analysisVersion"->>'id')::uuid,x.payload FROM jsonb_to_recordset($1::jsonb) AS x(version text,"snapshotId" uuid,"analysisVersion" jsonb,payload jsonb) ON CONFLICT DO NOTHING`, [JSON.stringify(views.slice(offset,offset+100).map(view => ({ ...view, payload: view })))]);
    await client.query('COMMIT');
    const byId = new Map(views.map(view => [view.snapshotId, view]));
    return requested.map(id => byId.get(id)!);
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}
