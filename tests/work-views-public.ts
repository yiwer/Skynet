import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import { chromium, expect, type Browser,type Page } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { mcpSandbox } from './mcp-support.js';
import { analysisFixture } from './analysis-fixture.js';
import { stop } from './support.js';
import { connect, digest } from '../apps/server/database.js';
import { readAnalysisConfig, publicConfig } from '../apps/analysis/config.js';
import { analysisQueue } from '../apps/analysis/queue.js';
import { executeAnalysis } from '../apps/analysis/execute.js';
import type { AnalysisInput } from '../apps/server/analysis.js';
import { beijingDate } from '../packages/contracts/reports.js';
import { addDays, monday, type WorkView, type WorkViewSelection } from '../packages/contracts/work-views.js';

export function findings(input: AnalysisInput) {
  const categories = ['topic', 'goal', 'activity', 'outcome', 'blocker', 'next'] as const;
  return { items: input.events.flatMap((event, index) => event.text.startsWith('共同主题') ? categories.map(category => ({ category,
    assessment: category === 'activity' || category === 'topic' ? 'inferred' : 'claimed', text: category === 'topic' ? '共同主题跨日延续' : `${category}：${event.text}`,
    citations: [{ event: index, textOffset: 0, quote: event.text }] })) : []).slice(0, 28) };
}
function inputFrom(body: any): AnalysisInput {
  for (const message of body.messages) for (const block of typeof message.content === 'string' ? [{ text: message.content }] : message.content) {
    if (typeof block.text !== 'string') continue; const start = block.text.indexOf('{"warning":');
    if (start >= 0) return JSON.parse(block.text.slice(start, block.text.lastIndexOf('}') + 1));
  }
  throw new Error('Missing archived input');
}
export type WorkViewsExtension=(context:{sandbox:Awaited<ReturnType<typeof mcpSandbox>>;alpha:{employeeId:string;readerCredential:string};beta:{employeeId:string;readerCredential:string};original:{snapshotId:string;bytes:Buffer};sunday:string;nextMonday:string;tuesday:string;week:string;project:WorkView;previous:WorkView;client:Client;page:Page;drain:()=>Promise<void>;queue:ReturnType<typeof analysisQueue>;config:Awaited<ReturnType<typeof readAnalysisConfig>>;native:boolean})=>Promise<unknown>;
export async function workViewsPublic(native: boolean,extension?:WorkViewsExtension) {
  const runtime = process.env.SKYNET_CLAUDE_RUNTIME; if (native) assert.ok(runtime, 'Explicit Claude 2.1.281, loopback only');
  const week = addDays(monday(beijingDate()), 7); const sunday = addDays(week, 6); const nextMonday = addDays(week, 7); const tuesday = addDays(week, 8);
  let now = new Date(`${sunday}T12:00:00+08:00`);
  const sandbox = await mcpSandbox({ reportClock: () => now }); const db = connect(sandbox.env.DATABASE_URL!);
  console.log(`Weekly/project isolated fixture: ${sandbox.directory}`);
  const fixture = analysisFixture((body: unknown) => findings(inputFrom(body)), join(sandbox.directory, 'MUST_NOT_EXIST'));
  let worker: ChildProcess | undefined; let browser: Browser | undefined; let client: Client | undefined; let logs = ''; let errors = '';
  const json = (value: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  try {
    fixture.server.listen(0, '127.0.0.1'); await once(fixture.server, 'listening');
    const configPath = join(sandbox.directory, 'work-view-analysis.json');
    await writeFile(configPath, JSON.stringify({ mode: 'fixture', executable: native ? runtime : process.execPath, runtimeVersion: '2.1.281',
      model: 'claude-sonnet-4-5', workDirectory: join(sandbox.directory, 'jobs'), fixtureOrigin: `http://127.0.0.1:${(fixture.server.address() as { port: number }).port}`,
      budgetId: 'weekly-synthetic', budgetCny: 0, inputCnyPerMillion: 0, outputCnyPerMillion: 0, maxRequests: 3, maxOutputTokens: 4096,
      maxAttempts: 1, timeoutSeconds: 30, autoAnalyzeUpdates: false, ...(native && process.platform === 'win32' ? { gitBashPath: 'C:/Program Files/Git/bin/bash.exe' } : {}) }));
    const config = await readAnalysisConfig(configPath); const queue = analysisQueue(db, config, 'weekly-test');
    async function startAnalysis() { if (native) {
      worker = spawn(process.execPath, ['dist/apps/analysis/worker.js'], { env: { ...sandbox.env, SKYNET_ANALYSIS_CONFIG: configPath }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      worker.stdout!.on('data', part => { logs += part; }); worker.stderr!.on('data', part => { errors += part; });
      for (let i = 0; i < 60 && !logs.includes('worker ready') && worker.exitCode === null; i++) await setTimeout(500);
      assert.match(logs, /worker ready/, errors);
    } else await db.query('INSERT INTO analysis_workers(id,config) VALUES($1,$2)', ['weekly-test', publicConfig(config)]); }
    const alpha = await sandbox.provision('合成周工作甲'); const beta = await sandbox.provision('合成周工作乙');
    const enroll = async (employee: typeof alpha) => (await sandbox.api('/api/devices/enroll', employee.enrollmentCredential, json({ installationId: randomUUID(), name: 'weekly synthetic' }))).json();
    const a = await enroll(alpha); const b = await enroll(beta);
    async function upload(device: typeof a, project: string, entries: { date: string; text: string }[], extra = false) {
      const sessionId = randomUUID(); const bytes = Buffer.from(JSON.stringify({ type: 'session_meta', payload: { id: sessionId, cli_version: '0.157.1', cwd: project } }) + '\n'
        + entries.map(entry => JSON.stringify({ timestamp: new Date(`${entry.date}T23:00:00+08:00`).toISOString(), type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: entry.text }] } })).join('\n') + '\n'
        + (extra ? '{"type":"unrecognized_future_row","retain":"原件🛰"}\n' : ''));
      const hash = digest(bytes); assert.equal((await sandbox.api(`/api/chunks/${hash}`, device.deviceCredential, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes })).status, 201);
      const response = await sandbox.api('/api/snapshots', device.deviceCredential, json({ protocolVersion: 1, source: 'codex-cli', sourceVersion: '0.157.1', sourceOs: 'win32', sourceSessionId: sessionId,
        project, hash, byteLength: bytes.length, qualifiedAt: new Date().toISOString(), capability: 'unverified' }));
      assert.equal(response.status, 200, await response.clone().text()); return { ...await response.json(), bytes };
    }
    const original = await upload(a, '/synthetic/shared-weekly', [{ date: sunday, text: '共同主题 周日甲目标' }, { date: nextMonday, text: '共同主题 周一甲推进' }, { date: tuesday, text: '共同主题 周二甲阻塞待继续' }], true);
    await upload(b, '/synthetic/shared-weekly', [{ date: sunday, text: '共同主题 周日乙推进' }, { date: nextMonday, text: '共同主题 周一乙成果声称' }]);
    await upload(a, '/synthetic/other-weekly', [{ date: sunday, text: '共同主题 其他项目' }]);
    await upload(a, '', [{ date: nextMonday, text: '共同主题 未归类项目' }]);
    const weekly = (from: string): WorkViewSelection => ({ kind: 'weekly', subject: alpha.employeeId, from, to: addDays(from, 6) });
    const path = (selection: WorkViewSelection, extra = '') => `/api/work-view?${new URLSearchParams(selection)}${extra}`;
    assert.equal((await sandbox.api(path(weekly(week)))).status, 401);
    assert.equal((await sandbox.api(path(weekly(week)), a.deviceCredential, json({}))).status, 401);
    assert.equal((await sandbox.api(path(weekly(week)), beta.readerCredential, json({ clock: '2099-01-01' }))).status, 400);
    assert.equal((await sandbox.api(path({ ...weekly(week), from: sunday }), beta.readerCredential)).status, 400);
    assert.equal((await sandbox.api(path({ kind: 'project', subject: '', from: sunday, to: addDays(sunday, 31) }), beta.readerCredential, json({}))).status, 422);
    async function drain() {
      if (native) return; await db.query("UPDATE analysis_workers SET updated_at=now() WHERE id='weekly-test'");
      for (let i = 0; i < 10; i++) {
        const job = await queue.claim(); if (!job) break;
        const result = await executeAnalysis(config, job.input, new AbortController().signal, () => queue.allowForward(job), async (_config, input, _signal, forward) => {
          assert.equal(await forward!(), true); return { output: findings(input), usage: { inputTokens: 100, outputTokens: 20, runtimeCostUsd: null, providerBilledCny: null, requests: 1 } };
        }); assert.equal(await queue.finish(job, result), true);
      }
    }
    async function wait(selection: WorkViewSelection, expectedRecords: number | null) {
      for (let i = 0; i < 120; i++) {
        await drain(); const response = await sandbox.api(path(selection), beta.readerCredential); assert.equal(response.status, 200);
        const report = await response.json() as WorkView;
        if (report.version && (report.items.length || expectedRecords === null) && !report.refreshPending && report.statistics?.records === expectedRecords && !['queued', 'waiting-analysis'].includes(report.state)) return report;
        await setTimeout(500);
      }
      throw new Error(`${sandbox.directory}; ${errors}; ${JSON.stringify(await (await sandbox.api(path(selection), beta.readerCredential)).json())}`);
    }
    // Only the trusted reporting calendar advances. Inputs, enrollment and provenance
    // use normal public paths. There are no manager per-session or weekly POSTs here.
    now = new Date(`${nextMonday}T09:00:00+08:00`);
    let offline: WorkView | undefined;
    for (let i = 0; i < 40; i++) {
      const value: WorkView = await (await sandbox.api(path(weekly(week)), beta.readerCredential)).json();
      if (value.version && value.coverage?.days.some(day => day.state === 'unavailable')) { offline = value; break; }
      await setTimeout(500);
    }
    assert.ok(offline, 'due weekly period persists while the runtime is offline'); assert.equal(offline.items.length, 0);
    await startAnalysis();
    const previous = await wait(weekly(week), 2); assert.equal(previous.state, 'partial', 'unknown original rows remain partial');
    assert.equal((await (await sandbox.api(path(weekly(week), `&revision=${offline.revision}`), beta.readerCredential)).json()).version, offline.version);
    assert.ok(previous.items.every(item => item.sourceDate === sunday && item.employeeId === alpha.employeeId));
    assert.ok(previous.items.every(item => item.category !== 'outcome' || item.assessment === 'claimed'));
    const operations = await (await sandbox.api('/api/analysis/operations', beta.readerCredential)).json();
    assert.ok(operations.runs.length >= 3); assert.ok(operations.runs.every((run: any) => run.actorKind === 'system' && run.actorId === null));
    const previousFixed = await (await sandbox.api(path(weekly(week), `&revision=${previous.revision}`), beta.readerCredential)).json();
    now = new Date(`${addDays(nextMonday, 7)}T09:00:00+08:00`);
    const next = await wait(weekly(nextMonday), 3); assert.equal(next.from, nextMonday); assert.equal(next.to, addDays(nextMonday, 6));
    assert.ok(next.items.every(item => item.sourceDate !== sunday)); assert.equal(next.state, 'partial');
    assert.ok(next.items.filter(item => item.project === '/synthetic/shared-weekly').every(item => item.theme === '共同主题跨日延续'));
    const fullRange = { kind: 'project', subject: '/synthetic/shared-weekly', from: sunday, to: tuesday } as const;
    assert.equal((await sandbox.api(path(fullRange), beta.readerCredential, json({}))).status, 202);
    const project = await wait(fullRange, 5); assert.equal(project.participants.length, 2); assert.equal(project.statistics!.tokens, null);
    const more = project.nextOffset === null ? null : await (await sandbox.api(path(fullRange, `&revision=${project.revision}&offset=${project.nextOffset}`), beta.readerCredential)).json();
    const all = [...project.items, ...(more?.items ?? [])]; assert.equal(all.length, 30);
    assert.ok(all.every(item => item.project === fullRange.subject)); assert.equal(new Set(all.map(item => item.sourceDate)).size, 3); assert.equal(new Set(all.map(item => item.employeeId)).size, 2);
    assert.ok(all.every(item => item.dailyRevision > 0 && item.dailyVersion && item.dailyPath.includes(`revision=${item.dailyRevision}`)));
    const unclassified = { kind: 'project', subject: '', from: nextMonday, to: tuesday } as const;
    assert.equal((await sandbox.api(path(unclassified), alpha.readerCredential, json({}))).status, 202);
    const empty = await wait(unclassified, 1); assert.equal(empty.subjectLabel, '未归类项目'); assert.ok(empty.items.every(item => item.project === ''));
    const projectsResponse = await sandbox.api('/api/work-projects', beta.readerCredential); assert.equal(projectsResponse.status, 200, await projectsResponse.clone().text());
    assert.ok((await projectsResponse.json()).projects.some((entry: any) => entry.project === ''));
    const absent = { kind: 'project', subject: '/synthetic/unknown-project', from: sunday, to: tuesday } as const;
    assert.equal((await sandbox.api(path(absent), beta.readerCredential, json({}))).status, 202);
    // The shared refresh lock may leave even an empty selection queued initially.
    // Verify its durable public result through the same bounded wait as populated views.
    const absentView = await wait(absent, null);
    assert.equal(absentView.state, 'partial'); assert.equal(absentView.statistics.records, null); assert.deepEqual(absentView.participants, []); assert.deepEqual(absentView.items, []);
    await sandbox.restart();
    assert.deepEqual(await (await sandbox.api(path(weekly(week), `&revision=${previous.revision}`), beta.readerCredential)).json(), previousFixed);
    assert.deepEqual(await (await sandbox.api(path(fullRange, `&revision=${project.revision}`), beta.readerCredential)).json(), { ...project, refreshPending: false });
    const registration = await (await sandbox.api('/oauth/register', undefined, json({ client_name: 'weekly evidence', redirect_uris: ['http://127.0.0.1:47123/callback'], token_endpoint_auth_method: 'none' }))).json();
    const verifier = randomBytes(48).toString('base64url'); const resource = `${sandbox.origin}/mcp`;
    const callback = new URL(await sandbox.authorizationPage(`${sandbox.origin}/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id: registration.client_id, redirect_uri: registration.redirect_uris[0], scope: 'archive:read', resource,
      state: randomUUID(), code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url') })}`, beta.readerCredential));
    const token = await (await sandbox.api('/oauth/token', undefined, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', client_id: registration.client_id,
      code: callback.searchParams.get('code')!, redirect_uri: registration.redirect_uris[0], code_verifier: verifier, resource }).toString() })).json();
    client = new Client({ name: 'weekly-test', version: '1' }); await client.connect(new StreamableHTTPClientTransport(new URL(resource), { fetch: sandbox.fetchTls, requestInit: { headers: { Authorization: `Bearer ${token.access_token}` } } }));
    const result = await client.callTool({ name: 'read_work_view', arguments: { ...weekly(week), revision: previous.revision } });
    assert.notEqual(result.isError, true); assert.deepEqual(JSON.parse((result.content as { text: string }[])[0]!.text), previousFixed);
    const projectResult = await client.callTool({ name: 'read_work_view', arguments: { ...fullRange, revision: project.revision, offset: project.nextOffset! } });
    assert.deepEqual(JSON.parse((projectResult.content as { text: string }[])[0]!.text), more);
    browser = await chromium.launch({ headless: true }); const context = await browser.newContext(); const page = await context.newPage();
    await context.route('**/*', async route => { if (new URL(route.request().url()).origin !== sandbox.origin) return route.abort(); const response = await sandbox.fetchTls(route.request().url(), { method: route.request().method(), headers: await route.request().allHeaders(), body: route.request().postData() });
      const headers: Record<string, string> = {}; response.headers.forEach((value, key) => { headers[key] = value; }); await route.fulfill({ status: response.status, headers, body: Buffer.from(await response.arrayBuffer()) }); });
    await page.goto(`${sandbox.origin}/#work?${new URLSearchParams({ ...fullRange, revision: String(project.revision) })}`);
    await page.getByLabel('个人读取凭据').fill(beta.readerCredential); await page.getByRole('button', { name: '进入存档', exact: true }).click();
    const panel = page.getByRole('region', { name: '周工作与项目', exact: true });
    await panel.locator('summary').filter({ hasText: '版本与来源' }).click();
    assert.ok(project.version, 'the visible fixed report retains an immutable version');
    await expect(panel).toContainText(project.version);
    await expect(panel.getByRole('link', { name: '本版永久链接', exact: true })).toHaveAttribute('href', new RegExp(`revision=${project.revision}$`));
    await expect(panel).toContainText('合成周工作甲'); await expect(panel).toContainText('合成周工作乙'); await expect(panel).toContainText('会话内成果');
    await panel.getByRole('button', { name: '更多事项', exact: true }).click(); await expect(panel).toContainText('待继续事项');
    await panel.getByRole('link', { name: /日报 v/ }).first().click();
    const daily = page.getByRole('region', { name: '日工作', exact: true }); await expect(daily.getByLabel('历史版本（留空读取最新）')).not.toHaveValue('');
    const evidence = daily.locator('details.report-evidence').first();
    await evidence.locator('summary').click();
    await evidence.getByRole('link').first().click(); await expect(page.getByRole('region', { name: '命中证据', exact: true })).toContainText('共同主题');
    assert.deepEqual(Buffer.from(await (await sandbox.api(`/api/snapshots/${original.snapshotId}/raw`, beta.readerCredential)).arrayBuffer()), original.bytes);
    const extensionEvidence=await extension?.({sandbox,alpha,beta,original,sunday,nextMonday,tuesday,week,project,previous,client,page,drain,queue,config,native});
    await writeFile(join(sandbox.directory, 'work-view-public-evidence.json'), JSON.stringify({ native, reportingCalendar: 'trusted synthetic Sunday→Monday→next Monday, not real elapsed weeks', offline, previous, next, project, more, empty,
      extensionEvidence,
      originalBytesUnchanged: true, analysisActors: operations.runs.map((run: any) => ({ actorId: run.actorId, actorKind: run.actorKind })), nativeRequests: fixture.requests.length, logs, errors, provider: 'synthetic loopback only; no Qwen/PAYG' }, null, 2));
    console.log(`Weekly/project public evidence: ${sandbox.directory}`);
  } finally { await client?.close(); await browser?.close(); await stop(worker); fixture.server.closeAllConnections(); if (fixture.server.listening) await new Promise<void>(resolve => fixture.server.close(() => resolve())); await db.end(); await sandbox.close(); }
}
