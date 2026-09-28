import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { command } from './support.js';
import { mcpSandbox } from './mcp-support.js';

const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');
const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
function objects(value: unknown): any[] {
  if (typeof value === 'string' && /^[\[{]/.test(value.trim())) { try { return objects(JSON.parse(value)); } catch { return []; } }
  if (!value || typeof value !== 'object') return [];
  return [value, ...Object.values(value).flatMap(objects)];
}

test('installed Claude and Codex authorize via HTTPS DCR/PKCE and read paged product tools', { timeout: 240_000 }, async () => {
  const codex = process.env.SKYNET_CODEX_CLI; const claude = process.env.SKYNET_CLAUDE_RUNTIME;
  const ptyRoot = process.env.SKYNET_NODE_PTY_ROOT;
  assert.ok(codex && claude && ptyRoot, 'Set SKYNET_CODEX_CLI (0.157.1), SKYNET_CLAUDE_RUNTIME (2.1.281) and SKYNET_NODE_PTY_ROOT');
  const sandbox = await mcpSandbox(); const active = new Set<ChildProcess>();
  const requests: { client: string; body: any }[] = []; let current: 'codex' | 'claude' = 'codex'; let step = 0; let phase = 0;
  let snapshotId = ''; const marker = 'SKYNET_NATIVE_MCP_COMPLETE_682';
  const largeText = '大工具😀证据'.repeat(1500) + marker;
  let rawBytes = Buffer.alloc(0);
  const provider = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = []; for await (const part of request) chunks.push(part);
      const text = Buffer.concat(chunks).toString('utf8');
      if (request.method !== 'POST' || !(/\/(?:responses|messages)(?:\?|$)/.test(request.url!))) { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end('{}'); return; }
      const body = JSON.parse(text); requests.push({ client: current, body });
      const output = objects(current === 'codex' ? body.input : body.messages);
      const listed = output.find(item => item.sessions && item.nextCursor);
      const lastPage = output.findLast(item => item.snapshotId === snapshotId && Array.isArray(item.events));
      const exportPage = output.findLast(item => item.snapshotId === snapshotId && typeof item.data === 'string');
      let next: { name: string; input: Record<string, unknown> } | undefined;
      if (phase === 0) { next = { name: 'list_sessions', input: { limit: 2 } }; phase++; }
      else if (phase === 1) { next = { name: 'list_sessions', input: { limit: 2, cursor: listed?.nextCursor } }; phase++; }
      else if (phase === 2) { next = { name: 'read_snapshot', input: { snapshotId } }; phase++; }
      else if (phase === 3 && lastPage?.next) next = { name: 'read_snapshot', input: { snapshotId, ...lastPage.next } };
      else if (phase === 3) { next = { name: 'prepare_export', input: { snapshotId, format: 'recovery' } }; phase++; }
      else if (phase === 4) { next = { name: 'read_export', input: { snapshotId, format: 'raw' } }; phase++; }
      else if (phase === 5 && exportPage?.nextOffset !== null) next = { name: 'read_export', input: { snapshotId, format: 'raw', offset: exportPage?.nextOffset } };
      step++;
      if (current === 'codex') {
        const namespace = body.tools.find((tool: any) => tool.type === 'namespace' && tool.name === 'mcp__skynet_archive');
        if (!namespace) throw new Error('Codex did not discover product MCP tools');
        const item = next
          ? { id: `fc_${step}`, type: 'function_call', status: 'completed', call_id: `mcp_${step}`, namespace: namespace.name, name: next.name, arguments: JSON.stringify(next.input) }
          : { id: `msg_${step}`, type: 'message', role: 'assistant', status: 'completed', phase: 'final_answer', content: [{ type: 'output_text', text: 'Synthetic MCP reads completed.', annotations: [] }] };
        const result = { id: `resp_${step}`, object: 'response', created_at: Math.floor(Date.now() / 1000), status: 'completed', model: 'skynet-fixture', output: [item], usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 } };
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        for (const [type, fields] of [['response.created', { response: { ...result, status: 'in_progress', output: [] } }],
          ['response.output_item.added', { output_index: 0, item: { ...item, status: 'in_progress' } }], ['response.output_item.done', { output_index: 0, item }], ['response.completed', { response: result }]] as const) {
          response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...fields })}\n\n`);
        }
        response.end();
      } else {
        const name = next ? `mcp__skynet_archive__${next.name}` : '';
        if (next && !body.tools.some((tool: any) => tool.name === name)) throw new Error('Claude did not discover product MCP tools');
        const block = next ? { type: 'tool_use', id: `toolu_mcp_${step}`, name, input: next.input } : { type: 'text', text: 'Synthetic MCP reads completed.' };
        const stop = next ? 'tool_use' : 'end_turn';
        const message = { id: `msg_mcp_${step}`, type: 'message', role: 'assistant', model: body.model, content: [block], stop_reason: stop, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 10 } };
        if (!body.stream) { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(message)); return; }
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const send = (type: string, value: unknown) => response.write(`event: ${type}\ndata: ${JSON.stringify(value)}\n\n`);
        send('message_start', { type: 'message_start', message: { ...message, content: [], stop_reason: null, usage: { input_tokens: 100, output_tokens: 0 } } });
        send('content_block_start', { type: 'content_block_start', index: 0, content_block: next ? { ...block, input: {} } : { type: 'text', text: '' } });
        send('content_block_delta', { type: 'content_block_delta', index: 0, delta: next ? { type: 'input_json_delta', partial_json: JSON.stringify(next.input) } : { type: 'text_delta', text: 'Synthetic MCP reads completed.' } });
        send('content_block_stop', { type: 'content_block_stop', index: 0 });
        send('message_delta', { type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 10 } }); send('message_stop', { type: 'message_stop' }); response.end();
      }
    } catch (error) { console.error((error as Error).message); response.writeHead(500); response.end(); }
  });
  try {
    provider.listen(0, '127.0.0.1'); await once(provider, 'listening');
    const providerOrigin = `http://127.0.0.1:${(provider.address() as { port: number }).port}`;
    const employee = await sandbox.provision('原生 MCP 合成员工'); const reader = await sandbox.provision('原生 MCP 合成读者');
    const enrollment = await (await sandbox.api('/api/devices/enroll', employee.enrollmentCredential, json({ installationId: randomUUID(), name: 'native MCP fixture' }))).json();
    for (let index = 0; index < 3; index++) {
      const id = randomUUID();
      const bytes = Buffer.from([ { type: 'session_meta', payload: { id, cli_version: '0.158.0-alpha.2.1' } },
        { type: 'response_item', payload: { type: 'function_call_output', call_id: 'tool', output: largeText } } ].map(item => JSON.stringify(item)).join('\n') + '\n');
      await sandbox.api(`/api/chunks/${sha256(bytes)}`, enrollment.deviceCredential, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes });
      const committed = await (await sandbox.api('/api/snapshots', enrollment.deviceCredential, json({ protocolVersion: 1, sourceSessionId: id, source: 'codex-desktop',
        sourceVersion: '26.924.2738.0', sourceOs: 'win32', project: `/synthetic/native-mcp-${index}`, hash: sha256(bytes), byteLength: bytes.length,
        qualifiedAt: new Date().toISOString(), capability: 'unverified' }))).json();
      snapshotId = committed.snapshotId; rawBytes = bytes;
    }
    for (const kind of ['codex', 'claude'] as const) {
      current = kind; step = 0; phase = 0;
      const root = join(sandbox.directory, kind); const home = join(root, 'user'); const config = join(home, kind === 'codex' ? '.codex' : '.claude');
      const workspace = join(root, 'project');
      for (const directory of [home, config, workspace, join(home, 'AppData/Roaming'), join(home, 'AppData/Local'), join(home, 'tmp')]) await mkdir(directory, { recursive: true });
      const env: NodeJS.ProcessEnv = { ...Object.fromEntries(['SystemRoot', 'WINDIR', 'COMSPEC', 'PATH', 'PATHEXT', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramData'].filter(key => process.env[key]).map(key => [key, process.env[key]])),
        HOME: home, USERPROFILE: home, APPDATA: join(home, 'AppData/Roaming'), LOCALAPPDATA: join(home, 'AppData/Local'), TEMP: join(home, 'tmp'), TMP: join(home, 'tmp'),
        CODEX_HOME: config, CLAUDE_CONFIG_DIR: config, CLAUDE_CODE_TMPDIR: join(home, 'tmp'), CODEX_CA_CERTIFICATE: sandbox.ca, SSL_CERT_FILE: sandbox.ca, NODE_EXTRA_CA_CERTS: sandbox.ca,
        ANTHROPIC_BASE_URL: providerOrigin, ANTHROPIC_API_KEY: 'synthetic-loopback-only', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_AUTOUPDATER: '1',
        CLAUDE_CODE_GIT_BASH_PATH: 'C:/Program Files/Git/bin/bash.exe' };
      await command('git', ['init', '--quiet', workspace], env);
      const runtime: string = (kind === 'codex' ? codex : claude)!;
      const version: string = (await command(runtime, ['--version'], env)).trim();
      assert.equal(version, kind === 'codex' ? 'codex-cli 0.157.1' : '2.1.281 (Claude Code)');
      if (kind === 'codex') await writeFile(join(config, 'config.toml'), `model="skynet-fixture"\nmodel_provider="skynet-local"\ncli_auth_credentials_store="file"\nmcp_oauth_credentials_store="file"\nsandbox_mode="read-only"\n[analytics]\nenabled=false\n[feedback]\nenabled=false\n[model_providers.skynet-local]\nname="Synthetic loopback"\nbase_url="${providerOrigin}/v1"\nwire_api="responses"\nrequires_openai_auth=false\n[mcp_servers.skynet_archive]\nurl="${sandbox.origin}/mcp"\n`);
      else await command(runtime!, ['mcp', 'add', '--transport', 'http', '--scope', 'user', 'skynet_archive', `${sandbox.origin}/mcp`], env);
      const prefix = kind === 'codex' ? ['--no-daemon'] : [];
      const loginArgs = [...prefix, 'mcp', 'login', '--no-browser', ...(kind === 'codex' ? ['--oauth-client-registration', 'dcr'] : []), 'skynet_archive'];
      const login = kind === 'codex'
        ? spawn(runtime!, loginArgs, { cwd: workspace, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
        : spawn(process.execPath, ['--import', 'tsx', 'tests/mcp-login-terminal.ts'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      if (kind === 'claude') login.stdin.write(JSON.stringify({ runtime, args: loginArgs, env, cwd: workspace, ptyRoot }) + '\n');
      active.add(login);
      let loginOutput = ''; let authorizing = false; let authorizationError: unknown;
      const timer = setTimeout(() => login.kill(), 45_000);
      const collect = (part: Buffer) => {
        loginOutput += part.toString();
        const match = /https:\/\/127\.0\.0\.1:\d+\/oauth\/authorize\?[^\s\x1b]+/.exec(loginOutput);
        if (match && !authorizing) {
          authorizing = true;
          void sandbox.authorizationPage(match[0], reader.readerCredential).then(callback => login.stdin.write(callback + '\n')).catch(error => { authorizationError = error; login.kill(); });
        }
      };
      login.stdout.on('data', collect); login.stderr.on('data', collect);
      const [code] = await once(login, 'exit'); clearTimeout(timer); active.delete(login);
      if (authorizationError) throw authorizationError;
      // OAuth logs can include expiring secrets: only print the diagnostic if login failed, with query strings removed.
      assert.equal(code, 0, `${kind} login failed: ${loginOutput.replace(/https?:\/\/[^\s]+/g, value => value.split('?')[0]!)}`);
      assert.ok(authorizing, `${kind} used the product authorization page`);
      const args = kind === 'codex' ? [...prefix, 'exec', '--json', 'Read the synthetic archive using its MCP tools; follow their pagination and prepare the recovery export.']
        : ['--print', '--output-format', 'stream-json', '--verbose', '--tools', '', '--allowedTools', 'mcp__skynet_archive__list_sessions', 'mcp__skynet_archive__read_snapshot', 'mcp__skynet_archive__prepare_export', 'mcp__skynet_archive__read_export',
          '--permission-prompts', 'none', '--model', 'claude-sonnet-4-5', '--setting-sources', 'user'];
      const child = spawn(runtime!, args, { cwd: workspace, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); active.add(child);
      let stdout = ''; let stderr = ''; child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
      child.stdout.on('data', part => stdout += part); child.stderr.on('data', part => stderr += part);
      const runTimer = setTimeout(() => child.kill(), 90_000); child.stdin.end(kind === 'claude' ? 'Read the synthetic archive via MCP, page the evidence and prepare its export.' : '');
      const [runCode] = await once(child, 'exit'); clearTimeout(runTimer); active.delete(child);
      await writeFile(join(root, 'native-output.jsonl'), stdout);
      await writeFile(join(root, 'model-requests.json'), JSON.stringify(requests.filter(request => request.client === kind)));
      assert.equal(runCode, 0, `${kind}: ${stderr}`);
      const history = objects(requests.filter(request => request.client === kind).at(-1)!.body);
      const lists = history.filter(item => Array.isArray(item.sessions)); assert.ok(lists.some(item => item.nextCursor) && lists.some(item => item.nextCursor === null), `${kind} paged sessions`);
      const pages = history.filter(item => item.snapshotId === snapshotId && Array.isArray(item.events));
      assert.equal(sha256(Buffer.from(pages.flatMap(page => page.events).map(event => event.text).join(''))), sha256(Buffer.from(largeText)), `${kind} got every large-output character`);
      assert.ok(history.some(item => item.format === 'recovery' && item.authentication?.includes('MCP access token')));
      const exported = history.filter(item => item.snapshotId === snapshotId && item.format === 'raw' && typeof item.data === 'string');
      assert.equal(sha256(Buffer.concat(exported.map(page => Buffer.from(page.data, 'base64')))), sha256(rawBytes));
      console.log(`${kind} ${version}: HTTPS consent + DCR/PKCE + ${step - 1} real MCP tool calls passed`);
    }
    await writeFile(join(sandbox.directory, 'native-mcp-evidence.json'), JSON.stringify({ sources: ['codex-cli 0.157.1', 'claude-code 2.1.281'],
      publicOrigin: sandbox.origin, testCa: 'isolated process only; TLS verification enabled',
      consentBrowser: 'Playwright page with fixed-origin CA-validating HTTPS adapter; callback passed to normal headless login',
      model: 'deterministic loopback only; no paid calls', snapshotId, originalSha256: sha256(rawBytes), traffic: sandbox.traffic,
      modelRequests: requests }, null, 2));
    console.log(`Native MCP evidence: ${sandbox.directory}`);
  } finally {
    for (const child of active) { child.kill(); await once(child, 'exit').catch(() => undefined); }
    await new Promise<void>(resolve => provider.close(() => resolve())); await sandbox.close();
  }
});
