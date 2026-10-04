import type pg from 'pg';
import type { Source } from '../../packages/contracts/archive.js';
import type { MetricsScope } from '../../packages/contracts/metrics.js';
import { digest } from './database.js';

type EventRow = [eventId: string, snapshotId: string, employeeId: string, employee: string, deviceId: string, source: Source,
  sourceSessionId: string, project: string, sourceDate: string, role: string, line: number, block: number, materialId: string | null,
  qualification: string, proof: string | null];
export type MetricEventTuple = [position: number, eventId: string, role: string, line: number, block: number, qualification: string, proof: string | null];
export type MetricEventGroup = { snapshot_id: string; employee_id: string; employee: string; device_id: string; source: Source;
  source_session_id: string; project: string; source_date: string; material_id: string | null; events: MetricEventTuple[] };
type UserReference = { group: MetricEventGroup; event: MetricEventTuple };
const sameMetadata = (group: MetricEventGroup, row: EventRow) => group.snapshot_id === row[1] && group.employee_id === row[2]
  && group.employee === row[3] && group.device_id === row[4] && group.source === row[5]
  && group.source_session_id === row[6] && group.project === row[7] && group.source_date === row[8]
  && group.material_id === row[12];

/** Select every original event before preparing shared request-local keys.
 * The database determines event order and enforces the pre-group bound. The
 * compact identity retains every field/occurrence without asking PostgreSQL
 * to sort the wide rows a second time by nine repeated metadata columns. */
export async function readMetricEvents(client: pg.PoolClient, scope: MetricsScope, limit: number): Promise<{ users: UserReference[]; groups: MetricEventGroup[]; identity: string } | undefined> {
  const rows = (await client.query<EventRow>({ rowMode: 'array', text: `SELECT o.event_id,o.snapshot_id,o.employee_id,e.name AS employee,o.device_id,o.source,
      o.source_session_id,o.project,o.source_date,o.role,o.line,o.block,o.material_id,o.qualification_revision,o.proof_snapshot_id
    FROM effective_event_origins o JOIN employees e ON e.id=o.employee_id
    WHERE o.context='after-enrollment' AND o.source_date BETWEEN $1 AND $2
      AND ($3::uuid IS NULL OR o.employee_id=$3) AND ($4::text IS NULL OR o.source=$4) AND ($5::text IS NULL OR o.project=$5)
    ORDER BY o.event_id LIMIT ($6::integer+1)`,
  values: [scope.from, scope.to, scope.employeeId ?? null, scope.source ?? null, scope.project ?? null, limit] })).rows;
  if (rows.length > limit) return undefined;
  const groups: MetricEventGroup[] = [], users: UserReference[] = [];
  const bySnapshot = new Map<string, { first: number; others?: Map<string, number> }>();
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]!;
    const bucket = bySnapshot.get(row[1]);
    let groupIndex: number | undefined, key: string | undefined;
    // Most ordinary carriers share one metadata tuple. Compare all fields
    // before reusing it; variants still use a complete, bounded map lookup.
    if (bucket && sameMetadata(groups[bucket.first]!, row)) groupIndex = bucket.first;
    else if (bucket) {
      key = JSON.stringify([row[1],row[2],row[3],row[4],row[5],row[6],row[7],row[8],row[12]]);
      groupIndex = bucket.others?.get(key);
    }
    if (groupIndex === undefined) {
      groupIndex = groups.length;
      if (!bucket) bySnapshot.set(row[1], { first: groupIndex });
      else { bucket.others ??= new Map(); bucket.others.set(key!, groupIndex); }
      groups.push({ snapshot_id: row[1], employee_id: row[2], employee: row[3], device_id: row[4],
        source: row[5], source_session_id: row[6], project: row[7], source_date: row[8], material_id: row[12], events: [] });
    }
    const group = groups[groupIndex]!, event: MetricEventTuple = [index + 1,row[0],row[9],row[10],row[11],row[13],row[14]];
    group.events.push(event);
    // User order follows the original rows, not a group's first other role.
    if (row[9] === 'user') users.push({ group, event });
  }
  // First appearance and append order are exactly the database ordinals used
  // by metric-event-input-1; moving packing does not change saved identities.
  const identity = digest(JSON.stringify(['metric-event-input-1', groups]));
  return { users, groups, identity };
}
