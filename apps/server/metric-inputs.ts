import type pg from 'pg';
import { digest } from './database.js';
import { readEvidence } from './evidence.js';
import { conversationContext } from './conversation-trace.js';
import { primaryInputCoverage, inputIntegrityVersion } from './evidence-integrity.js';
import { nativeStatistics, statisticsExtractorVersion } from '../../packages/native-statistics.js';
import type { Manifest, Source } from '../../packages/contracts/archive.js';

const version = `metric-input-1/${statisticsExtractorVersion}/${inputIntegrityVersion}`;
export type MetricInputFacts = Pick<ReturnType<typeof nativeStatistics>, 'usage' | 'supported' | 'complete'> & {
  coverageComplete: boolean; excludedUserLines: number[];
};
type Identity = { snapshotId: string; attributionRevision: string; materialId?: string;
  hash: string; source: Source; sourceVersion: string; manifest?: Manifest };
const identify = (input: Identity) => {
  const parserVersion = readEvidence(Buffer.alloc(0), input.source).parserVersion;
  return { parserVersion, key: digest(JSON.stringify([version, parserVersion, input.snapshotId, input.attributionRevision,
    input.materialId ?? null, input.hash, input.source, input.sourceVersion])) };
};

/** Only derived facts are retained. Callers verify the original hash before
 * entering this module, including warm reads. Full recomputation bypasses the
 * stored projection; old metric result versions remain immutable. */
export async function metricInputBatch(client: pg.PoolClient, identities: Identity[], full: boolean) {
  const keys = identities.map(input => identify(input).key);
  const stored = full || !keys.length ? [] : (await client.query('SELECT version,payload FROM metric_input_revisions WHERE version=ANY($1::text[])', [keys])).rows;
  const cached = new Map<string, MetricInputFacts>(stored.map(row => [row.version, row.payload]));
  const pending = new Map<string, { version: string; snapshot_id: string; attribution_revision: string; parser_version: string; payload: MetricInputFacts }>();
  function read(input: Identity & { bytes: Buffer }): MetricInputFacts {
    const { key, parserVersion } = identify(input);
    const known = cached.get(key); if (known) return known;
    const parsed = nativeStatistics(input.bytes, input.source, input.sourceVersion);
    const evidence = readEvidence(input.bytes, input.source);
    const excluded = new Set(evidence.events.filter(event => conversationContext(event) === 'environment').map(event => event.line));
    if (input.source === 'claude-code-cli') for (const [index, text] of input.bytes.toString('utf8').split('\n').entries()) {
      try { const row = JSON.parse(text); if (row.isCompactSummary === true || row.isMeta === true) excluded.add(index + 1); } catch { /* Incomplete evidence stays unknown. */ }
    }
    const facts: MetricInputFacts = { usage: parsed.usage, supported: parsed.supported, complete: parsed.complete,
      coverageComplete: primaryInputCoverage(input.bytes, input.source, evidence).complete, excludedUserLines: [...excluded].sort((a, b) => a - b) };
    cached.set(key, facts);
    pending.set(key, { version: key, snapshot_id: input.snapshotId, attribution_revision: input.attributionRevision, parser_version: parserVersion, payload: facts });
    return facts;
  }
  async function flush() {
    const rows = [...pending.values()];
    for (let offset = 0; offset < rows.length; offset += 100) await client.query(`INSERT INTO metric_input_revisions(version,snapshot_id,attribution_revision,parser_version,payload)
      SELECT version,snapshot_id,attribution_revision,parser_version,payload FROM jsonb_to_recordset($1::jsonb)
      AS x(version text,snapshot_id uuid,attribution_revision text,parser_version text,payload jsonb) ON CONFLICT(version) DO NOTHING`, [JSON.stringify(rows.slice(offset, offset + 100))]);
    pending.clear();
  }
  return { read, flush };
}
export async function materializeMetricInput(client: pg.PoolClient, input: Identity & { bytes: Buffer; full: boolean }): Promise<MetricInputFacts> {
  const batch = await metricInputBatch(client, [input], input.full), facts = batch.read(input);
  await batch.flush(); return facts;
}
