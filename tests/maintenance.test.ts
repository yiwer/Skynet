import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, delimiter, join } from 'node:path';
import { appendFile, chmod, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import { chromium, expect, type Browser } from '@playwright/test';
import { command, createSandbox } from './support.js';
import { installAgent, stopInstalled } from './installed-support.js';

test('repair → interrupted upgrade rollback → upgrade → uninstall → frozen drain retains identity, user settings and exact archives', { timeout: process.platform === 'win32' ? 600_000 : 240_000 }, async () => {
  const started = Date.now(); const sandbox = await createSandbox(); let state: string | undefined; let browser: Browser | undefined;
  let stage = 'prepare'; let failed = false;
  const stages: { stage: string; at: string; elapsedMs: number }[] = [];
  const progress = async (next: string) => {
    stage = next; stages.push({ stage, at: new Date().toISOString(), elapsedMs: Date.now() - started });
    await writeFile(join(sandbox.directory, 'maintenance-progress.json'), JSON.stringify(stages, null, 2));
  };
  try {
    const home = join(sandbox.directory, 'maintenance user with spaces'); const bin = join(home, 'bin');
    for (const path of [bin, join(home, '.codex'), join(home, '.claude'), join(home, 'local'), join(home, 'roaming'), join(home, 'tmp')]) await mkdir(path, { recursive: true });
    for (const [host, label, parts] of [['codex', 'codex-cli 0.157.1', ['@openai', 'codex', 'bin', 'codex.js']],
      ['claude', '2.1.281 (Claude Code)', ['@anthropic-ai', 'claude-code', 'cli.js']]] as const) {
      if (process.platform === 'win32') {
        await writeFile(join(bin, `${host}.cmd`), '@echo off\r\n'); const script = join(bin, 'node_modules', ...parts);
        await mkdir(dirname(script), { recursive: true }); await writeFile(script, `console.log(${JSON.stringify(label)})`);
      } else { const path = join(bin, host); await writeFile(path, `#!${process.execPath}\nconsole.log(${JSON.stringify(label)})\n`); await chmod(path, 0o700); }
    }
    const env: NodeJS.ProcessEnv = { ...Object.fromEntries(['SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramData'].map(key => [key, process.env[key]])),
      PATH: [bin, dirname(process.execPath), ...(process.platform === 'win32' ? [join(process.env.SystemRoot!, 'System32'), join(process.env.SystemRoot!, 'System32', 'WindowsPowerShell', 'v1.0')] : ['/usr/bin', '/bin'])].join(delimiter),
      HOME: home, USERPROFILE: home, LOCALAPPDATA: join(home, 'local'), APPDATA: join(home, 'roaming'), XDG_STATE_HOME: join(home, 'state'),
      CODEX_HOME: join(home, '.codex'), CLAUDE_CONFIG_DIR: join(home, '.claude'), TEMP: join(home, 'tmp'), TMP: join(home, 'tmp') };
    const other = { hooks: { UserPromptSubmit: [{ matcher: 'foreign', hooks: [{ type: 'command', command: 'existing-tool' }] }] }, userTheme: 'retained' };
    const claudeConfig = join(home, '.claude', 'settings.json'); const codexConfig = join(home, '.codex', 'hooks.json');
    for (const path of [claudeConfig, codexConfig]) await writeFile(path, JSON.stringify(other));
    const employee = await sandbox.provision('维护合成员工'); const reader = await sandbox.provision('维护读者'); const origin = await sandbox.startServer();
    await progress('initial-install');
    const installed = await installAgent(sandbox.directory, origin, env, employee.enrollmentCredential, { packCli: process.env.SKYNET_TEST_BASE_PACK_CLI }); state = installed.status.stateDirectory;
    const launcher = join(state!, 'skynet-launcher.mjs');
    const run = (action: string, cli = 'dist/apps/collector/cli.js') => command(process.execPath, [cli, action], { ...env, SKYNET_KEY: undefined });
    const identity = await readFile(join(state!, 'identity.json'), 'utf8');
    const originalConfig = JSON.parse(await readFile(claudeConfig, 'utf8'));
    const editedConfig = structuredClone(originalConfig); editedConfig.userTheme = 'changed-since-install';
    editedConfig.hooks.UserPromptSubmit = [other.hooks.UserPromptSubmit[0]]; await writeFile(claudeConfig, JSON.stringify(editedConfig));
    await progress('repair'); await run('stop'); await unlink(launcher);
    const repaired = JSON.parse(await run('repair')); assert.equal(repaired.background, 'running');
    await run('repair');
    const afterRepair = JSON.parse(await readFile(claudeConfig, 'utf8'));
    assert.equal(afterRepair.userTheme, 'changed-since-install'); assert.deepEqual(afterRepair.hooks.UserPromptSubmit[0], other.hooks.UserPromptSubmit[0]);
    assert.equal(afterRepair.hooks.UserPromptSubmit.length, 2, 'repeated repair installs exactly one owned definition');
    assert.equal(await readFile(join(state!, 'identity.json'), 'utf8'), identity);
    // A third-party listener stays running and never receives a stop request.
    await progress('repair-occupied'); await run('stop'); const control = JSON.parse(await readFile(join(state!, 'runtime-control.json'), 'utf8'));
    let foreignStops = 0; const foreign = createServer((req, res) => { if (req.url === '/stop') foreignStops++; res.writeHead(401); res.end('unrelated'); });
    await new Promise<void>(resolve => foreign.listen(control.supervisorPort, '127.0.0.1', resolve));
    try {
      await assert.rejects(run('start'), /occupied/); const repairedCollision = JSON.parse(await run('repair')); assert.equal(repairedCollision.background, 'running');
      const moved = JSON.parse(await readFile(join(state!, 'runtime-control.json'), 'utf8')); assert.notEqual(moved.supervisorPort, control.supervisorPort);
      assert.equal((await fetch(`http://127.0.0.1:${control.supervisorPort}/status`)).status, 401); assert.equal(foreignStops, 0);
    } finally { foreign.closeAllConnections(); await new Promise<void>(resolve => foreign.close(() => resolve())); }
    const id = randomUUID(); const transcript = join(home, '.claude', 'projects', `${id}.jsonl`);
    const record = (text: string) => JSON.stringify({ type: 'user', sessionId: id, uuid: randomUUID(), version: '2.1.281', timestamp: new Date().toISOString(), message: { role: 'user', content: text } }) + '\n';
    await writeFile(transcript, record('升级前已确认会话'));
    const hook = afterRepair.hooks.UserPromptSubmit.at(-1).hooks[0];
    await command(hook.command, hook.args, env, JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: id, transcript_path: transcript, cwd: '/synthetic/maintenance' }));
    const headers = { Authorization: `Bearer ${reader.readerCredential}` };
    const list = async () => (await (await fetch(`${origin}/api/sessions`, { headers })).json()).sessions;
    for (let attempt = 0; attempt < 80 && !(await list()).length; attempt++) await setTimeout(100);
    assert.equal((await list()).length, 1);
    await sandbox.stopServer(); await appendFile(transcript, record('升级中断仍须保留的离线材料'));
    const source = join(state!, 'sources', 'claude-code-cli');
    for (let attempt = 0; attempt < 80; attempt++) {
      const local = JSON.parse(await readFile(join(source, 'status.json'), 'utf8')); if (local.delivery.pendingSnapshots) break; await setTimeout(100);
    }
    const pendingDirectory = join(source, 'delivery', 'pending');
    const frozen = await readFile(transcript); const pendingFiles = (await readdir(pendingDirectory)).filter(file => file.endsWith('.json'));
    assert.equal(pendingFiles.length, 1); const pendingBytes = await readFile(join(pendingDirectory, pendingFiles[0]!));
    const packed = JSON.parse(await command(process.execPath, ['dist/apps/collector/cli.js', 'pack-agent', '--output', join(sandbox.directory, 'upgrade release'),
      '--origin', origin, '--deployment', 'isolated-acceptance', '--version', '0.2.0'], process.env));
    const upgradeCli = join(dirname(packed.package), 'dist', 'apps', 'collector', 'cli.js');
    const interruption: string[] = [];
    for (const phase of ['prepared', 'switched']) {
      await progress(`interrupt-${phase}`);
      const upgrade = spawn(process.execPath, [upgradeCli, 'upgrade'], { env, windowsHide: true, stdio: 'ignore' });
      const exited = new Promise<void>(resolve => upgrade.once('exit', () => resolve()));
      let observed = false;
      for (let attempt = 0; attempt < 4000 && upgrade.exitCode === null && upgrade.signalCode === null; attempt++) {
        const value = await readFile(join(state!, 'upgrade.json'), 'utf8').then(JSON.parse).catch(() => null);
        if (value?.phase === phase) { observed = true; upgrade.kill('SIGKILL'); break; }
        await setTimeout(2);
      }
      await exited; assert.equal(observed, true, `terminated actual public upgrade at durable ${phase} boundary`);
      await progress(`recover-${phase}`); const recovered = JSON.parse(await run('repair')); assert.equal(recovered.runtimeVersion, '0.1.0'); assert.equal(recovered.background, 'running');
      assert.equal(recovered.upgrade.phase, 'rolled-back'); assert.equal(await readFile(join(state!, 'identity.json'), 'utf8'), identity);
      assert.deepEqual(await readFile(join(pendingDirectory, pendingFiles[0]!)), pendingBytes); interruption.push(phase);
    }
    await progress('successful-upgrade'); const upgraded = JSON.parse(await run('upgrade', upgradeCli)); assert.equal(upgraded.runtimeVersion, '0.2.0'); assert.equal(upgraded.background, 'running');
    assert.equal(upgraded.upgrade.phase, 'complete'); await assert.rejects(run('setup', installed.cli), /older than the installed/);
    const plugins = JSON.parse(await command(process.execPath, ['dist/apps/collector/cli.js', 'pack-plugins', '--output', join(sandbox.directory, 'upgraded plugin release'),
      '--origin', origin, '--deployment', 'isolated-acceptance', '--version', '0.2.0'], process.env));
    const pluginScript = join(plugins.directory, 'plugins', 'skynet-claude', 'scripts', 'skynet.cjs');
    await progress('post-upgrade-plugin'); await command(process.execPath, [pluginScript, 'setup'], env).catch(error => { if (!/device health failed/.test(error.message)) throw error; });
    // setup's server health is intentionally unavailable during this offline
    // proof, but its durable new entry must not disappear on code rollback.
    await progress('codex-fence-before-rollback');
    if (process.env.SKYNET_TEST_BASE_PACK_CLI) {
      // Fault-inject one persisted source fence while the other remains active.
      // This is compatibility registration evidence, not Desktop support proof.
      const path = join(state!, 'installation.json'); const before = await readFile(path, 'utf8');
      const mixed = JSON.parse(before);
      mixed.clients.find((client: any) => client.source === 'codex-cli').configured = false;
      mixed.clients.find((client: any) => client.source === 'codex-desktop').configured = true;
      await writeFile(path, JSON.stringify(mixed));
      try {
        await assert.rejects(command(process.execPath, [launcher, 'rollback'], env), /capture fence for codex-cli/);
        assert.equal(await readFile(path, 'utf8'), JSON.stringify(mixed), 'incompatible rollback rejects before replacing registration');
      } finally { await writeFile(path, before); }
    }
    await command(process.execPath, [launcher, 'entry-remove', '--entry', 'npm'], env);
    if (process.env.SKYNET_TEST_BASE_PACK_CLI) await assert.rejects(command(process.execPath, [launcher, 'rollback'], env), /cannot enforce the current Codex capture fence/);
    else await command(process.execPath, [launcher, 'rollback'], env);
    const fenced = JSON.parse(await command(process.execPath, [launcher, 'start'], env));
    assert.equal(fenced.clients.find((client: any) => client.source === 'codex-cli').configured, false);
    const fencedId = randomUUID(); const fencedPath = join(home, '.codex', 'sessions', `${fencedId}.jsonl`);
    await writeFile(fencedPath, JSON.stringify({ type: 'must-not-be-parsed-while-disabled', payload: { id: fencedId } }) + '\n');
    await command(process.execPath, [launcher, 'hook', '--state', join(state!, 'inbox', 'codex')], env,
      JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: fencedId, transcript_path: fencedPath, cwd: '/synthetic/fenced-codex' }));
    let afterFence = fenced;
    for (let attempt = 0; attempt < 40; attempt++) {
      afterFence = JSON.parse(await command(process.execPath, [launcher, 'status'], env));
      if (afterFence.runtime.checkedAt > fenced.runtime.checkedAt) break;
      await setTimeout(150);
    }
    assert.ok(afterFence.runtime.checkedAt > fenced.runtime.checkedAt);
    assert.equal(afterFence.codexUnclassifiedEvents, 1); assert.deepEqual(afterFence.runtime.errors, [], 'disabled Codex metadata is not opened or parsed after normal background start');
    // Explicit reconnect is a separate authorization to resume reading sources.
    // Reconnect with the selected version. The compatible current-code fixture
    // already rolled back; repeat setup must preserve its newer maintenance
    // launcher without doing a redundant second successful upgrade.
    await progress('explicit-reconnect'); const reconnectCli = process.env.SKYNET_TEST_BASE_PACK_CLI ? upgradeCli : installed.cli;
    await run('setup', reconnectCli).catch(error => { if (!/device health failed/.test(error.message)) throw error; });
    await progress('explicit-rollback'); const rolledBack = JSON.parse(await command(process.execPath, [launcher, 'rollback'], env)); assert.equal(rolledBack.runtimeVersion, '0.1.0');
    assert.deepEqual(rolledBack.entries.map((entry: any) => entry.channel).sort(), ['claude-plugin', 'npm']);
    if (process.env.SKYNET_TEST_BASE_PACK_CLI) {
      await assert.rejects(command(process.execPath, [launcher, 'entry-remove', '--entry', 'npm'], env), /older runtime cannot enforce/);
      await command(process.execPath, [launcher, 'stop'], env);
      const path = join(state!, 'installation.json'); const before = await readFile(path, 'utf8'); const mixed = JSON.parse(before);
      mixed.clients.find((client: any) => client.source === 'codex-desktop').configured = true;
      mixed.entries.push({ channel: 'codex-plugin', packageVersion: '0.2.0', registeredAt: new Date().toISOString(), sources: ['codex-desktop'] });
      await writeFile(path, JSON.stringify(mixed));
      try {
        await assert.rejects(command(process.execPath, [launcher, 'entry-remove', '--entry', 'npm'], env), /older runtime cannot enforce/);
        assert.equal(await readFile(path, 'utf8'), JSON.stringify(mixed), 'a remaining different Codex owner cannot permit disabling this source on a legacy worker');
        mixed.clients.find((client: any) => client.source === 'codex-cli').configured = false;
        await writeFile(path, JSON.stringify(mixed));
        for (const action of ['start', 'background']) await assert.rejects(command(process.execPath, [launcher, action, '--state', state!], env), /capture fence for codex-cli/);
        assert.equal(await readFile(path, 'utf8'), JSON.stringify(mixed), 'normal stable entrypoints preserve the disabled source fence');
      } finally { await writeFile(path, before); }
      await command(process.execPath, [launcher, 'start'], env);
    }
    const current = await readFile(claudeConfig, 'utf8');
    const modifiedOwned = JSON.parse(current); modifiedOwned.hooks.UserPromptSubmit.at(-1).hooks[0].timeout = 9;
    await writeFile(claudeConfig, JSON.stringify(modifiedOwned)); await assert.rejects(command(process.execPath, [launcher, 'uninstall'], env), /ownership conflict/);
    assert.deepEqual(JSON.parse(await readFile(claudeConfig, 'utf8')), modifiedOwned); await writeFile(claudeConfig, current);
    await progress('uninstall'); const uninstalled = JSON.parse(await command(process.execPath, [launcher, 'uninstall'], env)); assert.equal(uninstalled.lifecycle, 'uninstalled');
    assert.equal(uninstalled.background, 'unavailable'); assert.equal(uninstalled.autostart.state, 'removed'); assert.equal(uninstalled.entries.length, 0);
    await command(process.execPath, [launcher, 'uninstall'], env);
    await assert.rejects(command(process.execPath, [launcher, 'start'], env), /Capture is uninstalled/);
    await assert.rejects(command(process.execPath, [launcher, 'background', '--state', state!], env), /Capture is uninstalled/);
    await assert.rejects(command(process.execPath, [launcher, 'background-guardian', '--state', state!], env), /Capture is uninstalled/);
    await assert.rejects(command(process.execPath, [launcher, 'background-worker', '--state', state!], env), /owning supervisor/);
    for (const path of [claudeConfig, codexConfig]) {
      const config = JSON.parse(await readFile(path, 'utf8')); assert.deepEqual(config.hooks.UserPromptSubmit, other.hooks.UserPromptSubmit);
      assert.equal(config.userTheme, path === claudeConfig ? 'changed-since-install' : 'retained');
    }
    await appendFile(transcript, record('卸载后不得读取的新材料'));
    await command(hook.command, hook.args, env, JSON.stringify({ hook_event_name: 'Stop', session_id: id, transcript_path: transcript, cwd: '/synthetic/maintenance' }));
    await command(process.execPath, [launcher, 'hook', '--state', join(state!, 'inbox', 'codex')], env,
      JSON.stringify({ hook_event_name: 'Stop', session_id: randomUUID(), transcript_path: join(home, '.codex', 'sessions', 'unread-after-uninstall.jsonl'), cwd: '/synthetic/maintenance' }));
    await sandbox.startServer(Number(new URL(origin).port));
    await progress('frozen-drain'); const drained = JSON.parse(await command(process.execPath, [launcher, 'drain'], env)); assert.equal(drained.background, 'unavailable');
    assert.equal(drained.retainedUnfrozenEvents, 3, 'stale/unparsed hooks remain visible and are never confused with frozen delivery');
    assert.equal((await readdir(pendingDirectory)).filter(file => file.endsWith('.json')).length, 0);
    const sessions = await list(); assert.equal(sessions.length, 1);
    const raw = Buffer.from(await (await fetch(`${origin}/api/snapshots/${sessions[0].id}/raw`, { headers })).arrayBuffer()); assert.deepEqual(raw, frozen);
    const history = await (await fetch(`${origin}/api/snapshots/${sessions[0].id}/history`, { headers })).json(); assert.equal(history.snapshots.length, 2);
    assert.equal(await readFile(join(state!, 'identity.json'), 'utf8'), identity);
    const finalRepair = JSON.parse(await command(process.execPath, [launcher, 'repair'], env)); assert.equal(finalRepair.background, 'unavailable'); assert.equal(finalRepair.lifecycle, 'uninstalled');
    await progress('web-archive'); browser = await chromium.launch(); const page = await browser.newPage(); await page.goto(origin + '/#sessions');
    await page.getByLabel('个人读取凭据').fill(reader.readerCredential); await page.getByRole('button', { name: '进入存档' }).click();
    await page.getByRole('row').filter({ hasText: '维护合成员工' }).filter({ hasText: 'Claude Code CLI' }).getByRole('link').click(); await expect(page.getByText('升级中断仍须保留的离线材料', { exact: false })).toBeVisible();
    await page.getByRole('navigation', { name: '平台页面' }).getByRole('button', { name: '接入与设备', exact: true }).click(); await expect(page.getByRole('region', { name: '设备同步状态', exact: true })).toContainText('维护合成员工');
    await page.screenshot({ path: join(sandbox.directory, 'maintenance-archive.png'), fullPage: true });
    await progress('complete'); await writeFile(join(sandbox.directory, 'maintenance-evidence.json'), JSON.stringify({ interruption, identityRetained: true, exactFrozenBytes: true,
      repeatRepairOneDefinition: true, occupiedListenerPreserved: true, userSettingsPreserved: true, rollbackAfterSuccess: true, uninstallStopsCapture: true,
      pendingDrainAfterUninstall: true, codexFenceAcrossRollback: true, legacyPerSourceFence: Boolean(process.env.SKYNET_TEST_BASE_PACK_CLI), retainedUnfrozenEvents: 3, snapshots: history.snapshots.length, nativeHost: false, basePackCli: process.env.SKYNET_TEST_BASE_PACK_CLI ?? 'current build' }, null, 2));
    console.log(`Maintenance evidence: ${sandbox.directory}`);
  } catch (error) {
    failed = true;
    await writeFile(join(sandbox.directory, 'maintenance-failed-evidence.json'), JSON.stringify({ stage, error: (error as Error).message }, null, 2));
    console.log(`Maintenance failure (${stage}): ${sandbox.directory}`); throw error;
  } finally {
    try { if (state) await stopInstalled(state); }
    catch (error) { if (!failed) throw error; console.error('Owned maintenance test cleanup failed; original failure retained.'); }
    await browser?.close(); await sandbox.close();
  }
});
