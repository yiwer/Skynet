import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { chromium, expect, type Browser } from '@playwright/test';
import { command, createSandbox } from './support.js';

test('actual Linux ENOSPC, EACCES and deleted native originals leave visible persistent coverage gaps while Claude completes', { timeout: 180_000 }, async () => {
  const image = process.env.SKYNET_FAULT_TEST_IMAGE;
  assert.ok(image, 'Set SKYNET_FAULT_TEST_IMAGE to an owned Node 24 image with real Claude Code 2.1.281 on PATH');
  const sandbox = await createSandbox(); const name = `skynet-local-fault-${randomUUID()}`; let created = false; let browser: Browser | undefined;
  try {
    const employee = await sandbox.provision('真实本地故障测试员工'); const reader = await sandbox.provision('共享读取人');
    await command('docker', ['run', '--detach', '--name', name, '--user', '1000:1000', '--publish', '127.0.0.1::3000',
      '--tmpfs', '/fault:rw,size=2m,uid=1000,gid=1000,mode=0700', '--tmpfs', '/work:rw,size=64m,uid=1000,gid=1000,mode=0700',
      '--mount', `type=bind,source=${resolve('.')},target=/skynet,readonly`, '--mount', `type=bind,source=${sandbox.directory},target=/evidence`, image, 'sleep', 'infinity'], process.env); created = true;
    let failure: Error | undefined;
    const operation = command('docker', ['exec', '--interactive', name, 'node', '/skynet/dist/tests/local-faults-linux.js'], process.env,
      JSON.stringify({ database: sandbox.containerDatabaseUrl, enrollment: employee.enrollmentCredential, reader: reader.readerCredential })).catch(error => { failure = error; throw error; });
    void operation.catch(() => undefined);
    let ready: { snapshotId: string } | undefined;
    for (let attempt = 0; attempt < 600; attempt++) {
      if (failure) throw failure;
      try { ready = JSON.parse(await readFile(join(sandbox.directory, 'ready.json'), 'utf8')); break; } catch { await setTimeout(200); }
    }
    assert.ok(ready, 'native fixture did not finish');
    const port = (await command('docker', ['port', name, '3000/tcp'], process.env)).trim().split(':').at(-1);
    const origin = `http://127.0.0.1:${port}`;
    const evidence = JSON.parse(await readFile(join(sandbox.directory, 'native-local-faults-evidence.json'), 'utf8'));
    assert.deepEqual(evidence.actualErrors, ['ENOSPC', 'EACCES', 'ENOENT']); assert.ok(evidence.lostUnarchivedBytes > 0);
    browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(`${origin}#${ready.snapshotId}`); await page.getByLabel('个人读取凭据').fill(reader.readerCredential); await page.getByRole('button', { name: '进入存档' }).click();
    await expect(page.getByRole('region', { name: '后续采集覆盖' })).toContainText('来源已消失');
    await expect(page.getByRole('region', { name: '后续采集覆盖' })).toContainText('故障已恢复，范围未核实');
    await page.screenshot({ path: join(sandbox.directory, 'fault-session-desktop.png'), fullPage: true });
    await page.getByRole('button', { name: '设备同步', exact: true }).click(); await expect(page.getByRole('region', { name: '设备同步状态' })).toContainText('本地存储不足');
    await page.setViewportSize({ width: 375, height: 900 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: join(sandbox.directory, 'fault-device-mobile.png'), fullPage: true });
    await writeFile(join(sandbox.directory, 'finish'), 'verified'); await operation;
    console.log(`Actual native local fault evidence: ${sandbox.directory}`);
  } finally { await browser?.close(); if (created) await command('docker', ['rm', '--force', name], process.env); await sandbox.close(); }
});
