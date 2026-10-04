import type { Database } from './database.js';
import { digest } from './database.js';
import type { ArchiveQuery } from './archive-query.js';
import { prepareAnalysisInput, type AnalysisService } from './analysis.js';
import type { SessionInsights } from '../../packages/contracts/session-insights.js';
import { readEvidence } from './evidence.js';
import { attributionRevision } from './qualification.js';
import { HttpError } from './identities.js';
import { recordedOutputFacts, outputFactsVersion } from './session-output-facts.js';

export async function migrateSessionInsights(db:Database){
  const client=await db.connect();try{
    await client.query('BEGIN; SELECT pg_advisory_xact_lock(7402138)');
    await client.query(`CREATE TABLE IF NOT EXISTS session_insight_revisions(version text PRIMARY KEY,snapshot_id uuid NOT NULL REFERENCES snapshots(id),analysis_id uuid REFERENCES analysis_jobs(id),payload jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
      CREATE INDEX IF NOT EXISTS session_insight_analysis ON session_insight_revisions(snapshot_id,analysis_id,created_at DESC)`);
    await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}

export function sessionInsightsService(db: Database, archive: ArchiveQuery, analysis: AnalysisService) {
  async function read(snapshotId: string, selection: { analysisId?: string;version?:string } = {}): Promise<SessionInsights> {
    const record = await archive.snapshot(snapshotId);
    if(selection.version){
      const row=(await db.query('SELECT payload FROM session_insight_revisions WHERE version=$1 AND snapshot_id=$2',[selection.version,snapshotId])).rows[0];
      if(!row)throw new HttpError(404,'会话洞察版本不存在');
      if(selection.analysisId&&row.payload.analysisVersion?.id!==selection.analysisId)throw new HttpError(409,'版本不属于所选分析');
      return row.payload;
    }
    if(selection.analysisId){
      const row=(await db.query('SELECT payload FROM session_insight_revisions WHERE snapshot_id=$1 AND analysis_id=$2 ORDER BY created_at DESC,version DESC LIMIT 1',[snapshotId,selection.analysisId])).rows[0];
      if(row)return row.payload;
    }
    const page = await analysis.list(snapshotId);
    const run = selection.analysisId ? await analysis.get(selection.analysisId) : page.runs[0];
    if (run && run.snapshotId !== snapshotId) throw new HttpError(409, '分析版本不属于此快照');
    const input = selection.analysisId&&run ? {hash:run.input.hash,parserVersion:run.input.parserVersion,attributionRevision:String(run.input.attributionRevision??'0')} : { hash: record.hash, parserVersion: readEvidence(Buffer.alloc(0), record.source).parserVersion, attributionRevision: String(await attributionRevision(db, snapshotId)) };
    const usable=run?.state==='succeeded'&&(selection.analysisId||run.applicable)&&run.result?.insights;
    const state = !run ? 'unavailable' : run.state === 'failed' ? 'failed' : run.state === 'superseded'||run.state==='succeeded'&&!run.applicable&&!selection.analysisId ? 'stale' : run.state === 'succeeded' ? !usable?'legacy':usable.complete&&run.result?.processing?.complete?'complete':'partial' : 'pending';
    const analysisVersion = run ? { id: run.id, generation: run.generation, prompt: run.config.promptVersion, configuration: run.config.configurationHash, applicable: run.applicable } : null;
    const unknown = () => ({ value: null, complete: false, evidence: [],contributions:[],scope:'after-enrollment' as const });
    let facts:SessionInsights['facts']={codeChanges:unknown(),tests:unknown(),commits:unknown()};
    if(record.manifest.byteLength<=8*1024*1024){
      try{
        const prepared=await prepareAnalysisInput(db,archive,snapshotId,{maxSessionBytes:8*1024*1024});
        if(String(prepared.input.attributionRevision)!==input.attributionRevision){
          if(!selection.analysisId)throw new HttpError(409,'原件归属已更新，请重新读取会话洞察');
          // A newly requested historical analysis cannot borrow today's changed ownership.
        }else{
          const {bytes}=await archive.exported(snapshotId,'raw');facts=recordedOutputFacts(bytes,prepared.input);
          if(String(await attributionRevision(db,snapshotId))!==input.attributionRevision)throw new HttpError(409,'原件归属已更新，请重新读取会话洞察');
        }
      }catch(error){
        // An empty, unparsed or over-limit original is still a readable unavailable view.
        if(!(error instanceof HttpError)||![413,422].includes(error.statusCode))throw error;
      }
    }
    const complete=!!usable&&usable.complete&&run?.result?.processing?.complete===true;
    const value:SessionInsights={ version: digest(JSON.stringify({ snapshotId,input, analysisVersion, state, outputFactsVersion,readingVersion:'session-insights-read-1' })),factsVersion:outputFactsVersion, snapshotId, input, state, analysisVersion,
      inferences:usable||null, metrics: { verified: complete?usable!.outcomes.filter(v=>v.status==='verified').length:null,
        claimed:complete?usable!.outcomes.filter(v=>v.status==='claimed').length:null,
        rework:complete&&usable!.prompts.filter(p=>!p.first).every(p=>p.rework!==null)?usable!.prompts.filter(p=>!p.first&&p.rework).length:null,
        clarifications:complete&&usable!.replies.every(r=>r.clarification!==null)?usable!.replies.filter(r=>r.clarification).length:null }, facts };
    if(Buffer.byteLength(JSON.stringify(value))>80*1024)throw new HttpError(413,'会话洞察超过单次读取上限，请读取分析与原文分页');
    await db.query('INSERT INTO session_insight_revisions(version,snapshot_id,analysis_id,payload) VALUES($1,$2,$3,$4) ON CONFLICT(version) DO NOTHING',[value.version,snapshotId,usable&&run?run.id:null,value]);
    return (await db.query('SELECT payload FROM session_insight_revisions WHERE version=$1',[value.version])).rows[0].payload;
  }
  return { read };
}
