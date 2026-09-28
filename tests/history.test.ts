import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { appendFile, mkdir, readFile, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, expect, type Browser } from '@playwright/test';
import { createSandbox } from './support.js';
import { sourceSchema } from '../packages/contracts/archive.js';

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const jsonl = (records: unknown[]) => Buffer.from(records.map(item => JSON.stringify(item)).join('\r\n') + '\r\n');

function record(source: string, id: string, role: string, text: string, timestamp: unknown) {
  if (source === 'claude-code-cli') {
    const content = role === 'tool request' ? [{ type: 'tool_use', id: text, name: 'SyntheticTool', input: { marker: text } }]
      : role === 'tool result' ? [{ type: 'tool_result', tool_use_id: 'old-tool', content: text }]
        : [{ type: 'text', text }, ...(role === 'user' ? [{ type: 'text', text: '(same native message)' }] : [])];
    const type = role === 'tool request' ? 'assistant' : role === 'tool result' ? 'user' : role;
    return { type, timestamp, sessionId: id, uuid: randomUUID(), version: '2.1.281', message: { role: type, content } };
  }
  const payload = role === 'tool request' ? { type: 'function_call', name: 'SyntheticTool', call_id: text, arguments: '{}' }
    : role === 'tool result' ? { type: 'function_call_output', call_id: 'old-tool', output: text }
      : { type: 'message', role, content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }] };
  return { type: 'response_item', timestamp, payload };
}

test('resuming one old conversation preserves source dates, sends verified appends and exports complete snapshots for every registered source', { timeout: 240_000 }, async () => {
  const sandbox = await createSandbox();
  let browser: Browser | undefined;
  let upstream = await sandbox.startServer();
  const transfers: { path: string; bytes: number; status: number }[] = [];
  let rejectOneAppend = false;
  const proxy = createServer(async (request, response) => {
    try {
      const parts: Buffer[] = []; for await (const part of request) parts.push(Buffer.from(part));
      const body = Buffer.concat(parts); const path = request.url!;
      if (rejectOneAppend && path === '/api/snapshots/append') {
        rejectOneAppend = false; transfers.push({ path, bytes: body.length, status: 409 });
        response.writeHead(409, { 'Content-Type': 'application/json' }); response.end('{"error":"synthetic unconfirmed base"}'); return;
      }
      const result = await fetch(`${upstream}${path}`, { method: request.method,
        headers: { ...(request.headers.authorization ? { Authorization: request.headers.authorization } : {}),
          ...(request.headers['content-type'] ? { 'Content-Type': request.headers['content-type'] } : {}) },
        ...(body.length ? { body } : {}) });
      transfers.push({ path, bytes: body.length, status: result.status });
      response.writeHead(result.status, { 'Content-Type': result.headers.get('content-type') ?? 'application/json' });
      response.end(Buffer.from(await result.arrayBuffer()));
    } catch { response.writeHead(502); response.end(); }
  });
  try {
    proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening');
    const proxyOrigin = `http://127.0.0.1:${(proxy.address() as { port: number }).port}`;
    const employee = await sandbox.provision('历史续用合成员工');
    const reader = await sandbox.provision('历史续用合成读者');
    const api = (path: string, credential = reader.readerCredential, init: RequestInit = {}) => fetch(`${upstream}${path}`, {
      ...init, headers: { ...init.headers, Authorization: `Bearer ${credential}` },
    });
    const detail = async (id: string) => (await api(`/api/snapshots/${id}`)).json();
    const raw = async (id: string) => Buffer.from(await (await api(`/api/snapshots/${id}/raw`)).arrayBuffer());
    const results: { snapshotId: string; bytes: Buffer }[] = [];
    for (const source of sourceSchema.options as readonly string[]) {
      const state = join(sandbox.directory, `${source}-collector`);
      const nativeRoot = join(sandbox.directory, source, 'sessions'); await mkdir(nativeRoot, { recursive: true });
      const id = randomUUID(); const path = join(nativeRoot, `${id}.jsonl`);
      const older = '2000-01-01T15:59:59.000Z'; const nextBeijingDay = '2000-01-01T16:00:00.000Z';
      const oldRecords = [
        ...(source === 'claude-code-cli' ? [] : [{ type: 'session_meta', timestamp: older, payload: { id, cli_version: source === 'codex-cli' ? '0.157.1' : '0.158.0-alpha.2.1' } }]),
        ...Array.from({ length: 121 }, (_, index) => record(source, id, 'user', `old-context-${index}`, index === 120 ? nextBeijingDay : older)),
        record(source, id, 'tool request', 'old-tool', older), record(source, id, 'tool result', 'historical tool result', older),
        record(source, id, 'assistant', 'unknown-time preserved', undefined), record(source, id, 'assistant', 'invalid-time preserved', 'not-a-date'),
      ];
      const original = jsonl(oldRecords); await writeFile(path, original);
      const untouched = [join(nativeRoot, `${randomUUID()}.jsonl`), join(nativeRoot, `${randomUUID()}.jsonl`)];
      for (const uncontinued of untouched) await writeFile(uncontinued, original);
      await sandbox.collectorCommand('setup', state, { server: proxyOrigin, enrollmentCredential: employee.enrollmentCredential,
        nativeRoot, source, sourceVersion: source === 'codex-desktop' ? '26.924.2738.0' : source === 'codex-cli' ? '0.157.1' : '2.1.281', sourceOs: process.platform });
      // Existing history and even a fresh directory mtime never qualify a conversation.
      for (const uncontinued of untouched) await utimes(uncontinued, new Date(), new Date());
      assert.equal(JSON.parse(await sandbox.collectorCommand('run', state)).tracked, 0);
      const resumed = jsonl([record(source, id, 'user', 'new-turn-one', new Date().toISOString()),
        record(source, id, 'tool request', 'new-tool-one', new Date().toISOString())]);
      await appendFile(path, resumed); const firstBytes = Buffer.concat([original, resumed]);
      await sandbox.collectorCommand('hook', state, { hook_event_name: 'UserPromptSubmit', session_id: id, transcript_path: path, cwd: `/synthetic/${source}` });
      transfers.length = 0;
      const firstStatus = JSON.parse(await sandbox.collectorCommand('run', state));
      assert.deepEqual(firstStatus.errors, []); assert.equal(firstStatus.uploadedBytes, firstBytes.length); assert.equal(firstStatus.appended, 0);
      assert.deepEqual(transfers.filter(t => t.path.startsWith('/api/chunks')).map(t => t.bytes), [firstBytes.length]);
      const find = async () => (await (await api('/api/sessions')).json()).sessions.filter((session: any) => session.source === source);
      let sessions = await find(); assert.equal(sessions.length, 1, 'only the continued conversation is uploaded');
      const firstId = sessions[0].id; const first = await detail(firstId);
      assert.equal(first.events.length, 100, 'activity summary covers the whole snapshot, not just the page');
      assert.equal(first.activity.today.counts.userTurns, 1, 'old context and multi-block messages do not inflate new user turns');
      assert.equal(first.activity.today.counts.toolCalls, 1);
      assert.equal(first.activity.unknownTimeRecords, 2);
      assert.deepEqual(first.activity.days.filter((day: any) => day.date.startsWith('2000')).map((day: any) => day.date), ['2000-01-01', '2000-01-02']);
      assert.ok(first.activity.historicalRecords >= 123); assert.equal(first.events[0].context, 'historical');
      assert.equal(first.events[0].timestamp, older); assert.deepEqual(await raw(firstId), firstBytes);

      // An incomplete last record is transferred as bytes, then completed by another append.
      const next = jsonl([record(source, id, 'user', 'new-turn-two', new Date().toISOString())]);
      const split = Math.floor(next.length / 2); const prefix = next.subarray(0, split); const suffix = next.subarray(split);
      await appendFile(path, prefix); transfers.length = 0;
      const partialStatus = JSON.parse(await sandbox.collectorCommand('run', state));
      assert.equal(partialStatus.appended, 1); assert.equal(partialStatus.uploadedBytes, prefix.length);
      assert.deepEqual(transfers.filter(t => t.path.startsWith('/api/chunks')).map(t => t.bytes), [prefix.length]);
      const partialId = (await find())[0].id; const partial = await detail(partialId);
      assert.equal(partial.partialLine, true); assert.equal(partial.activity.today.counts.userTurns, 1);
      assert.deepEqual(await raw(firstId), firstBytes, 'an append cannot mutate a previously committed snapshot');
      await appendFile(path, suffix); transfers.length = 0;
      const nextStatus = JSON.parse(await sandbox.collectorCommand('run', state));
      assert.deepEqual(nextStatus.errors, []); assert.equal(nextStatus.appended, 1); assert.equal(nextStatus.uploadedBytes, suffix.length);
      assert.deepEqual(transfers.filter(t => t.path.startsWith('/api/chunks')).map(t => t.bytes), [suffix.length]);
      const nextId = (await find())[0].id; const updated = await detail(nextId); const complete = Buffer.concat([firstBytes, next]);
      assert.equal(updated.partialLine, false); assert.equal(updated.activity.today.counts.userTurns, 2);
      assert.deepEqual(await raw(nextId), complete);
      const bundle = await (await api(`/api/snapshots/${nextId}/recovery`)).json();
      assert.deepEqual(Buffer.from(bundle.artifact.data, 'base64'), complete, 'server export contains original context and all appended bytes');
      assert.equal(bundle.manifest.enrolledAt, first.manifest.enrolledAt);
      const readable = await (await api(`/api/snapshots/${nextId}/readable`)).text();
      assert.ok(readable.includes('old-context-0') && readable.includes('historical tool result') && readable.includes('new-turn-two'));
      assert.ok(readable.includes('来源时间：未知')); assert.ok(readable.endsWith(complete.toString('utf8')));

      // Replay an already committed append and reject cross-source/device/unconfirmed bases.
      const settings = JSON.parse(await readFile(join(state, 'settings.json'), 'utf8'));
      const appendRequest = { manifest: updated.manifest, baseSnapshotId: partialId, baseHash: partial.manifest.hash,
        baseByteLength: partial.manifest.byteLength, appendHash: hash(suffix), appendByteLength: suffix.length };
      const post = (body: unknown, credential = settings.deviceCredential) => api('/api/snapshots/append', credential,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      assert.equal((await (await post(appendRequest)).json()).snapshotId, nextId, 'repeated append acknowledges the same immutable snapshot');
      assert.equal((await post({ ...appendRequest, baseSnapshotId: randomUUID() })).status, 409);
      assert.equal((await post({ ...appendRequest, manifest: { ...updated.manifest, sourceSessionId: randomUUID() } })).status, 409);
      assert.equal((await post({ ...appendRequest, manifest: { ...updated.manifest, source: source === 'claude-code-cli' ? 'codex-desktop' : 'claude-code-cli' } })).status, 409);
      const other = await (await api('/api/devices/enroll', employee.enrollmentCredential, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ installationId: randomUUID(), name: 'different device' }) })).json();
      assert.equal((await post(appendRequest, other.deviceCredential)).status, 409);
      assert.equal((await post({ ...appendRequest, manifest: { ...updated.manifest, hash: 'a'.repeat(64) } })).status, 422);
      assert.equal((await find())[0].id, nextId, 'failed append never publishes a partial or incorrect snapshot');
      const claimed = await api('/api/snapshots', settings.deviceCredential, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...updated.manifest, enrolledAt: '1999-01-01T00:00:00.000Z' }) });
      assert.equal((await claimed.json()).snapshotId, nextId, 'client-supplied enrollment cannot reclassify historical work');

      const last = jsonl([record(source, id, 'assistant', 'fallback still preserves old context', new Date().toISOString())]);
      await appendFile(path, last); rejectOneAppend = true; transfers.length = 0;
      const fullBytes = Buffer.concat([complete, last]);
      const fallback = JSON.parse(await sandbox.collectorCommand('run', state));
      assert.deepEqual(fallback.errors, []); assert.equal(fallback.appended, 0);
      assert.deepEqual(transfers.filter(t => t.path.startsWith('/api/chunks')).map(t => t.bytes), [last.length, fullBytes.length]);
      const finalId = (await find())[0].id; assert.deepEqual(await raw(finalId), fullBytes);
      for (const uncontinued of untouched) await appendFile(uncontinued, '\n');
      assert.equal(JSON.parse(await sandbox.collectorCommand('run', state)).committed, 0);
      assert.equal((await find()).length, 1); results.push({ snapshotId: finalId, bytes: fullBytes });
    }
    assert.equal((await (await api('/api/sessions')).json()).sessions.length, sourceSchema.options.length);
    const port = Number(new URL(upstream).port); await sandbox.stopServer(); upstream = await sandbox.startServer(port);
    for (const result of results) {
      assert.deepEqual(await raw(result.snapshotId), result.bytes);
      assert.equal((await detail(result.snapshotId)).activity.today.counts.userTurns, 2);
      const secondExport = await (await api(`/api/snapshots/${result.snapshotId}/recovery`)).json();
      assert.deepEqual(Buffer.from(secondExport.artifact.data, 'base64'), result.bytes);
    }
    browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(`${upstream}#${results.at(-1)!.snapshotId}`);
    await page.getByLabel('个人读取凭据').fill(reader.readerCredential); await page.getByRole('button', { name: '进入存档' }).click();
    const activity = page.getByRole('region', { name: '来源日期与活动' });
    await expect(activity).toContainText('用户轮次 2 · 工具调用 1');
    await activity.getByText('按来源日期查看', { exact: true }).click(); await expect(activity).toContainText('2000-01-02');
    await expect(page.locator('.message').first()).toContainText('历史上下文');
    let nextOffset = (await detail(results.at(-1)!.snapshotId)).nextOffset;
    while (nextOffset !== null) {
      const response = page.waitForResponse(value => value.url().endsWith(`?offset=${nextOffset}`));
      await page.getByRole('button', { name: '下一页' }).click();
      const nextPage = await (await response).json(); nextOffset = nextPage.nextOffset;
      await expect(page.locator('.message').first()).toContainText(`原件第 ${nextPage.events[0].line} 行`);
      await expect(activity).toContainText('用户轮次 2 · 工具调用 1');
    }
    await expect(page.locator('.message').filter({ hasText: 'unknown-time preserved' })).toContainText('来源时间：未知');
    await expect(page.locator('.message').filter({ hasText: 'new-turn-two' }).first()).toContainText('接入后活动');
    await page.screenshot({ path: join(sandbox.directory, 'history-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 375, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: join(sandbox.directory, 'history-mobile.png'), fullPage: true });
    console.log(`History synthetic API/UI evidence: ${sandbox.directory}; host calls are simulated, native-client acceptance is separate.`);
  } finally {
    proxy.closeAllConnections(); await new Promise<void>(resolve => proxy.close(() => resolve()));
    try { await browser?.close(); } finally { await sandbox.close(); }
  }
});
