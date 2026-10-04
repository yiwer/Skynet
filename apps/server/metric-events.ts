import type pg from 'pg';
import type { Source } from '../../packages/contracts/archive.js';
import type { MetricsScope } from '../../packages/contracts/metrics.js';
import { digest } from './database.js';

export type MetricEvent = { event_id: string; snapshot_id: string; employee_id: string; employee: string; device_id: string; source: Source;
  source_session_id: string; project: string; source_date: string; role: string; line: number; block: number; material_id: string | null;
  qualification_revision: string; proof_snapshot_id: string | null };
type PackedEvent = [position: number, eventId: string, role: string, line: number, block: number, qualification: string, proof: string | null];
type Group = Pick<MetricEvent, 'snapshot_id' | 'employee_id' | 'employee' | 'device_id' | 'source' | 'source_session_id' | 'project' | 'source_date' | 'material_id'> & { events: PackedEvent[] };
const sameMetadata = (group: Group, event: MetricEvent) => group.snapshot_id === event.snapshot_id && group.employee_id === event.employee_id
  && group.employee === event.employee && group.device_id === event.device_id && group.source === event.source
  && group.source_session_id === event.source_session_id && group.project === event.project && group.source_date === event.source_date
  && group.material_id === event.material_id;

/** Select every original event before preparing shared request-local keys.
 * The database determines event order and enforces the pre-group bound. The
 * compact identity retains every field/occurrence without asking PostgreSQL
 * to sort the wide rows a second time by nine repeated metadata columns. */
export async function readMetricEvents(client: pg.PoolClient, scope: MetricsScope, limit: number): Promise<{ events: MetricEvent[]; groups: MetricEvent[][]; identity: string } | undefined> {
  const events = (await client.query(`SELECT o.event_id,o.snapshot_id,o.employee_id,e.name AS employee,o.device_id,o.source,
      o.source_session_id,o.project,o.source_date,o.role,o.line,o.block,o.material_id,o.qualification_revision,o.proof_snapshot_id
    FROM effective_event_origins o JOIN employees e ON e.id=o.employee_id
    WHERE o.context='after-enrollment' AND o.source_date BETWEEN $1 AND $2
      AND ($3::uuid IS NULL OR o.employee_id=$3) AND ($4::text IS NULL OR o.source=$4) AND ($5::text IS NULL OR o.project=$5)
    ORDER BY o.event_id LIMIT ($6::integer+1)`,
  [scope.from, scope.to, scope.employeeId ?? null, scope.source ?? null, scope.project ?? null, limit])).rows as MetricEvent[];
  if (events.length > limit) return undefined;
  const groups: Group[] = [], eventGroups: MetricEvent[][] = [];
  const bySnapshot = new Map<string, { first: number; others?: Map<string, number> }>();
  for (const [index, event] of events.entries()) {
    const bucket = bySnapshot.get(event.snapshot_id);
    let groupIndex: number | undefined, key: string | undefined;
    // Most ordinary carriers share one metadata tuple. Compare all fields
    // before reusing it; variants still use a complete, bounded map lookup.
    if (bucket && sameMetadata(groups[bucket.first]!, event)) groupIndex = bucket.first;
    else if (bucket) {
      key = JSON.stringify([event.snapshot_id,event.employee_id,event.employee,event.device_id,event.source,
        event.source_session_id,event.project,event.source_date,event.material_id]);
      groupIndex = bucket.others?.get(key);
    }
    if (groupIndex === undefined) {
      groupIndex = groups.length;
      if (!bucket) bySnapshot.set(event.snapshot_id, { first: groupIndex });
      else { bucket.others ??= new Map(); bucket.others.set(key!, groupIndex); }
      groups.push({ snapshot_id: event.snapshot_id, employee_id: event.employee_id, employee: event.employee, device_id: event.device_id,
        source: event.source, source_session_id: event.source_session_id, project: event.project, source_date: event.source_date,
        material_id: event.material_id, events: [] });
      eventGroups.push([]);
    }
    groups[groupIndex]!.events.push([index + 1,event.event_id,event.role,event.line,event.block,event.qualification_revision,event.proof_snapshot_id]);
    eventGroups[groupIndex]!.push(event);
  }
  // First appearance and append order are exactly the database ordinals used
  // by metric-event-input-1; moving packing does not change saved identities.
  const identity = digest(JSON.stringify(['metric-event-input-1', groups]));
  return { events, groups: eventGroups, identity };
}
