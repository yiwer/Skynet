import { mkdtemp, writeFile } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { performance } from 'node:perf_hooks';
const launcher = process.argv[2];
if (!launcher || !isAbsolute(launcher)) throw new Error('Pass an installed absolute skynet-launcher.mjs path');
const state = await mkdtemp(join(tmpdir(), 'skynet-installed-hook-latency-'));
const payload = JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 'synthetic-latency-session', transcript_path: join(state, 'unread-native.jsonl'), cwd: state });
const samples = [];
for (let index = 0; index < 200; index++) {
  const started = performance.now();
  const child = spawn(process.execPath, [launcher, 'hook', '--state', state], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = ''; child.stdout.on('data', part => stdout += part); child.stderr.on('data', part => stderr += part); child.stdin.end(payload);
  const [code] = await once(child, 'exit'); if (code !== 0 || stdout || stderr) throw new Error('Installed hook did not finish silently with exit 0');
  samples.push(performance.now() - started);
}
const sorted = [...samples].sort((a, b) => a - b);
const result = { state, launcher, at: new Date().toISOString(), node: process.version, platform: process.platform, arch: process.arch,
  count: samples.length, p50: sorted[99], p95: sorted[189], max: sorted[199], passed: sorted[189]! <= 100,
  scope: 'installed stable launcher; includes process creation, launcher import and durable enqueue; no network or transcript read', samples };
await writeFile(join(state, 'latency.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ ...result, samples: undefined }));
