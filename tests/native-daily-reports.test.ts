import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { writeFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { chromium, expect, type Browser } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { mcpSandbox } from './mcp-support.js';
import { stop } from './support.js';
import { analysisFixture } from './analysis-fixture.js';
import { beijingDate, type DailyReport } from '../packages/contracts/reports.js';
import { connect } from '../apps/server/database.js';
import { reportService } from '../apps/server/reports.js';
import { analysisService } from '../apps/server/analysis.js';
import { archiveQuery } from '../apps/server/archive-query.js';
import { RawStore } from '../apps/server/raw-store.js';

const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const json = (value: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
const form = (value: Record<string, string>): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(value).toString() });

test('public daily report automatically analyzes day events through native CLI, preserves original owners and Web/MCP immutable versions', { timeout: 180000 }, async () => {
  const runtime = process.env.SKYNET_CLAUDE_RUNTIME; assert.ok(runtime, 'Explicit native Claude 2.1.281; synthetic loopback only');
  const sandbox = await mcpSandbox(); const root = await realpath(sandbox.directory);
  console.log(`Daily report isolated fixture: ${root}`);
  const fixture = analysisFixture({ items: [
    { category: 'topic', assessment: 'inferred', text: '核查共同测试主题', citations: [{ event: 1, textOffset: 0, quote: '本日核查🛰' }] },
    { category: 'goal', assessment: 'claimed', text: '本日核查目标', citations: [{ event: 1, textOffset: 0, quote: '本日核查🛰' }] },
    { category: 'activity', assessment: 'inferred', text: '依据本日请求核查旧背景', citations: [{ event: 1, textOffset: 0, quote: '本日核查🛰' }, { event: 0, textOffset: 0, quote: '旧日背景' }] },
    { category: 'outcome', assessment: 'claimed', text: '旧日自述不能成为当天成果', citations: [{ event: 0, textOffset: 0, quote: '旧日背景' }] },
    { category: 'next', assessment: 'claimed', text: '翌日事实不回填本日', citations: [{ event: 2, textOffset: 0, quote: '翌日核查' }] },
  ] }, join(root, 'MUST_NOT_EXIST'));
  let child: ChildProcess | undefined; let browser: Browser | undefined; let client: Client | undefined; let logs = ''; let stderr = '';
  try {
    fixture.server.listen(0, '127.0.0.1'); await once(fixture.server, 'listening');
    const alpha = await sandbox.provision('合成日报甲'); const beta = await sandbox.provision('合成日报乙');
    async function enroll(employee: typeof alpha) { return (await sandbox.api('/api/devices/enroll', employee.enrollmentCredential, json({ installationId: randomUUID(), name: 'daily synthetic' }))).json(); }
    const a = await enroll(alpha); const b = await enroll(beta); const date = beijingDate();
    const current = new Date(Date.now() + 1000).toISOString();
    assert.equal(beijingDate(new Date(current)), date, 'Run outside the final second of Beijing day');
    const midnight = new Date(`${date}T00:00:00+08:00`).getTime();
    const line = (text: string, timestamp: string) => JSON.stringify({ timestamp, type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } }) + '\n';
    async function upload(device: typeof a, project: string, bytes?: Buffer, sessionId = randomUUID(), restoredFrom?: unknown) {
      const raw = bytes ?? Buffer.from(JSON.stringify({ type: 'session_meta', payload: { id: sessionId, cli_version: '0.157.1', cwd: project } }) + '\n'
        + line('旧日背景', new Date(midnight - 1000).toISOString()) + line('本日核查🛰', current)
        + line('翌日核查', new Date(midnight + 86400_000 + 1000).toISOString()) + JSON.stringify({ type: 'unknown_future_event', keep: 'RAW_BYTES_KEEP' }) + '\n');
      const manifest = { protocolVersion: 1, source: 'codex-cli', sourceVersion: '0.157.1', sourceOs: 'win32', sourceSessionId: sessionId,
        project, hash: hash(raw), byteLength: raw.length, qualifiedAt: current, capability: 'unverified', ...(restoredFrom ? { restoredFrom } : {}) };
      assert.equal((await sandbox.api(`/api/chunks/${manifest.hash}`, device.deviceCredential, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(raw) })).status, 201);
      const result = await sandbox.api('/api/snapshots', device.deviceCredential, json(manifest)); assert.equal(result.status, 200, await result.clone().text());
      return { ...(await result.json()), raw, manifest };
    }
    const original = await upload(a, '/synthetic/shared');
    for (let session = 0; session < 6; session++) await upload(a, '/synthetic/shared');
    await upload(a, '/synthetic/other');
    const bundle = await (await sandbox.api(`/api/snapshots/${original.snapshotId}/recovery`, alpha.readerCredential)).json();
    const restored = await upload(b, '/synthetic/beta', Buffer.concat([Buffer.from(bundle.artifact.data, 'base64'), Buffer.from(line('乙新后缀', current))]),
      original.manifest.sourceSessionId, { snapshotId: original.snapshotId, hash: original.manifest.hash, byteLength: original.manifest.byteLength });
    // Exercise the production scheduler against public-uploaded originals with an
    // explicit clock, without editing enrollment/source timestamps in the DB.
    // This proves the timer policy, not a real next-morning wall-clock observation.
    const scheduleDb = connect(sandbox.env.DATABASE_URL!);
    try {
      const reports = reportService(scheduleDb, analysisService(scheduleDb, archiveQuery(scheduleDb, new RawStore(sandbox.env.RAW_DIRECTORY!))));
      await reports.tick(new Date(midnight + 86400_000 + 9 * 3600_000));
    } finally { await scheduleDb.end(); }
    const path = `/api/daily-reports/${alpha.employeeId}/${date}`;
    const queued: DailyReport = await (await sandbox.api(path, beta.readerCredential)).json();
    assert.equal(queued.state, 'unavailable', '09:00 schedules a durable period even while runtime is offline');
    const configPath = join(root, 'daily-analysis.json');
    await writeFile(configPath, JSON.stringify({ mode: 'fixture', executable: runtime, runtimeVersion: '2.1.281', model: 'claude-sonnet-4-5',
      workDirectory: join(root, 'jobs'), fixtureOrigin: `http://127.0.0.1:${(fixture.server.address() as { port: number }).port}`,
      gitBashPath: 'C:/Program Files/Git/bin/bash.exe', budgetId: 'daily-synthetic', budgetCny: 0, inputCnyPerMillion: 0, outputCnyPerMillion: 0,
      maxRequests: 3, maxOutputTokens: 1024, timeoutSeconds: 15 }));
    child = spawn(process.execPath, ['dist/apps/analysis/worker.js'], { env: { ...sandbox.env, SKYNET_ANALYSIS_CONFIG: configPath }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout!.on('data', part => { logs += part; }); child.stderr!.on('data', part => { stderr += part; });
    for (let attempt = 0; attempt < 60 && !logs.includes('worker ready'); attempt++) await setTimeout(500);
    assert.match(logs, /worker ready/, stderr);
    assert.equal((await sandbox.api(path)).status, 401);
    assert.equal((await sandbox.api(path, a.deviceCredential, json({}))).status, 401);
    // No report POST, /snapshot/analysis POST or database insert: reporting itself discovers and
    // enqueues the qualified inputs using an internal system initiator.
    let report = queued;
    for (let attempt = 0; attempt < 120 && !['ready', 'partial'].includes(report.state); attempt++) {
      await setTimeout(500); report = await (await sandbox.api(path, beta.readerCredential)).json();
    }
    assert.equal(report.state, 'partial', `${root}; ${stderr}; ${JSON.stringify(report)}`);
    assert.equal(report.coverage!.eligibleInputsComplete, false, 'unknown raw rows prevent a claim of complete daily coverage');
    const firstPage = report; assert.equal(firstPage.items.length, 20); assert.equal(firstPage.nextOffset, 20);
    const secondPage: DailyReport = await (await sandbox.api(`${path}?revision=${report.revision}&offset=${report.nextOffset}`, beta.readerCredential)).json();
    assert.equal(secondPage.version, report.version); assert.equal(secondPage.items.length, 4); assert.equal(secondPage.nextOffset, null);
    report = { ...report, items: [...report.items, ...secondPage.items], nextOffset: null };
    assert.equal(report.statistics!.records, 8); assert.equal(report.statistics!.userTurns, 8); assert.equal(report.statistics!.toolCalls, 0);
    assert.equal(report.statistics!.historicalRecords, 0, 'old source-day records never become current historical counts');
    assert.equal(report.statistics!.tokens, null); assert.equal(report.statistics!.humanWorkHours, null);
    const archiveCounts = (await (await sandbox.api('/api/activity-statistics', beta.readerCredential)).json()).rows.find((row: any) => row.employeeId === alpha.employeeId && row.date === date);
    assert.equal(report.statistics!.records, archiveCounts.activityRecords); assert.equal(report.statistics!.userTurns, archiveCounts.activityUserTurns);
    assert.equal(report.statistics!.toolCalls, archiveCounts.activityToolCalls);
    assert.equal(report.items.length, 24); assert.equal(new Set(report.items.map(item => item.project)).size, 2);
    assert.equal(new Set(report.items.filter(item => item.project === '/synthetic/shared').map(item => item.analysisId)).size, 7);
    assert.ok(report.items.every(item => item.category !== 'outcome' && item.category !== 'next'));
    assert.ok(report.items.every(item => item.citations.every(c => c.origin!.employeeId === alpha.employeeId && c.origin!.sourceDate === date && c.context === 'after-enrollment')));
    assert.ok(report.items.filter(item => item.category === 'activity').every(item => item.backgroundCitations.length === 1 && item.backgroundCitations[0]!.context === 'historical'));
    assert.ok(report.coverage!.messages.some(message => message.includes('未解析'))); assert.equal(report.coverage!.fixture, true);
    const old = await (await sandbox.api(`${path}?revision=${queued.revision}`, beta.readerCredential)).json(); assert.equal(old.version, queued.version); assert.equal(old.state, 'unavailable');
    const stable = await (await sandbox.api(path, beta.readerCredential, json({}))).json(); assert.equal(stable.version, report.version); assert.equal(stable.revision, report.revision);
    const betaReport = await (await sandbox.api(`/api/daily-reports/${beta.employeeId}/${date}`, alpha.readerCredential, json({}))).json();
    await writeFile(join(root, 'daily-report-diagnostic.json'), JSON.stringify({ report, queued, betaReport, logs, stderr }, null, 2));
    assert.equal(betaReport.statistics.records, 1); assert.equal(betaReport.items.length, 0); assert.equal(betaReport.state, 'partial');
    const evidence = report.items.flatMap(item => item.citations).find(citation => citation.origin!.snapshotId === original.snapshotId)!;
    assert.ok(evidence, 'restored carrier points to original A evidence');
    const location = await (await sandbox.api(`/api/snapshots/${evidence.snapshotId}/location?${new URLSearchParams(Object.entries(evidence.location).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]))}`, beta.readerCredential)).json();
    assert.equal(location.kind, 'raw'); assert.ok(location.text.includes('本日核查🛰'));
    assert.deepEqual(Buffer.from(await (await sandbox.api(`/api/snapshots/${restored.snapshotId}/raw`, alpha.readerCredential)).arrayBuffer()), restored.raw);
    await sandbox.restart(); assert.deepEqual(await (await sandbox.api(path, beta.readerCredential)).json(), firstPage);
    const registration = await (await sandbox.api('/oauth/register', undefined, json({ client_name: 'synthetic daily report', redirect_uris: ['http://127.0.0.1:47123/callback'], token_endpoint_auth_method: 'none' }))).json();
    const verifier = randomBytes(48).toString('base64url'); const resource = `${sandbox.origin}/mcp`;
    const callback = new URL(await sandbox.authorizationPage(`${sandbox.origin}/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id: registration.client_id,
      redirect_uri: registration.redirect_uris[0], scope: 'archive:read', resource, state: randomUUID(), code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url') })}`, beta.readerCredential));
    const token = await (await sandbox.api('/oauth/token', undefined, form({ grant_type: 'authorization_code', client_id: registration.client_id, code: callback.searchParams.get('code')!, redirect_uri: registration.redirect_uris[0], code_verifier: verifier, resource }))).json();
    client = new Client({ name: 'daily-public-test', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(resource), { fetch: sandbox.fetchTls, requestInit: { headers: { Authorization: `Bearer ${token.access_token}` } } }));
    const mcp = await client.callTool({ name: 'read_daily_report', arguments: { employeeId: alpha.employeeId, date, revision: report.revision } });
    assert.notEqual(mcp.isError, true); assert.deepEqual(JSON.parse((mcp.content as { text: string }[])[0]!.text), firstPage);
    const mcpMore = await client.callTool({ name: 'read_daily_report', arguments: { employeeId: alpha.employeeId, date, revision: report.revision, offset: 20 } });
    assert.deepEqual(JSON.parse((mcpMore.content as { text: string }[])[0]!.text), secondPage);
    browser = await chromium.launch({ headless: true }); const context = await browser.newContext(); const page = await context.newPage();
    await context.route('**/*', async route => {
      if (new URL(route.request().url()).origin !== sandbox.origin) return route.abort();
      const response = await sandbox.fetchTls(route.request().url(), { method: route.request().method(), headers: await route.request().allHeaders(), body: route.request().postData() });
      const headers: Record<string, string> = {}; response.headers.forEach((value, key) => { headers[key] = value; });
      await route.fulfill({ status: response.status, headers, body: Buffer.from(await response.arrayBuffer()) });
    });
    await page.goto(sandbox.origin); await page.getByLabel('个人读取凭据').fill(beta.readerCredential); await page.getByRole('button', { name: '进入存档', exact: true }).click();
    await page.getByRole('button', { name: '日工作', exact: true }).click();
    const panel = page.getByRole('region', { name: '日工作', exact: true });
    await panel.getByLabel('员工', { exact: true }).selectOption(alpha.employeeId); await panel.getByLabel('来源日期').fill(date);
    await expect(panel).toContainText(`不可变版本标识：${report.version}`); await expect(panel).toContainText('合成演示，非正式验收');
    await panel.getByRole('button', { name: '读取本版更多主题', exact: true }).click();
    await expect(panel.getByRole('button', { name: '读取本版更多主题', exact: true })).toHaveCount(0);
    await expect(panel).toContainText('背景或其他项目引用（不计本项活动）'); await expect(panel).toContainText('主题关联为推断');
    await panel.getByRole('link', { name: /核查本日原句/ }).first().click(); await expect(page.getByRole('region', { name: '命中证据', exact: true })).toContainText('本日核查🛰');
    await writeFile(join(root, 'daily-public-evidence.json'), JSON.stringify({ report, betaReport, queued, nativeRequests: fixture.requests, provider: 'synthetic loopback; no paid request', logs, stderr }, null, 2));
    console.log(`Public daily report native evidence: ${root}`);
  } finally {
    await client?.close(); await browser?.close(); await stop(child); fixture.server.closeAllConnections();
    if (fixture.server.listening) await new Promise<void>(resolve => fixture.server.close(() => resolve())); await sandbox.close();
  }
});

