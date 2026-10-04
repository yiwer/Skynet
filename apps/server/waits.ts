import { materializeWaits } from './wait-revisions.js';
import { digest, type Database } from './database.js';
import { HttpError } from './identities.js';
import type { RawStore } from './raw-store.js';
import { waitDataset, waitBounded } from './wait-dataset.js';
import { waitsQuerySchema,waitsReadingQuerySchema, type WaitsQuery, type WaitsPage, type WaitsScope } from '../../packages/contracts/waits.js';
import { beijingDate } from '../../packages/contracts/reports.js';
import { monday, addDays } from '../../packages/contracts/work-views.js';
import {assertWaitScope,openWaitRevision,readWaitPage} from './wait-reading.js';
import {prepareReportDownload} from './report-download.js';

export async function migrateWaits(db: Database) {
  await db.query(`CREATE TABLE IF NOT EXISTS wait_input_revisions(version text PRIMARY KEY,snapshot_id uuid NOT NULL REFERENCES snapshots(id),payload jsonb NOT NULL);
    CREATE TABLE IF NOT EXISTS wait_revisions(version text PRIMARY KEY,scope_key text NOT NULL,revision integer NOT NULL,payload jsonb NOT NULL,UNIQUE(scope_key,revision));`);
}
export function waitsService(db: Database, raw: RawStore, clock: () => Date = () => new Date()) {
  async function computeOnce(q: WaitsQuery, full: boolean, range?:{from:string;to:string}): Promise<WaitsPage> {
    const client = await db.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      const scope: WaitsScope = { timeZone: 'Asia/Shanghai', ...(q.snapshotId ? { snapshotId: q.snapshotId } : { period: q.period }),
        ...(q.employeeId ? { employeeId: q.employeeId } : {}), ...(q.source ? { source: q.source } : {}), ...(q.project !== undefined ? { project: q.project } : {}) };
      if (!q.snapshotId) {
        const today = beijingDate(clock());
        if (q.period === 'since-enrollment') {
          const first = (await client.query('SELECT min(enrolled_at) AS first FROM devices WHERE ($1::uuid IS NULL OR employee_id=$1)', [q.employeeId ?? null])).rows[0].first;
          scope.from = first ? beijingDate(first) : today; scope.to = today;
        } else { scope.from = addDays(monday(today), q.period === 'last-week' ? -7 : 0); scope.to = addDays(scope.from, 6); }
        if (Date.parse(scope.to!) - Date.parse(scope.from!) > 3660 * 86400_000) throw waitBounded();
      }
      if(range){scope.from=range.from;scope.to=range.to;}
      const scopeKey = digest(JSON.stringify(scope));
      const lock = (await client.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,3701)) AS locked', [scopeKey])).rows[0];
      if (!lock.locked) throw new HttpError(409, '等待记录正在计算，请稍后重试');
      let employees: string[] | null = q.employeeId ? [q.employeeId] : null;
      if (q.snapshotId && !employees) employees = (await client.query(`SELECT d.employee_id FROM snapshots s JOIN devices d ON d.id=s.device_id WHERE s.id=$1
        UNION SELECT o.employee_id FROM effective_snapshot_events se JOIN effective_event_origins o ON o.event_id=se.event_id WHERE se.snapshot_id=$1`, [q.snapshotId])).rows.map(row => row.employee_id);
      const originals = await waitDataset(client, raw, full, employees);
      if (q.snapshotId && !originals.some(original => original.record.id === q.snapshotId)) throw new HttpError(404, '未找到会话原件');
      if(q.employeeId){const employee=(await client.query('SELECT id,name FROM employees WHERE id=$1',[q.employeeId])).rows[0];if(!employee)throw new HttpError(404,'员工不存在');scope.employeeName=employee.name;}
      const result=await materializeWaits(client,originals,scope,clock);
      await client.query('COMMIT');return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async function compute(q: WaitsQuery, full: boolean, range?:{from:string;to:string}) {
    for (let attempt = 0; ; attempt++) try { return await computeOnce(q, full,range); }
    catch (error) {
      if (!['40001', '40P01'].includes((error as { code?: string }).code ?? '')) throw error;
      if (attempt >= 2) throw new HttpError(409, '等待来源正在更新，请稍后重试');
    }
  }
  async function load(input: unknown, full = false) {
    const q = waitsQuerySchema.parse(input); let result: WaitsPage;
    if(full&&(q.version||q.offset||q.lines||q.contextSnapshotId))throw new HttpError(400,'重算不能指定旧版本、分页或对话行');
    if (q.version) {
      if (full) throw new HttpError(400, '重算请使用当前范围，固定版本保持不变');
      const row = (await db.query('SELECT payload FROM wait_revisions WHERE version=$1', [q.version])).rows[0];
      if (!row) throw new HttpError(404, '等待记录版本不存在');
      result = row.payload;
      // Fixed dates remain readable after the week rolls over; compare selection,
      // not the newly resolved current date window.
      assertWaitScope(q,result.scope);
    } else result = await compute(q, full);
    return {q,result};
  }
  /** Complete immutable input for composed reports; transport budgets belong
   * to read/export, while compute retains all original-input resource guards. */
  async function complete(input:unknown,options:{full?:boolean}={}) {
    const q=waitsQuerySchema.parse(input);
    if(q.offset||q.lines||q.contextSnapshotId)throw new HttpError(400,'完整等待输入不能指定分页或对话行');
    return (await load(q,options.full??false)).result;
  }
  async function read(input: unknown, full = false) {
    const q=waitsReadingQuerySchema.parse(input);
    if(full&&(q.version||q.section||q.offset||q.lines||q.contextSnapshotId))throw new HttpError(400,'重算不能指定旧版本、分页或对话行');
    const version=q.version??(await compute(q,full)).version;
    return readWaitPage(db,{...q,version});
  }
  async function download(input:unknown){
    const q=waitsQuerySchema.parse(input);
    if(q.offset||q.lines||q.contextSnapshotId)throw new HttpError(400,'完整等待下载不能指定分页或对话行');
    const version=q.version??(await compute(q,false)).version;
    return prepareReportDownload(db,reader=>openWaitRevision(reader,{...q,version}));
  }
  return {complete,forScope:(input:unknown,range:{from:string;to:string},full=false)=>compute(waitsQuerySchema.parse(input),full,range), read, recompute: (input: unknown) => read(input, true),download };
}
