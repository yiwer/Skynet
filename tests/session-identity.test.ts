import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, expect, type Browser } from '@playwright/test';
import { createSandbox } from './support.js';

const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

test('same-name employees remain distinct in public session lists, employee filters and recovery exports', { timeout: 120_000 }, async () => {
  const sandbox = await createSandbox(); let browser: Browser | undefined;
  console.log(`Session identity evidence directory: ${sandbox.directory}`);
  try {
    const name = '同名合成员工';
    const alpha = await sandbox.provision(name); const beta = await sandbox.provision(name);
    assert.notEqual(alpha.employeeId, beta.employeeId);
    const origin = await sandbox.startServer();
    const api = (path: string, token = alpha.readerCredential, init: RequestInit = {}) => fetch(origin + path, {
      ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` },
    });
    async function upload(owner: typeof alpha, project: string) {
      const response = await api('/api/devices/enroll', owner.enrollmentCredential, json({ installationId: randomUUID(), name: project }));
      assert.equal(response.status, 200, await response.clone().text()); const device = await response.json();
      const sessionId = randomUUID(); const timestamp = new Date().toISOString();
      const bytes = Buffer.from(JSON.stringify({ type: 'user', sessionId, uuid: randomUUID(), version: '2.1.281', timestamp,
        message: { role: 'user', content: `NAME_IDENTITY ${project} 的独立原件` } }) + '\n');
      const staged = await api(`/api/chunks/${hash(bytes)}`, device.deviceCredential, {
        method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(bytes),
      });
      assert.equal(staged.status, 201, await staged.clone().text());
      const committed = await api('/api/snapshots', device.deviceCredential, json({ protocolVersion: 1, sourceSessionId: sessionId,
        source: 'claude-code-cli', sourceVersion: '2.1.281', sourceOs: process.platform, project: `/synthetic/${project}`,
        hash: hash(bytes), byteLength: bytes.length, qualifiedAt: timestamp, capability: 'unverified' }));
      assert.equal(committed.status, 200, await committed.clone().text());
      return { employeeId: owner.employeeId as string, snapshotId: (await committed.json()).snapshotId as string, sessionId, project, bytes };
    }
    const originals = [await upload(alpha, 'name-alpha'), await upload(beta, 'name-beta')];
    const sessionsResponse = await api('/api/sessions'); assert.equal(sessionsResponse.status, 200);
    const sessions = (await sessionsResponse.json()).sessions as Array<{ id: string; employee: string; employeeId: string }>;
    assert.equal(sessions.length, 2);
    for (const original of originals) {
      const session = sessions.find(value => value.id === original.snapshotId)!;
      assert.equal(session.employee, name); assert.equal(session.employeeId, original.employeeId);
    }
    const searchResponse = await api('/api/search?content=NAME_IDENTITY'); assert.equal(searchResponse.status, 200);
    const hits = (await searchResponse.json()).hits as Array<{ id: string; employee: string; employeeId: string }>;
    assert.equal(hits.length, 2);
    for (const original of originals) {
      const hit = hits.find(value => value.id === original.snapshotId)!;
      assert.equal(hit.employee, name); assert.equal(hit.employeeId, original.employeeId);
    }

    browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
    const pageErrors: string[] = []; page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(origin + '/#sessions');
    await page.getByLabel('个人读取凭据').fill(alpha.readerCredential); await page.getByRole('button', { name: '进入存档', exact: true }).click();
    const list = page.getByRole('region', { name: '会话列表', exact: true });
    const employeeSelect = list.getByRole('combobox', { name: /^员工/ });
    await expect(employeeSelect.locator('option')).toHaveCount(3);
    const labels: string[] = [];
    for (const original of originals) {
      const option = employeeSelect.locator(`option[value="${original.employeeId}"]`);
      await expect(option).toContainText(name); labels.push((await option.textContent())!);
      await employeeSelect.selectOption(original.employeeId);
      await expect(list.getByRole('link')).toHaveCount(1);
      await expect(list.getByRole('link')).toHaveAttribute('href', `#${original.snapshotId}`);
      await expect(list.getByRole('link')).toContainText(original.sessionId);
    }
    assert.equal(new Set(labels).size, 2, 'same-name employee choices must be distinguishable to the person selecting them');
    await employeeSelect.selectOption(''); await expect(list.getByRole('link')).toHaveCount(2);
    await page.screenshot({ path: join(sandbox.directory, 'same-name-session-list.png'), fullPage: true, animations: 'disabled' });

    await page.getByRole('navigation', { name: '平台页面', exact: true }).getByRole('button', { name: '会话找回', exact: true }).click();
    const recovery = page.getByRole('region', { name: '会话找回', exact: true });
    const people = recovery.getByRole('group', { name: '选择员工', exact: true });
    const selections = [];
    for (const original of originals) {
      await expect(people.getByRole('button')).toHaveCount(2);
      const person = people.getByRole('button').filter({ hasText: original.employeeId.slice(0, 8) });
      await expect(person).toContainText(name); await person.click(); await expect(person).toHaveAttribute('aria-pressed', 'true');
      const slots = recovery.getByRole('region', { name: '选择会话', exact: true });
      await expect(slots.getByRole('button')).toHaveCount(1);
      await expect(slots.getByRole('button')).toContainText(original.project);
      await expect(slots).not.toContainText(originals.find(value => value.employeeId !== original.employeeId)!.project);
      await page.screenshot({ path: join(sandbox.directory, `${original.project}-recovery-selection.png`), fullPage: true, animations: 'disabled' });
      await slots.getByRole('button').click(); await recovery.getByRole('button', { name: '下一步 →', exact: true }).click();
      await expect(recovery.getByRole('link', { name: '阅读会话', exact: true })).toHaveAttribute('href', `#${original.snapshotId}`);
      await expect(recovery).toContainText(hash(original.bytes));
      await recovery.getByRole('button', { name: '下一步 →', exact: true }).click();
      const downloadPending = page.waitForEvent('download');
      await recovery.getByRole('button', { name: '下载原件 JSONL', exact: true }).click();
      const download = await downloadPending; const path = join(sandbox.directory, `${original.project}.jsonl`);
      await download.saveAs(path); assert.deepEqual(await readFile(path), original.bytes);
      selections.push({ employeeId: original.employeeId, snapshotId: original.snapshotId, sha256: hash(original.bytes) });
      await recovery.getByRole('list', { name: '找回步骤', exact: true }).getByRole('button', { name: /选择会话/ }).click();
    }
    assert.deepEqual(pageErrors, []);
    await writeFile(join(sandbox.directory, 'session-identity-evidence.json'), JSON.stringify({ name, selections,
      sameNameDifferentIds: true, publicSearchAndListAgree: true, distinctVisibleChoices: true, filtersDoNotMerge: true,
      recoveryOriginalBytesExact: true, pageErrors }, null, 2));
  } finally { try { await browser?.close(); } finally { await sandbox.close(); } }
});
