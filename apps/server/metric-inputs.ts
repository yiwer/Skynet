import type pg from 'pg';
import { digest } from './database.js';
import { readEvidence } from './evidence.js';
import { conversationContext } from './conversation-trace.js';
import { primaryInputCoverage, inputIntegrityVersion } from './evidence-integrity.js';
import { codexInitialBaseline, nativeStatistics, statisticsExtractorVersion } from '../../packages/native-statistics.js';
import type { Source } from '../../packages/contracts/archive.js';

const version = `metric-input-2/${statisticsExtractorVersion}/${inputIntegrityVersion}`;
type Facts = Pick<ReturnType<typeof nativeStatistics>, 'usage' | 'supported' | 'complete'> & {
  coverageComplete: boolean; excludedUserLines: number[];
};

/** Only derived facts are retained. Callers verify the original hash before
 * entering this module, including warm reads. Full recomputation bypasses the
 * stored projection; old metric result versions remain immutable. */
export async function materializeMetricInput(client: pg.PoolClient, input: {
  snapshotId: string; attributionRevision: string; materialId?: string; bytes: Buffer;
  hash: string; source: Source; sourceVersion: string; full: boolean;
}): Promise<Facts> {
  const parserVersion = readEvidence(Buffer.alloc(0), input.source).parserVersion;
  const key = digest(JSON.stringify([version, parserVersion, input.snapshotId, input.attributionRevision,
    input.materialId ?? null, input.hash, input.source, input.sourceVersion]));
  if (!input.full) {
    const cached = (await client.query('SELECT payload FROM metric_input_revisions WHERE version=$1', [key])).rows[0];
    if (cached) return cached.payload as Facts;
  }
  const manifest = input.materialId ? undefined : (await client.query('SELECT manifest FROM snapshots WHERE id=$1', [input.snapshotId])).rows[0]?.manifest;
  const parsed = nativeStatistics(input.bytes, input.source, input.sourceVersion, { codexInitialBaseline: manifest ? codexInitialBaseline(input.bytes, manifest) : false });
  const excluded = new Set(readEvidence(input.bytes, input.source).events
    .filter(event => conversationContext(event) === 'environment').map(event => event.line));
  if (input.source === 'claude-code-cli') for (const [index, text] of input.bytes.toString('utf8').split('\n').entries()) {
    try { const row = JSON.parse(text); if (row.isCompactSummary === true || row.isMeta === true) excluded.add(index + 1); } catch { /* Incomplete evidence stays unknown. */ }
  }
  const facts: Facts = { usage: parsed.usage, supported: parsed.supported, complete: parsed.complete,
    coverageComplete: primaryInputCoverage(input.bytes, input.source).complete, excludedUserLines: [...excluded].sort((a, b) => a - b) };
  await client.query(`INSERT INTO metric_input_revisions(version,snapshot_id,attribution_revision,parser_version,payload)
    VALUES($1,$2,$3,$4,$5) ON CONFLICT(version) DO NOTHING`, [key, input.snapshotId, input.attributionRevision, parserVersion, facts]);
  return facts;
}
