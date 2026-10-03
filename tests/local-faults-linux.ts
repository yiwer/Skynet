// Invoked only by native-local-faults.test.ts inside its owned Linux container.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { chmod, mkdir, open, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import { createApp } from '../apps/server/app.js';
import { connect } from '../apps/server/database.js';
import {benchmarkEnvironment,measureHooks} from './hook-benchmark.js';
import {ownedCommand,stopOwnedChild} from './owned-command.js';
import {fileURLToPath} from 'node:url';

assert.equal(process.platform, 'linux'); assert.equal(process.getuid!(), 1000);
let input = ''; for await (const chunk of process.stdin) input += chunk;
const config = JSON.parse(input);
const outerDeadline=performance.now()+150000;
const remaining=()=>{const value=Math.floor(outerDeadline-performance.now());if(value<=0)throw new Error('Owned local-fault suite overall deadline exceeded');return value;};
const db = connect(config.database);
const app = await createApp({ db, rawDirectory: '/work/raw', webDirectory: '/skynet/dist/web' });
await app.listen({ host: '0.0.0.0', port: 3000 });
const origin = 'http://127.0.0.1:3000'; const state = '/fault/state'; const home = '/work/home'; const native = `${home}/.claude`;
const project = '/work/project'; const cli = '/skynet/dist/apps/collector/cli.js';
const env = { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: native, TMPDIR: '/work/tmp', CLAUDE_CODE_TMPDIR: '/work/tmp',
  ANTHROPIC_API_KEY: 'synthetic-loopback-only', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_AUTOUPDATER: '1' };
for (const path of [home, native, `${native}/projects`, project, '/work/tmp']) await mkdir(path, { recursive: true });
const requests: unknown[] = [];
const provider = createServer(async (request, response) => {
  let raw = ''; for await (const chunk of request) raw += chunk;
  const body = JSON.parse(raw || '{}'); requests.push({ path: request.url, body });
  if (!request.url?.startsWith('/v1/messages')) { response.writeHead(200, { 'content-type': 'application/json' }); response.end('{}'); return; }
  const message = { id: `msg_${randomUUID()}`, type: 'message', role: 'assistant', model: body.model,
    content: [{ type: 'text', text: 'NATIVE_CODING_COMPLETED_DURING_CAPTURE_FAULT' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 30, output_tokens: 10 } };
  if (!body.stream) { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(message)); return; }
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  const send = (type: string, payload: unknown) => response.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`);
  send('message_start', { type: 'message_start', message: { ...message, content: [], stop_reason: null } });
  send('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
  send('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: message.content[0]!.text } });
  send('content_block_stop', { type: 'content_block_stop', index: 0 });
  send('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 10 } });
  send('message_stop', { type: 'message_stop' }); response.end();
});
provider.listen(0, '127.0.0.1'); await once(provider, 'listening');
const nativeEnv = { ...env, ANTHROPIC_BASE_URL: `http://127.0.0.1:${(provider.address() as any).port}` };
async function run(file: string, args: string[], data = '', childEnv = env) {
  return ownedCommand(file,args,childEnv,data,{cwd:project,timeoutMs:Math.min(40000,remaining()),maxOutputBytes:1048576});
}
async function poll<T>(operation: () => Promise<T>, match: (value: T) => boolean, label: string) {
  for (let attempt = 0; attempt < 200; attempt++) { remaining();const value = await operation(); if (match(value)) return value; await setTimeout(100); }
  throw new Error(`Timed out: ${label}`);
}
const api = async (path: string) => { const response = await fetch(`${origin}${path}`, { headers: { Authorization: `Bearer ${config.reader}` } }); assert.equal(response.status, 200); return response; };
const all = async () => (await (await api('/api/sessions')).json()).sessions;
const device = async () => (await (await api('/api/devices/status')).json()).devices[0];
const faults = async () => (await device()).capture.flatMap((item: any) => item.faults);
const snapshot = async (id: string): Promise<any> => (await all()).find((item: any) => item.source_session_id === id);
const nativeRun = async (id: string, label: string, resume = false) => {
  const output = await run('claude', ['--print', '--output-format', 'stream-json', '--verbose', '--include-hook-events', '--setting-sources', 'user',
    '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--tools', '', '--permission-prompts', 'none', '--model', 'claude-sonnet-4-5',
    '--system-prompt', 'Return a short deterministic test response.', resume ? '--resume' : '--session-id', id], label, nativeEnv);
  const entries = output.stdout.trim().split('\n').map(line => JSON.parse(line)); const result = entries.findLast(item => item.type === 'result');
  assert.equal(result?.is_error, false); assert.equal(result?.terminal_reason, 'completed');
  assert.ok(entries.some(item => item.type === 'system' && item.subtype === 'hook_response'), 'native runtime invoked configured hooks');
  await writeFile(`/evidence/native-${label}.json`, JSON.stringify({ entries, stderr: output.stderr }, null, 2)); return output;
};
const sourcePath = async (id: string) => {
  for (const folder of await readdir(`${native}/projects`)) { const path = `${native}/projects/${folder}/${id}.jsonl`; try { await readFile(path); return path; } catch {} }
  throw new Error('Own native transcript not found');
};
assert.match((await run('claude', ['--version'])).stdout, /2\.1\.281/);
await run(process.execPath, [cli, 'setup', '--state', state], JSON.stringify({ server: origin, enrollmentCredential: config.enrollment,
  nativeRoot: `${native}/projects`, source: 'claude-code-cli', sourceVersion: '2.1.281', sourceOs: 'linux' }));
await writeFile(`${native}/settings.json`, JSON.stringify({ hooks: Object.fromEntries(['SessionStart', 'UserPromptSubmit', 'Stop', 'SessionEnd'].map(name => [name,
  [{ hooks: [{ type: 'command', command: `${process.execPath} ${cli} hook --state ${state}` }] }]])) }));
const collector = spawn(process.execPath, [cli, 'run', '--state', state], { env, windowsHide:true,stdio: 'ignore' });
const A = randomUUID(); const B = randomUUID(); let paused = false;
try {
  await nativeRun(A, 'baseline'); const initial: any = await poll(() => snapshot(A), Boolean, 'baseline archive'); const aPath = await sourcePath(A);
  // Fixed-size owned tmpfs only. ENOSPC comes from actual kernel writes.
  const filler = await open('/fault/fill', 'w'); let fullCode = ''; let filled = 0;
  try { while (true) { filled += (await filler.write(Buffer.alloc(65536))).bytesWritten; } }
  catch (error) { fullCode = (error as NodeJS.ErrnoException).code!; assert.equal(fullCode, 'ENOSPC'); } finally { await filler.close(); }
  await poll(faults, values => values.some((item: any) => item.code === 'storage-full'), 'remote full-disk gap');
  const fullReport = await device(); assert.equal(fullReport.capture[0].report.locallyPersisted, false);
  const fullNative = await nativeRun(B, 'disk-full'); assert.equal(await snapshot(B), undefined, 'failed hook enqueue cannot be claimed as archived');
  assert.ok(JSON.stringify(fullNative).includes('local diagnostics could not be saved'), 'full disk warning survives in native hook result');
  await mkdir('/evidence/hook-enospc',{recursive:true});
  const event={hook_event_name:'Stop',session_id:B,transcript_path:await sourcePath(B),cwd:project};
  const hookMeasurement=await measureHooks({launcher:cli,state,output:'/evidence/hook-enospc',event,env,
    profile:'Linux native local faults; current collector running; sequential direct CLI under actual2MiB tmpfs ENOSPC; not installed stable launcher or historical four-job pressure',
    environment:await benchmarkEnvironment([cli,'/skynet/dist/apps/collector/hook.js','/skynet/dist/packages/filesystem.js',fileURLToPath(import.meta.url),'/skynet/dist/tests/hook-benchmark.js','/skynet/dist/tests/owned-command.js',process.execPath]),
    expectedStderr:'Skynet: host activity was not queued and local diagnostics could not be saved; check storage and skynet status.\n',durability:'unavailable-enospc',
    thresholdMs:config.hookThresholdMs??null,deadlineMs:Math.min(60000,remaining())});
  assert.equal(hookMeasurement.passed,true,'Hook measurement incomplete or explicitly requested threshold failed; see ordered200-sample evidence');
  await unlink('/fault/fill');
  await nativeRun(B, 'disk-recovered', true); const uploadedB: any = await poll(() => snapshot(B), Boolean, 'resumed still-readable bytes automatically archived');
  const bBytes = await readFile(await sourcePath(B));
  await poll(() => snapshot(B), value => value?.hash === createHash('sha256').update(bBytes).digest('hex'), 'exact full native B bytes');
  // Agent can keep working in B while previously observed A is actually unreadable.
  await chmod(aPath, 0);
  await assert.rejects(readFile(aPath), { code: 'EACCES' });
  await poll(faults, values => values.some((item: any) => item.code === 'permission-denied' && item.sessionId === A), 'actual EACCES');
  await nativeRun(B, 'permission-denied', true);
  await chmod(aPath, 0o600);
  await poll(faults, values => values.some((item: any) => item.code === 'permission-denied' && item.sessionId === A && item.recoveredAt), 'permission recovery retains gap');
  const beforeDelete = await snapshot(A); const archivedBeforeDelete = Buffer.from(await (await api(`/api/snapshots/${beforeDelete.id}/raw`)).arrayBuffer());
  collector.kill('SIGSTOP'); paused = true;
  await nativeRun(A, 'before-source-deletion', true); const lostBytes = await readFile(aPath); assert.ok(lostBytes.length > archivedBeforeDelete.length);
  await unlink(aPath); await assert.rejects(readFile(aPath), { code: 'ENOENT' }); collector.kill('SIGCONT'); paused = false;
  await poll(faults, values => values.some((item: any) => item.code === 'source-missing' && item.sessionId === A), 'deleted unseen range');
  await nativeRun(B, 'source-deleted', true);
  const finalA = await snapshot(A); assert.equal(finalA.id, beforeDelete.id);
  assert.deepEqual(Buffer.from(await (await api(`/api/snapshots/${finalA.id}/raw`)).arrayBuffer()), archivedBeforeDelete);
  const evidence = { source: 'Claude Code CLI 2.1.281 Linux x64', uid: process.getuid!(), image: 'skynet-analysis-probe:2.1.281',
    actualErrors: [fullCode, 'EACCES', 'ENOENT'], fixedTmpfsBytes: 2 * 1024 * 1024, filledBytes: filled, paidCalls: 0,
    nativeCompleted: ['baseline', 'disk-full', 'disk-recovered', 'permission-denied', 'before-source-deletion', 'source-deleted'],
    fullDiskHook: { samples: hookMeasurement.count, p50Ms:hookMeasurement.p50Ms,p95Ms:hookMeasurement.p95Ms,maxMs:hookMeasurement.maxMs,
      orderedSamples:hookMeasurement.samples,environment:hookMeasurement.metadata.environment,profile:hookMeasurement.metadata.profile,
      durableInventoryVerified:false,durability:hookMeasurement.durability,thresholdMs:hookMeasurement.metadata.thresholdMs,
      thresholdPassed:hookMeasurement.thresholdPassed,remoteWait:false },
    fullDiskReport: fullReport, finalDevice: await device(), snapshotId: finalA.id, initialSnapshotId: initial.id, backfilledSnapshotId: uploadedB.id,
    lostUnarchivedBytes: lostBytes.length - archivedBeforeDelete.length, rawStillExact: true,
    limits: 'No Windows DACL equivalence; no source scan after entirely lost hooks; reusing B produces its normal qualification. A inaccessible while B works. Full disk + offline + process death cannot guarantee durable diagnostics.' };
  await writeFile('/evidence/native-local-faults-evidence.json', JSON.stringify(evidence, null, 2));
  await writeFile('/evidence/ready.json', JSON.stringify({ snapshotId: finalA.id }));
  await poll(async () => { try { await readFile('/evidence/finish'); return true; } catch { return false; } }, Boolean, 'host Web verification');
  console.log(JSON.stringify({ state: 'passed', snapshotId: finalA.id }));
} finally {
  if (paused) collector.kill('SIGCONT'); await stopOwnedChild(collector);
  await new Promise<void>(resolve => provider.close(() => resolve())); await app.close(); await db.end();
}
