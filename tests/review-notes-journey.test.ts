import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { chromium, expect, type Browser } from '@playwright/test';
import { assessmentFixture } from './assessment-fixture.js';
const params = (object: object) => new URLSearchParams(Object.entries(object).map(([key, value]) => [key, String(value)]));

test('a colleague adds profile context through Web and shared OAuth MCP reads it without changing the assessment', { timeout: 180_000 }, async () => {
  const sandbox = await assessmentFixture();
  const directory = process.env.SKYNET_NOTES_EVIDENCE_DIR ?? join(sandbox.directory, 'review-notes-evidence');
  let client: Client | undefined, browser: Browser | undefined;
  await mkdir(directory, { recursive: true });
  try {
    const subject = await sandbox.owner('复核画像员工'), colleague = await sandbox.owner('背景备注作者');
    for (let index = 0; index < 3; index++) await sandbox.session(subject, { prompts: 3 });
    const path = '/api/assessments/' + subject.employeeId, notesPath = `/api/employees/${subject.employeeId}/review-notes`;
    const api = (path: string, init: RequestInit = {}) => sandbox.nativeApi(path, colleague.readerCredential, init);
    const before = await (await api(path)).json(); assert.equal(before.index, 73);
    const json = (value: object) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
    const resource = sandbox.origin + '/mcp', registration = await (await api('/oauth/register', json({ client_name: 'Review notes reader', redirect_uris: ['http://127.0.0.1:47125/callback'], token_endpoint_auth_method: 'none' }))).json();
    const verifier = randomBytes(48).toString('base64url');
    const callback = new URL(await sandbox.authorizationPage(sandbox.origin + '/oauth/authorize?' + params({ response_type: 'code', client_id: registration.client_id,
      redirect_uri: registration.redirect_uris[0], scope: 'archive:read', resource, state: randomUUID(), code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url') }), colleague.readerCredential));
    const token = await (await api('/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params({ grant_type: 'authorization_code',
      client_id: registration.client_id, code: callback.searchParams.get('code'), redirect_uri: registration.redirect_uris[0], code_verifier: verifier, resource }).toString() })).json();
    client = new Client({ name: 'review-notes-public', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(resource), { fetch: sandbox.fetchTls, requestInit: { headers: { Authorization: `Bearer ${token.access_token}` } } }));
    async function call(name: string, args: Record<string, unknown>) {
      const response = await client!.callTool({ name, arguments: args }); assert.notEqual(response.isError, true, JSON.stringify(response));
      return JSON.parse((response.content as { text: string }[])[0]!.text);
    }
    assert.deepEqual(await call('read_assessment', { employeeId: subject.employeeId }), before);
    assert.deepEqual(await call('read_review_notes', { employeeId: subject.employeeId }), { employeeId: subject.employeeId, notes: [], count: 0, nextCursor: null });
    browser = await chromium.launch(); const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 } });
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(sandbox.origin + '/#profile?employeeId=' + subject.employeeId + '&version=' + before.version);
    await page.getByLabel('个人读取凭据').fill(colleague.readerCredential); await page.getByRole('button', { name: '进入存档', exact: true }).click();
    await expect(page.getByTestId('assessment-index')).toHaveText('73');
    const section = page.getByRole('region', { name: '复核备注', exact: true });
    await expect(section).toContainText('暂无备注');
    const text = '本周以方案评审为主。\n<img src=x onerror=alert(1)> 原文作为普通文本保留。';
    await section.getByLabel('备注内容').fill(text);
    let failed = false;
    await page.route('**/api/employees/*/review-notes', async route => {
      if (route.request().method() === 'POST' && !failed) { failed = true; await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '保存暂时不可用' }) }); }
      else await route.continue();
    });
    await section.getByRole('button', { name: '保存备注', exact: true }).click();
    await expect(section.getByRole('alert')).toContainText('保存暂时不可用'); await expect(section.getByLabel('备注内容')).toHaveValue(text);
    await section.getByRole('button', { name: '保存备注', exact: true }).focus(); await page.keyboard.press('Enter');
    await expect(section.getByLabel('备注内容')).toHaveValue(''); await expect(section).toContainText('背景备注作者');
    await expect(section.locator('.review-note-text')).toHaveText(text); await expect(section.locator('img')).toHaveCount(0);
    const notes = await (await api(notesPath)).json(); assert.equal(notes.count, 1);
    assert.equal(notes.notes[0].author.id, colleague.employeeId); assert.equal(notes.notes[0].assessmentVersion, before.version);
    assert.match(notes.notes[0].createdAt, /\+08:00$/);
    assert.deepEqual(await call('read_review_notes', { employeeId: subject.employeeId }), notes);
    assert.deepEqual(await call('read_assessment', { employeeId: subject.employeeId }), before);
    assert.deepEqual(await (await api(path)).json(), before);
    assert.deepEqual(await (await api(path + '/export?version=' + before.version)).json(), before);
    const shots: string[] = [];
    for (const width of [1280, 320]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ['light', 'dark']) {
        await page.evaluate(t => { document.documentElement.dataset.theme = t; }, theme);
        await section.scrollIntoViewIfNeeded();
        const filename = join(directory, `review-notes-${width}-${theme}.png`); await page.screenshot({ path: filename, animations: 'disabled' }); shots.push(filename);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight));
        const targets = await section.locator('button, a, textarea').evaluateAll(elements => elements.map(element => { const r = element.getBoundingClientRect(); return { width: r.width, height: r.height }; }));
        assert.ok(targets.every(target => target.width >= 44 && target.height >= 44), JSON.stringify(targets));
      }
    }
    const download = page.waitForEvent('download'); await page.getByRole('button', { name: '导出评估', exact: true }).click();
    assert.deepEqual(JSON.parse(await readFile((await (await download).path())!, 'utf8')), before);
    await client.close(); client = undefined; await sandbox.restart(); await page.reload();
    await page.getByLabel('个人读取凭据').fill(colleague.readerCredential); await page.getByRole('button', { name: '进入存档', exact: true }).click();
    await expect(section).toContainText('背景备注作者'); assert.deepEqual(await (await api(notesPath)).json(), notes);
    assert.deepEqual(await (await api(path)).json(), before); assert.deepEqual(errors, []);
    await writeFile(join(directory, 'public-result.json'), JSON.stringify({ assessment: before, notes, shots, errors, notifications: 'No notification or HR action path is added by this feature.' }, null, 2));
  } finally { await client?.close(); await browser?.close(); await sandbox.close(); }
});
