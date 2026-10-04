import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { mcpSandbox } from './mcp-support.js';
import { digest } from '../apps/server/database.js';
import { readAnalysisConfig, publicConfig } from '../apps/analysis/config.js';
import { analysisQueue } from '../apps/analysis/queue.js';
import { executeAnalysis } from '../apps/analysis/execute.js';

export async function assessmentFixture() {
  // Keep the default long-wait samples within one Beijing business date;
  // tests of calendar boundaries override base explicitly.
  const base = new Date(Date.now() + 86400000); base.setUTCHours(2, 0, 0, 0);
  while ([0,6].includes(base.getUTCDay())) base.setUTCDate(base.getUTCDate() + 1);
  const now = new Date(Date.now() + 28 * 86400000), sandbox = await mcpSandbox({ reportClock: () => now });
  const json = (value: object) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  const configPath = join(sandbox.directory, 'assessment-analysis.json');
  await writeFile(configPath, JSON.stringify({ mode: 'fixture', executable: process.execPath, runtimeVersion: '2.1.281', model: 'assessment-deterministic', workDirectory: join(sandbox.directory, 'jobs'),
    fixtureOrigin: 'http://127.0.0.1:12345', budgetId: 'assessment-fixture', budgetCny: 0, inputCnyPerMillion: 0, outputCnyPerMillion: 0,
    maxInputBytes: 65536, maxSessionBytes: 131072, maxSegments: 16, maxRequests: 32, maxAttempts: 1, timeoutSeconds: 90 }));
  const config = await readAnalysisConfig(configPath), queue = analysisQueue(sandbox.testDatabase, config, 'assessment-fixture');
  await sandbox.testDatabase.query('INSERT INTO analysis_workers(id,config) VALUES($1,$2)', ['assessment-fixture', publicConfig(config)]);
  async function enroll<T extends { enrollmentCredential: string }>(employee: T) {
    const device = await (await sandbox.api('/api/devices/enroll', employee.enrollmentCredential, json({ installationId: randomUUID(), name: '能力合成设备' }))).json();
    return { ...employee, ...device };
  }
  async function owner(name: string) { return enroll(await sandbox.provision(name)); }
  type Owner = Awaited<ReturnType<typeof owner>>;
  const api = (person: Owner, path: string, body?: object) => sandbox.api(path, person.readerCredential, body ? json(body) : {});
  async function upload(person: Owner, rows: object[], sessionId: string, extra = {}) {
    const errorsBefore = sandbox.serverErrors.length;
    // Preserve safe server error classes when a concurrent CI upload fails.
    // Messages and request data may contain credentials or original content.
    const errorCodes = () => sandbox.serverErrors.slice(errorsBefore).map(error =>
      error.code && /^[A-Z0-9_]{1,64}$/i.test(error.code) ? error.code : 'unclassified').slice(-8);
    const bytes = Buffer.from(rows.map(row => JSON.stringify(row)).join('\n') + '\n');
    const staged = await sandbox.api('/api/chunks/' + digest(bytes), person.deviceCredential, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes });
    assert.ok([200,201].includes(staged.status), `chunk HTTP ${staged.status}; observed server error codes: ${JSON.stringify(errorCodes())}`);
    const response = await sandbox.api('/api/snapshots', person.deviceCredential, json({ protocolVersion: 1, sourceSessionId: sessionId, source: 'codex-cli', sourceVersion: '0.157.1', sourceOs: process.platform,
      project: '/synthetic/assessment-model', hash: digest(bytes), byteLength: bytes.length, qualifiedAt: base.toISOString(), capability: 'unverified', ...extra }));
    assert.equal(response.status, 200, `${await response.clone().text()}; observed server error codes: ${JSON.stringify(errorCodes())}`); return { snapshotId: (await response.json()).snapshotId as string, bytes, rows, sessionId };
  }
  function rows(input: { id?: string; prompts?: number; tokens?: number; elements?: number; rework?: boolean; verified?: number; claimed?: number; long?: boolean; active?: boolean } = {}) {
    const id = input.id ?? randomUUID(), timestamp = (ms: number) => new Date(base.getTime() + ms).toISOString();
    const counter = (n: number, time: string) => ({ type: 'event_msg', timestamp: time, payload: { type: 'token_count', info: { total_token_usage: {
      input_tokens: n, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0, total_tokens: n } } } });
    const original: object[] = [{ type: 'session_meta', timestamp: timestamp(-86400000), payload: { id } }, counter(0, new Date(Date.now() - 86400000).toISOString())];
    for (let turn = 0; turn < (input.prompts ?? 5); turn++) {
      const start = turn * (input.long ? 601_100 : 1100);
      original.push({ type: 'response_item', timestamp: timestamp(start), payload: { type: 'message', id: randomUUID(), role: 'user', content: [{ type: 'input_text', text: `${turn > 0 && input.rework ? '返工' : '请求'} ${turn} elements=${input.elements ?? 3}` }] } },
        { type: 'event_msg', timestamp: timestamp(start + 1), payload: { type: 'task_started', turn_id: id + '/' + turn } });
      if (turn === 0) for (let result = 0; result < (input.verified ?? 1); result++) original.push(
        { type: 'response_item', timestamp: timestamp(start + 10 + result), payload: { type: 'function_call', name: 'exec_command', call_id: id + '/' + result, arguments: JSON.stringify({ cmd: `node --test case${result}.js` }) } },
        { type: 'response_item', timestamp: timestamp(start + 30 + result), payload: { type: 'function_call_output', call_id: id + '/' + result, output: `# tests ${result + 1}\n# pass ${result + 1}\n# fail 0` } });
      original.push({ type: 'response_item', timestamp: timestamp(start + 60), payload: { type: 'message', id: randomUUID(), role: 'assistant', content: [{ type: 'output_text', text: turn === 0 ? `声称 ${input.claimed ?? 1} 项结果` : '继续完成本轮' }] } });
      if (!input.active || turn + 1 < (input.prompts ?? 5)) original.push({ type: 'event_msg', timestamp: timestamp(start + 100), payload: { type: 'task_complete', turn_id: id + '/' + turn } });
    }
    original.push(counter(input.tokens ?? 1000, timestamp((input.prompts ?? 5) * (input.long ? 601_100 : 1100))));
    return { rows: original, sessionId: id };
  }
  async function analyze(person: Owner, snapshotId: string, options:{beforeFinish?:()=>Promise<void>;expectedState?:string;taskCitations?:number;clarification?:boolean;representativeOutcomes?:boolean;
    verifyPreparedJob?:{prompts:number;replies:number;outcomes:number}}={}) {
    await sandbox.testDatabase.query("UPDATE analysis_workers SET updated_at=now() WHERE id='assessment-fixture'");
    const response = await api(person, `/api/snapshots/${snapshotId}/analysis`, {}); assert.equal(response.status, 202, await response.clone().text());
    const job = await response.json(), claim = await queue.claim(); assert.equal(claim?.id, job.id);
    const result = await executeAnalysis(config, claim!.input, new AbortController().signal, () => queue.allowForward(claim!), async (_config, input, _signal, forward) => {
      assert.equal(await forward!(), true);
      const cite = (index: number) => ({ event: index, textOffset: 0, quote: input.events[index]!.text.slice(0, 512) });
      const first = input.events.findIndex(event => event.role === 'user'), items = [{ category: 'topic', assessment: 'inferred', text: '合成测试实现', citations: [cite(first)] }];
      return { usage: { inputTokens: 100, outputTokens: 20, runtimeCostUsd: null, providerBilledCny: null, requests: 1 }, output: input.analysisContext?.phase === 'aggregate' ? { items } : { items, insights: {
        version: 'session-insights-1', taskType: { value: 'implementation', citations: input.events.flatMap((event,index)=>event.role==='user'?[cite(index)]:[]).slice(0,options.taskCitations??1) },
        prompts: input.events.flatMap((event, index) => event.role === 'user' ? [{ event: index, elements: Object.fromEntries(['goal','constraints','context','acceptance'].map((key, n) => [key, n < Number(/elements=(\d)/.exec(event.text)?.[1] ?? 3)])), rework: event.text.startsWith('返工'), citations: [cite(index)] }] : []),
        replies: input.events.flatMap((event, index) => event.role === 'assistant' ? [{ event: index, clarification: options.clarification??false, citations: [cite(index)] }] : []),
        outcomes: input.events.flatMap((event, index) => event.role === 'tool result' ? [{ status: 'verified', text: event.text, citations: [cite(index)] }]
          : event.role === 'assistant' && event.text.startsWith('声称 ') && !event.text.startsWith('声称 0') ? [{ status: 'claimed', text: event.text, citations: [cite(index)] }] : []).filter((item,index,all)=>!options.representativeOutcomes||all.findIndex(candidate=>candidate.status===item.status)===index), suggestions: [] } } };
    });
    await options.beforeFinish?.();
    assert.equal(await queue.finish(claim!, result), true);
    if(options.verifyPreparedJob){
      const response=await api(person,'/api/analysis/'+job.id);assert.equal(response.status,200,await response.clone().text());
      const prepared=await response.json();assert.equal(prepared.state,'succeeded');assert.equal(prepared.applicable,true);assert.equal(prepared.result.processing.complete,true);
      assert.deepEqual([prepared.result.insights.prompts.length,prepared.result.insights.replies.length,prepared.result.insights.outcomes.length],
        [options.verifyPreparedJob.prompts,options.verifyPreparedJob.replies,options.verifyPreparedJob.outcomes]);
      return job.id as string;
    }
    const insightResponse=await api(person, `/api/snapshots/${snapshotId}/insights`);
    assert.equal(insightResponse.status,200,await insightResponse.clone().text());
    const view = await insightResponse.json(); assert.equal(view.state, options.expectedState??'complete');
    return job.id as string;
  }
  async function session(person: Owner, input: Parameters<typeof rows>[0] = {}) { const record = rows(input); const result = await upload(person, record.rows, record.sessionId); await analyze(person, result.snapshotId); return result; }
  return { ...sandbox, nativeApi: sandbox.api, owner, enroll, api, session, rows, upload, analyze, base, now };
}
