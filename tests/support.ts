import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';

const execute = promisify(execFile);
export async function command(file: string, args: string[], env: NodeJS.ProcessEnv, input = '') {
  return new Promise<string>((resolveResult, reject) => {
    const child = spawn(file, args, { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', part => { stdout += part; }); child.stderr.on('data', part => { stderr += part; });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolveResult(stdout) : reject(new Error(`Command failed (${code}): ${stderr}\n${stdout}`)));
    child.stdin.end(input);
  });
}
export async function stop(child?: ChildProcess) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>(resolveResult => { child.once('exit', () => resolveResult()); child.kill('SIGTERM'); });
}

export async function createSandbox() {
  const directory = await mkdtemp(join(tmpdir(), 'skynet-test-'));
  const name = `skynet-test-${randomUUID()}`;
  const password = randomBytes(24).toString('hex');
  const database = 'skynet_test';
  await execute('docker', ['run', '--detach', '--name', name, '--publish', '127.0.0.1::5432',
    '--env', `POSTGRES_PASSWORD=${password}`, '--env', `POSTGRES_DB=${database}`, 'postgres:17-alpine'], { windowsHide: true });
  let server: ChildProcess | undefined;
  let collector: ChildProcess | undefined;
  try {
    const { stdout } = await execute('docker', ['port', name, '5432/tcp'], { windowsHide: true });
    const port = stdout.trim().split(':').at(-1);
    const env = { ...process.env, DATABASE_URL: `postgresql://postgres:${password}@127.0.0.1:${port}/${database}`, RAW_DIRECTORY: join(directory, 'raw') };
    for (let attempt = 0; attempt < 60; attempt++) {
      // The image's initialization server accepts sockets before the final TCP server starts.
      try { await execute('docker', ['exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres', '-d', database], { windowsHide: true }); break; }
      catch { if (attempt === 59) throw new Error('Isolated PostgreSQL did not start'); await setTimeout(500); }
    }
    async function startServer(portNumber = 0) {
      server = spawn(process.execPath, ['dist/apps/server/main.js'], { env: { ...env, PORT: String(portNumber) }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      return await new Promise<string>((resolveOrigin, reject) => {
        let output = ''; let stderr = '';
        const timer = globalThis.setTimeout(() => reject(new Error(`Server did not start: ${stderr}`)), 20_000);
        server!.stdout!.on('data', part => {
          output += part;
          const match = /Skynet listening on (http:\/\/[^;]+)/.exec(output);
          if (match) { clearTimeout(timer); resolveOrigin(match[1]!); }
        });
        server!.stderr!.on('data', part => { stderr += part; });
        server!.once('error', error => { clearTimeout(timer); reject(error); });
        server!.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited (${code}): ${stderr}`)); });
      });
    }
    async function provision(employeeName: string) {
      return JSON.parse(await command(process.execPath, ['dist/apps/server/provision.js'], env, JSON.stringify({ name: employeeName })));
    }
    async function collectorCommand(action: string, state: string, input?: unknown) {
      return command(process.execPath, ['dist/apps/collector/cli.js', action, '--state', state, ...(action === 'run' ? ['--once'] : [])], env, input === undefined ? '' : JSON.stringify(input));
    }
    async function startCollector(state: string) {
      collector = spawn(process.execPath, ['dist/apps/collector/cli.js', 'run', '--state', state], { env, windowsHide: true, stdio: 'ignore' });
      collector.on('error', () => undefined);
    }
    async function close() {
      await stop(collector); await stop(server);
      await execute('docker', ['rm', '--force', name], { windowsHide: true });
    }
    const inspected = await execute('docker', ['inspect', '--format', '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}', name], { windowsHide: true });
    const containerDatabaseUrl = `postgresql://postgres:${password}@${inspected.stdout.trim()}:5432/${database}`;
    return { directory, env, name, containerDatabaseUrl, startServer, stopServer: () => stop(server), startCollector, stopCollector: () => stop(collector),
      provision, collectorCommand, close };
  } catch (error) {
    await stop(server); await execute('docker', ['rm', '--force', name], { windowsHide: true });
    throw error;
  }
}

export async function syntheticSession(root: string, sessionId = randomUUID()) {
  await mkdir(root, { recursive: true });
  const transcriptPath = resolve(root, `${sessionId}.jsonl`);
  const timestamp = '2026-09-28T01:02:03.000Z';
  const lines = [
    { timestamp, type: 'session_meta', payload: { id: sessionId, source: 'vscode', cli_version: 'synthetic-fixture-1', cwd: '/synthetic/project' } },
    { timestamp, type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '请核查合成项目的测试结果。' }] } },
    { timestamp, type: 'response_item', payload: { type: 'function_call', name: 'shell', arguments: '{"command":"synthetic-test"}', call_id: 'call-1' } },
    { timestamp, type: 'response_item', payload: { type: 'function_call_output', call_id: 'call-1', output: '合成工具结果：3 tests passed\n<script>window.archiveInjected=true</script>' } },
    { timestamp, type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '会话记录显示测试通过。' }] } },
    { timestamp, type: 'unknown_future_event', payload: { keep: 'unknown bytes must survive' } },
  ];
  const bytes = Buffer.from(lines.map(line => JSON.stringify(line)).join('\n') + '\n{"incomplete":');
  await writeFile(transcriptPath, bytes);
  return { sessionId, transcriptPath, bytes, event: { hook_event_name: 'Stop', session_id: sessionId, transcript_path: transcriptPath, cwd: '/synthetic/project' } };
}
