import { digest, type Database } from './database.js';
import { HttpError } from './identities.js';
import type { RawStore } from './raw-store.js';
import type { Manifest } from '../../packages/contracts/archive.js';
import { beijingDate, reportDate } from '../../packages/contracts/reports.js';
import { evidenceLink } from '../../packages/contracts/search.js';
import type { WorkStatistics, StatisticReference, RecordedTokens } from '../../packages/contracts/coverage.js';
import { nativeStatistics, statisticsExtractorVersion, type TokenComponents } from '../../packages/native-statistics.js';
import { materialSource } from './material-provenance.js';
import type { Provenance } from '../../packages/contracts/provenance.js';
import {qualificationDaySql} from './qualification.js';
import {setTimeout as pause} from 'node:timers/promises';
import {unscopedRawGapsSql} from './evidence-integrity.js';

class StatisticsBusy extends HttpError {constructor(){super(409,'统计版本正在更新，请稍后重试；旧固定版本仍可读取');}}
export function transientStatistics(error:unknown){const value=error as {code?:string;constraint?:string};return error instanceof StatisticsBusy||value.code==='40001'||value.code==='23505'&&!!value.constraint?.startsWith('work_statistic_revisions');}

type Event = { event_id: string; snapshot_id: string; material_id: string | null; device_id: string; line: number; block: number;
  source: Manifest['source']; source_session_id: string; role: string; timestamp: string | null; context: string; text_offset: number; project: string;
  qualification_revision?: string; proof_snapshot_id?: string; proof_enrolled_at?: Date };
const definition = '原员工在本北京时间来源日期的已确认接入后 eventId 去重。用户轮次按原件/材料行、工具调用按解析 block，会话按原设备+Agent+原生会话 ID。文件仅取支持的结构化工具参数，按原设备+原项目+逐字路径去重，不读代码文件或猜测 shell 中的路径；Token 仅取来源记录，不是计费账单。相邻活动点不超过10分钟归为一段，孤立点为零跨度；区间不是持续工作或人工工时。历史与未知单列，缺失不填零。';
const tokenDefinition = 'Codex 缓存输入是输入子集、推理输出是输出子集，不重复加总；使用可验证累计计数的非负差值，缺少基线或重置为未知。Claude 同一 message.id 只计一次，输入为普通输入+缓存读取+缓存写入（字段齐全时）；未知缓存或推理分项不填零。来源记录量不代表实际计费。';

export function recordedIntervals(events: Pick<Event, 'device_id' | 'source' | 'source_session_id' | 'timestamp'>[], date: string) {
  const groups = new Map<string, number[]>();
  for (const event of events) {
    const time = Date.parse(event.timestamp ?? '');
    if (!Number.isFinite(time) || beijingDate(new Date(time)) !== date) continue;
    const session = digest(JSON.stringify([event.device_id, event.source, event.source_session_id]));
    const points = groups.get(session) ?? []; points.push(time); groups.set(session, points);
  }
  const output: WorkStatistics['intervals'] = [];
  for (const [session, points] of groups) {
    const sorted = [...new Set(points)].sort((a, b) => a - b); let from = sorted[0]!; let last = from; let count = 1;
    for (const time of sorted.slice(1)) {
      if (time - last > 600_000) { output.push({ session, from: new Date(from).toISOString(), to: new Date(last).toISOString(), points: count }); from = time; count = 0; }
      last = time; count++;
    }
    output.push({ session, from: new Date(from).toISOString(), to: new Date(last).toISOString(), points: count });
  }
  return output.sort((a, b) => a.from.localeCompare(b.from) || a.session.localeCompare(b.session));
}

export function workStatisticsService(db: Database, raw: RawStore) {
  // The caller owns one repeatable transaction. Never acquire a second pool
  // connection or commit a statistic before its referencing report is ready.
  async function freeze(client:Pick<Database,'query'>,employeeId:string,date:string){
      const lock=await client.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,7402131)) AS locked',[`${employeeId}/${date}`]);
      if(!lock.rows[0].locked)throw new StatisticsBusy();
      const employee = (await client.query('SELECT name FROM employees WHERE id=$1', [employeeId])).rows[0];
      if (!employee) throw new HttpError(404, '员工不存在');
      const counts = (await client.query(`SELECT
        count(*) FILTER(WHERE context='after-enrollment')::integer AS records,
        count(DISTINCT (device_id,source,source_session_id)) FILTER(WHERE context='after-enrollment')::integer AS sessions,
        count(DISTINCT (snapshot_id,material_id,line)) FILTER(WHERE context='after-enrollment' AND role='user')::integer AS "userTurns",
        count(*) FILTER(WHERE context='after-enrollment' AND role='tool request')::integer AS "toolCalls",
        count(*) FILTER(WHERE context='historical')::integer AS "historicalRecords",
        count(*) FILTER(WHERE context IN ('unknown-time','unknown-enrollment'))::integer AS "unknownRecords"
        FROM effective_event_origins WHERE employee_id=$1 AND source_date=$2`, [employeeId, date])).rows[0];
      const all = (await client.query(`SELECT * FROM effective_event_origins WHERE employee_id=$1 AND source_date=$2
        AND context='after-enrollment' ORDER BY event_id LIMIT 10001`, [employeeId, date])).rows as Event[];
      const integrity=(await client.query(`SELECT count(*)::integer AS gaps FROM archive_event_origins o WHERE employee_id=$1 AND source_date=$2
        AND NOT EXISTS(SELECT 1 FROM event_integrity i WHERE i.event_id=o.event_id AND i.version='original-utf8-1' AND i.valid)`,[employeeId,date])).rows[0].gaps as number;
      const attribution=(await client.query(`SELECT ${qualificationDaySql('$1','$2')} AS revision`,[employeeId,date])).rows[0].revision;
      const unscoped=(await client.query(`SELECT ${unscopedRawGapsSql('$1')} AS gaps`,[employeeId])).rows[0].gaps as {count:string;revision:string};
      const gapCount=Number(unscoped.count);
      const events = all.slice(0, 10000); let inputComplete = all.length <= 10000 && integrity===0 && unscoped.count==='0';
      const sources = new Map<string, Event[]>();
      for (const event of events) {
        const key = `${event.snapshot_id}/${event.material_id ?? ''}`;
        sources.set(key, [...sources.get(key) ?? [], event]);
      }
      const paths = new Set<string>(); const fileKeys = new Set<string>(); const references: StatisticReference[] = [];
      let unsupportedTools = 0; let fileComplete = inputComplete; let totalBytes = 0; let tokenComplete = inputComplete; let unknownUsageScopes = Number.isSafeInteger(gapCount)?gapCount:1;
      const usage = new Map<string, TokenComponents | null>();
      const inputKeys: unknown[] = [];
      for (const [index, [key, sourceEvents]] of [...sources.entries()].entries()) {
        if (index >= 32) { inputComplete = false; fileComplete = false; break; }
        const first = sourceEvents[0]!;
        const record = (await client.query(`SELECT s.*,d.enrolled_at FROM snapshots s JOIN devices d ON d.id=s.device_id WHERE s.id=$1`, [first.snapshot_id])).rows[0] as
          { id: string; device_id: string; hash: string; manifest: Manifest; provenance: Provenance; enrolled_at: Date | null };
        let sourceVersion = record.manifest.sourceVersion;
        let selected = { deviceId: record.device_id, hash: record.hash, length: record.manifest.byteLength, enrolledAt: record.enrolled_at,
          prefixBytes: 0, allowUsage: !first.material_id };
        let proofBytes: Buffer | undefined;
        if (first.material_id) {
          const resolved = await materialSource(client, record, first.material_id);
          const material = resolved.material;
          selected = { deviceId: resolved.origin.device_id, hash: material.hash, length: material.byteLength,
            enrolledAt: null, prefixBytes: 0, allowUsage: false };
          // Auxiliary rows have no eventId: business-event qualification alone
          // cannot grant them activity. Recheck the original bytes against an
          // ordinary primary from that exact original device/session/source.
          if (first.proof_snapshot_id && first.proof_enrolled_at) {
            const proof = (await client.query('SELECT * FROM snapshots WHERE id=$1', [first.proof_snapshot_id])).rows[0] as typeof record | undefined;
            if (proof && !proof.manifest.restoredFrom && proof.device_id === first.device_id
              && proof.manifest.source === first.source && proof.manifest.sourceSessionId === first.source_session_id
              && proof.manifest.enrolledAt === first.proof_enrolled_at.toISOString()
              && proof.manifest.byteLength <= 64 * 1024 * 1024 && totalBytes + proof.manifest.byteLength + selected.length <= 128 * 1024 * 1024) {
              proofBytes = await raw.read(proof.device_id, proof.hash); totalBytes += proofBytes.length;
              sourceVersion = proof.manifest.sourceVersion; selected.enrolledAt = first.proof_enrolled_at;
              inputKeys.push(['material-normal-proof', proof.id, proof.hash, first.qualification_revision]);
            }
          }
        } else if (record.manifest.restoredFrom) selected.prefixBytes = record.manifest.restoredFrom.byteLength;
        if (totalBytes + selected.length > 128 * 1024 * 1024) { inputComplete = false; fileComplete = false; continue; }
        totalBytes += selected.length; inputKeys.push([key, selected.hash, selected.length]);
        let parsed: ReturnType<typeof nativeStatistics>; let bytes: Buffer;
        try {
          bytes = await raw.read(selected.deviceId, selected.hash);
          if (proofBytes && proofBytes.length >= bytes.length && proofBytes.subarray(0, bytes.length).equals(bytes) && bytes.at(-1) === 10) selected.allowUsage = true;
          parsed = nativeStatistics(bytes, record.manifest.source, sourceVersion);
        }
        catch { inputComplete = false; fileComplete = false; tokenComplete = false; unknownUsageScopes++; continue; }
        fileComplete &&= parsed.complete && parsed.supported;
        if (!parsed.complete || !parsed.supported || !selected.allowUsage || !selected.enrolledAt) { tokenComplete = false; unknownUsageScopes++; }
        const qualifiedTools = new Set(sourceEvents.filter(event => event.role === 'tool request').map(event => `${event.line}/${event.block}`));
        const seenTools = new Set<string>();
        for (const file of parsed.files) {
          const tool = `${file.line}/${file.block}`; if (!qualifiedTools.has(tool)) continue; seenTools.add(tool);
          if (!file.supported) { unsupportedTools++; fileComplete = false; }
          for (const value of file.paths) {
            paths.add(value);
            const event = sourceEvents.find(event => event.line === file.line && event.block === file.block)!;
            fileKeys.add(JSON.stringify([event.device_id, event.project, value]));
            references.push({ snapshotId: first.snapshot_id, materialId: first.material_id, line: file.line, kind: 'file', value,
              webPath: evidenceLink(first.snapshot_id, first.material_id ? { kind: 'material', materialId: first.material_id, textOffset: event.text_offset }
                : { kind: 'raw', line: file.line, textOffset: 0 }) });
          }
        }
        for (const tool of qualifiedTools) if (!seenTools.has(tool)) { unsupportedTools++; fileComplete = false; }
        const prefixLines = selected.prefixBytes ? bytes.subarray(0, selected.prefixBytes).toString('utf8').split('\n').length - 1 : 0;
        const rawLines = new TextDecoder('utf-8', { fatal: true }).decode(bytes).split('\n');
        let rawOffset = 0; const lineOffsets = rawLines.map(line => { const value = rawOffset; rawOffset += line.length + 1; return value; });
        for (const item of parsed.usage) {
          if (!selected.allowUsage || !selected.enrolledAt || !item.timestamp || beijingDate(new Date(item.timestamp)) !== date
            || Date.parse(item.timestamp) < selected.enrolledAt.getTime() || item.line <= prefixLines) continue;
          const usageKey = JSON.stringify([first.device_id, first.source, first.source_session_id, item.key]);
          const previous = usage.get(usageKey);
          // Conflicting repeats are unknown; no arbitrary winner or double count.
          usage.set(usageKey, usage.has(usageKey) && JSON.stringify(previous) !== JSON.stringify(item.value) ? null : item.value);
          references.push({ snapshotId: first.snapshot_id, materialId: first.material_id, line: item.line, kind: 'usage', value: item.key,
            webPath: evidenceLink(first.snapshot_id, first.material_id ? { kind: 'material', materialId: first.material_id, textOffset: lineOffsets[item.line - 1]! }
              : { kind: 'raw', line: item.line, textOffset: 0 }) });
        }
      }
      const components: TokenComponents = { input: null, cachedInput: null, cacheWriteInput: null, output: null, reasoningOutput: null, total: null };
      for (const field of Object.keys(components) as (keyof TokenComponents)[]) {
        const values = [...usage.values()];
        if (inputComplete && tokenComplete && values.length && values.every(value => value?.[field] !== null && value?.[field] !== undefined)) {
          const sum = values.reduce((sum, value) => sum + value![field]!, 0); components[field] = Number.isSafeInteger(sum) ? sum : null;
        }
      }
      const tokens: RecordedTokens = { ...components, usageRecords: usage.size, unknownRecords: [...usage.values()].filter(value => !value).length + unknownUsageScopes, definition: tokenDefinition };
      const intervals = recordedIntervals(events, date);
      const content = { employeeId, employee: employee.name, date, ...counts, files: { observedCount: fileKeys.size, paths: [...paths].sort().slice(0, 40), complete: fileComplete && paths.size <= 40, unsupportedToolCalls: unsupportedTools },
        tokens, intervals: intervals.slice(0, 50), references: references.slice(0, 10000), sourceInputsComplete: inputComplete && intervals.length <= 50 && references.length <= 10000,
        definition, humanWorkHours: null, extractorVersion: statisticsExtractorVersion,
        inputDigest: digest(JSON.stringify([events.map(event => [event.event_id, event.context, event.qualification_revision ?? '0']), inputKeys,attribution,integrity,unscoped,'original-utf8-1'])) };
      const version = digest(JSON.stringify(content));
      const known = (await client.query('SELECT payload FROM work_statistic_revisions WHERE employee_id=$1 AND date=$2 AND version=$3', [employeeId, date, version])).rows[0];
      let payload: WorkStatistics;
      if (known) payload = known.payload;
      else {
        const revision = Number((await client.query('SELECT COALESCE(max(revision),0)+1 AS revision FROM work_statistic_revisions WHERE employee_id=$1 AND date=$2', [employeeId, date])).rows[0].revision);
        payload = { ...content, revision, version, createdAt: new Date().toISOString(), nextOffset: null };
        await client.query('INSERT INTO work_statistic_revisions(employee_id,date,revision,version,payload) VALUES($1,$2,$3,$4,$5)', [employeeId, date, revision, version, payload]);
      }
      return payload;
  }
  async function refresh(employeeId:string,date:string){
    for(let attempt=0;attempt<3;attempt++){
      const client=await db.connect();try{await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');const value=await freeze(client,employeeId,date);await client.query('COMMIT');return value;}
      catch(error){await client.query('ROLLBACK');if(attempt===2||!transientStatistics(error))throw error;}
      finally{client.release();}
      await pause(25);
    }
    throw new StatisticsBusy();
  }
  async function read(employeeId: string, date: string, offset = 0, revision?: number): Promise<WorkStatistics> {
    reportDate.parse(date);
    const payload = revision ? (await db.query('SELECT payload FROM work_statistic_revisions WHERE employee_id=$1 AND date=$2 AND revision=$3', [employeeId, date, revision])).rows[0]?.payload
      : await refresh(employeeId, date);
    if (!payload) throw new HttpError(404, '统计版本不存在');
    return { ...payload, references: payload.references.slice(offset, offset + 20), nextOffset: offset + 20 < payload.references.length ? offset + 20 : null };
  }
  return { read,freeze };
}
export type WorkStatisticsService = ReturnType<typeof workStatisticsService>;
