import type { Database } from './database.js';
import { beijingDate, reportDate } from '../../packages/contracts/reports.js';
import type { CoverageCell, CoverageMatrix, CoverageObservation } from '../../packages/contracts/coverage.js';
import type { Source } from '../../packages/contracts/archive.js';
import type { CaptureHealth } from '../../packages/contracts/capture-health.js';
import type { DeliveryHealth } from '../../packages/contracts/delivery.js';
import type { z } from 'zod';
import type { installationObservationSchema } from '../../packages/contracts/coverage.js';

export async function migrateCoverage(db: Database) {
  const client = await db.connect();
  try { await client.query(`BEGIN; SELECT pg_advisory_xact_lock(7402131);
    CREATE TABLE IF NOT EXISTS coverage_schema(id integer PRIMARY KEY CHECK(id=1),started_at timestamptz NOT NULL DEFAULT now());
    INSERT INTO coverage_schema(id) VALUES(1) ON CONFLICT DO NOTHING;
    CREATE TABLE IF NOT EXISTS device_coverage_observations(device_id uuid NOT NULL REFERENCES devices(id),source text NOT NULL,
      date text NOT NULL,hour integer NOT NULL CHECK(hour BETWEEN 0 AND 23),first_received_at timestamptz NOT NULL DEFAULT now(),
      last_received_at timestamptz NOT NULL DEFAULT now(),samples integer NOT NULL DEFAULT 1,
      gap_observed boolean NOT NULL DEFAULT false,backlog_observed boolean NOT NULL DEFAULT false,
      configured boolean,host_event text NOT NULL DEFAULT 'unknown',fault_codes text[] NOT NULL DEFAULT '{}',
      PRIMARY KEY(device_id,source,date,hour));
    CREATE INDEX IF NOT EXISTS coverage_observation_day ON device_coverage_observations(date,device_id);
    CREATE TABLE IF NOT EXISTS work_statistic_revisions(employee_id uuid NOT NULL REFERENCES employees(id),date text NOT NULL,
      revision integer NOT NULL,version text NOT NULL,payload jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(employee_id,date,revision),UNIQUE(employee_id,date,version));
    COMMIT;`); } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

// One bounded row per source/server-received hour retains adverse observations
// even after recovery. It neither backfills old latest-health rows nor certifies
// every instant between heartbeats. Device-supplied checkedAt cannot choose date.
export async function observeCoverage(db: Database, deviceId: string, report: {
  source?: Source; capture?: CaptureHealth; delivery?: DeliveryHealth;
  installation?: z.infer<typeof installationObservationSchema>;
}) {
  const observations: { source: string; gap: boolean; backlog: boolean; configured: boolean | null; host: string; codes: string[] }[] = [];
  observations.push({ source: report.source ?? '', gap: Boolean(report.capture?.faults.length),
    backlog: Boolean(report.delivery?.pendingSnapshots), configured: null,
    host: report.capture?.observation === 'host-event-observed' ? 'observed' : report.capture ? 'not-observed' : 'unknown',
    codes: [...new Set(report.capture?.faults.map(fault => fault.code) ?? [])] });
  for (const client of report.installation?.clients ?? []) {
    const existing = observations.find(observation => observation.source === client.source);
    if (existing) { existing.configured = client.configured; if (existing.host !== 'observed') existing.host = client.hostEvent; }
    else observations.push({ source: client.source, gap: false, backlog: false, configured: client.configured, host: client.hostEvent, codes: [] });
  }
  for (const observation of observations) await db.query(`
    INSERT INTO device_coverage_observations(device_id,source,date,hour,gap_observed,backlog_observed,configured,host_event,fault_codes)
    VALUES($1,$2,to_char(now() AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD'),extract(hour FROM now() AT TIME ZONE 'Asia/Shanghai'),$3,$4,$5,$6,$7)
    ON CONFLICT(device_id,source,date,hour) DO UPDATE SET last_received_at=now(),samples=device_coverage_observations.samples+1,
      gap_observed=device_coverage_observations.gap_observed OR EXCLUDED.gap_observed,
      backlog_observed=device_coverage_observations.backlog_observed OR EXCLUDED.backlog_observed,
      configured=COALESCE(EXCLUDED.configured,device_coverage_observations.configured),
      host_event=CASE WHEN device_coverage_observations.host_event='observed' OR EXCLUDED.host_event='observed' THEN 'observed'
        WHEN EXCLUDED.host_event<>'unknown' THEN EXCLUDED.host_event ELSE device_coverage_observations.host_event END,
      fault_codes=ARRAY(SELECT DISTINCT unnest(device_coverage_observations.fault_codes || EXCLUDED.fault_codes))`,
  [deviceId, observation.source, observation.gap, observation.backlog, observation.configured, observation.host, observation.codes]);
}

const definition = '北京时间员工×来源日期。活动按原员工的已确认接入后 eventId 去重；无已观察活动不证明没有工作。采集观测按服务器收到日期保存，心跳只证明对应时刻可达，历史无观测为未知。宿主确认待核对不等于已证实未信任；原件提交、设备可达与分析完成分开。';
export function coverageService(db: Database) {
  async function matrix(selectedDate: string, offset = 0): Promise<CoverageMatrix> {
    reportDate.parse(selectedDate);
    const end = new Date(`${selectedDate}T00:00:00+08:00`).getTime();
    const dates = Array.from({ length: 7 }, (_, index) => beijingDate(new Date(end - (6 - index) * 86400_000)));
    const employees = (await db.query('SELECT id,name FROM employees ORDER BY name,id LIMIT 11 OFFSET $1', [offset])).rows;
    const ids = employees.slice(0, 10).map(row => row.id);
    const [activity, observations, devices, reportStates, schema] = await Promise.all([
      db.query(`SELECT employee_id,source_date,count(*)::integer AS records,count(DISTINCT (source,source_session_id))::integer AS sessions
        FROM effective_event_origins WHERE employee_id=ANY($1::uuid[]) AND source_date=ANY($2::text[]) AND context='after-enrollment'
        GROUP BY employee_id,source_date`, [ids, dates]),
      db.query(`SELECT d.employee_id,o.date,bool_or(o.gap_observed) AS gap,min(o.first_received_at) AS first,max(o.last_received_at) AS last,
        bool_or(o.configured=true) AS configured,bool_or(o.configured=false) AS unconfigured,
        bool_or(o.host_event='observed') AS host_observed,bool_or(o.host_event='not-observed' AND o.configured=true) AS pending
        FROM device_coverage_observations o JOIN devices d ON d.id=o.device_id
        WHERE d.employee_id=ANY($1::uuid[]) AND o.date=ANY($2::text[]) GROUP BY d.employee_id,o.date`, [ids, dates]),
      db.query(`SELECT d.employee_id,bool_or(d.active AND e.active AND h.received_at>now()-interval '90 seconds') AS connected,
        bool_or(h.received_at IS NOT NULL) AS seen FROM devices d JOIN employees e ON e.id=d.employee_id
        LEFT JOIN device_health h ON h.device_id=d.id WHERE d.employee_id=ANY($1::uuid[]) GROUP BY d.employee_id`, [ids]),
      db.query(`SELECT p.employee_id,p.date,r.payload->>'state' AS state,p.refresh_pending FROM daily_report_periods p
        LEFT JOIN LATERAL(SELECT payload FROM daily_report_revisions WHERE employee_id=p.employee_id AND date=p.date ORDER BY revision DESC LIMIT 1) r ON true
        WHERE p.employee_id=ANY($1::uuid[]) AND p.date=ANY($2::text[])`, [ids, dates]),
      db.query('SELECT started_at FROM coverage_schema WHERE id=1'),
    ]);
    const today = beijingDate();
    const rows = employees.slice(0, 10).map(employee => ({ employeeId: employee.id, employee: employee.name, cells: dates.map(date => {
      const a = activity.rows.find(row => row.employee_id === employee.id && row.source_date === date);
      const o = observations.rows.find(row => row.employee_id === employee.id && row.date === date);
      const device = devices.rows.find(row => row.employee_id === employee.id);
      const report = reportStates.rows.find(row => row.employee_id === employee.id && row.date === date);
      const cell: CoverageCell = { employeeId: employee.id, employee: employee.name, date, records: a?.records ?? 0, sessions: a?.sessions ?? 0,
        activity: a ? 'observed' : 'none-observed', collection: o?.gap ? 'gap-observed' : o ? 'observations-only' : 'unknown',
        configured: o?.configured && o?.unconfigured ? 'mixed' : o?.configured ? 'configured' : o?.unconfigured ? 'not-configured' : 'unknown',
        hostConfirmation: o?.host_observed ? 'observed' : o?.pending ? 'pending-confirmation' : 'unknown',
        analysis: report?.refresh_pending ? 'unfinished' : report?.state === 'ready' || report?.state === 'partial' ? 'ready'
          : report ? 'unfinished' : a ? 'not-scheduled' : 'unknown',
        currentConnection: date !== today ? 'not-applicable' : !device?.seen ? 'unknown' : device.connected ? 'connected' : 'not-connected',
        firstReceivedAt: o?.first?.toISOString() ?? null, lastReceivedAt: o?.last?.toISOString() ?? null };
      return cell;
    }) }));
    return { selectedDate, dates, rows, nextOffset: employees.length > 10 ? offset + 10 : null, definition,
      observationStartedAt: schema.rows[0].started_at.toISOString(), checkedAt: new Date().toISOString() };
  }
  async function observations(employeeId: string, date: string, offset = 0) {
    reportDate.parse(date);
    const result = await db.query(`SELECT d.id AS "deviceId",d.name AS device,NULLIF(o.source,'') AS source,o.date,
      o.first_received_at AS "firstReceivedAt",o.last_received_at AS "lastReceivedAt",o.samples,o.gap_observed AS "gapObserved",
      o.backlog_observed AS "backlogObserved",o.configured,o.host_event AS "hostEvent",o.fault_codes AS "faultCodes"
      FROM device_coverage_observations o JOIN devices d ON d.id=o.device_id WHERE d.employee_id=$1 AND o.date=$2
      ORDER BY o.first_received_at,d.id,o.source LIMIT 21 OFFSET $3`, [employeeId, date, offset]);
    return { employeeId, date, observations: result.rows.slice(0, 20) as CoverageObservation[],
      nextOffset: result.rows.length > 20 ? offset + 20 : null, definition };
  }
  return { matrix, observations };
}
export type CoverageService = ReturnType<typeof coverageService>;
