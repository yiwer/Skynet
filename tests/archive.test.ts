import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import { chromium, type Browser } from '@playwright/test';
import { createSandbox, syntheticSession } from './support.js';

test('public enrollment → local hook → background → committed archive → authenticated browser survives restart', { timeout: 180_000 }, async () => {
  const sandbox = await createSandbox();
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
    const settings = JSON.parse(await readFile(join(state, 'settings.json'), 'utf8'));
    const api = (path: string, credential?: string, init: RequestInit = {}) => fetch(`${origin}${path}`, {
      ...init, headers: { ...init.headers, ...(credential ? { Authorization: `Bearer ${credential}` } : {}) },
    });
    assert.equal((await api('/api/sessions')).status, 401);
    assert.equal((await api('/api/sessions', settings.deviceCredential)).status, 401);
    assert.deepEqual((await (await api('/api/sessions', reader.readerCredential)).json()).sessions, []);

    const stage = Buffer.from('raw material not committed');
    const stageHash = createHash('sha256').update(stage).digest('hex');
    assert.equal((await api(`/api/chunks/${stageHash}`, settings.deviceCredential, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: stage })).status, 201);
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
    assert.equal((await api('/api/snapshots', settings.deviceCredential, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...detail.manifest, employeeId: reader.employeeId }) })).status, 400, 'ownership cannot be supplied by uploader');
    const repeated = await (await api('/api/snapshots', settings.deviceCredential, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(detail.manifest) })).json();
    assert.equal(repeated.snapshotId, id);
    const absent = { ...detail.manifest, hash: 'a'.repeat(64) };
    assert.equal((await api('/api/snapshots', settings.deviceCredential, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(absent) })).status, 409);
    assert.equal((await api(`/api/chunks/${stageHash}`, settings.deviceCredential, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: Buffer.from('wrong') })).status, 422);

    await sandbox.stopCollector();
    await sandbox.stopServer();
    origin = await sandbox.startServer(previousPort);
    assert.deepEqual(Buffer.from(await (await api(`/api/snapshots/${id}/raw`, reader.readerCredential)).arrayBuffer()), source.bytes, 'raw bytes persist across server process restart');
    assert.equal((await api(`/api/snapshots/${id}/raw`)).status, 401);
    await sandbox.collectorCommand('hook', state, { ...source.event, transcript_path: null });
    const status = JSON.parse(await sandbox.collectorCommand('status', state));
    assert.match(status['hook-gap.json'].error, /could not be queued/);

    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(origin);
    await page.getByLabel('个人读取凭据').fill(reader.readerCredential);
    await page.getByRole('button', { name: '进入存档' }).click();
    await page.getByRole('link').filter({ hasText: '合成员工甲' }).click();
    await page.getByText('合成工具结果：3 tests passed', { exact: false }).waitFor();
    assert.equal(await page.evaluate(() => (window as any).archiveInjected), undefined, 'source content is inert text');
    await page.getByText('Desktop 原生能力待验证', { exact: false }).waitFor();
    await page.screenshot({ path: join(sandbox.directory, 'archive-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 375, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.screenshot({ path: join(sandbox.directory, 'archive-mobile.png'), fullPage: true });
    await page.getByRole('button', { name: '退出', exact: true }).click();
    await page.getByRole('button', { name: '进入存档' }).waitFor();
    assert.equal(await page.getByText('合成工具结果：3 tests passed', { exact: false }).count(), 0);
    console.log(`Evidence screenshots: ${sandbox.directory}`);
  } finally { await browser?.close(); await sandbox.close(); }
});
