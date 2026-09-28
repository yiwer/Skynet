import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { join, resolve } from 'node:path';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import { chromium, expect, type Browser } from '@playwright/test';
import { command, createSandbox } from './support.js';
import { installAgent, stopInstalled } from './installed-support.js';

test('normally trusted Codex CLI hooks archive two projects and server-only restore retains native history', { timeout: 240_000 }, async () => {
  const runtime = process.env.SKYNET_CODEX_CLI;
  const ptyRoot = process.env.SKYNET_NODE_PTY_ROOT;
  assert.ok(runtime && ptyRoot, 'Set SKYNET_CODEX_CLI and SKYNET_NODE_PTY_ROOT (external test-only node-pty install)');
  assert.equal(process.platform, 'win32'); assert.equal(process.arch, 'x64');
  assert.equal((await command(runtime, ['--version'], process.env)).trim(), 'codex-cli 0.157.1');
  const sandbox = await createSandbox(); let browser: Browser | undefined;
  const requests: any[] = [];
  const toolMarker = 'SKYNET_CLI_READ_TOOL_793';
  const provider = createServer(async (request, response) => {
    try {
      let raw = ''; for await (const chunk of request) raw += chunk;
      if (request.method !== 'POST') { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end('{"data":[]}'); return; }
      const body = JSON.parse(raw); requests.push(body); await writeFile(join(sandbox.directory, 'provider-request.json'), JSON.stringify(body, null, 2));
      const input = JSON.stringify(body.input);
      const namespace = body.tools.find((tool: any) => tool.type === 'namespace' && tool.name === 'mcp__skynet_fixture');
      const name = namespace?.tools.find((tool: any) => tool.name === 'read_fixture')?.name;
      if (!name) throw new Error('Native CLI did not register the synthetic MCP tool');
      const n = requests.length;
      const item = !input.includes(toolMarker)
        ? { id: `fc_${n}`, type: 'function_call', status: 'completed', call_id: `fixture_call_${n}`, namespace: namespace.name, name, arguments: '{}' }
        : { id: `msg_${n}`, type: 'message', role: 'assistant', status: 'completed', phase: 'final_answer',
          content: [{ type: 'output_text', text: 'Synthetic CLI source or continuation completed.', annotations: [] }] };
      const result = { id: `resp_${n}`, object: 'response', created_at: Math.floor(Date.now() / 1000), status: 'completed',
        model: 'skynet-fixture', output: [item], usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 } };
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const send = (type: string, fields: object) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...fields })}\n\n`);
      send('response.created', { response: { ...result, status: 'in_progress', output: [] } });
      send('response.output_item.added', { output_index: 0, item: { ...item, status: 'in_progress' } });
      send('response.output_item.done', { output_index: 0, item }); send('response.completed', { response: result }); response.end();
    } catch (error) { console.error((error as Error).message); response.writeHead(500); response.end(); }
  });
  const sourceHome = join(sandbox.directory, 'cli-source');
  let state = join(sandbox.directory, 'collector'); let installedState: string | undefined;
  const alpha = join(sandbox.directory, 'project-alpha'); const beta = join(sandbox.directory, 'project-beta');
  const target = join(sandbox.directory, 'cli-restored');
  const restoredWorkspace = join(sandbox.directory, 'restored-project');
  const envFor = (home: string): NodeJS.ProcessEnv => ({ ...Object.fromEntries(['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'PATH', 'PATHEXT',
    'COMSPEC', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramData'].filter(key => process.env[key]).map(key => [key, process.env[key]])),
    CODEX_HOME: home, HOME: join(sandbox.directory, 'user'), USERPROFILE: join(sandbox.directory, 'user'),
    APPDATA: join(sandbox.directory, 'appdata'), LOCALAPPDATA: join(sandbox.directory, 'localappdata'), TERM: 'xterm-256color' });
  async function native(home: string, cwd: string, args: string[]) {
    const child = spawn(runtime!, ['--no-daemon', ...args], { cwd, env: envFor(home), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; let error = ''; child.stdout.on('data', part => { output += part; }); child.stderr.on('data', part => { error += part; });
    const timer = globalThis.setTimeout(() => child.kill(), 45_000);
    try { const [code] = await once(child, 'exit'); await writeFile(join(sandbox.directory, 'native-output.jsonl'), output); assert.equal(code, 0, error); return output; }
    finally { clearTimeout(timer); }
  }
  async function reviewHook() {
    await command(process.execPath, ['dist/tests/codex-hook-review.js'], process.env,
      JSON.stringify({ runtime, ptyRoot, alpha, sourceHome, directory: sandbox.directory, env: envFor(sourceHome), allHooks: !!installedState,
        probePrompt: installedState ? 'Synthetic interactive project alpha. Read the fixture to confirm native capture.' : undefined }));
    if (installedState) {
      const metadata = [];
      for (const file of await readdir(join(sourceHome, 'sessions'), { recursive: true })) if (file.endsWith('.jsonl')) {
        const record = JSON.parse((await readFile(join(sourceHome, 'sessions', file), 'utf8')).split('\n')[0]!);
        metadata.push({ id: record.payload.id, source: record.payload.source, originator: record.payload.originator, cliVersion: record.payload.cli_version });
      }
      await writeFile(join(sandbox.directory, 'installed-native-metadata.json'), JSON.stringify(metadata, null, 2));
    }
  }

  try {
    provider.listen(0, '127.0.0.1'); await once(provider, 'listening');
    const port = (provider.address() as { port: number }).port;
    for (const directory of [sourceHome, join(sourceHome, 'sessions'), alpha, beta, restoredWorkspace, join(sandbox.directory, 'user'), join(sandbox.directory, 'appdata'), join(sandbox.directory, 'localappdata')]) await mkdir(directory, { recursive: true });
    for (const cwd of [alpha, beta, restoredWorkspace]) {
      const git = spawn('git', ['init', '--quiet', cwd], { windowsHide: true, env: envFor(sourceHome), stdio: 'ignore' });
      assert.equal((await once(git, 'exit'))[0], 0);
    }
    const fixture = join(sandbox.directory, 'fixture.ts');
    await writeFile(fixture, `// ${toolMarker}\nexport const syntheticValue = 42;\n`);
    const mcp = join(sandbox.directory, 'fixture-mcp.mjs');
    await writeFile(mcp, `import{createInterface}from'node:readline';import{readFileSync}from'node:fs';createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.id===undefined)return;let result;if(m.method==='initialize')result={protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'skynet-synthetic',version:'1'}};else if(m.method==='tools/list')result={tools:[{name:'read_fixture',description:'Read a fixed synthetic fixture, without modifying anything.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false}}]};else if(m.method==='tools/call')result={content:[{type:'text',text:readFileSync(process.argv[2],'utf8')}],isError:false};else result={};process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');});`);
    async function configure(home: string) {
      await writeFile(join(home, 'config.toml'), `model = "skynet-fixture"\nmodel_provider = "skynet-local"\ncli_auth_credentials_store = "file"\nsandbox_mode = "read-only"\n[analytics]\nenabled = false\n[feedback]\nenabled = false\n[model_providers.skynet-local]\nname = "Synthetic loopback provider"\nbase_url = "http://127.0.0.1:${port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n[mcp_servers.skynet_fixture]\ncommand = ${JSON.stringify(process.execPath)}\nargs = ${JSON.stringify([mcp, fixture])}\n`);
    }
    await configure(sourceHome);
    const cliPath = resolve('dist/apps/collector/cli.js');
    if (!process.env.SKYNET_TEST_INSTALLER) await writeFile(join(sourceHome, 'hooks.json'), JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command',
      command: `"${process.execPath}" "${cliPath}" hook --state "${state}"`,
      commandWindows: `& '${process.execPath}' '${cliPath}' hook --state '${state}'`, timeout: 3 }] }] } }, null, 2));
    const employee = await sandbox.provision('真实 CLI 合成活动员工');
    const reader = await sandbox.provision('真实 CLI 合成活动读者');
    const origin = await sandbox.startServer();
    if (process.env.SKYNET_TEST_INSTALLER) {
      const installed = await installAgent(sandbox.directory, origin, envFor(sourceHome), employee.enrollmentCredential);
      installedState = installed.status.stateDirectory; state = join(installedState!, 'sources', 'codex-cli');
      assert.equal(installed.status.clients.find((item: any) => item.source === 'codex-cli').detected, true);
    } else await sandbox.collectorCommand('setup', state, { server: origin, enrollmentCredential: employee.enrollmentCredential,
      source: 'codex-cli', nativeRoot: join(sourceHome, 'sessions'), sourceVersion: '0.157.1', sourceOs: 'win32' });
    await reviewHook();
    console.log(`Normal product hook review evidence: ${sandbox.directory}`);
    if (!installedState) await sandbox.startCollector(state);
    const alphaOutput = await native(sourceHome, alpha, ['exec', '--json', 'Synthetic project alpha. Remember SKYNET_CLI_PROJECT_ALPHA_381 and read the fixture.']);
    const alphaId = alphaOutput.trim().split('\n').map(line => JSON.parse(line)).find(item => item.type === 'thread.started').thread_id;
    await native(sourceHome, beta, ['exec', '--json', 'Synthetic project beta. Remember SKYNET_CLI_PROJECT_BETA_482 and read the fixture.']);
    const headers = { Authorization: `Bearer ${reader.readerCredential}` };
    let sessions: any[] = []; let selected: any;
    const expectedSessions = installedState ? 3 : 2;
    for (let attempt = 0; attempt < 100; attempt++) {
      sessions = (await (await fetch(`${origin}/api/sessions`, { headers })).json()).sessions;
      selected = sessions.find(item => item.source_session_id === alphaId);
      if (sessions.length === expectedSessions && selected) {
        const details = await Promise.all(sessions.map(async session => (await fetch(`${origin}/api/snapshots/${session.id}`, { headers })).json()));
        if (details.every(detail => detail.events.some((item: any) => item.role === 'tool result' && item.text.includes(toolMarker)))) break;
      }
      await setTimeout(200);
    }
    assert.equal(sessions.length, expectedSessions, 'real CLI projects and the optional installed interactive session reached the archive via normal trusted hooks');
    assert.ok(sessions.every(item => item.source === 'codex-cli' && item.source_version === '0.157.1'));
    for (const session of sessions) {
      const detail = await (await fetch(`${origin}/api/snapshots/${session.id}`, { headers })).json();
      assert.ok(detail.events.some((item: any) => item.role === 'tool result' && item.text.includes(toolMarker)));
    }
    browser = await chromium.launch(); const page = await browser.newPage();
    await page.goto(`${origin}/#${selected.id}`); await page.getByLabel('个人读取凭据').fill(reader.readerCredential);
    await page.getByRole('button', { name: '进入存档' }).click();
    await expect(page.getByRole('article').getByText(toolMarker, { exact: false })).toBeVisible();
    await page.screenshot({ path: join(sandbox.directory, 'codex-cli-real-hook-web.png'), fullPage: true });
    const raw = Buffer.from(await (await fetch(`${origin}/api/snapshots/${selected.id}/raw`, { headers })).arrayBuffer());
    const packagePath = join(sandbox.directory, 'server-download.skynet-recovery.json');
    await writeFile(packagePath, Buffer.from(await (await fetch(`${origin}/api/snapshots/${selected.id}/recovery`, { headers })).arrayBuffer()));
    await sandbox.stopCollector();
    if (installedState) await stopInstalled(installedState);
    assert.equal(resolve(sourceHome), join(resolve(sandbox.directory), 'cli-source'));
    await rm(sourceHome, { recursive: true, maxRetries: 20, retryDelay: 100 });
    const receipt = JSON.parse(await command(process.execPath, ['dist/apps/collector/cli.js', 'restore', '--package', packagePath,
      '--target', target, '--source-version', '0.157.1', '--runtime', runtime], sandbox.env));
    assert.equal(receipt.state, 'prepared-cli'); assert.deepEqual(await readFile(receipt.rolloutPath), raw);
    assert.deepEqual((await readdir(target)).sort(), ['restore-receipt.json', 'sessions']);
    await configure(target); const before = requests.length;
    await native(target, restoredWorkspace, ['exec', 'resume', '--json', alphaId, 'Synthetic continuation. Recall the prior project and tool result.']);
    const restoredInput = JSON.stringify(requests[before]?.input);
    assert.ok(restoredInput.includes('SKYNET_CLI_PROJECT_ALPHA_381')); assert.ok(restoredInput.includes(toolMarker));
    await writeFile(join(sandbox.directory, 'codex-cli-native-evidence.json'), JSON.stringify({ at: new Date().toISOString(),
      source: 'codex-cli', version: '0.157.1', os: 'win32', arch: 'x64', normalHookReview: true, twoProjectsArchived: true,
      serverOnlyRestore: true, sourceHomeRemoved: true, contextAndToolHistoryRetained: true,
      npmIgnoreScriptsSetup: !!installedState, interactiveAndExecCaptured: !!installedState,
      toolScope: 'ordinary read-only MCP fixture; no shell sandbox changes or real code edit performed',
      provider: 'synthetic loopback; no credentials', desktopAcceptance: 'not established' }, null, 2));
    console.log(`Codex CLI native evidence: ${join(sandbox.directory, 'codex-cli-native-evidence.json')}`);
  } finally { try { if (installedState) await stopInstalled(installedState); await browser?.close(); } finally { provider.closeAllConnections(); provider.close(); await sandbox.close(); } }
});
