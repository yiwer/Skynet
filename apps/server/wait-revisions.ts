import type pg from 'pg';
import { digest } from './database.js';
import { HttpError } from './identities.js';
import { waitIntervals } from './wait-intervals.js';
import { waitAlgorithmVersion } from './wait-inputs.js';
import { waitBounded,type WaitOriginal } from './wait-dataset.js';
import type { WaitsScope,WaitsPage } from '../../packages/contracts/waits.js';
import { beijingDate } from '../../packages/contracts/reports.js';
import { addDays } from '../../packages/contracts/work-views.js';

const definition = '原生本轮结束至下一条真实用户消息；末尾空闲不计，满 10 分钟为长等待。并行仅表示同一员工在区间内有其他逻辑会话活动（含其他项目和 Agent），边界相邻不算。按北京时间拆日，重叠会话分别保留，不换算工时。权限请求与决定缺少来源时单列未知。';

/** Caller owns the repeatable-read transaction and verified source dataset.
 * A fixed activity date is deliberately distinct from rolling report periods. */
export async function materializeWaits(client:pg.PoolClient,originals:WaitOriginal[],scope:WaitsScope,clock:()=>Date):Promise<WaitsPage>{
  const scopeKey=digest(JSON.stringify(scope));
  if(!(await client.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,3701)) AS locked',[scopeKey])).rows[0].locked)throw new HttpError(409,'等待记录正在计算，请稍后重试');
  const {intervals,selected,rangeStart,rangeEnd}=waitIntervals(originals,scope);
  // Earlier immutable prefixes remain evidence, but a complete continuation
  // can resolve their temporary coverage gap for the current report.
  const coverage = [...new Map([...selected].map(original => [original.sessionId, original])).values()];
  const replySupport = coverage.some(original => original.facts.boundaries.some(boundary => boundary.kind === 'completed' && boundary.turnId && boundary.timestamp)) ? 'observed' as const : 'unknown' as const;
  const unknownReasons = [...new Set(coverage.flatMap(({ record, facts }) => [
    ...(!facts.boundaries.some(boundary => boundary.kind === 'completed' && boundary.turnId && boundary.timestamp) ? ['部分来源未记录可识别的本轮结束'] : []),
    ...(record.manifest.capture?.partialLine || record.manifest.capture?.gaps.length || record.manifest.capture?.compacted ? ['来源材料存在压缩或采集缺口'] : [])]))];
  if (!selected.size) unknownReasons.push('尚无所选范围的来源材料');
  const known = intervals.filter(interval => interval.durationMs !== null), unknown = intervals.length - known.length;
  const knownReplyWaitMs = known.reduce((sum, interval) => sum + interval.durationInScopeMs!, 0);
  if (!Number.isSafeInteger(knownReplyWaitMs)) throw waitBounded();
  const days = new Map<string, { date: string; knownReplyWaitMs: number; unknownReplyWaitCount: number }>();
  const day = (date: string) => { if (!days.has(date)) days.set(date, { date, knownReplyWaitMs: 0, unknownReplyWaitCount: 0 }); return days.get(date)!; };
  for (const interval of intervals) {
    if (interval.durationMs === null) { if (interval.endedAt) day(beijingDate(new Date(interval.endedAt))).unknownReplyWaitCount++; continue; }
    let start = Math.max(Date.parse(interval.startedAt!), rangeStart); const end = Math.min(Date.parse(interval.endedAt!), rangeEnd);
    while (start < end) {
      const date = beijingDate(new Date(start)), next = Date.parse(addDays(date, 1) + 'T00:00:00+08:00');
      day(date).knownReplyWaitMs += Math.min(next, end) - start; start = next;
      if (days.size > 3661) throw waitBounded();
    }
  }
  const content = { scope, algorithmVersion: waitAlgorithmVersion, summary: { replyWaitCount: known.length, unknownReplyWaitCount: unknown,
    replyWaitMs: unknown || unknownReasons.length ? null : knownReplyWaitMs, knownReplyWaitMs, longWaitCount: known.filter(interval => interval.long).length,
    permissionWaitMs: null, permissionWaitCount: null }, intervals, total: intervals.length, nextOffset: null,
    daily: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)), replySupport, permissionSupport: 'unknown' as const, unknownReasons, definition,
    dataAsOf: originals.at(-1)?.record.committed_at.toISOString() ?? null };
  const version = digest(JSON.stringify([content, originals.map(original => [original.record.id, original.record.hash, original.revision, original.sessionId])]));
  const saved = (await client.query('SELECT payload FROM wait_revisions WHERE version=$1', [version])).rows[0];
  if (saved) return saved.payload;
  const next = Number((await client.query('SELECT COALESCE(MAX(revision),0)+1 AS next FROM wait_revisions WHERE scope_key=$1', [scopeKey])).rows[0].next);
  const payload: WaitsPage = { ...content, version, revision: next, createdAt: clock().toISOString() };
  await client.query('INSERT INTO wait_revisions(version,scope_key,revision,payload) VALUES($1,$2,$3,$4)', [version, scopeKey, next, payload]);
  return payload;
}
