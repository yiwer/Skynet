import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { mcpSandbox } from './mcp-support.js';
import { beijingDate } from '../packages/contracts/reports.js';
import {monday,addDays} from '../packages/contracts/work-views.js';
import { readAnalysisConfig, publicConfig } from '../apps/analysis/config.js';
import { analysisQueue } from '../apps/analysis/queue.js';
import { executeAnalysis } from '../apps/analysis/execute.js';

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const json = (value: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
const bytes = (...rows: unknown[]) => Buffer.from(rows.map(row => JSON.stringify(row)).join('\n') + '\n');

test('public coverage matrix, frozen source-day statistics and original evidence agree across HTTP/Web/OAuth MCP', { timeout: 180000 }, async () => {
  const s = await mcpSandbox(); let client: Client | undefined; let browser;
  console.log(`Coverage fixture directory: ${s.directory}`);
  try {
    const A = await s.provision('覆盖甲：有活动与缺口'); const B = await s.provision('覆盖乙：宿主确认待核对'); const C = await s.provision('覆盖丙：旧客户端未知');
    const api = (path: string, token = A.readerCredential, init: RequestInit = {}) => s.api(path, token, init);
    const enroll = async (employee: typeof A) => (await api('/api/devices/enroll', employee.enrollmentCredential, json({ installationId: randomUUID(), name: employee.employeeId }))).json();
    const a = await enroll(A); const b = await enroll(B); const c = await enroll(C);
    const now = Date.now() + 60000; const timestamp = new Date(now).toISOString(); const day = beijingDate(new Date(now));
    const priorDay = beijingDate(new Date(now - 86400000)); const sessionId = randomUUID();
    const tokenRow = (time: string, total: number) => ({ timestamp: time, type: 'event_msg', payload: { type: 'token_count', info: {
      total_token_usage: { input_tokens: total * 2 / 3, cached_input_tokens: total / 3, output_tokens: total / 3, reasoning_output_tokens: 0, total_tokens: total } } } });
    const user = (text: string, time = timestamp) => ({ timestamp: time, type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } });
    const original = bytes({ timestamp, type: 'session_meta', payload: { id: sessionId, cwd: '/synthetic', source: 'cli', cli_version: '0.157.1' } },
      tokenRow(new Date(Date.now() - 60000).toISOString(), 60), user('结构化路径与来源 Token 合成记录'),
      { timestamp, type: 'response_item', payload: { type: 'custom_tool_call', name: 'apply_patch', call_id: 'fixture-patch-1', input: '*** Begin Patch\n*** Add File: synthetic/code.ts\n+export const fixture = true;\n*** End Patch' } },
      tokenRow(timestamp, 90));
    async function upload(device: typeof a, content: Buffer, restoredFrom?: unknown, extra: object = {}) {
      assert.equal((await api(`/api/chunks/${hash(content)}`, device.deviceCredential, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(content) })).status, 201);
      const manifest = { protocolVersion: 1, sourceSessionId: sessionId, source: 'codex-cli', sourceVersion: '0.157.1', sourceOs: process.platform,
        project: '/synthetic/coverage', hash: hash(content), byteLength: content.length, qualifiedAt: timestamp, capability: 'unverified', ...(restoredFrom ? { restoredFrom } : {}), ...extra };
      const response = await api('/api/snapshots', device.deviceCredential, json(manifest)); assert.equal(response.status, 200, await response.clone().text());
      return (await response.json()).snapshotId;
    }
    const snapshotId = await upload(a, original);
    const health = (device: typeof a, value: unknown) => api('/api/devices/health', device.deviceCredential, json({ nonce: randomUUID(), ...value as object }));
    assert.equal((await health(a, { source: 'codex-cli', installation: { clients: [{ source: 'codex-cli', configured: true, hostEvent: 'observed' }] },
      capture: { checkedAt: new Date().toISOString(), observation: 'host-event-observed', locallyPersisted: true,
        faults: [{ id: randomUUID(), code: 'source-missing', scope: 'source', firstObservedAt: new Date().toISOString(), lastObservedAt: new Date().toISOString(), recoveredAt: null, coverage: 'unverified-range' }] } })).status, 200);
    assert.equal((await health(b, { installation: { clients: [{ source: 'codex-cli', configured: true, hostEvent: 'not-observed' }] } })).status, 200);
    assert.equal((await health(c, {})).status, 200);
    // Isolated clock fixture: simulate a formerly observed device being currently
    // disconnected without waiting 90s. This does not create historical coverage.
    await s.testDatabase.query(`UPDATE device_health SET received_at=now()-interval '2 minutes' WHERE device_id=$1`, [c.deviceId]);
    assert.equal((await s.api(`/api/team-coverage?date=${day}`)).status, 401);
    assert.equal((await api(`/api/team-coverage?date=${day}`, a.deviceCredential)).status, 401);
    assert.equal((await api('/api/team-coverage?date=2026-02-30')).status, 400);
    const matrix = await (await api(`/api/team-coverage?date=${day}`)).json();
    const cell = (employeeId: string, date = day) => matrix.rows.find((row: any) => row.employeeId === employeeId).cells.find((row: any) => row.date === date);
    assert.equal(cell(A.employeeId).records, 2); assert.equal(cell(A.employeeId).collection, 'gap-observed');
    assert.equal(cell(B.employeeId).hostConfirmation, 'pending-confirmation'); assert.equal(cell(B.employeeId).activity, 'none-observed');
    assert.equal(cell(C.employeeId).configured, 'unknown'); assert.equal(cell(C.employeeId).hostConfirmation, 'unknown'); assert.equal(cell(C.employeeId).currentConnection, 'not-connected');
    for (const employee of [A, B, C]) assert.equal(cell(employee.employeeId, priorDay).collection, 'unknown');
    assert.equal((await health(a, { source: 'codex-cli', capture: { checkedAt: '2000-01-01T00:00:00.000Z', observation: 'host-event-observed', locallyPersisted: true, faults: [] } })).status, 200);
    const recoveredMatrix = await (await api(`/api/team-coverage?date=${day}`)).json();
    assert.equal(recoveredMatrix.rows.find((row: any) => row.employeeId === A.employeeId).cells.at(-1).collection, 'gap-observed', 'later recovery retains the received-hour adverse observation');
    const statsPath = `/api/work-statistics/${A.employeeId}?date=${day}`;
    const statistics = await (await api(statsPath)).json();
    assert.deepEqual([statistics.records, statistics.sessions, statistics.userTurns, statistics.toolCalls], [2, 1, 1, 1]);
    assert.equal(statistics.files.observedCount, 1); assert.equal(statistics.files.complete, true);
    assert.equal(statistics.tokens.total, 30); assert.equal(statistics.tokens.input, 20); assert.equal(statistics.tokens.cachedInput, 10);
    assert.equal(statistics.tokens.cacheWriteInput, null); assert.equal(statistics.humanWorkHours, null);
    const reference = statistics.references.find((item: any) => item.kind === 'file'); assert.ok(reference.webPath.includes(snapshotId));
    const bRaw = Buffer.concat([original, bytes(user('乙的新增 suffix', new Date(now + 60000).toISOString()), tokenRow(new Date(now + 60000).toISOString(), 120))]);
    const restored = await upload(b, bRaw, { snapshotId, hash: hash(original), byteLength: original.length });
    const bStatistics = await (await api(`/api/work-statistics/${B.employeeId}?date=${day}`)).json();
    assert.equal(bStatistics.records, 1); assert.equal(bStatistics.tokens.total, 30); assert.equal(bStatistics.files.observedCount, 0);
    assert.deepEqual(await (await api(statsPath + `&revision=${statistics.revision}`)).json(), statistics);
    assert.deepEqual(Buffer.from(await (await api(`/api/snapshots/${snapshotId}/raw`)).arrayBuffer()), original);

    // The sourceSnapshotId below points to a parent whose main raw is different.
    // Auxiliary usage must resolve the ORIGINAL MATERIAL, and qualify it only
    // when A's ordinary primary proves the exact same bytes on A's own device.
    const childId = randomUUID(); const parentId = randomUUID(); const childTime = new Date(now + 120000).toISOString();
    const child = bytes({ timestamp: childTime, type: 'session_meta', payload: { id: childId, cwd: '/synthetic', source: 'cli', cli_version: '0.157.1' } },
      tokenRow(new Date(Date.now() - 60000).toISOString(), 60), user('材料自己的活动', childTime),
      { timestamp: childTime, type: 'response_item', payload: { type: 'custom_tool_call', name: 'apply_patch', call_id: 'child-patch', input: '*** Begin Patch\n*** Add File: synthetic/child.ts\n+export const child = true;\n*** End Patch' } }, tokenRow(childTime, 90));
    const material = { id: hash('coverage-child-material'), hash: hash(child), byteLength: child.length, mediaType: 'jsonl', role: 'child-transcript',
      name: 'sessions/child.jsonl', placement: 'codex-rollout', sourceSessionId: childId };
    assert.equal((await api(`/api/chunks/${material.hash}`, a.deviceCredential, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(child) })).status, 201);
    const parent = bytes({ timestamp, type: 'session_meta', payload: { id: parentId, cwd: '/synthetic', source: 'cli', cli_version: '0.157.1' } }, user('父件没有 child Token 记录'));
    const parentSnapshot = await upload(a, parent, undefined, { sourceSessionId: parentId, capture: { generation: hash(parentId), revision: 1,
      change: 'initial', materials: [material], lineage: [], compacted: false, partialLine: false, gaps: [] } });
    await upload(b, child, { snapshotId: parentSnapshot, materialId: material.id, hash: material.hash, byteLength: material.byteLength }, { sourceSessionId: childId });
    const beforeMaterialProof = await (await api(statsPath)).json(); assert.equal(beforeMaterialProof.tokens.total, 30);
    const proofSnapshot = await upload(a, child, undefined, { sourceSessionId: childId });
    const materialStatistics = await (await api(statsPath)).json();
    assert.equal(materialStatistics.records, 5); assert.equal(materialStatistics.tokens.total, 60); assert.equal(materialStatistics.files.observedCount, 2);
    const materialUsage = materialStatistics.references.find((item: any) => item.kind === 'usage' && item.materialId === material.id);
    assert.ok(materialUsage && materialUsage.snapshotId === parentSnapshot && materialUsage.webPath.includes('kind=material'));
    assert.equal((await (await api(`/api/work-statistics/${B.employeeId}?date=${day}`)).json()).tokens.total, 30);
    assert.deepEqual(await (await api(statsPath + `&revision=${statistics.revision}`)).json(), statistics);

    const registration = await (await s.api('/oauth/register', undefined, json({ client_name: 'coverage tracer', redirect_uris: ['http://127.0.0.1:47123/callback'], token_endpoint_auth_method: 'none' }))).json();
    const verifier = randomBytes(48).toString('base64url'); const resource = s.origin + '/mcp';
    const parameters = { response_type: 'code', client_id: registration.client_id, redirect_uri: registration.redirect_uris[0], scope: 'archive:read', resource, state: randomUUID(), code_challenge_method: 'S256', code_challenge: hash(verifier) };
    parameters.code_challenge = createHash('sha256').update(verifier).digest('base64url');
    const callback = new URL(await s.authorizationPage(s.origin + '/oauth/authorize?' + new URLSearchParams(parameters), A.readerCredential));
    const token = await (await s.api('/oauth/token', undefined, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({
      grant_type: 'authorization_code', client_id: registration.client_id, code: callback.searchParams.get('code')!, redirect_uri: parameters.redirect_uri, code_verifier: verifier, resource }).toString() })).json();
    client = new Client({ name: 'coverage-public-tracer', version: '1' }); await client.connect(new StreamableHTTPClientTransport(new URL(resource), { fetch: s.fetchTls,
      requestInit: { headers: { Authorization: `Bearer ${token.access_token}` } } }));
    const result = await client.callTool({ name: 'read_work_statistics', arguments: { employeeId: A.employeeId, date: day, revision: statistics.revision } });
    assert.deepEqual(JSON.parse((result.content as { text: string }[])[0]!.text), statistics);
    const mcpMatrix = await client.callTool({ name: 'read_team_coverage', arguments: { date: day } });
    const httpMatrix = await (await api(`/api/team-coverage?date=${day}`)).json();
    assert.deepEqual(JSON.parse((mcpMatrix.content as { text: string }[])[0]!.text).rows, httpMatrix.rows);
    const configPath = join(s.directory, 'coverage-explicit-synthetic-analysis.json');
    await writeFile(configPath, JSON.stringify({ mode: 'fixture', executable: process.execPath, runtimeVersion: '2.1.281', model: 'synthetic-coverage-fixture',
      workDirectory: join(s.directory, 'synthetic-analysis'), fixtureOrigin: 'http://127.0.0.1:9', budgetId: 'coverage-fixture', budgetCny: 0,
      inputCnyPerMillion: 0, outputCnyPerMillion: 0, maxRequests: 3, maxOutputTokens: 4096, maxAttempts: 1, timeoutSeconds: 30, autoAnalyzeUpdates: false }));
    const config = await readAnalysisConfig(configPath); const queue = analysisQueue(s.testDatabase, config, 'coverage-synthetic-runner');
    await s.testDatabase.query('INSERT INTO analysis_workers(id,config) VALUES($1,$2)', ['coverage-synthetic-runner', publicConfig(config)]);
    // Necessary old-payload migration fixture: no statistic pointer existed in
    // that format. It must remain null and byte-for-byte fixed after new writes.
    const legacyPayload={employeeId:A.employeeId,employee:'覆盖甲：有活动与缺口',date:day,timeZone:'Asia/Shanghai',revision:0,version:null,state:'unavailable',createdAt:null,items:[],nextOffset:null,refreshPending:false,
      statistics:{records:4,userTurns:2,toolCalls:2,historicalRecords:0,unknownRecords:0,files:null,tokens:null,activityIntervals:null,humanWorkHours:null,definition:'合成旧格式；统计未绑定，未知不是零'},
      coverage:{messages:['合成旧格式固定报告'],inputs:[],originalEventIdsSample:[],originalEventCount:4,originalEventHash:hash('legacy synthetic event scope'),originalEventHashComplete:true,eligibleInputsComplete:false,dailyDeviceCoverage:'unknown',fixture:true}};
    await s.testDatabase.query('INSERT INTO daily_report_revisions(id,employee_id,date,revision,version,payload) VALUES($1,$2,$3,1,$4,$5)',[randomUUID(),A.employeeId,day,hash(JSON.stringify(legacyPayload)),legacyPayload]);
    const legacyPath=`/api/daily-reports/${A.employeeId}/${day}?revision=1`,legacyText=await(await api(legacyPath)).text();assert.equal(JSON.parse(legacyText).statistics.tokens,null);assert.equal(JSON.parse(legacyText).coverage.workStatistics,undefined);
    const concurrent=await Promise.all([api(`/api/daily-reports/${A.employeeId}/${day}`, A.readerCredential, json({})),api(statsPath)]);
    assert.equal(concurrent[0]!.status,202);assert.ok([200,409].includes(concurrent[1]!.status),'nonwaiting statistic serialization never produces a pool/unique failure');
    let dailyReport: any;
    for (let attempt = 0; attempt < 70; attempt++) {
      await s.testDatabase.query("UPDATE analysis_workers SET updated_at=now() WHERE id='coverage-synthetic-runner'");
      for (let index = 0; index < 10; index++) {
        const job = await queue.claim(); if (!job) break;
        const result = await executeAnalysis(config, job.input, new AbortController().signal, () => queue.allowForward(job), async (_config, input, _signal, beforeForward) => {
          assert.equal(await beforeForward!(), true);
          const event = input.events.findIndex(item => item.role === 'user' && item.origin?.employeeId === A.employeeId && item.origin?.sourceDate === day && item.origin?.context === 'after-enrollment');
          return { output: { items: event < 0 ? [] : (['goal', 'topic', 'blocker'] as const).map(category => ({ category, assessment: 'claimed' as const,
            text: `合成${category}：${input.events[event]!.text}`, citations: [{ event, textOffset: 0, quote: input.events[event]!.text }] })) },
            usage: { inputTokens: 100, outputTokens: 20, requests: 1, runtimeCostUsd: null, providerBilledCny: null } };
        });
        assert.equal(await queue.finish(job, result), true);
      }
      dailyReport = await (await api(`/api/daily-reports/${A.employeeId}/${day}`)).json();
      if (dailyReport.items.some((item: any) => item.category === 'blocker') && !dailyReport.refreshPending) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.ok(dailyReport.items.some((item: any) => item.category === 'blocker'), JSON.stringify(dailyReport));
    assert.equal(dailyReport.coverage.fixture, true);
    const mcpDaily = await client.callTool({ name: 'read_daily_report', arguments: { employeeId: A.employeeId, date: day, revision: dailyReport.revision } });
    const frozenDaily = await (await api(`/api/daily-reports/${A.employeeId}/${day}?revision=${dailyReport.revision}`)).json();
    assert.ok(frozenDaily.coverage.workStatistics,'a new daily version must freeze a statistic revision, not permanent unknowns');
    const fixedStatistic=frozenDaily.coverage.workStatistics;
    const boundStatistic=await(await api(statsPath+`&revision=${fixedStatistic.revision}`)).json();
    assert.equal(boundStatistic.version,fixedStatistic.version);assert.equal(boundStatistic.employeeId,A.employeeId);assert.equal(boundStatistic.date,day);
    assert.deepEqual(frozenDaily.statistics.tokens,boundStatistic.tokens);assert.equal(frozenDaily.statistics.files.observedCount,boundStatistic.files.observedCount);assert.deepEqual(frozenDaily.statistics.activityIntervals,boundStatistic.intervals);
    assert.equal(await(await api(legacyPath)).text(),legacyText,'old unbound payload is never filled from latest statistics');
    const week=monday(day),weeklyPath='/api/work-view?'+new URLSearchParams({kind:'weekly',subject:A.employeeId,from:week,to:addDays(week,6)});
    assert.equal((await api(weeklyPath,undefined,json({}))).status,202);let weekly:any;
    for(let tick=0;tick<20;tick++){weekly=await(await api(weeklyPath)).json();if(weekly.coverage?.days.find((row:any)=>row.date===day)?.workStatistics)break;await new Promise(resolve=>setTimeout(resolve,100));}
    const fixedDay=weekly.coverage.days.find((row:any)=>row.date===day);assert.deepEqual(fixedDay.workStatistics,fixedStatistic);assert.deepEqual(fixedDay.statistics.files,frozenDaily.statistics.files);assert.equal(fixedDay.statistics.tokens.total,frozenDaily.statistics.tokens.total);
    const frozenWeekly=await(await api(weeklyPath+`&revision=${weekly.revision}`)).text();
    assert.deepEqual(JSON.parse((mcpDaily.content as { text: string }[])[0]!.text), frozenDaily);
    const requestsBeforeMatrix = s.traffic.filter(item => item.method === 'POST' && item.path.startsWith('/api/daily-reports/')).length;
    browser = await chromium.launch({ headless: true }); const page = await browser.newPage({ ignoreHTTPSErrors: true });
    await page.goto(s.origin); await page.getByLabel('个人读取凭据').fill(A.readerCredential); await page.getByRole('button', { name: '进入存档' }).click();
    await page.getByRole('button', { name: '团队覆盖', exact: true }).click();
    await expect(page.getByRole('region', { name: '团队覆盖矩阵' })).toContainText('采集缺口已观察');
    await expect(page.getByRole('complementary', { name: '选中员工与日期' })).toContainText('来源 Token 总量');
    await expect(page.getByRole('region', { name: '方向主题与阻塞' })).toContainText('合成blocker');
    await page.getByRole('button', { name: new RegExp(`^覆盖丙：旧客户端未知 ${day}，`) }).click();
    await expect(page.getByRole('region', { name: '方向主题与阻塞' })).toContainText('本日主题尚未生成');
    await page.getByRole('button', { name: new RegExp(`^覆盖甲：有活动与缺口 ${day}，`) }).click();
    await expect(page.getByRole('region', { name: '方向主题与阻塞' })).toContainText('合成blocker');
    const dailyLink = page.getByRole('link', { name: '查看该员工本日工作', exact: true });
    await expect(dailyLink).toHaveAttribute('href', `#daily?${new URLSearchParams({ employeeId: A.employeeId, date: day, revision: String(dailyReport.revision) })}`);
    await dailyLink.click(); await expect(page.getByRole('region', { name: '日工作' })).toContainText('合成blocker');
    const dailyPanel = page.getByRole('region', { name: '日工作' });
    assert.equal(await dailyPanel.getByLabel('来源日期', { exact: true }).inputValue(), day); await expect(dailyPanel.getByRole('combobox')).toHaveValue(A.employeeId);
    await expect(dailyPanel.getByLabel('历史版本（留空读取最新）')).toHaveValue(String(dailyReport.revision));
    await dailyPanel.getByText(new RegExp(`^核查固定统计 v${fixedStatistic.revision}`)).click();
    await expect(dailyPanel.getByRole('link',{name:'synthetic/code.ts',exact:true})).toBeVisible();
    await expect(dailyPanel.getByText(`统计版本 ${fixedStatistic.version}；区间不是人工工时。`,{exact:true})).toBeVisible();
    await page.getByRole('button', { name: '团队覆盖', exact: true }).click();
    const projectLink = page.getByRole('link', { name: '查看项目工作：/synthetic/coverage', exact: true }).first();
    await expect(projectLink).toHaveAttribute('href', `#work?${new URLSearchParams({ kind: 'project', subject: '/synthetic/coverage', from: day, to: day })}`);
    await projectLink.click(); await expect(page.getByRole('region', { name: '周工作与项目' })).toBeVisible();
    const projectPanel = page.getByRole('region', { name: '周工作与项目' });
    await expect(projectPanel.getByRole('combobox').nth(0)).toHaveValue('project'); await expect(projectPanel.getByRole('combobox').nth(1)).toHaveValue('/synthetic/coverage');
    await expect(projectPanel.getByLabel('起始来源日期')).toHaveValue(day); await expect(projectPanel.getByLabel('结束来源日期')).toHaveValue(day);
    assert.equal(s.traffic.filter(item => item.method === 'POST' && item.path.startsWith('/api/daily-reports/')).length, requestsBeforeMatrix, 'matrix reads/drilldown never generate a report or model attempt');
    await page.getByRole('button', { name: '团队覆盖', exact: true }).click();
    await page.getByText('原件统计引用', { exact: true }).click(); await page.getByRole('link', { name: 'synthetic/code.ts', exact: true }).click();
    await expect(page.getByRole('region', { name: '命中证据' })).toContainText('*** Add File: synthetic/code.ts');
    await page.getByRole('button', { name: '团队覆盖', exact: true }).click();
    const layouts = [];
    const evidence = join('F:/GenCode/Skynet-evidence/v1-2026-09-30', `coverage-${snapshotId}`); await mkdir(evidence, { recursive: true });
    for (const width of [320, 375, 760, 1280, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.getByRole('region', { name: '团队覆盖矩阵' })).toBeVisible();
      const dimensions = await page.evaluate(() => ({ width: innerWidth, contentWidth: document.documentElement.scrollWidth }));
      assert.ok(dimensions.contentWidth <= width, JSON.stringify(dimensions)); layouts.push(dimensions);
      await page.screenshot({ path: join(evidence, `coverage-${width}.png`), fullPage: true });
    }
    const corruptId = randomUUID(); const corruptPrefix = bytes({ timestamp, type: 'session_meta', payload: { id: corruptId, cwd: '/synthetic', source: 'cli', cli_version: '0.157.1' } });
    const corrupt = Buffer.concat([corruptPrefix, Buffer.from(`{"timestamp":"${timestamp}","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"`),
      Buffer.from([0xff]), Buffer.from('"}]}}\n'), bytes(tokenRow(timestamp, 120))]);
    const corruptSnapshot = await upload(a, corrupt, undefined, { sourceSessionId: corruptId });
    const corruptStatistics = await (await api(statsPath)).json();
    assert.equal(corruptStatistics.tokens.total, null); assert.equal(corruptStatistics.files.complete, false); assert.equal(corruptStatistics.sourceInputsComplete, false);
    assert.deepEqual(Buffer.from(await (await api(`/api/snapshots/${corruptSnapshot}/raw`)).arrayBuffer()), corrupt);
    assert.equal((await api('/api/sessions')).status, 200); assert.equal((await api('/health')).status, 200);
    assert.equal((await(await api(`/api/daily-reports/${A.employeeId}/${day}`)).json()).refreshPending,true,'a no-semantic-origin current raw gap changes report input revision without guessing its source day');
    await s.testDatabase.query("UPDATE analysis_workers SET updated_at=now() WHERE id='coverage-synthetic-runner'");
    assert.equal((await api(`/api/daily-reports/${A.employeeId}/${day}`,undefined,json({}))).status,202);let changedReport:any;
    for(let tick=0;tick<20;tick++){changedReport=await(await api(`/api/daily-reports/${A.employeeId}/${day}`)).json();if(changedReport.coverage?.workStatistics?.version===corruptStatistics.version)break;await new Promise(resolve=>setTimeout(resolve,100));}
    assert.ok(changedReport.revision>frozenDaily.revision);assert.equal(changedReport.statistics.tokens.total,null);assert.equal(changedReport.coverage.workStatistics.version,corruptStatistics.version);assert.equal(changedReport.state,'partial');
    const unchanged=await(await api(`/api/analysis/${frozenDaily.coverage.inputs.find((value:any)=>value.analysisId).analysisId}`)).json();assert.equal(unchanged.applicable,true,'an independent corrupt session does not invalidate an unchanged snapshot analysis');
    assert.equal(await(await api(legacyPath)).text(),legacyText);assert.deepEqual(await(await api(`/api/daily-reports/${A.employeeId}/${day}?revision=${dailyReport.revision}`)).json(),frozenDaily);
    assert.equal(await(await api(weeklyPath+`&revision=${weekly.revision}`)).text(),frozenWeekly);
    const mcpLegacy=await client.callTool({name:'read_daily_report',arguments:{employeeId:A.employeeId,date:day,revision:1}});assert.deepEqual(JSON.parse((mcpLegacy.content as{text:string}[])[0]!.text),JSON.parse(legacyText));
    await s.restart();
    assert.deepEqual(await (await api(statsPath + `&revision=${statistics.revision}`)).json(), statistics);
    assert.equal((await (await api(`/api/team-coverage?date=${day}`)).json()).rows.find((row: any) => row.employeeId === A.employeeId).cells.at(-1).collection, 'gap-observed');
    await writeFile(join(evidence, 'public-flow.json'), JSON.stringify({ snapshotId, restored, matrix: httpMatrix, statistics, bStatistics, parentSnapshot, proofSnapshot, materialStatistics, corruptSnapshot, corruptStatistics, dailyReport, layouts,
      boundary: 'Public authenticated synthetic upload and native-record-schema rows, immutable export, Web/OAuth MCP and restart; no real provider/model/paid call or Task setup.' }, null, 2));
    console.log(`Coverage public-flow evidence: ${evidence}`);
  } finally { await browser?.close(); await client?.close(); await s.close(); }
});
