import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import { chromium, expect, type Browser } from '@playwright/test';
import { createSandbox, syntheticSession } from './support.js';

test('public enrollment → local hook → background → committed archive → authenticated browser survives restart', { timeout: 180_000 }, async () => {
  const sandbox = await createSandbox();
  console.log(`Archive public fixture: ${sandbox.directory}`);
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch();
    const employee = await sandbox.provision('合成员工甲');
    const reader = await sandbox.provision('合成读者乙');
    let origin = await sandbox.startServer();
    const state = join(sandbox.directory, 'collector');
    const sourceRoot = join(sandbox.directory, 'native-sessions');
    const source = await syntheticSession(sourceRoot);
    await syntheticSession(sourceRoot); // Existing unrelated history must never be discovered by scanning.
    await sandbox.collectorCommand('setup', state, { server: origin, enrollmentCredential: employee.enrollmentCredential,
      nativeRoot: sourceRoot, sourceVersion: 'synthetic-fixture-1', sourceOs: process.platform });
    const api = (path: string, credential?: string, init: RequestInit = {}) => fetch(`${origin}${path}`, {
      ...init, headers: { ...init.headers, ...(credential ? { Authorization: `Bearer ${credential}` } : {}) },
    });
    // Separate synthetic device uses the public enrollment contract; CLI state stays private.
    const apiEmployee = await sandbox.provision('合成接口验证员工');
    const enrollment = await api('/api/devices/enroll', apiEmployee.enrollmentCredential, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ installationId: randomUUID(), name: 'synthetic-api-device' }),
    });
    assert.equal(enrollment.status, 200);
    const { deviceCredential } = await enrollment.json();
    assert.equal((await api('/api/sessions')).status, 401);
    assert.equal((await api('/api/sessions', deviceCredential)).status, 401);
    assert.deepEqual((await (await api('/api/sessions', reader.readerCredential)).json()).sessions, []);

    const stage = Buffer.from('raw material not committed');
    const stageHash = createHash('sha256').update(stage).digest('hex');
    assert.equal((await api(`/api/chunks/${stageHash}`, deviceCredential, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: stage })).status, 201);
    assert.equal((await api(`/api/chunks/${stageHash}`, reader.readerCredential, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: stage })).status, 401);
    assert.deepEqual((await (await api('/api/sessions', reader.readerCredential)).json()).sessions, []);
    assert.equal((await api(`/api/snapshots/${randomUUID()}`, reader.readerCredential)).status, 404);

    const previousPort = Number(new URL(origin).port);
    await sandbox.stopServer();
    // Public host hook invocation completes successfully while the platform is unreachable.
    assert.equal(await sandbox.collectorCommand('hook', state, source.event), '');
    origin = await sandbox.startServer(previousPort);
    await sandbox.startCollector(state);
    let sessions: any[] = [];
    for (let attempt = 0; attempt < 60; attempt++) {
      sessions = (await (await api('/api/sessions', reader.readerCredential)).json()).sessions;
      if (sessions.length) break;
      await setTimeout(250);
    }
    assert.equal(sessions.length, 1, 'only the host-qualified session is captured');
    assert.equal(sessions[0].employee, '合成员工甲', 'server-owned device binding determines employee');
    const id = sessions[0].id;
    const detail = await (await api(`/api/snapshots/${id}`, reader.readerCredential)).json();
    assert.equal(detail.state, 'committed');
    assert.equal(detail.manifest.capability, 'unverified');
    assert.equal(detail.events.length, 4);
    assert.equal(detail.unrecognizedLines, 1);
    assert.equal(detail.partialLine, true);
    assert.deepEqual(Buffer.from(await (await api(`/api/snapshots/${id}/raw`, reader.readerCredential)).arrayBuffer()), source.bytes);
    const responseItem = (payload: unknown) => ({ type: 'response_item', payload });
    const validEvidence = [
      responseItem({ type: 'message', role: 'user', content: [{ type: 'input_text', text: '已知完整消息' }] }),
      responseItem({ type: 'function_call', name: 'shell', arguments: '{}', call_id: 'known-call' }),
      responseItem({ type: 'function_call_output', call_id: 'known-call', output: '' }),
    ];
    const unsupportedEvidence = [
      responseItem({ type: 'function_call', arguments: '{}', call_id: 'missing-name' }),
      responseItem({ type: 'function_call', name: 'shell', call_id: 'missing-arguments' }),
      responseItem({ type: 'function_call', name: 'shell', arguments: '{}' }),
      responseItem({ type: 'function_call', name: 123, arguments: '{}', call_id: 'wrong-name' }),
      responseItem({ type: 'function_call', name: 'shell', arguments: {}, call_id: 'wrong-arguments' }),
      responseItem({ type: 'function_call_output', call_id: 'missing-output' }),
      responseItem({ type: 'function_call_output', call_id: 'wrong-output', output: {} }),
      responseItem({ type: 'function_call_output', call_id: 'mixed-output', output: [
        { type: 'input_text', text: 'Text beside an unsupported image must not masquerade as the complete tool result' },
        { type: 'input_image', image_url: 'synthetic://image' },
      ] }),
      responseItem({ type: 'function_call_output', output: 'missing call ID' }),
      responseItem({ type: 'message', content: [{ type: 'input_text', text: 'missing role' }] }),
      responseItem({ type: 'message', role: 'unknown-role', content: [{ type: 'input_text', text: 'wrong role' }] }),
      responseItem({ type: 'message', role: 'user' }),
      responseItem({ type: 'message', role: 'user', content: [] }),
      responseItem({ type: 'message', role: 'user', content: [{ type: 'input_text', text: 42 }] }),
      responseItem({ type: 'message', role: 'user', content: [{ type: 'input_image', image_url: 'synthetic://image' }] }),
      responseItem({ type: 'message', role: 'user', content: [
        { type: 'input_text', text: '部分文本不能冒充完整消息' }, { type: 'input_image', image_url: 'synthetic://image' },
      ] }),
      { type: 'session_meta', payload: {} },
      { type: 'unknown_future_event' },
      null,
      42,
      'unsupported primitive record',
      [],
    ];
    const malformedBytes = Buffer.from([...validEvidence, ...unsupportedEvidence].map(item => JSON.stringify(item)).join('\n') + '\n{not-json}\n');
    const malformedHash = createHash('sha256').update(malformedBytes).digest('hex');
    const apiManifest = { ...detail.manifest, sourceSessionId: randomUUID(), project: '/synthetic/parser',
      hash: malformedHash, byteLength: malformedBytes.length };
    assert.equal((await api(`/api/chunks/${malformedHash}`, deviceCredential, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: malformedBytes })).status, 201);
    assert.equal((await api('/api/snapshots', deviceCredential, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...apiManifest, employeeId: reader.employeeId }) })).status, 400, 'ownership cannot be supplied by uploader');
    const committed = await (await api('/api/snapshots', deviceCredential, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(apiManifest) })).json();
    assert.equal(committed.state, 'committed');
    const repeated = await (await api('/api/snapshots', deviceCredential, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(apiManifest) })).json();
    assert.equal(repeated.snapshotId, committed.snapshotId);
    const parsed = await (await api(`/api/snapshots/${committed.snapshotId}`, reader.readerCredential)).json();
    assert.equal(parsed.employee, '合成接口验证员工');
    assert.deepEqual(parsed.events.map((event: { line: number; role: string; text: string }) => ({ line: event.line, role: event.role, text: event.text })), [
      { line: 1, role: 'user', text: '已知完整消息' },
      { line: 2, role: 'tool request', text: 'shell\n{}' },
      { line: 3, role: 'tool result', text: '' },
    ]);
    assert.equal(parsed.total, validEvidence.length, 'malformed or partially supported records are not complete events');
    assert.equal(parsed.unrecognizedLines, unsupportedEvidence.length + 1, 'every unsupported source line exposes a gap');
    assert.equal(parsed.partialLine, false);
    assert.deepEqual(Buffer.from(await (await api(`/api/snapshots/${committed.snapshotId}/raw`, reader.readerCredential)).arrayBuffer()), malformedBytes);
    const absent = { ...apiManifest, hash: 'a'.repeat(64) };
    assert.equal((await api('/api/snapshots', deviceCredential, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(absent) })).status, 409);
    assert.equal((await api(`/api/chunks/${stageHash}`, deviceCredential, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: Buffer.from('wrong') })).status, 422);

    await sandbox.stopCollector();
    await sandbox.stopServer();
    origin = await sandbox.startServer(previousPort);
    assert.deepEqual(Buffer.from(await (await api(`/api/snapshots/${id}/raw`, reader.readerCredential)).arrayBuffer()), source.bytes, 'raw bytes persist across server process restart');
    assert.equal((await api(`/api/snapshots/${id}/raw`)).status, 401);
    await sandbox.collectorCommand('hook', state, { ...source.event, transcript_path: null });
    const status = JSON.parse(await sandbox.collectorCommand('status', state));
    assert.match(status['hook-gap.json'].error, /could not be queued/);

    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(origin + '/#sessions');
    await page.getByLabel('个人读取凭据').fill(reader.readerCredential);
    await page.getByRole('button', { name: '进入存档' }).click();
    const detailRegion = page.getByRole('article', { name: '会话详情' });
    await page.route(`**/api/snapshots/${id}?*`, route => route.fulfill({ status: 503, body: 'Temporary synthetic failure' }), { times: 1 });
    const archivedRow = page.getByRole('row').filter({ hasText: '合成员工甲' });
    await archivedRow.getByRole('link').click();
    await expect(page.getByRole('main').getByRole('alert')).toBeVisible();
    await expect(page.getByRole('status')).toHaveCount(0);
    await page.getByRole('button', { name: '重试读取会话' }).click();
    await detailRegion.getByRole('link', { name: '时间线', exact: true }).click();
    await page.getByText('合成工具结果：3 tests passed', { exact: false }).waitFor();
    assert.equal(new URL(page.url()).hash, `#${id}?view=timeline`, 'retry keeps the selected snapshot');
    await expect(page.getByRole('button', { name: '重试读取会话' })).toHaveCount(0);
    // Refresh the current archive list and reopen the same snapshot through its
    // visible row; a second, independent network failure must remain recoverable.
    await detailRegion.getByRole('navigation', { name: '位置' }).getByRole('link', { name: '会话', exact: true }).click();
    await page.getByRole('button', { name: '刷新存档' }).click();
    await page.route(`**/api/snapshots/${id}?*`, route => route.abort('failed'), { times: 1 });
    await archivedRow.getByRole('link').click();
    await expect(page.getByRole('main').getByRole('alert')).toBeVisible();
    await expect(page.getByRole('status')).toHaveCount(0);
    await page.getByRole('button', { name: '重试读取会话' }).click();
    await detailRegion.getByRole('link', { name: '时间线', exact: true }).click();
    await page.getByText('合成工具结果：3 tests passed', { exact: false }).waitFor();
    assert.equal(new URL(page.url()).hash, `#${id}?view=timeline`);
    await expect(page.getByRole('button', { name: '重试读取会话' })).toHaveCount(0);
    assert.equal(await page.evaluate(() => (window as any).archiveInjected), undefined, 'source content is inert text');
    const exports = page.getByRole('complementary', { name: '会话数据与存档' });
    await page.route(`**/api/snapshots/${id}/readable`, route => route.fulfill({ status: 503, body: 'Synthetic export failure' }), { times: 1 });
    await exports.getByRole('button', { name: '导出文本', exact: true }).click();
    const exportError = exports.getByRole('alert').filter({ hasText: '暂时无法读取，请稍后重试。' });
    await expect(exportError).toBeVisible();
    const readableDownload = page.waitForEvent('download');
    await exports.getByRole('button', { name: '导出文本', exact: true }).click();
    const readable = await readableDownload;
    assert.equal(readable.suggestedFilename(), `${id}.txt`);
    assert.ok((await readFile((await readable.path())!, 'utf8')).includes(source.bytes.toString('utf8')), 'browser readable export retains every source line');
    await expect(exportError).toHaveCount(0);
    await detailRegion.getByRole('link', { name: '找回此会话', exact: true }).click();
    await page.getByRole('radio', { name: /恢复资料包/ }).check();
    await page.getByRole('button', { name: '下一步 →', exact: true }).click();
    const recoveryDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: '下载恢复资料包', exact: true }).click();
    const recovery = await recoveryDownload;
    assert.equal(recovery.suggestedFilename(), `${id}.skynet-recovery.json`);
    const bundle = JSON.parse(await readFile((await recovery.path())!, 'utf8'));
    assert.deepEqual(Buffer.from(bundle.artifact.data, 'base64'), source.bytes);
    assert.notEqual(detail.recovery.preparation, 'candidate', 'synthetic Desktop data does not claim native recovery support');
    await page.screenshot({ path: join(sandbox.directory, 'archive-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 375, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.screenshot({ path: join(sandbox.directory, 'archive-mobile.png'), fullPage: true });
    await page.getByRole('button', { name: '打开导航', exact: true }).click();
    await page.getByRole('button', { name: '退出', exact: true }).click();
    await page.getByRole('button', { name: '进入存档' }).waitFor();
    assert.equal(await page.getByText('合成工具结果：3 tests passed', { exact: false }).count(), 0);
    console.log(`Evidence screenshots: ${sandbox.directory}`);
  } finally {
    try { await browser?.close(); } finally { await sandbox.close(); }
  }
});
