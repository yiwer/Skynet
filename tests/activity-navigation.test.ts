import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chromium, expect, type Browser } from '@playwright/test';
import { mcpSandbox } from './mcp-support.js';
import { digest } from '../apps/server/database.js';

test('applying activity filters immediately after changing the date keeps the newly selected date and matching records', { timeout: 120_000 }, async () => {
  const base = new Date(Date.now() + 86400000); base.setUTCHours(2, 0, 0, 0);
  const firstDate = base.toISOString().slice(0, 10), secondDate = new Date(+base + 86400000).toISOString().slice(0, 10);
  const sandbox = await mcpSandbox({ reportClock: () => new Date(+base + 2 * 86400000) });
  let browser: Browser | undefined;
  try {
    const person = await sandbox.provision('日期切换员工'), json = (body: object) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const api = (path: string, init: RequestInit = {}) => sandbox.api(path, person.readerCredential, init);
    const device = await (await sandbox.api('/api/devices/enroll', person.enrollmentCredential, json({ installationId: randomUUID(), name: '日期切换设备' }))).json();
    for (const [date, text] of [[firstDate, '第一天的真实活动'], [secondDate, '第二天的真实活动']] as const) {
      const id = randomUUID(), timestamp = date + 'T02:00:00Z', rows = [{ type: 'session_meta', timestamp, payload: { id } },
        { type: 'response_item', timestamp, payload: { type: 'message', id: randomUUID(), role: 'user', content: [{ type: 'input_text', text }] } }];
      const raw = Buffer.from(rows.map(row => JSON.stringify(row)).join('\n') + '\n');
      assert.ok([200, 201].includes((await sandbox.api('/api/chunks/' + digest(raw), device.deviceCredential, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: raw })).status));
      const response = await sandbox.api('/api/snapshots', device.deviceCredential, json({ protocolVersion: 1, sourceSessionId: id, source: 'codex-cli', sourceVersion: '0.160.0', sourceOs: process.platform,
        project: '/activity/navigation', hash: digest(raw), byteLength: raw.length, qualifiedAt: timestamp, capability: 'unverified' }));
      assert.equal(response.status, 200, await response.clone().text());
    }
    assert.equal((await (await api('/api/activity?date=' + firstDate)).json()).total, 2);
    const initial = await (await api('/api/activity?date=' + secondDate)).json(); assert.equal(initial.total, 2);
    browser = await chromium.launch(); const page = await browser.newPage({ ignoreHTTPSErrors: true });
    await page.goto(sandbox.origin + '/#activity?date=' + secondDate + '&version=' + initial.version);
    await page.getByLabel('个人读取凭据').fill(person.readerCredential); await page.getByRole('button', { name: '进入存档', exact: true }).click();
    await expect(page.locator('.activity-scope')).toContainText(secondDate);
    await expect(page.getByRole('table', { name: '活动记录', exact: true })).toContainText('第二天的真实活动');
    // A date change and immediate submit are public DOM events in one browser task;
    // the hashchange render must not be required before the next user action.
    const navigation = await page.getByLabel('活动日期').evaluate((input, value) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
      const afterChange = location.hash;
      input.closest('form')!.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
      return { afterChange, afterApply: location.hash };
    }, firstDate);
    console.log('activity-date-navigation', JSON.stringify(navigation));
    await expect(page.getByLabel('活动日期')).toHaveValue(firstDate);
    await expect(page.locator('.activity-scope')).toContainText(firstDate);
    await expect(page.getByRole('table', { name: '活动记录', exact: true })).toContainText('第一天的真实活动');
    await expect(page.getByRole('table', { name: '活动记录', exact: true })).not.toContainText('第二天的真实活动');
    assert.equal(new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('date'), firstDate);
  } finally { await browser?.close(); await sandbox.close(); }
});
