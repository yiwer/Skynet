import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join, delimiter } from 'node:path';
import { appendFile, chmod, mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
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
    assert.equal(repeated.autostart.lifecycle.login, 'not-verified'); assert.equal(repeated.autostart.lifecycle.sleepResume, 'not-verified');
    if (process.platform === 'win32') {
      assert.equal(repeated.autostart.state, 'registered');
      const script = "$t=Get-ScheduledTask -TaskName $env:SKYNET_TEST_TASK; [pscustomobject]@{state=[string]$t.State;level=[string]$t.Principal.RunLevel;logon=[string]$t.Principal.LogonType;hidden=$t.Settings.Hidden;action=$t.Actions[0].Arguments} | ConvertTo-Json -Compress";
      const task = JSON.parse(await command('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { ...env, SKYNET_TEST_TASK: repeated.autostart.taskName }));
      assert.equal(repeated.autostart.taskState, task.state, 'report the actual scheduled task state, never infer Running from a separate fallback process');
      assert.ok(['Running', 'Ready'].includes(task.state)); assert.equal(repeated.background, 'running');
      assert.equal(repeated.worker.supervisorInstance, repeated.supervisor.instance);
      assert.equal(task.level, 'Limited'); assert.equal(task.logon, 'Interactive'); assert.equal(task.hidden, true);
      assert.ok(task.action.includes('-WindowStyle Hidden')); assert.ok(!task.action.includes(employee.enrollmentCredential));
    }
    else assert.equal(repeated.autostart.state, 'degraded');
    const concurrentStarts = await Promise.all([installed.run('start'), installed.run('start')]);
    assert.ok(concurrentStarts.map(value => JSON.parse(value)).every(value => value.worker.instance === repeated.worker.instance && value.supervisor.instance === repeated.supervisor.instance));
    const control = JSON.parse(await readFile(join(state!, 'runtime-control.json'), 'utf8'));
    assert.equal((await fetch(`http://127.0.0.1:${control.supervisorPort}/stop`, { method: 'POST' })).status, 401);
    assert.equal((await fetch(`http://127.0.0.1:${control.workerPort}/status`, { headers: { Authorization: 'Bearer wrong-local-control-token' } })).status, 401);
    await assert.rejects(command(process.execPath, [installed.cli, 'background-worker', '--state', state!], env), /owning supervisor/);
    await assert.rejects(command(process.execPath, [installed.cli, 'run', '--state', join(state!, 'sources', 'codex-cli'), '--once'], env), /owned by the shared background/);
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
    const recoveries = await Promise.all(sessions.map(async item => {
      const detail = await fetch(`${origin}/api/snapshots/${item.id}`, { headers });
      assert.equal(detail.status, 200);
      return detail.json();
    }));
    assert.ok(recoveries.every(item => item.employee === '安装合成员工'));
    assert.ok(recoveries.every(item => item.deviceId === identity.deviceId), 'both adapters commit under one server-owned device');
    const status = JSON.parse(await installed.run('status')); assert.equal(status.clients.find((client: any) => client.source === 'codex-cli').confirmedUploads, 1);
    assert.ok(status.clients.find((client: any) => client.source === 'codex-cli').firstEvent);
    browser = await chromium.launch(); const page = await browser.newPage(); await page.goto(origin); await page.getByLabel('个人读取凭据').fill(reader.readerCredential); await page.getByRole('button', { name: '进入存档' }).click();
    await page.getByRole('link').filter({ hasText: '安装合成员工' }).filter({ hasText: 'Codex CLI' }).click(); await expect(page.getByText('会话记录显示测试通过。')).toBeVisible();
    // The setup shell has exited. The background continues without its Key/PATH;
    // a crashed owned worker is restarted by the supervisor, retaining identity.
    const beforeCrash = JSON.parse(await installed.run('status'));
    process.kill(beforeCrash.worker.pid, 'SIGKILL');
    let recovered: any;
    for (let attempt = 0; attempt < 40; attempt++) {
      recovered = JSON.parse(await installed.run('status'));
      if (recovered.background === 'running' && recovered.worker.instance !== beforeCrash.worker.instance) break;
      await setTimeout(200);
    }
    assert.equal(recovered.background, 'running'); assert.notEqual(recovered.worker.instance, beforeCrash.worker.instance);
    assert.equal(recovered.supervisor.instance, beforeCrash.supervisor.instance); assert.ok(recovered.supervisor.restarts >= 1);
    assert.equal(recovered.deviceId, identity.deviceId);
    let supervisorCrashRecovered = false;
    if (process.platform === 'win32') {
      // The isolated registered task's action remains alive across a crashed
      // supervisor and recovers it without issuing another start.
      const previousSupervisor = recovered.supervisor.instance;
      process.kill(recovered.supervisor.pid, 'SIGKILL');
      const recoveryDeadline = Date.now() + 30_000;
      while (Date.now() < recoveryDeadline) {
        recovered = JSON.parse(await installed.run('status'));
        if (recovered.background === 'running' && recovered.supervisor.instance !== previousSupervisor) break;
        await setTimeout(1000);
      }
      assert.equal(recovered.background, 'running'); assert.notEqual(recovered.supervisor.instance, previousSupervisor);
      assert.equal(recovered.deviceId, identity.deviceId); supervisorCrashRecovered = true;
    }
    await sandbox.stopServer();
    await appendFile(claudePath, JSON.stringify({ type: 'user', sessionId: claudeId, uuid: randomUUID(), version: '2.1.281', timestamp: new Date().toISOString(),
      message: { role: 'user', content: 'runtime-offline-backlog-proof' } }) + '\n');
    let offline: any;
    for (let attempt = 0; attempt < 30; attempt++) {
      offline = JSON.parse(await installed.run('status'));
      if (offline.clients.find((item: any) => item.source === 'claude-code-cli').capture?.delivery?.pendingSnapshots > 0) break;
      await setTimeout(200);
    }
    assert.equal(offline.background, 'running');
    const backlog = offline.clients.find((item: any) => item.source === 'claude-code-cli').capture.delivery;
    assert.ok(backlog.pendingSnapshots > 0); assert.equal(backlog.lastFailure.kind, 'disconnected'); assert.ok(backlog.lastSuccessAt);
    assert.equal(offline.worker.instance, recovered.worker.instance, 'network failure does not become a stale-process restart');
    await sandbox.startServer(Number(new URL(origin).port));
    await command(process.execPath, [installed.cli, 'retry', '--state', join(state!, 'sources', 'claude-code-cli')], env);
    let restoredDetail: any;
    for (let attempt = 0; attempt < 50; attempt++) {
      const latest = (await (await fetch(`${origin}/api/sessions`, { headers })).json()).sessions.find((item: any) => item.source_session_id === claudeId);
      restoredDetail = await (await fetch(`${origin}/api/snapshots/${latest.id}`, { headers })).json();
      if (restoredDetail.events.some((event: any) => event.text.includes('runtime-offline-backlog-proof'))) break;
      await setTimeout(200);
    }
    assert.ok(restoredDetail.events.some((event: any) => event.text.includes('runtime-offline-backlog-proof')));
    await installed.run('stop');
    const collision = createServer((_req, res) => { res.writeHead(401); res.end(); });
    try {
      await new Promise<void>(resolve => collision.listen(control.supervisorPort, '127.0.0.1', resolve));
      await assert.rejects(installed.run('start'), /occupied or rejected authentication/);
      const blocked = JSON.parse(await installed.run('status'));
      assert.equal(blocked.background, 'unavailable'); assert.match(blocked.controlError, /occupied/);
    } finally { collision.closeAllConnections(); await new Promise<void>(resolve => collision.close(() => resolve())); }
    // A stale diagnostic PID can even name a live unrelated process. It grants
    // no ownership and must not cause that process to be killed or a false lock.
    await writeFile(join(state!, 'runtime.lock'), JSON.stringify({ version: 2, pid: process.pid, instance: 'stale-diagnostic-only' }));
    const restarted = JSON.parse(await command(process.execPath, [installed.cli, 'start'], { ...env, PATH: '', SKYNET_KEY: undefined }));
    assert.equal(restarted.background, 'running'); assert.equal(restarted.deviceId, identity.deviceId); process.kill(process.pid, 0);
    if (process.platform === 'win32') {
      const taskEnvironment = { ...env, SKYNET_TEST_TASK: restarted.autostart.taskName };
      const taskCommand = (verb: string) => command('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand',
        Buffer.from(`${verb}-ScheduledTask -TaskName $env:SKYNET_TEST_TASK | Out-Null`, 'utf16le').toString('base64')], taskEnvironment);
      try {
        await taskCommand('Disable'); const disabled = JSON.parse(await installed.run('status'));
        assert.equal(disabled.autostart.state, 'degraded'); assert.equal(disabled.autostart.taskState, 'Disabled'); assert.equal(disabled.background, 'running');
      } finally { await taskCommand('Enable'); }
    }
    await writeFile(join(sandbox.directory, 'runtime-evidence.json'), JSON.stringify({ platform: process.platform, setupParentExited: true,
      currentUserAutostart: restarted.autostart, concurrentStartsOneWorker: true, unauthenticatedControlRejected: true,
      workerCrashRecovered: true, supervisorCrashRecovered, stalePidNotAuthority: true, networkBacklogWhileAlive: backlog, uploadAfterRestart: true,
      nativeClient: false, login: 'not-verified', reboot: 'not-verified', sleepResume: 'not-verified', desktopIcon: 'not-verified' }, null, 2));
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
    await writeFile(join(codex, 'hooks.json'), '{invalid-json');
    await assert.rejects(installed.run('setup'), /invalid JSON/); assert.equal(await readFile(join(codex, 'hooks.json'), 'utf8'), '{invalid-json');
    await writeFile(join(codex, 'hooks.json'), JSON.stringify(hooks));
    const changedHome = { ...env, SKYNET_KEY: undefined, CODEX_HOME: join(home, 'changed-codex') };
    await assert.rejects(command(process.execPath, [installed.cli, 'setup'], changedHome), /native home changed/);
    assert.deepEqual(JSON.parse(await readFile(join(state!, 'identity.json'), 'utf8')), identity);
    const emptyHome = join(sandbox.directory, 'missing key user'); await mkdir(emptyHome);
    await assert.rejects(command(process.execPath, [installed.cli, 'setup'], { ...env, SKYNET_KEY: undefined,
      HOME: emptyHome, USERPROFILE: emptyHome, LOCALAPPDATA: join(emptyHome, 'local'), XDG_STATE_HOME: join(emptyHome, 'state'),
      CODEX_HOME: join(emptyHome, '.codex'), CLAUDE_CONFIG_DIR: join(emptyHome, '.claude') }), /Set the personal SKYNET_KEY/);
    await writeFile(join(sandbox.directory, 'installation-evidence.json'), JSON.stringify({ setupMs: installed.setupMs, packInstallAndSetupMs: installed.packInstallAndSetupMs,
      deviceId: identity.deviceId, backgroundInstance: status.runtime.instance, platform: process.platform, npmIgnoreScripts: true, offlineBundledDependency: true,
      existingHooksPreserved: true, repeatSetupOneIdentity: true, bothSourceDeviceIdVerified: true,
      isolatedSyntheticCapture: true, nativeClient: false, desktop: 'not-validated' }, null, 2));
    console.log(`Installation evidence: ${sandbox.directory}`);
  } finally { if (state) await stopInstalled(state); await browser?.close(); await sandbox.close(); }
});
