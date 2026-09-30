import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { join, relative, resolve } from 'node:path';
import { mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import { deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { command, createSandbox, stop } from './support.js';

// Explicit opt-in integration test: a real installed native runtime, synthetic local provider,
// no login credentials, host hooks, trust flags, or source-state fallback during restoration.
test('native fork, parent image and tool history survive server material package alone in a fresh native home', { timeout: 180_000 }, async () => {
  const sourceKind = process.env.SKYNET_MATERIAL_SOURCE ?? 'codex-desktop';
  assert.ok(['codex-desktop', 'codex-cli'].includes(sourceKind));
  const sourceVersion = sourceKind === 'codex-cli' ? '0.157.1' : '26.924.2738.0';
  const runtimeVersion = sourceKind === 'codex-cli' ? '0.157.1' : '0.158.0-alpha.2.1';
  const runtime = sourceKind === 'codex-cli' ? process.env.SKYNET_CODEX_CLI : process.env.SKYNET_CODEX_RUNTIME;
  assert.ok(runtime, 'Set SKYNET_CODEX_RUNTIME or SKYNET_CODEX_CLI to the measured binary for SKYNET_MATERIAL_SOURCE');
  assert.equal(process.platform, 'win32'); assert.equal(process.arch, 'x64');
  assert.equal((await command(runtime, ['--version'], process.env)).trim(), `codex-cli ${runtimeVersion}`);
  const sandbox = await createSandbox();
  const requests: any[] = [];
  const userMarker = 'SKYNET_SERVER_ONLY_CONTEXT_731';
  const toolMarker = 'SKYNET_SERVER_ONLY_TOOL_RESULT_842';
  let nativeClient: Awaited<ReturnType<typeof client>> | undefined;
  const provider = createServer(async (request, response) => {
    try {
      let raw = ''; for await (const chunk of request) raw += chunk;
      if (request.method !== 'POST') { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end('{"data":[]}'); return; }
      const body = JSON.parse(raw); requests.push(body);
      const n = requests.length;
      const output = n === 1
        ? { id: 'fc_1', type: 'function_call', status: 'completed', call_id: 'call_skynet_fixture', name: 'skynet_fixture_read', arguments: '{}' }
        : { id: `msg_${n}`, type: 'message', role: 'assistant', status: 'completed', phase: 'final_answer',
          content: [{ type: 'output_text', text: n === 2 ? 'Synthetic source turn complete.' : 'Synthetic restored turn complete.', annotations: [] }] };
      const result = { id: `resp_${n}`, object: 'response', created_at: Math.floor(Date.now() / 1000), status: 'completed',
        model: 'skynet-fixture', output: [output], usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 } };
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      const send = (type: string, fields: unknown) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...fields as object })}\n\n`);
      send('response.created', { response: { ...result, status: 'in_progress', output: [] } });
      send('response.output_item.added', { output_index: 0, item: { ...output, status: 'in_progress' } });
      send('response.output_item.done', { output_index: 0, item: output });
      send('response.completed', { response: result }); response.end();
    } catch { response.writeHead(500); response.end(); }
  });
  async function client(home: string, cwd: string) {
    const env: NodeJS.ProcessEnv = Object.fromEntries(['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'PATH', 'PATHEXT', 'COMSPEC',
      'ProgramFiles', 'ProgramFiles(x86)', 'ProgramData'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
    Object.assign(env, { CODEX_HOME: home, USERPROFILE: join(sandbox.directory, 'synthetic-user'), HOME: join(sandbox.directory, 'synthetic-user'),
      APPDATA: join(sandbox.directory, 'appdata'), LOCALAPPDATA: join(sandbox.directory, 'localappdata'), TEMP: sandbox.directory, TMP: sandbox.directory });
    const child = spawn(runtime!, ['app-server', '--stdio'], { env, cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = ''; child.stderr.on('data', part => { stderr += part; });
    const events: any[] = [];
    const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
    let sequence = 0;
    createInterface({ input: child.stdout }).on('line', line => {
      const item = JSON.parse(line); events.push(item);
      if (item.method === 'item/tool/call' && item.id !== undefined) {
        // This synthetic external tool has no filesystem/network effects; its result must survive native resume.
        child.stdin.write(JSON.stringify({ id: item.id, result: { success: item.params.tool === 'skynet_fixture_read',
          contentItems: [{ type: 'inputText', text: toolMarker }] } }) + '\n');
      } else if (!item.method && item.id !== undefined && pending.has(item.id)) {
        const waiting = pending.get(item.id)!; clearTimeout(waiting.timer); pending.delete(item.id);
        item.error ? waiting.reject(new Error(JSON.stringify(item.error))) : waiting.resolve(item.result);
      }
    });
    child.on('error', error => { for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); } pending.clear(); });
    child.on('exit', code => { for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error(`Native runtime exited ${code}: ${stderr}`)); } pending.clear(); });
    const rpc = (method: string, params: unknown) => new Promise<any>((resolveResult, reject) => {
      const id = ++sequence;
      const timer = globalThis.setTimeout(() => { pending.delete(id); reject(new Error(`Native ${method} timeout: ${stderr}`)); }, 25_000);
      pending.set(id, { resolve: resolveResult, reject, timer }); child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
    try {
      await rpc('initialize', { clientInfo: { name: 'skynet_restore_test', version: '1.0' }, capabilities: { experimentalApi: true } });
      child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
    } catch (error) { await stop(child); throw error; }
    return { rpc, events, async close() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = once(child, 'exit'); child.stdin.end();
      const timer = globalThis.setTimeout(() => child.kill(), 3000);
      try { await exited; } finally { clearTimeout(timer); }
    }, async turn(threadId: string, text: string, imagePath?: string) {
      const prior = events.length;
      await rpc('turn/start', { threadId, input: [{ type: 'text', text }, ...(imagePath ? [{ type: 'localImage', path: imagePath }] : [])] });
      for (let attempt = 0; attempt < 250; attempt++) {
        const completed = events.slice(prior).find(event => event.method === 'turn/completed');
        if (completed) { assert.equal(completed.params.turn.status, 'completed', JSON.stringify(completed)); return; }
        await setTimeout(100);
      }
      throw new Error(`Native turn did not complete: ${stderr}`);
    } };
  }
  try {
    provider.listen(0, '127.0.0.1'); await once(provider, 'listening');
    const port = (provider.address() as { port: number }).port;
    const sourceHome = join(sandbox.directory, 'native-source');
    const target = join(sandbox.directory, 'native-restored');
    const sourceWorkspace = join(sandbox.directory, 'source-workspace');
    const restoredWorkspace = join(sandbox.directory, 'restored-workspace');
    for (const directory of [sourceHome, sourceWorkspace, restoredWorkspace, join(sandbox.directory, 'synthetic-user')]) await mkdir(directory);
    async function configure(home: string) {
      // Generated independently in each home, never read or copied from source or user's config.
      await writeFile(join(home, 'config.toml'), `model = "skynet-fixture"\nmodel_provider = "skynet-local"\ncli_auth_credentials_store = "file"\n[analytics]\nenabled = false\n[feedback]\nenabled = false\n[model_providers.skynet-local]\nname = "Synthetic loopback fixture"\nbase_url = "http://127.0.0.1:${port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n`);
    }
    await configure(sourceHome);
    nativeClient = await client(sourceHome, sourceWorkspace);
    const parameters = { model: 'skynet-fixture', modelProvider: 'skynet-local', approvalPolicy: 'never', sandbox: 'read-only' };
    const started = await nativeClient.rpc('thread/start', { ...parameters, cwd: sourceWorkspace,
      dynamicTools: [{ type: 'function', name: 'skynet_fixture_read', description: 'Returns a synthetic fixed marker; no side effects.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false } }] });
    const parentId = started.thread.id;
    // A tiny valid, deterministic PNG tests byte preservation without external images or user files.
    const crc = (bytes: Buffer) => { let n = 0xffffffff; for (const value of bytes) { n ^= value; for (let i = 0; i < 8; i++) n = (n >>> 1) ^ ((n & 1) ? 0xedb88320 : 0); } return (n ^ 0xffffffff) >>> 0; };
    const chunk = (name: string, data: Buffer) => { const type = Buffer.from(name); const length = Buffer.alloc(4); length.writeUInt32BE(data.length); const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(Buffer.concat([type, data]))); return Buffer.concat([length, type, data, sum]); };
    const header = Buffer.alloc(13); header.writeUInt32BE(16, 0); header.writeUInt32BE(16, 4); header[8] = 8; header[9] = 2;
    const pixels = Buffer.alloc(16 * 49, 255); for (let y = 0; y < 16; y++) pixels[y * 49] = 0;
    const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
    const imagePath = join(sourceWorkspace, 'synthetic.png'); await writeFile(imagePath, png);
    await nativeClient.turn(parentId, `Synthetic context to retain: ${userMarker}.`, imagePath);
    const source = await nativeClient.rpc('thread/read', { threadId: parentId, includeTurns: true });
    const forked = await nativeClient.rpc('thread/fork', { ...parameters, threadId: parentId, cwd: sourceWorkspace });
    const threadId = forked.thread.id;
    await nativeClient.rpc('thread/attachment/add', { threadId: parentId, attachmentType: 'skynet-synthetic', identityKey: 'synthetic-marker', payload: { text: 'NATIVE_ATTACHMENT_BYTES_968' } });
    assert.ok(nativeClient.events.some(event => event.method === 'item/tool/call'), 'real runtime executes the supplied synthetic tool');
    await nativeClient.close(); nativeClient = undefined;
    const sourcePath = forked.thread.path;
    assert.ok(sourcePath && !relative(await realpath(sourceHome), await realpath(sourcePath)).startsWith('..'));
    const original = await readFile(sourcePath);
    const parentOriginal = await readFile(source.thread.path ?? started.thread.path);
    assert.ok(parentOriginal.includes(Buffer.from(toolMarker)));
    assert.ok(parentOriginal.includes(Buffer.from('data:image/png;base64,')), 'native source stores exact inline image bytes');
    const nativeHeader = JSON.parse(original.toString().split('\n')[0]!);
    assert.equal(nativeHeader.payload.history_base.thread_id, parentId, 'the native fork depends on a precise parent boundary');
    const employee = await sandbox.provision('合成原生恢复员工');
    const reader = await sandbox.provision('合成原生恢复读者');
    const origin = await sandbox.startServer();
    const state = join(sandbox.directory, 'collector');
    await sandbox.collectorCommand('setup', state, { server: origin, enrollmentCredential: employee.enrollmentCredential,
      nativeRoot: join(sourceHome, 'sessions'), source: sourceKind, sourceVersion, sourceOs: 'win32' });
    // Simulates the host event; this is not Desktop hook trust/automatic capture acceptance.
    await sandbox.collectorCommand('hook', state, { hook_event_name: 'Stop', session_id: threadId, transcript_path: sourcePath, cwd: sourceWorkspace });
    const collected = JSON.parse(await sandbox.collectorCommand('run', state));
    assert.equal(collected.committed, 1); assert.deepEqual(collected.errors, []);
    const headers = { Authorization: `Bearer ${reader.readerCredential}` };
    const sessions = await (await fetch(`${origin}/api/sessions`, { headers })).json();
    assert.equal(sessions.sessions.length, 1);
    const snapshotId = sessions.sessions[0].id;
    const download = await fetch(`${origin}/api/snapshots/${snapshotId}/recovery`, { headers });
    assert.equal(download.status, 200);
    const packagePath = join(sandbox.directory, 'server-download.skynet-recovery.json');
    await writeFile(packagePath, Buffer.from(await download.arrayBuffer()));
    const bundle = JSON.parse(await readFile(packagePath, 'utf8'));
    assert.equal(bundle.packageVersion, 2);
    const parentMaterial = bundle.manifest.capture.materials.find((item: any) => item.role === 'parent-transcript'); assert.equal(parentMaterial.sourceSessionId, parentId);
    assert.deepEqual(Buffer.from(bundle.materials.find((item: any) => item.id === parentMaterial.id).data, 'base64'), parentOriginal);
    assert.ok(bundle.manifest.capture.materials.some((item: any) => item.placement === 'codex-attachments'), 'only associated attachment rows are exported');
    // Save only generated, credential-free native originals as diagnostic evidence outside the destroyed native home.
    await writeFile(join(sandbox.directory, 'generated-parent.jsonl'), parentOriginal); await writeFile(join(sandbox.directory, 'generated-fork.jsonl'), original);
    assert.equal(resolve(sourceHome), join(resolve(sandbox.directory), 'native-source'), 'recursive removal is constrained to this test-created source home');
    await rm(sourceHome, { recursive: true, maxRetries: 20, retryDelay: 100 }); // No source transcript or database remains to consult.
    const attachmentIndex = bundle.manifest.capture.materials.findIndex((item: any) => item.placement === 'codex-attachments');
    const corruptions = [
      (rows: any[]) => { rows.push(structuredClone(rows[0])); },
      (rows: any[]) => { rows[0].thread_id = threadId; },
      (rows: any[]) => { rows[0].payload = 'not JSON'; },
      (rows: any[]) => { rows[0].created_at = -1; },
    ];
    for (const [index, corrupt] of corruptions.entries()) {
      const bad = structuredClone(bundle); const meta = bad.manifest.capture.materials[attachmentIndex];
      const data = bad.materials.find((item: any) => item.id === meta.id);
      const rows = JSON.parse(Buffer.from(data.data, 'base64').toString()); corrupt(rows);
      const bytes = Buffer.from(JSON.stringify(rows)); data.data = bytes.toString('base64');
      meta.hash = createHash('sha256').update(bytes).digest('hex'); meta.byteLength = bytes.length;
      const { packageSha256: _, ...content } = bad; bad.packageSha256 = createHash('sha256').update(JSON.stringify(content)).digest('hex');
      const invalidPackage = join(sandbox.directory, `invalid-attachment-${index}.json`); await writeFile(invalidPackage, JSON.stringify(bad));
      const invalidTarget = join(sandbox.directory, `invalid-target-${index}`);
      await assert.rejects(command(process.execPath, ['dist/apps/collector/cli.js', 'restore', '--package', invalidPackage, '--target', invalidTarget, '--source-version', sourceVersion, '--runtime', runtime], sandbox.env), /attachment|Attachment/);
      await assert.rejects(readdir(invalidTarget), { code: 'ENOENT' });
    }
    const receipt = JSON.parse(await command(process.execPath, ['dist/apps/collector/cli.js', 'restore', '--package', packagePath,
      '--target', target, '--source-version', sourceVersion, '--runtime', runtime], sandbox.env));
    assert.equal(receipt.state, sourceKind === 'codex-cli' ? 'prepared-cli' : 'prepared-desktop-unverified');
    assert.equal(receipt.sourceSessionId, threadId);
    assert.deepEqual(await readFile(receipt.rolloutPath), original, 'server-only restored bytes are exact before the native runtime opens them');
    assert.equal(receipt.attachmentRowsReconstructed, 1);
    assert.equal(receipt.attachmentPayloadSemantics, 'unverified');
    assert.ok((await readdir(target)).includes('state_5.sqlite'));
    assert.ok(!(await readdir(target)).includes('.skynet-restore-incomplete'));
    assert.ok(!(await readdir(target)).includes('auth.json'), 'credentials are never restored');
    assert.deepEqual(await readFile(receipt.materials.find((item: any) => item.role === 'parent-transcript').path), parentOriginal);
    assert.ok(receipt.gaps.some((item: any) => item.code === 'native-mapping-unverified'), 'opaque payload and Desktop semantic support is not silently claimed');
    await configure(target);
    nativeClient = await client(target, restoredWorkspace);
    const listed = await nativeClient.rpc('thread/list', { modelProviders: [], sourceKinds: ['cli', 'vscode', 'exec', 'appServer', 'unknown'], limit: 100 });
    await writeFile(join(sandbox.directory, 'native-list-before-resume.json'), JSON.stringify(listed, null, 2));
    const archivedMaterial = bundle.manifest.capture.materials.find((item: any) => item.placement === 'codex-attachments');
    const archivedRows = JSON.parse(Buffer.from(bundle.materials.find((item: any) => item.id === archivedMaterial.id).data, 'base64').toString());
    const nativeAttachments = await nativeClient.rpc('thread/attachment/list', { threadId: parentId });
    assert.equal(nativeAttachments.data.length, archivedRows.length);
    for (const row of archivedRows) {
      const item = nativeAttachments.data.find((item: any) => item.id === row.id); assert.ok(item);
      assert.equal(item.createdAt, row.created_at); assert.equal(item.attachmentType, row.attachment_type);
      assert.equal(item.identityKey, row.identity_key); assert.deepEqual(item.payload, JSON.parse(row.payload));
    }
    await writeFile(join(sandbox.directory, 'native-attachment-readback.json'), JSON.stringify({ archivedRows, nativeAttachments }, null, 2));
    const resumed = await nativeClient.rpc('thread/resume', { ...parameters, threadId, cwd: restoredWorkspace });
    assert.equal(resumed.thread.id, threadId);
    const beforeContinuation = requests.length;
    await nativeClient.turn(threadId, 'Synthetic continuation. Use the previously saved context and tool result.');
    const continuation = JSON.stringify(requests[beforeContinuation]?.input);
    assert.ok(continuation.includes(userMarker), 'native continuation sends the original user context');
    assert.ok(continuation.includes(toolMarker), 'native continuation sends original tool result history');
    assert.ok(continuation.includes('skynet_fixture_read'), 'native continuation sends the original tool call');
    assert.ok(continuation.includes('data:image/png;base64,'), 'native fork continuation receives parent image bytes from the restored original');
    const restored = await nativeClient.rpc('thread/read', { threadId, includeTurns: true });
    assert.equal(restored.thread.id, threadId);
    assert.ok(restored.thread.turns.length >= 1, 'fork read returns its own continuation turns; inherited context was verified in the actual provider request');
    const restoredParent = await nativeClient.rpc('thread/read', { threadId: parentId, includeTurns: true });
    assert.ok(JSON.stringify(restoredParent).includes(userMarker));
    await writeFile(join(sandbox.directory, 'native-read-after-resume.json'), JSON.stringify({ restored, restoredParent }, null, 2));
    await nativeClient.close(); nativeClient = undefined;
    const evidence = { testedAt: new Date().toISOString(), source, sourceVersion, runtime: runtimeVersion,
      os: process.platform, arch: process.arch, sourceHomeRemoved: true, serverPackageOnly: true,
      originalBytesPreserved: true, contextAndToolHistoryRetained: true, nativeBackend: 'passed-synthetic-provider',
      desktopUi: 'unverified', automaticHostCapture: 'unverified', snapshotId, parentId, threadId,
      forkBoundaryPreserved: true, inlineImageRetained: true, attachmentRowsPreserved: true, attachmentDatabaseRebuild: 'exact-opaque-rows', attachmentPayloadSemantics: 'unverified',
      newEmptyForkListedBeforeResume: listed.data.some((thread: any) => thread.id === threadId), forkReadReturnsOwnTurns: true };
    await writeFile(join(sandbox.directory, `native-materials-${sourceKind}-evidence.json`), JSON.stringify(evidence, null, 2));
    console.log(`Native material backend evidence (Desktop UI unverified): ${join(sandbox.directory, `native-materials-${sourceKind}-evidence.json`)}`);
  } finally {
    try { await nativeClient?.close(); } finally { provider.closeAllConnections(); provider.close(); await sandbox.close(); }
  }
});
