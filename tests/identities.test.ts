import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { chromium, expect, type Browser } from '@playwright/test';
import { createSandbox } from './support.js';

test('Web account/device revocation preserves shared history and enforces every credential boundary with auditable retries', { timeout: 180_000 }, async () => {
  const sandbox = await createSandbox(); let browser: Browser | undefined;
  try {
    const alpha = await sandbox.provision('合成员工甲');
    const beta = await sandbox.provision('合成员工乙');
    const manager = await sandbox.provision('合成身份维护者', true);
    assert.equal(alpha.canManageIdentities, false); assert.equal(beta.canManageIdentities, false);
    let origin = await sandbox.startServer();
    const api = (path: string, token?: string, init: RequestInit = {}) => fetch(`${origin}${path}`, {
      ...init, headers: { ...init.headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
    const post = (path: string, token: string, body: unknown = {}) => api(path, token, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const enroll = async (employee: any, name: string) => {
      const response = await post('/api/devices/enroll', employee.enrollmentCredential, { installationId: randomUUID(), name });
      assert.equal(response.status, 200); return response.json();
    };
    const a1 = await enroll(alpha, '甲电脑一'); const a2 = await enroll(alpha, '甲电脑二');
    const b1 = await enroll(beta, '乙电脑一'); const b2 = await enroll(beta, '乙电脑二');
    const managementDevice = await enroll(manager, '维护者上传设备');
    const makeArtifact = (label: string) => {
      const sessionId = randomUUID();
      const bytes = Buffer.from([
        { timestamp: '2026-09-28T01:02:03Z', type: 'session_meta', payload: { id: sessionId, cli_version: '0.157.1' } },
        { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: label }] } },
      ].map(item => JSON.stringify(item)).join('\n') + '\n');
      return { bytes, manifest: { protocolVersion: 1, sourceSessionId: sessionId, source: 'codex-cli', sourceVersion: '0.157.1',
        sourceOs: process.platform, project: '/synthetic/identity', hash: createHash('sha256').update(bytes).digest('hex'),
        byteLength: bytes.length, qualifiedAt: new Date().toISOString(), capability: 'unverified' } };
    };
    const stage = (device: any, artifact: ReturnType<typeof makeArtifact>) => api(`/api/chunks/${artifact.manifest.hash}`, device.deviceCredential,
      { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: artifact.bytes });
    const upload = async (device: any, label: string) => {
      const artifact = makeArtifact(label); assert.equal((await stage(device, artifact)).status, 201);
      const response = await post('/api/snapshots', device.deviceCredential, artifact.manifest); assert.equal(response.status, 200);
      return { ...artifact, ...(await response.json()) };
    };
    const archived = await upload(a1, '甲设备一的历史材料仍可核查');
    await upload(a2, '甲设备二的历史材料'); await upload(b1, '乙设备一的历史材料'); await upload(b2, '乙设备二的历史材料');
    const pending = makeArtifact('停用前暂存而未提交的材料'); assert.equal((await stage(a1, pending)).status, 201);
    const snapshotPath = `/api/snapshots/${archived.snapshotId}`;
    for (const employee of [alpha, beta]) {
      const shared = await (await api('/api/sessions', employee.readerCredential)).json();
      assert.equal(shared.sessions.length, 4);
      assert.deepEqual(new Set(shared.sessions.map((item: any) => item.employee)), new Set(['合成员工甲', '合成员工乙']));
      assert.equal((await (await api('/api/me', employee.readerCredential)).json()).canManageIdentities, false);
    }
    const stopA = `/api/identities/employees/${alpha.employeeId}/disable`;
    const stopA1 = `/api/identities/devices/${a1.deviceId}/disable`;
    for (const [token, status] of [[undefined, 401], [a1.deviceCredential, 401], [managementDevice.deviceCredential, 401], [alpha.readerCredential, 403], [beta.readerCredential, 403]] as const) {
      assert.equal((await api('/api/identities', token)).status, status);
      assert.equal((await api('/api/identity-audit', token)).status, status);
      assert.equal((await api(stopA, token, { method: 'POST' })).status, status);
      assert.equal((await api(stopA1, token, { method: 'POST' })).status, status);
    }
    assert.equal((await api('/api/sessions', a1.deviceCredential)).status, 401);
    assert.equal((await api(snapshotPath + '/recovery', a1.deviceCredential)).status, 401);
    assert.equal((await post('/api/devices/enroll', alpha.enrollmentCredential, { installationId: randomUUID(), name: '伪装授权', canManageIdentities: true })).status, 400);
    assert.equal((await post('/api/devices/enroll', alpha.enrollmentCredential, { installationId: randomUUID(), name: '伪装归属', employeeId: beta.employeeId })).status, 400);
    assert.equal((await post('/api/snapshots', a1.deviceCredential, { ...pending.manifest, employeeId: beta.employeeId })).status, 400);
    assert.equal((await post(`/api/identities/employees/${beta.employeeId}/disable`, manager.readerCredential, { actorId: alpha.employeeId })).status, 400);
    assert.equal((await post(`/api/identities/devices/${randomUUID()}/disable`, manager.readerCredential)).status, 404);

    browser = await chromium.launch();
    const login = async (token: string, snapshot = '') => {
      const page = await browser!.newPage({ viewport: { width: 1440, height: 1000 } });
      await page.goto(origin + (snapshot ? `/#${snapshot}` : ''));
      await page.getByLabel('个人读取凭据').fill(token); await page.getByRole('button', { name: '进入存档' }).click();
      await expect(page.getByRole('navigation', { name: '平台页面', exact: true }).getByRole('button', { name: '会话', exact: true })).toBeEnabled(); return page;
    };
    const alphaPage = await login(alpha.readerCredential, archived.snapshotId);
    const alphaDownloadPage = await login(alpha.readerCredential, archived.snapshotId);
    await alphaPage.getByRole('navigation', { name: '平台页面', exact: true }).getByRole('button', { name: '接入与设备', exact: true }).click();
    await expect(alphaPage.getByRole('region', { name: '设备同步状态', exact: true })).toBeVisible();
    await expect(alphaPage.getByRole('region', { name: '接入与设备维护', exact: true })).toHaveCount(0);
    await expect(alphaPage.getByRole('button', { name: /停用设备|停用账号/ })).toHaveCount(0);
    await alphaDownloadPage.getByText('原件与来源信息', { exact: true }).click();
    await alphaDownloadPage.getByRole('button', { name: '下载原件', exact: true }).waitFor();
    const page = await login(manager.readerCredential);
    await page.getByRole('button', { name: '接入与设备', exact: true }).click();
    const management = page.getByRole('region', { name: '接入与设备维护' });
    const alphaCard = page.getByRole('region', { name: '账号 合成员工甲', exact: true });
    const firstDevice = alphaCard.getByRole('listitem', { name: '设备 甲电脑一', exact: true });
    await firstDevice.getByRole('button', { name: '停用设备' }).click();
    await expect(page.getByText('仅此设备的后续上传被拒绝', { exact: false })).toBeVisible();
    await page.route(`**${stopA1}`, route => route.fulfill({ status: 503, body: 'Synthetic maintenance failure' }), { times: 1 });
    await page.getByRole('button', { name: '确认停用', exact: true }).click();
    await expect(management.getByRole('alert')).toBeVisible();
    await expect(firstDevice.getByText('可上传', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '确认停用', exact: true }).click();
    await expect(firstDevice.getByText('设备已停用', { exact: true })).toBeVisible();
    await expect(firstDevice.getByRole('button', { name: '停用设备' })).toBeDisabled();
    await expect(alphaCard.getByRole('listitem', { name: '设备 甲电脑二' }).getByText('可上传', { exact: true })).toBeVisible();
    assert.equal((await stage(a1, pending)).status, 401);
    assert.equal((await post('/api/snapshots', a1.deviceCredential, pending.manifest)).status, 401, 'already staged data cannot be committed after revocation');
    assert.equal((await api('/api/me', alpha.readerCredential)).status, 200);
    await upload(a2, '单设备停用后另一个设备仍能上传');
    const a3 = await enroll(alpha, '甲新接入设备');
    const repeated = await Promise.all(Array.from({ length: 4 }, () => post(stopA1, manager.readerCredential)));
    for (const response of repeated) { assert.equal(response.status, 200); assert.equal((await response.json()).changed, false); }
    let history = await (await api('/api/identity-audit', manager.readerCredential)).json();
    assert.equal(history.events.length, 1, 'duplicate concurrent requests do not duplicate audit entries');
    assert.equal(history.events[0].actorId, manager.employeeId); assert.equal(history.events[0].deviceId, a1.deviceId);
    await alphaCard.getByRole('button', { name: '停用账号' }).click();
    await expect(page.getByText('该账号的读取、下载、新设备接入和全部设备上传将被拒绝', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: '确认停用', exact: true }).click();
    await expect(alphaCard.getByText('已停用', { exact: true })).toBeVisible();
    await expect(alphaCard.getByRole('listitem', { name: '设备 甲电脑二' }).getByText('账号已停用，上传被拒绝')).toBeVisible();
    await page.getByRole('region', { name: '身份维护记录' }).getByText('停用账号：合成员工甲', { exact: false }).waitFor();

    const deniedDownload = alphaDownloadPage.waitForResponse(response => response.url().endsWith(`${snapshotPath}/raw`));
    await alphaDownloadPage.getByRole('button', { name: '下载原件', exact: true }).click();
    assert.equal((await deniedDownload).status(), 401);
    await alphaDownloadPage.getByRole('button', { name: '进入存档' }).waitFor();
    // Exercise the list refresh alone; a selected snapshot would also refresh and
    // could receive its own 401 before the deliberately held list response.
    await alphaPage.getByRole('navigation', { name: '平台页面', exact: true }).getByRole('button', { name: '会话', exact: true }).click();
    await expect(alphaPage.getByRole('button', { name: '下载原件', exact: true })).toHaveCount(0);
    await expect(alphaPage.getByRole('region', { name: '会话列表', exact: true })).toBeVisible();
    // Keep the real revoked response pending until the refresh has visibly entered its
    // loading state. Logout aborts that request's effect, so its finally cannot reset busy.
    let releaseRevocation!: () => void;
    const revocationHeld = new Promise<void>(resolve => { releaseRevocation = resolve; });
    await alphaPage.route('**/api/sessions', async route => {
      const response = await route.fetch(); assert.equal(response.status(), 401);
      await revocationHeld; await route.fulfill({ response });
    }, { times: 1 });
    await alphaPage.getByRole('button', { name: '刷新存档' }).click();
    try { await expect(alphaPage.getByRole('button', { name: '正在刷新…', exact: true })).toBeDisabled(); }
    finally { releaseRevocation(); }
    await expect(alphaPage.getByRole('button', { name: '进入存档', exact: true })).toBeVisible();
    assert.equal(await alphaPage.getByText('甲设备一的历史材料仍可核查', { exact: true }).count(), 0, 'revoked login clears in-page archive data when a request is rejected');
    await alphaPage.getByLabel('个人读取凭据').fill(beta.readerCredential);
    await expect(alphaPage.getByRole('button', { name: '进入存档', exact: true })).toBeEnabled();
    await alphaPage.getByRole('button', { name: '进入存档', exact: true }).click();
    await expect(alphaPage.getByRole('button', { name: '刷新存档', exact: true })).toBeEnabled();
    await alphaPage.locator(`a[href="#${archived.snapshotId}"]`).click();
    await expect(alphaPage.getByRole('region', { name: '对话阅读', exact: true }).getByText('甲设备一的历史材料仍可核查', { exact: true })).toBeVisible();
    for (const path of ['/api/me', '/api/sessions', snapshotPath, `${snapshotPath}/raw`, `${snapshotPath}/readable`, `${snapshotPath}/recovery`]) {
      assert.equal((await api(path, alpha.readerCredential)).status, 401);
    }
    assert.equal((await post('/api/devices/enroll', alpha.enrollmentCredential, { installationId: randomUUID(), name: '应拒绝的新设备' })).status, 401);
    for (const device of [a1, a2, a3]) {
      assert.equal((await stage(device, pending)).status, 401);
      assert.equal((await post('/api/snapshots', device.deviceCredential, pending.manifest)).status, 401);
    }
    await upload(b1, '另一个员工设备一继续上传'); await upload(b2, '另一个员工设备二继续上传');
    assert.deepEqual(Buffer.from(await (await api(`${snapshotPath}/raw`, beta.readerCredential)).arrayBuffer()), archived.bytes);
    const exportPackage = await (await api(`${snapshotPath}/recovery`, beta.readerCredential)).json();
    assert.equal(exportPackage.snapshot.employee, '合成员工甲');
    assert.deepEqual(Buffer.from(exportPackage.artifact.data, 'base64'), archived.bytes);
    assert.ok((await (await api(`${snapshotPath}/readable`, beta.readerCredential)).text()).includes('甲设备一的历史材料仍可核查'));
    assert.equal((await post(stopA, manager.readerCredential)).status, 200);
    history = await (await api('/api/identity-audit', manager.readerCredential)).json();
    assert.equal(history.events.length, 2);
    assert.ok(history.events.every((item: any) => item.actorId === manager.employeeId && item.employeeId === alpha.employeeId && !Number.isNaN(Date.parse(item.occurredAt))));
    const identitiesResponse = await (await api('/api/identities', manager.readerCredential)).json();
    const serialized = JSON.stringify({ history, identitiesResponse });
    for (const token of [alpha.readerCredential, alpha.enrollmentCredential, beta.readerCredential, manager.readerCredential, a1.deviceCredential, a2.deviceCredential]) assert.equal(serialized.includes(token), false);
    assert.equal(serialized.includes('_hash'), false);
    await page.screenshot({ path: join(sandbox.directory, 'identity-maintenance-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 375, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.screenshot({ path: join(sandbox.directory, 'identity-maintenance-mobile.png'), fullPage: true });
    const previousPort = Number(new URL(origin).port); await sandbox.stopServer(); origin = await sandbox.startServer(previousPort);
    assert.equal((await api('/api/me', alpha.readerCredential)).status, 401);
    assert.equal((await api('/api/me', beta.readerCredential)).status, 200);
    assert.equal((await (await api('/api/identity-audit', manager.readerCredential)).json()).events.length, 2);
    assert.deepEqual(Buffer.from(await (await api(`${snapshotPath}/raw`, beta.readerCredential)).arrayBuffer()), archived.bytes);
    console.log(`Identity maintenance public-flow evidence: ${sandbox.directory}`);
  } finally { try { await browser?.close(); } finally { await sandbox.close(); } }
});
