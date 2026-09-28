import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join, delimiter } from 'node:path';
import { chmod, mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { chromium, expect, type Browser } from '@playwright/test';
import { command, createSandbox, syntheticSession } from './support.js';
import { installAgent, stopInstalled } from './installed-support.js';

test('offline npm package with scripts disabled → one key setup → owned hooks → shared background → archive and status', { timeout: 180_000 }, async () => {
  const sandbox = await createSandbox(); let state: string | undefined; let browser: Browser | undefined;
  try {
    const home = join(sandbox.directory, 'isolated user with spaces'); const bin = join(home, 'bin');
    const codex = join(home, '.codex'); const local = join(home, 'AppData', 'Local'); const roaming = join(home, 'AppData', 'Roaming');
    for (const path of [bin, codex, local, roaming, join(home, 'tmp')]) await mkdir(path, { recursive: true });
    // CI detection fixture, not evidence of a real native Agent. Native tests opt
    // into the same npm/setup path with installed executables separately.
    if (process.platform === 'win32') {
      await writeFile(join(bin, 'codex.cmd'), '@echo off\r\n');
      await mkdir(join(bin, 'node_modules', '@openai', 'codex', 'bin'), { recursive: true });
      await writeFile(join(bin, 'node_modules', '@openai', 'codex', 'bin', 'codex.js'), "console.log('codex-cli 0.157.1')");
      await writeFile(join(bin, 'claude.cmd'), '@echo off\r\n');
      await mkdir(join(bin, 'node_modules', '@anthropic-ai', 'claude-code'), { recursive: true });
      await writeFile(join(bin, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'), "console.log('2.1.281 (Claude Code)')");
    } else { for (const [client, text] of [['codex', 'codex-cli 0.157.1'], ['claude', '2.1.281 (Claude Code)']]) {
      const file = join(bin, client!); await writeFile(file, `#!${process.execPath}\nconsole.log(${JSON.stringify(text)})\n`); await chmod(file, 0o700);
    } }
    const env: NodeJS.ProcessEnv = { ...Object.fromEntries(['SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramData'].filter(key => process.env[key]).map(key => [key, process.env[key]])),
      PATH: [bin, dirname(process.execPath), ...(process.platform === 'win32' ? [join(process.env.SystemRoot!, 'System32'), join(process.env.SystemRoot!, 'System32', 'WindowsPowerShell', 'v1.0')] : ['/usr/bin', '/bin'])].join(delimiter),
      HOME: home, USERPROFILE: home, APPDATA: roaming, LOCALAPPDATA: local, XDG_STATE_HOME: join(home, 'state'),
      CODEX_HOME: codex, CLAUDE_CONFIG_DIR: join(home, '.claude'), TEMP: join(home, 'tmp'), TMP: join(home, 'tmp') };
    const existing = { hooks: { UserPromptSubmit: [{ matcher: 'third-party', hooks: [{ type: 'command', command: 'echo existing-hook' }] }] }, arbitrarySetting: { retained: true } };
    await writeFile(join(codex, 'hooks.json'), JSON.stringify(existing));
    await mkdir(join(home, '.claude')); await writeFile(join(home, '.claude', 'settings.json'), JSON.stringify(existing));
    const employee = await sandbox.provision('安装合成员工'); const reader = await sandbox.provision('安装合成读者'); const origin = await sandbox.startServer();
    const installed = await installAgent(sandbox.directory, origin, env, employee.enrollmentCredential);
    state = installed.status.stateDirectory;
    assert.equal(installed.status.background, 'running'); assert.equal(installed.status.server.state, 'connected');
    assert.ok(installed.status.clients.every((client: any) => client.firstEvent === null && client.confirmedUploads === 0));
    assert.ok(installed.output.includes('pending-host-confirmation')); assert.ok(!installed.output.includes(employee.enrollmentCredential));
    const identity = JSON.parse(await readFile(join(state!, 'identity.json'), 'utf8'));
    const sourceSettings = await readFile(join(state!, 'sources', 'codex-cli', 'settings.json'), 'utf8');
    assert.ok(!sourceSettings.includes(identity.deviceCredential));
    const claudeSettings = await readFile(join(state!, 'sources', 'claude-code-cli', 'settings.json'), 'utf8');
    assert.ok(!claudeSettings.includes(identity.deviceCredential));
    if (process.platform === 'win32') {
      const script = "$a=Get-Acl -LiteralPath $env:SKYNET_TEST_STATE; [pscustomobject]@{protected=$a.AreAccessRulesProtected;rules=@($a.Access | ForEach-Object{$_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value});sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value} | ConvertTo-Json -Compress";
      const result = JSON.parse(await command('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { ...env, SKYNET_TEST_STATE: state }));
      assert.equal(result.protected, true); assert.deepEqual(result.rules, [result.sid]);
    } else { assert.equal((await stat(state!)).mode & 0o777, 0o700); assert.equal((await stat(join(state!, 'identity.json'))).mode & 0o777, 0o600); }
    const hooks = JSON.parse(await readFile(join(codex, 'hooks.json'), 'utf8'));
    assert.deepEqual(hooks.arbitrarySetting, existing.arbitrarySetting); assert.deepEqual(hooks.hooks.UserPromptSubmit[0], existing.hooks.UserPromptSubmit[0]);
    assert.ok(!JSON.stringify(hooks).includes(employee.enrollmentCredential)); assert.ok(!JSON.stringify(hooks).includes(identity.deviceCredential));
    assert.ok((await readdir(codex)).some(file => file.startsWith('hooks.json.skynet-backup-')));
    const repeated = JSON.parse(await installed.run('setup')); assert.equal(repeated.deviceId, identity.deviceId); assert.equal(repeated.runtime.instance, installed.status.runtime.instance);
    assert.deepEqual(JSON.parse(await readFile(join(codex, 'hooks.json'), 'utf8')), hooks);
    const health = await fetch(`${origin}/api/devices/health`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nonce: randomUUID() }) }); assert.equal(health.status, 401);
    const headers = { Authorization: `Bearer ${reader.readerCredential}` };
    assert.deepEqual((await (await fetch(`${origin}/api/sessions`, { headers })).json()).sessions, [], 'health does not invent employee work');
    const native = await syntheticSession(join(codex, 'sessions')); await syntheticSession(join(codex, 'sessions'));
    const records = native.bytes.toString().split('\n'); const metadata = JSON.parse(records[0]!); metadata.payload.source = 'exec'; metadata.payload.originator = 'codex_exec'; metadata.payload.cli_version = '0.157.1'; records[0] = JSON.stringify(metadata);
    await writeFile(native.transcriptPath, records.join('\n'));
    // Execute the actual installed host command; no direct internal collector API.
    const hook = hooks.hooks.UserPromptSubmit.at(-1).hooks[0];
    if (process.platform === 'win32') {
      await command('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(hook.commandWindows, 'utf16le').toString('base64')], env, JSON.stringify(native.event));
    } else await command('/bin/sh', ['-c', hook.command], env, JSON.stringify(native.event));
    let sessions: any[] = [];
    for (let attempt = 0; attempt < 80; attempt++) { sessions = (await (await fetch(`${origin}/api/sessions`, { headers })).json()).sessions; if (sessions.length) break; await setTimeout(200); }
    assert.equal(sessions.length, 1); assert.equal(sessions[0].source, 'codex-cli');
    const claudeHooks = JSON.parse(await readFile(join(home, '.claude', 'settings.json'), 'utf8'));
    assert.deepEqual(claudeHooks.hooks.UserPromptSubmit[0], existing.hooks.UserPromptSubmit[0]);
    const claudeId = randomUUID(); const claudePath = join(home, '.claude', 'projects', `${claudeId}.jsonl`);
    await writeFile(claudePath, JSON.stringify({ type: 'user', sessionId: claudeId, uuid: randomUUID(), version: '2.1.281', timestamp: new Date().toISOString(),
      message: { role: 'user', content: '同一设备的第二种来源' } }) + '\n');
    const claudeHook = claudeHooks.hooks.UserPromptSubmit.at(-1).hooks[0];
    await command(claudeHook.command, claudeHook.args, env, JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: claudeId, transcript_path: claudePath, cwd: '/synthetic/claude' }));
    for (let attempt = 0; attempt < 60; attempt++) { sessions = (await (await fetch(`${origin}/api/sessions`, { headers })).json()).sessions; if (sessions.length === 2) break; await setTimeout(200); }
    assert.equal(sessions.length, 2);
    const recoveries = await Promise.all(sessions.map(async item => (await fetch(`${origin}/api/snapshots/${item.id}`, { headers })).json()));
    assert.ok(recoveries.every(item => item.employee === '安装合成员工'));
    assert.ok(recoveries.every(item => item.deviceId === identity.deviceId), 'both adapters commit under one server-owned device');
    const status = JSON.parse(await installed.run('status')); assert.equal(status.clients.find((client: any) => client.source === 'codex-cli').confirmedUploads, 1);
    assert.ok(status.clients.find((client: any) => client.source === 'codex-cli').firstEvent);
    browser = await chromium.launch(); const page = await browser.newPage(); await page.goto(origin); await page.getByLabel('个人读取凭据').fill(reader.readerCredential); await page.getByRole('button', { name: '进入存档' }).click();
    await page.getByRole('link').filter({ hasText: '安装合成员工' }).filter({ hasText: 'Codex CLI' }).click(); await expect(page.getByText('会话记录显示测试通过。')).toBeVisible();
    // Unknown app-server origin is retained without falsely counting Desktop work.
    const unknown = await syntheticSession(join(codex, 'sessions'));
    await command(process.execPath, [join(state!, 'skynet-launcher.mjs'), 'hook', '--state', join(state!, 'inbox', 'codex')], env, JSON.stringify(unknown.event));
    await setTimeout(1400); const gaps = JSON.parse(await installed.run('status')); assert.equal(gaps.codexUnclassifiedEvents, 1); assert.ok(gaps.runtime.errors.some((item: string) => item.includes('not yet verified')));
    // Removing the npm location from availability leaves the stable runtime and
    // configured absolute hook intact; restoring it permits later setup checks.
    await rename(installed.prefix, `${installed.prefix} moved`);
    await command(process.execPath, [join(state!, 'skynet-launcher.mjs'), 'hook', '--state', join(state!, 'inbox', 'codex')], env, JSON.stringify(native.event));
    await rename(`${installed.prefix} moved`, installed.prefix);
    const conflict = structuredClone(hooks); conflict.hooks.UserPromptSubmit.at(-1).hooks[0].timeout = 9;
    await writeFile(join(codex, 'hooks.json'), JSON.stringify(conflict));
    await assert.rejects(installed.run('setup'), /ownership conflict/); assert.deepEqual(JSON.parse(await readFile(join(codex, 'hooks.json'), 'utf8')), conflict);
    await writeFile(join(sandbox.directory, 'installation-evidence.json'), JSON.stringify({ setupMs: installed.setupMs, packInstallAndSetupMs: installed.packInstallAndSetupMs,
      deviceId: identity.deviceId, backgroundInstance: status.runtime.instance, platform: process.platform, npmIgnoreScripts: true, offlineBundledDependency: true,
      existingHooksPreserved: true, repeatSetupOneIdentity: true, isolatedSyntheticCapture: true, nativeClient: false, desktop: 'not-validated' }, null, 2));
    console.log(`Installation evidence: ${sandbox.directory}`);
  } finally { if (state) await stopInstalled(state); await browser?.close(); await sandbox.close(); }
});
