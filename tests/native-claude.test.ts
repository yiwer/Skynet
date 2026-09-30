import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { chromium, expect, type Browser } from '@playwright/test';
import { command, createSandbox } from './support.js';
import { installAgent, stopInstalled } from './installed-support.js';
import { installNativePlugins } from './plugin-support.js';

// Explicit opt-in: real CLI and ordinary user hooks, synthetic loopback model responses.
// This is product/native integration evidence, not a paid provider or whole G0 pass.
test('ordinary Claude hooks archive two projects and a server-only package resumes native tool history', { timeout: 180_000 }, async () => {
  const runtime = process.env.SKYNET_CLAUDE_RUNTIME;
  assert.ok(runtime, 'Set SKYNET_CLAUDE_RUNTIME to the installed Claude Code 2.1.281 executable');
  assert.equal(process.platform, 'win32'); assert.equal(process.arch, 'x64');
  const sandbox = await createSandbox();
  const directory = await realpath(sandbox.directory);
  const requests: { url: string; body: any }[] = [];
  const sourceHome = join(directory, 'native-source');
  const sourceConfig = join(sourceHome, '.claude');
  const projects = { A: join(directory, 'project-a'), B: join(directory, 'project-b') };
  const marker = 'SKYNET_CLAUDE_TOOL_MARKER_719';
  let browser: Browser | undefined;
  let installedState: string | undefined;
  const provider = createServer(async (request, response) => {
    try {
      let raw = ''; for await (const chunk of request) raw += chunk;
      const body = JSON.parse(raw || '{}'); requests.push({ url: request.url!, body });
      if (!request.url?.startsWith('/v1/messages')) { response.writeHead(200, { 'content-type': 'application/json' }); response.end('{}'); return; }
      const history = JSON.stringify(body.messages ?? []);
      const blocks = (body.messages ?? []).flatMap((m: any) => Array.isArray(m.content) ? m.content : []);
      const completedRead = blocks.some((b: any) => b.type === 'tool_result');
      const project = history.includes('SKYNET_PROJECT_B') ? projects.B : projects.A;
      const block = completedRead
        ? { type: 'text', text: 'Synthetic Claude result; previous tool history remains in the conversation.' }
        : { type: 'tool_use', id: 'toolu_skynet_claude', name: 'Read', input: { file_path: join(project, 'marker.txt') } };
      const stopReason = block.type === 'tool_use' ? 'tool_use' : 'end_turn';
      const message = { id: `msg_${randomUUID().replaceAll('-', '')}`, type: 'message', role: 'assistant', model: body.model,
        content: [block], stop_reason: stopReason, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 20 } };
      if (!body.stream) { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(message)); return; }
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      const send = (type: string, value: unknown) => response.write(`event: ${type}\ndata: ${JSON.stringify(value)}\n\n`);
      send('message_start', { type: 'message_start', message: { ...message, content: [], stop_reason: null, usage: { input_tokens: 100, output_tokens: 0 } } });
      send('content_block_start', { type: 'content_block_start', index: 0, content_block: block.type === 'tool_use' ? { ...block, input: {} } : { type: 'text', text: '' } });
      send('content_block_delta', { type: 'content_block_delta', index: 0, delta: block.type === 'tool_use'
        ? { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } : { type: 'text_delta', text: block.text } });
      send('content_block_stop', { type: 'content_block_stop', index: 0 });
      send('message_delta', { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 20 } });
      send('message_stop', { type: 'message_stop' }); response.end();
    } catch { response.writeHead(500); response.end(); }
  });
  try {
    provider.listen(0, '127.0.0.1'); await once(provider, 'listening');
    const port = (provider.address() as { port: number }).port;
    async function nativeEnv(home: string, config: string) {
      for (const part of [home, config, join(home, 'tmp'), join(home, 'appdata'), join(home, 'localappdata')]) await mkdir(part, { recursive: true });
      const system = process.env.SystemRoot!;
      return { SystemRoot: system, WINDIR: system, COMSPEC: process.env.COMSPEC!, PATHEXT: '.COM;.EXE;.BAT;.CMD',
        PATH: `${dirname(runtime!)};${dirname(process.execPath)};${join(system, 'System32')};${join(system, 'System32', 'WindowsPowerShell', 'v1.0')};${system};C:\\Program Files\\Git\\bin`,
        HOME: home, USERPROFILE: home, HOMEDRIVE: home.slice(0, 2), HOMEPATH: home.slice(2),
        APPDATA: join(home, 'appdata'), LOCALAPPDATA: join(home, 'localappdata'), TEMP: join(home, 'tmp'), TMP: join(home, 'tmp'),
        CLAUDE_CONFIG_DIR: config, CLAUDE_CODE_TMPDIR: join(home, 'tmp'), CLAUDE_CODE_GIT_BASH_PATH: 'C:\\Program Files\\Git\\bin\\bash.exe',
        ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`, ANTHROPIC_API_KEY: 'synthetic-loopback-only',
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_AUTOUPDATER: '1' };
    }
    const sourceEnv = await nativeEnv(sourceHome, sourceConfig);
    assert.equal((await command(runtime, ['--version'], sourceEnv)).trim(), '2.1.281 (Claude Code)');
    for (const project of Object.values(projects)) { await mkdir(project); await writeFile(join(project, 'marker.txt'), `${marker}\n`); }
    await mkdir(join(sourceConfig, 'projects'));
    const employee = await sandbox.provision('真实 Claude 合成测试员工');
    const reader = await sandbox.provision('真实 Claude 合成测试读者');
    const origin = await sandbox.startServer();
    let state = join(directory, 'collector');
    if (process.env.SKYNET_TEST_INSTALLER || process.env.SKYNET_TEST_PLUGINS) {
      const installed = process.env.SKYNET_TEST_PLUGINS
        ? await installNativePlugins(directory, origin, sourceEnv, employee.enrollmentCredential, 'claude')
        : await installAgent(directory, origin, sourceEnv, employee.enrollmentCredential);
      installedState = installed.status.stateDirectory; state = join(installedState!, 'sources', 'claude-code-cli');
      assert.equal(installed.status.clients.find((item: any) => item.source === 'claude-code-cli').detected, true);
      // Setup's terminal has already closed. Kill only this isolated, authenticated
      // installation's worker and prove real native activity reaches the archive
      // after its supervisor restarts it, without another setup or enrollment Key.
      const before = JSON.parse(await installed.run('status')); process.kill(before.worker.pid, 'SIGKILL');
      let after: any;
      for (let attempt = 0; attempt < 40; attempt++) {
        after = JSON.parse(await installed.run('status'));
        if (after.background === 'running' && after.worker.instance !== before.worker.instance) break;
        await setTimeout(200);
      }
      assert.equal(after.background, 'running'); assert.notEqual(after.worker.instance, before.worker.instance);
      assert.equal(after.deviceId, before.deviceId); assert.equal(after.supervisor.instance, before.supervisor.instance);
      await writeFile(join(directory, 'native-runtime-recovery.json'), JSON.stringify({ setupParentExited: true,
        source: 'claude-code-cli', workerCrashRecovered: true, autostart: after.autostart,
        priorWorker: before.worker.instance, currentWorker: after.worker.instance, supervisor: after.supervisor.instance }, null, 2));
    } else await sandbox.collectorCommand('setup', state, { server: origin, enrollmentCredential: employee.enrollmentCredential,
      nativeRoot: join(sourceConfig, 'projects'), source: 'claude-code-cli', sourceVersion: '2.1.281', sourceOs: process.platform });
    const hooks = Object.fromEntries(['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'Stop', 'SessionEnd'].map(event => [event,
      [{ hooks: [{ type: 'command', command: process.execPath, args: [resolve('dist/apps/collector/cli.js'), 'hook', '--state', state] }] }]]));
    if (!installedState) { await writeFile(join(sourceConfig, 'settings.json'), JSON.stringify({ hooks })); await sandbox.startCollector(state); }
    async function runNative(env: NodeJS.ProcessEnv, cwd: string, id: string, prompt: string, resume = false) {
      const args = ['--print', '--output-format', 'stream-json', '--verbose', '--include-hook-events', '--setting-sources', 'user',
        '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--tools', 'Read', '--permission-prompts', 'none', '--model', 'claude-sonnet-4-5',
        '--system-prompt', 'Use the synthetic marker only. Preserve the conversation.', resume ? '--resume' : '--session-id', id];
      const output = await new Promise<string>((resolveResult, reject) => {
        const child = spawn(runtime!, args, { env, cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
        let stdout = ''; let stderr = '';
        child.stdout.on('data', part => stdout += part); child.stderr.on('data', part => stderr += part);
        const timer = globalThis.setTimeout(() => { child.kill(); reject(new Error('Isolated Claude runtime timed out')); }, 30_000);
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('close', code => { clearTimeout(timer); code === 0 ? resolveResult(stdout) : reject(new Error(`Claude exited ${code}: ${stderr}`)); });
        child.stdin.end(prompt);
      });
      const result = output.trim().split('\n').map(line => JSON.parse(line)).findLast(item => item.type === 'result');
      assert.equal(result?.is_error, false); assert.equal(result?.terminal_reason, 'completed'); assert.deepEqual(result?.permission_denials, []);
      return output;
    }
    const ids = { A: randomUUID(), B: randomUUID() };
    for (const key of ['A', 'B'] as const) {
      await writeFile(join(directory, `claude-${key}.jsonl`), await runNative(sourceEnv, projects[key], ids[key], `SKYNET_PROJECT_${key}: read marker.txt and keep the result.`));
    }
    const completedHashes = new Map<string, string>();
    for (const folder of await readdir(join(sourceConfig, 'projects'), { withFileTypes: true })) {
      if (!folder.isDirectory()) continue;
      for (const id of Object.values(ids)) {
        try {
          const bytes = await readFile(join(sourceConfig, 'projects', folder.name, `${id}.jsonl`));
          completedHashes.set(id, createHash('sha256').update(bytes).digest('hex'));
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      }
    }
    assert.equal(completedHashes.size, 2);
    const headers = { Authorization: `Bearer ${reader.readerCredential}` };
    let sessions: any[] = [];
    for (let attempt = 0; attempt < 100; attempt++) {
      sessions = (await (await fetch(`${origin}/api/sessions`, { headers })).json()).sessions;
      if (sessions.length === 2 && sessions.every(session => session.hash === completedHashes.get(session.source_session_id))) break;
      await setTimeout(100);
    }
    assert.equal(sessions.length, 2, 'ordinary CLI hooks automatically qualify both projects');
    assert.ok(sessions.every(session => session.hash === completedHashes.get(session.source_session_id)), 'background reconciliation captures final asynchronously flushed bytes in both projects');
    const session = sessions.find(item => item.source_session_id === ids.A)!;
    const detail = await (await fetch(`${origin}/api/snapshots/${session.id}`, { headers })).json();
    assert.ok(detail.events.some((event: any) => event.role === 'tool request' && event.text.includes('Read')));
    assert.ok(detail.events.some((event: any) => event.role === 'tool result' && event.text.includes(marker)));
    assert.equal(detail.manifest.source, 'claude-code-cli');
    const readable = await (await fetch(`${origin}/api/snapshots/${session.id}/readable`, { headers })).text();
    assert.ok(readable.includes('claude-jsonl-2') && readable.includes(marker));
    browser = await chromium.launch();
    const page = await browser.newPage(); await page.goto(origin);
    await page.getByLabel('个人读取凭据').fill(reader.readerCredential); await page.getByRole('button', { name: '进入存档' }).click();
    await page.getByRole('link').filter({ hasText: projects.A }).click();
    await expect(page.getByRole('article', { name: '会话详情' }).getByText(marker, { exact: false }).first()).toBeVisible();
    await page.screenshot({ path: join(directory, 'native-claude-web.png'), fullPage: true });
    const packagePath = join(directory, 'server-only.skynet-recovery.json');
    const download = await fetch(`${origin}/api/snapshots/${session.id}/recovery`, { headers }); assert.equal(download.status, 200);
    const bundleBytes = Buffer.from(await download.arrayBuffer()); await writeFile(packagePath, bundleBytes);
    const original = Buffer.from(await (await fetch(`${origin}/api/snapshots/${session.id}/raw`, { headers })).arrayBuffer());
    await sandbox.stopCollector();
    if (installedState) await stopInstalled(installedState);
    assert.equal(dirname(resolve(sourceHome)), resolve(directory), 'recursive deletion is confined to this generated test home');
    await rm(sourceHome, { recursive: true, maxRetries: 20, retryDelay: 100 });
    await assert.rejects(access(sourceConfig), { code: 'ENOENT' });
    const target = join(directory, 'restored-config');
    const receipt = JSON.parse(await command(process.execPath, ['dist/apps/collector/cli.js', 'restore', '--package', packagePath,
      '--target', target, '--runtime', runtime], sandbox.env));
    assert.equal(receipt.state, 'prepared-claude-unverified'); assert.equal(receipt.sourceSessionId, ids.A);
    assert.deepEqual(await readFile(receipt.rolloutPath), original, 'only server-returned bytes seed the new native config');
    assert.deepEqual((await readdir(target)).sort(), ['projects', 'restore-receipt.json']);
    const restoredHome = join(directory, 'restored-user'); const restoredWorkspace = join(directory, 'restored-workspace');
    await mkdir(restoredWorkspace);
    const restoredEnv = await nativeEnv(restoredHome, target);
    const resumedEmployee = await sandbox.provision('恢复后的 Claude 员工乙');
    const resumedState = join(directory, 'restored-collector-B');
    const resumedSetup = JSON.parse(await sandbox.collectorCommand('setup', resumedState, { server: origin,
      enrollmentCredential: resumedEmployee.enrollmentCredential, nativeRoot: join(target, 'projects'), source: 'claude-code-cli', sourceVersion: '2.1.281', sourceOs: process.platform }));
    const hooksFor = (collectorState: string) => Object.fromEntries(['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'Stop', 'SessionEnd'].map(event => [event,
      [{ hooks: [{ type: 'command', command: process.execPath, args: [resolve('dist/apps/collector/cli.js'), 'hook', '--state', collectorState] }] }]]));
    await writeFile(join(target, 'settings.json'), JSON.stringify({ hooks: hooksFor(resumedState) }));
    const beforeResume = requests.length;
    await writeFile(join(directory, 'claude-resumed.jsonl'), await runNative(restoredEnv, restoredWorkspace, ids.A, 'SKYNET_CLAUDE_RESUME: continue with previous tool history.', true));
    const continuation = requests.slice(beforeResume).find(item => item.url.startsWith('/v1/messages'));
    assert.ok(continuation);
    const history = JSON.stringify(continuation.body.messages);
    assert.ok(history.includes('SKYNET_PROJECT_A')); assert.ok(history.includes(marker));
    const blocks = continuation.body.messages.flatMap((m: any) => Array.isArray(m.content) ? m.content : []);
    assert.ok(blocks.some((b: any) => b.type === 'tool_use' && b.name === 'Read'));
    assert.ok(blocks.some((b: any) => b.type === 'tool_result' && JSON.stringify(b.content).includes(marker)));
    await sandbox.collectorCommand('run', resumedState);
    const resumedSessions = (await (await fetch(`${origin}/api/sessions`, { headers })).json()).sessions;
    const resumedSession = resumedSessions.find((item: any) => item.employee === resumedEmployee.name || item.employee === '恢复后的 Claude 员工乙');
    assert.ok(resumedSession, 'normal restored native hooks qualify the new bound employee device');
    const resumedDetail = await (await fetch(`${origin}/api/snapshots/${resumedSession.id}`, { headers })).json();
    assert.equal(resumedDetail.provenance.relation, 'verified-restoration');
    assert.equal(resumedDetail.manifest.restoredFrom.snapshotId, session.id);
    const oldEventIds = detail.events.map((event: any) => event.origin.eventId);
    assert.ok(oldEventIds.every((id: string) => resumedDetail.events.some((event: any) => event.origin.eventId === id && event.origin.employeeId === employee.employeeId)));
    assert.ok(resumedDetail.events.some((event: any) => event.role === 'user' && event.text.includes('SKYNET_CLAUDE_RESUME')
      && event.origin.employeeId === resumedEmployee.employeeId && event.origin.deviceId === resumedSetup.deviceId));
    const secondPackage = join(directory, 'server-only-B.skynet-recovery.json');
    await writeFile(secondPackage, Buffer.from(await (await fetch(`${origin}/api/snapshots/${resumedSession.id}/recovery`, { headers })).arrayBuffer()));
    await sandbox.stopCollector();
    const secondTarget = join(directory, 'restored-config-C');
    const secondReceipt = JSON.parse(await command(process.execPath, ['dist/apps/collector/cli.js', 'restore', '--package', secondPackage,
      '--target', secondTarget, '--runtime', runtime], sandbox.env));
    const thirdState = join(directory, 'restored-collector-C');
    const thirdSetup = JSON.parse(await sandbox.collectorCommand('setup', thirdState, { server: origin, enrollmentCredential: employee.enrollmentCredential,
      nativeRoot: join(secondTarget, 'projects'), source: 'claude-code-cli', sourceVersion: '2.1.281', sourceOs: process.platform }));
    await writeFile(join(secondTarget, 'settings.json'), JSON.stringify({ hooks: hooksFor(thirdState) }));
    const thirdEnv = await nativeEnv(join(directory, 'restored-user-C'), secondTarget);
    await writeFile(join(directory, 'claude-resumed-C.jsonl'), await runNative(thirdEnv, restoredWorkspace, ids.A, 'SKYNET_CLAUDE_RESUME_C: preserve the complete A and B history.', true));
    await sandbox.collectorCommand('run', thirdState);
    const finalSessions = (await (await fetch(`${origin}/api/sessions`, { headers })).json()).sessions;
    const finalSession = finalSessions.find((item: any) => item.source_session_id === ids.A && item.id !== session.id && item.id !== resumedSession.id);
    assert.ok(finalSession);
    const finalDetail = await (await fetch(`${origin}/api/snapshots/${finalSession.id}`, { headers })).json();
    assert.equal(finalDetail.provenance.relation, 'verified-restoration');
    assert.equal(finalDetail.provenance.sourceSnapshotId, resumedSession.id);
    assert.ok(resumedDetail.events.every((old: any) => finalDetail.events.some((event: any) => event.origin.eventId === old.origin.eventId
      && event.origin.employeeId === old.origin.employeeId && event.origin.project === old.origin.project)));
    assert.ok(finalDetail.events.some((event: any) => event.text.includes('SKYNET_CLAUDE_RESUME_C') && event.origin.deviceId === thirdSetup.deviceId));
    const finalReadable = await (await fetch(`${origin}/api/snapshots/${finalSession.id}/readable`, { headers })).text();
    assert.ok(finalReadable.includes(resumedSetup.deviceId));
    assert.ok(finalDetail.events.every((event: any) => finalReadable.includes(event.origin.snapshotId)), 'readable export uses the original immutable evidence anchors, which can predate the latest A snapshot');
    const stats = await (await fetch(`${origin}/api/activity-statistics`, { headers })).json();
    await page.goto(`${origin}/#${finalSession.id}`);
    await expect(page.getByRole('region', { name: '历史归属' })).toContainText('服务器已核对恢复来源');
    await expect(page.getByRole('region', { name: '跨设备去重统计' })).toContainText('恢复后的 Claude 员工乙');
    await page.screenshot({ path: join(directory, 'native-claude-cross-device.png'), fullPage: true });
    await writeFile(join(directory, 'native-cross-device-evidence.json'), JSON.stringify({ sourceSnapshotId: session.id, secondSnapshotId: resumedSession.id,
      thirdSnapshotId: finalSession.id, secondReceipt, preservedOrigins: finalDetail.events.map((event: any) => event.origin), statistics: stats,
      normalRestoredHooks: true, AtoBtoC: true, sameOsUserDifferentBindings: true, exactHistoricalAndNewOwners: true, model: 'synthetic loopback' }, null, 2));
    const evidence = { testedAt: new Date().toISOString(), client: 'claude-code-cli', version: '2.1.281', os: process.platform, arch: process.arch,
      ordinaryHostHooks: true, twoProjects: true, serverPackageOnly: true, sourceHomeRemoved: true,
      npmIgnoreScriptsSetup: !!process.env.SKYNET_TEST_INSTALLER, pluginMarketplaceSetup: process.env.SKYNET_TEST_PLUGINS ?? false,
      exactArchivedBytesRestored: true, nativeContextAndToolHistoryRetained: true, syntheticProvider: true, liveModel: 'unverified', G0: 'unverified' };
    await writeFile(join(directory, 'native-claude-evidence.json'), JSON.stringify(evidence, null, 2));
    console.log(`Claude native public-flow evidence: ${join(directory, 'native-claude-evidence.json')}`);
  } finally { try { if (installedState) await stopInstalled(installedState); await browser?.close(); } finally { provider.closeAllConnections(); provider.close(); await sandbox.close(); } }
});
