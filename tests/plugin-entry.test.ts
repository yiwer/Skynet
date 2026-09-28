import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, delimiter, join } from 'node:path';
import { appendFile, chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { chromium, expect, type Browser } from '@playwright/test';
import { command, createSandbox } from './support.js';
import { installAgent, stopInstalled } from './installed-support.js';

test('plugin payloads share npm ownership; final entry removal delivers frozen bytes without reading new native activity', { timeout: 180_000 }, async () => {
  const sandbox = await createSandbox(); let state: string | undefined; let browser: Browser | undefined;
  try {
    const home = join(sandbox.directory, 'plugin user with spaces'); const bin = join(home, 'bin');
    for (const path of [bin, join(home, '.codex'), join(home, '.claude'), join(home, 'local'), join(home, 'roaming'), join(home, 'tmp')]) await mkdir(path, { recursive: true });
    for (const [host, label, parts] of [['codex', 'codex-cli 0.157.1', ['@openai', 'codex', 'bin', 'codex.js']],
      ['claude', '2.1.281 (Claude Code)', ['@anthropic-ai', 'claude-code', 'cli.js']]] as const) {
      if (process.platform === 'win32') {
        await writeFile(join(bin, `${host}.cmd`), '@echo off\r\n');
        const script = join(bin, 'node_modules', ...parts); await mkdir(dirname(script), { recursive: true });
        await writeFile(script, `console.log(${JSON.stringify(label)})`);
      } else { const path = join(bin, host); await writeFile(path, `#!${process.execPath}\nconsole.log(${JSON.stringify(label)})\n`); await chmod(path, 0o700); }
    }
    const env: NodeJS.ProcessEnv = { ...Object.fromEntries(['SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramData'].map(key => [key, process.env[key]])),
      PATH: [bin, dirname(process.execPath), ...(process.platform === 'win32' ? [join(process.env.SystemRoot!, 'System32'), join(process.env.SystemRoot!, 'System32', 'WindowsPowerShell', 'v1.0')] : ['/usr/bin', '/bin'])].join(delimiter),
      HOME: home, USERPROFILE: home, LOCALAPPDATA: join(home, 'local'), APPDATA: join(home, 'roaming'), XDG_STATE_HOME: join(home, 'state'),
      CODEX_HOME: join(home, '.codex'), CLAUDE_CONFIG_DIR: join(home, '.claude'), TEMP: join(home, 'tmp'), TMP: join(home, 'tmp') };
    const employee = await sandbox.provision('插件合成员工'); const reader = await sandbox.provision('插件读者'); const origin = await sandbox.startServer();
    const installed = await installAgent(sandbox.directory, origin, env, employee.enrollmentCredential); state = installed.status.stateDirectory;
    const launcher = join(state!, 'skynet-launcher.mjs');
    const packed = JSON.parse(await command(process.execPath, ['dist/apps/collector/cli.js', 'pack-plugins', '--output', join(sandbox.directory, 'plugins release'),
      '--origin', origin, '--deployment', 'isolated-acceptance'], process.env));
    const script = (host: string) => join(packed.directory, 'plugins', `skynet-${host}`, 'scripts', 'skynet.cjs');
    const original = await readFile(join(home, '.claude', 'settings.json'), 'utf8');
    for (const host of ['codex', 'claude']) {
      const status = JSON.parse(await command(process.execPath, [script(host), 'setup'], env));
      assert.equal(status.deviceId, installed.status.deviceId); assert.equal(status.worker.instance, installed.status.worker.instance);
    }
    assert.equal(await readFile(join(home, '.claude', 'settings.json'), 'utf8'), original, 'one host definition regardless of entry count');
    const registered = JSON.parse(await installed.run('status')); assert.equal(registered.entries.length, 3);
    const packageFile = join(packed.directory, 'plugins', 'skynet-claude', 'payload', 'package.json');
    const descriptor = join(packed.directory, 'plugins', 'skynet-claude', 'payload', 'entry.json');
    const packageBefore = await readFile(packageFile, 'utf8'); const entryBefore = await readFile(descriptor, 'utf8');
    await writeFile(packageFile, JSON.stringify({ ...JSON.parse(packageBefore), version: '0.0.1' }));
    await writeFile(descriptor, JSON.stringify({ channel: 'claude-plugin', version: '0.0.1' }));
    await assert.rejects(command(process.execPath, [script('claude'), 'setup'], env), /older than the installed/);
    await writeFile(packageFile, packageBefore); await writeFile(descriptor, entryBefore);
    await command(process.execPath, [launcher, 'entry-remove', '--entry', 'claude-plugin'], env);
    assert.equal(await readFile(join(home, '.claude', 'settings.json'), 'utf8'), original, 'npm still owns Claude');
    const beforeRemoval = JSON.parse(await installed.run('status')); assert.equal(beforeRemoval.worker.instance, registered.worker.instance);
    const id = randomUUID(); const transcript = join(home, '.claude', 'projects', `${id}.jsonl`);
    const record = (text: string) => JSON.stringify({ type: 'user', sessionId: id, uuid: randomUUID(), version: '2.1.281', timestamp: new Date().toISOString(), message: { role: 'user', content: text } }) + '\n';
    await writeFile(transcript, record('已确认初始活动'));
    const hook = JSON.parse(original).hooks.UserPromptSubmit[0].hooks[0];
    await command(hook.command, hook.args, env, JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: id, transcript_path: transcript, cwd: '/synthetic/plugin' }));
    const headers = { Authorization: `Bearer ${reader.readerCredential}` };
    let sessions: any[] = [];
    for (let attempt = 0; attempt < 80; attempt++) { sessions = (await (await fetch(`${origin}/api/sessions`, { headers })).json()).sessions; if (sessions.length) break; await setTimeout(150); }
    assert.equal(sessions.length, 1);
    const sourceState = join(state!, 'sources', 'claude-code-cli');
    await sandbox.stopServer(); await appendFile(transcript, record('离线时已冻结材料'));
    let local: any;
    for (let attempt = 0; attempt < 80; attempt++) {
      local = JSON.parse(await readFile(join(sourceState, 'status.json'), 'utf8'));
      if (local.delivery.pendingSnapshots) break; await setTimeout(150);
    }
    assert.equal(local.delivery.pendingSnapshots, 1);
    const frozen = await readFile(transcript);
    await command(process.execPath, [launcher, 'entry-remove', '--entry', 'npm'], env);
    const disabled = JSON.parse(await installed.run('status'));
    assert.deepEqual(disabled.entries.map((item: any) => item.channel), ['codex-plugin']);
    assert.equal(disabled.clients.find((item: any) => item.source === 'claude-code-cli').configured, false);
    assert.equal(JSON.parse(await readFile(join(home, '.claude', 'settings.json'), 'utf8')).hooks.UserPromptSubmit.length, 0);
    await appendFile(transcript, record('移除后不得新增采集的内容'));
    // A stale already-loaded host may still invoke its old command. It may queue
    // metadata, but the removed source must not read new bytes from disk.
    await command(hook.command, hook.args, env, JSON.stringify({ hook_event_name: 'Stop', session_id: id, transcript_path: transcript, cwd: '/synthetic/plugin' }));
    await sandbox.startServer(Number(new URL(origin).port));
    await command(process.execPath, [launcher, 'retry', '--state', sourceState], env);
    for (let attempt = 0; attempt < 100; attempt++) {
      local = JSON.parse(await readFile(join(sourceState, 'status.json'), 'utf8'));
      if (local.delivery.pendingSnapshots === 0) break; await setTimeout(150);
    }
    assert.equal(local.delivery.pendingSnapshots, 0); assert.equal(local.capture, 'disabled; frozen-delivery-only');
    sessions = (await (await fetch(`${origin}/api/sessions`, { headers })).json()).sessions; assert.equal(sessions.length, 1);
    const raw = Buffer.from(await (await fetch(`${origin}/api/snapshots/${sessions[0].id}/raw`, { headers })).arrayBuffer()); assert.deepEqual(raw, frozen);
    const history = await (await fetch(`${origin}/api/snapshots/${sessions[0].id}/history`, { headers })).json(); assert.equal(history.snapshots.length, 2);
    await rename(packed.directory, `${packed.directory} cache unavailable`);
    assert.equal(JSON.parse(await installed.run('status')).deviceId, registered.deviceId);
    browser = await chromium.launch(); const page = await browser.newPage(); await page.goto(origin); await page.getByLabel('个人读取凭据').fill(reader.readerCredential);
    await page.getByRole('button', { name: '进入存档' }).click();
    await page.getByRole('link', { name: /插件合成员工 Claude Code CLI/ }).click();
    await expect(page.getByText('离线时已冻结材料', { exact: false })).toBeVisible();
    await page.getByText('接入设备 · npm / 插件安装说明', { exact: true }).click();
    await expect(page.getByText('当前插件同样要求 Node 24。', { exact: false })).toBeVisible();
    await page.screenshot({ path: join(sandbox.directory, 'plugin-archive-and-installation.png'), fullPage: true });
    await writeFile(join(sandbox.directory, 'plugin-entry-evidence.json'), JSON.stringify({ deviceId: registered.deviceId, entries: registered.entries,
      nativeHosts: false, oneHookDefinition: true, oldPluginRejected: true, lastOwnerStopsNativeReads: true, frozenPendingDelivered: true,
      staleHookDoesNotCapture: true, exactSnapshots: 2, cacheIndependent: true }, null, 2));
    console.log(`Plugin ownership evidence: ${sandbox.directory}`);
  } finally { if (state) await stopInstalled(state); await browser?.close(); await sandbox.close(); }
});
