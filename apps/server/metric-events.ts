import type pg from 'pg';
import type { Source } from '../../packages/contracts/archive.js';
import type { MetricsScope } from '../../packages/contracts/metrics.js';
import { digest } from './database.js';

export type MetricEvent = { event_id: string; snapshot_id: string; employee_id: string; employee: string; device_id: string; source: Source;
  source_session_id: string; project: string; source_date: string; role: string; line: number; block: number; material_id: string | null;
  qualification_revision: string; proof_snapshot_id: string | null };
type PackedEvent = [position: number, eventId: string, role: string, line: number, block: number, qualification: string, proof: string | null];
type Group = Pick<MetricEvent, 'snapshot_id' | 'employee_id' | 'employee' | 'device_id' | 'source' | 'source_session_id' | 'project' | 'source_date' | 'material_id'> & { events: PackedEvent[] };

/** Pack only repeated transport metadata. Selection, proof identities and the
 * event limit precede grouping; counts still come from individual originals.
 * Positions restore the database's original event order, including its exact
 * collation. The identity includes every field and occurrence, with repeated
 * metadata encoded once; it never substitutes counts for the proof ledger. */
export async function readMetricEvents(client: pg.PoolClient, scope: MetricsScope, limit: number): Promise<{ events: MetricEvent[]; groups: MetricEvent[][]; identity: string } | undefined> {
  const groups = (await client.query(`WITH selected AS MATERIALIZED (
    SELECT o.event_id,o.snapshot_id,o.employee_id,e.name AS employee,o.device_id,o.source,
      o.source_session_id,o.project,o.source_date,o.role,o.line,o.block,o.material_id,o.qualification_revision,o.proof_snapshot_id,
      row_number() OVER(ORDER BY o.event_id) AS position
    FROM effective_event_origins o JOIN employees e ON e.id=o.employee_id
    WHERE o.context='after-enrollment' AND o.source_date BETWEEN $1 AND $2
      AND ($3::uuid IS NULL OR o.employee_id=$3) AND ($4::text IS NULL OR o.source=$4) AND ($5::text IS NULL OR o.project=$5)
    ORDER BY o.event_id LIMIT ($6::integer+1)
  ) SELECT snapshot_id,employee_id,employee,device_id,source,source_session_id,project,source_date,material_id,
    json_agg(json_build_array(position,event_id,role,line,block,qualification_revision::text,proof_snapshot_id)) AS events
    FROM selected GROUP BY snapshot_id,employee_id,employee,device_id,source,source_session_id,project,source_date,material_id`,
  [scope.from, scope.to, scope.employeeId ?? null, scope.source ?? null, scope.project ?? null, limit])).rows as Group[];
  const count = groups.reduce((sum, group) => sum + group.events.length, 0);
  if (count > limit) return undefined;
  // Aggregate arrival order is not a PostgreSQL guarantee. Original ordinal
  // positions give both levels a deterministic order without comparing names
  // or changing the database's event-ID collation.
  for (const group of groups) group.events.sort((a, b) => a[0] - b[0]);
  groups.sort((a, b) => a.events[0]![0] - b.events[0]![0]);
  const identity = digest(JSON.stringify(['metric-event-input-1', groups]));
  const events = new Array<MetricEvent>(count);
  const eventGroups: MetricEvent[][] = [];
  for (const group of groups) {
    const unpacked: MetricEvent[] = [];
    for (const [position, eventId, role, line, block, qualification, proof] of group.events) {
      // The public calculation still receives the previous row types and order.
      const event = { event_id: eventId, snapshot_id: group.snapshot_id, employee_id: group.employee_id, employee: group.employee,
        device_id: group.device_id, source: group.source, source_session_id: group.source_session_id, project: group.project,
        source_date: group.source_date, role, line, block, material_id: group.material_id, qualification_revision: qualification, proof_snapshot_id: proof };
      events[position - 1] = event; unpacked.push(event);
    }
    eventGroups.push(unpacked);
  }
  return { events, groups: eventGroups, identity };
}
