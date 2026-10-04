import type pg from 'pg';
import { setImmediate } from 'node:timers/promises';
import { digest } from './database.js';
import { readEvidence } from './evidence.js';
import { conversationContext } from './conversation-trace.js';
import { primaryInputCoverage, inputIntegrityVersion } from './evidence-integrity.js';
import { codexInitialBaseline, nativeStatistics, statisticsExtractorVersion } from '../../packages/native-statistics.js';
import type { Manifest, Source } from '../../packages/contracts/archive.js';
import { prepareOriginal } from '../../packages/native/prepared-original.js';
import { completeOriginalLines } from '../../packages/native/raw-lines.js';

const version = `metric-input-3/${statisticsExtractorVersion}/${inputIntegrityVersion}`;
export type MetricInputFacts = Pick<ReturnType<typeof nativeStatistics>, 'usage' | 'supported' | 'complete'> & {
  coverageComplete: boolean; excludedUserLines: number[];
};
type Identity = { snapshotId: string; attributionRevision: string; materialId?: string;
  hash: string; source: Source; sourceVersion: string; manifest?: Manifest; baselineContinuity?: boolean };
const identify = (input: Identity) => {
  const parserVersion = readEvidence(Buffer.alloc(0), input.source).parserVersion;
  return { parserVersion, key: digest(JSON.stringify([version, parserVersion, input.snapshotId, input.attributionRevision,
    input.materialId ?? null, input.hash, input.source, input.sourceVersion, input.baselineContinuity === true])) };
};

/** User classification can still use exact readable lines beside a corrupt
 * line. It does not infer usage or create a normal statistics projection. */
export function metricExcludedUserLines(bytes: Buffer, source: Source, evidence = readEvidence(bytes, source)): number[] {
  const excluded = new Set(evidence.events.filter(event => conversationContext(event) === 'environment').map(event => event.line));
  if (source === 'claude-code-cli') for (const { line, text } of completeOriginalLines(bytes)) {
    if (text === null) continue;
    try { const row = JSON.parse(text); if (row.isCompactSummary === true || row.isMeta === true) excluded.add(line); } catch { /* Incomplete evidence stays unknown. */ }
  }
  return [...excluded].sort((a, b) => a - b);
}

/** Only derived facts are retained. Callers verify the original hash before
 * entering this module, including warm reads. Full recomputation bypasses the
 * stored projection; old metric result versions remain immutable. */
export async function metricInputBatch(client: pg.PoolClient, identities: Identity[], full: boolean) {
  const keys = identities.map(input => identify(input).key);
  const stored = full || !keys.length ? [] : (await client.query('SELECT version,payload FROM metric_input_revisions WHERE version=ANY($1::text[])', [keys])).rows;
  const cached = new Map<string, MetricInputFacts>(stored.map(row => [row.version, row.payload]));
  const pending = new Map<string, { version: string; snapshot_id: string; attribution_revision: string; parser_version: string; payload: MetricInputFacts }>();
  const coverageProofs = new Map<string, ReturnType<typeof primaryInputCoverage>>();
  let inFlight: Promise<void> | undefined, writeFailure: { error: unknown } | undefined;
  function read(input: Identity & { bytes: Buffer }): MetricInputFacts {
    const { key, parserVersion } = identify(input);
    const known = cached.get(key); if (known) return known;
    const prepared = prepareOriginal(input.bytes);
    const parsed = nativeStatistics(input.bytes, input.source, input.sourceVersion, { prepared,
      codexInitialBaseline: input.manifest && !input.materialId && input.baselineContinuity === true ? codexInitialBaseline(input.bytes, input.manifest, prepared) : false });
    const evidence = readEvidence(input.bytes, input.source, prepared);
    const excluded = metricExcludedUserLines(input.bytes, input.source, evidence);
    const coverage = primaryInputCoverage(input.bytes, input.source, evidence, prepared);
    if (!input.materialId) coverageProofs.set(input.snapshotId, coverage);
    const facts: MetricInputFacts = { usage: parsed.usage, supported: parsed.supported, complete: parsed.complete,
      coverageComplete: coverage.complete, excludedUserLines: excluded };
    cached.set(key, facts);
    pending.set(key, { version: key, snapshot_id: input.snapshotId, attribution_revision: input.attributionRevision, parser_version: parserVersion, payload: facts });
    return facts;
  }
  function takeRows() {
    const rows = [...pending.values()].slice(0, 100);
    for (const row of rows) pending.delete(row.version);
    return rows;
  }
  async function writeRows(rows: ReturnType<typeof takeRows>) {
    await client.query(`INSERT INTO metric_input_revisions(version,snapshot_id,attribution_revision,parser_version,payload)
      SELECT version,snapshot_id,attribution_revision,parser_version,payload FROM jsonb_to_recordset($1::jsonb)
      AS x(version text,snapshot_id uuid,attribution_revision text,parser_version text,payload jsonb) ON CONFLICT(version) DO NOTHING`, [JSON.stringify(rows)]);
  }
  async function settle() {
    await inFlight; inFlight = undefined;
    if (writeFailure) throw writeFailure.error;
  }
  /** Only primary parsing may overlap a fact write. The caller drains before
   * any further SQL, preserving the first database error and transaction retry. */
  async function checkpoint() {
    if (pending.size < 100) return;
    await settle();
    // No continuation schedules another query: at most one strict 100-row
    // batch is in flight, with rejection handled even if parsing later fails.
    inFlight = writeRows(takeRows()).catch(error => { writeFailure ??= { error }; });
    await setImmediate();
  }
  async function drainFacts() {
    await settle();
    while (pending.size) await writeRows(takeRows());
  }
  async function flush() {
    // Every request size takes fact locks before coverage locks. Mixing this
    // order for small and pipelined batches would introduce a deadlock cycle.
    await drainFacts();
    const proofs = [...coverageProofs].map(([snapshotId, proof]) => ({ snapshotId, ...proof }));
    for (let offset=0; offset<proofs.length; offset+=100) await client.query(`INSERT INTO snapshot_input_integrity(snapshot_id,version,complete,unrecognized_lines,partial_line)
      SELECT x."snapshotId",$2,x.complete,x."unrecognizedLines",x."partialLine" FROM jsonb_to_recordset($1::jsonb) AS x("snapshotId" uuid,complete boolean,"unrecognizedLines" integer,"partialLine" boolean) ON CONFLICT DO NOTHING`, [JSON.stringify(proofs.slice(offset,offset+100)),inputIntegrityVersion]);
    coverageProofs.clear();
  }
  return { read, checkpoint, drainFacts, flush };
}
export async function materializeMetricInput(client: pg.PoolClient, input: Identity & { bytes: Buffer; full: boolean }): Promise<MetricInputFacts> {
  const batch = await metricInputBatch(client, [input], input.full), facts = batch.read(input);
  await batch.flush(); return facts;
}
