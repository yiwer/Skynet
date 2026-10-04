import { spawn, type ChildProcess } from 'node:child_process';
import {ownedCommand,ownedReady,stopOwnedChild,removeOwnedContainer,type CommandOptions} from './owned-command.js';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { localPostgres } from './local-postgres.js';

const execute=(file:string,args:string[],options:CommandOptions={})=>ownedCommand(file,args,process.env,'',{timeoutMs:5000,...options});
export async function command(file: string, args: string[], env: NodeJS.ProcessEnv, input = '',options:CommandOptions={}) {
  return (await ownedCommand(file,args,env,input,options)).stdout;
}
export async function stop(child?: ChildProcess) {
  await stopOwnedChild(child);
}
export async function crash(child?: ChildProcess) {
  await stopOwnedChild(child,true);
}

export async function createSandbox(options:{stoppedNativeSnapshot?:{directory:string;password:string}}={}) {
  const directory = await mkdtemp(join(tmpdir(), 'skynet-test-'));
  const name = `skynet-test-${randomUUID()}`;
  const password = options.stoppedNativeSnapshot?.password??randomBytes(24).toString('hex');
  const database = 'skynet_test';
  const owner=randomUUID();
  let server: ChildProcess | undefined;
  let collector: ChildProcess | undefined;
  let native: Awaited<ReturnType<typeof localPostgres>> | undefined;
  const nativeBinaries = process.env.SKYNET_TEST_POSTGRES_BIN;
  const closeDatabase = () => nativeBinaries ? native?.close() ?? Promise.resolve() : removeOwnedContainer(name, owner);
  try {
    let databaseUrl: string;
    if (nativeBinaries) {
      native = await localPostgres(directory, password, database, nativeBinaries,options.stoppedNativeSnapshot?.directory);
      databaseUrl = native.url;
    } else {
      if(options.stoppedNativeSnapshot)throw new Error('A native fixture snapshot requires SKYNET_TEST_POSTGRES_BIN');
      await ownedCommand('docker', ['run', '--detach', '--name', name,'--label',`org.skynet.test-owner=${owner}`, '--publish', '127.0.0.1::5432',
      '--env','POSTGRES_PASSWORD','--env', `POSTGRES_DB=${database}`, 'postgres:17-alpine'],{...process.env,POSTGRES_PASSWORD:password},'',{timeoutMs:60000});
      const { stdout } = await execute('docker', ['port', name, '5432/tcp']);
      const port = stdout.trim().split(':').at(-1);
      databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${port}/${database}`;
      const readyDeadline=Date.now()+30000;
      for (let attempt = 0; attempt < 60; attempt++) {
        // The image's initialization server accepts sockets before the final TCP server starts.
        try { await execute('docker', ['exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres', '-d', database]); break; }
        catch { if (attempt === 59||Date.now()>=readyDeadline) throw new Error('Isolated PostgreSQL readiness deadline exceeded'); await setTimeout(500); }
      }
    }
    const env = { ...process.env, DATABASE_URL: databaseUrl, RAW_DIRECTORY: join(directory, 'raw') };
    async function startServer(portNumber = 0) {
      server = spawn(process.execPath, ['dist/apps/server/main.js'], { env: { ...env, PORT: String(portNumber) }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      return ownedReady(server,/Skynet listening on (http:\/\/[^;]+)/);
    }
    async function provision(employeeName: string, canManageIdentities?: boolean) {
      return JSON.parse(await command(process.execPath, ['dist/apps/server/provision.js'], env, JSON.stringify({ name: employeeName, canManageIdentities })));
    }
    async function collectorCommand(action: string, state: string, input?: unknown) {
      return command(process.execPath, ['dist/apps/collector/cli.js', action, '--state', state, ...(action === 'run' ? ['--once'] : [])], env, input === undefined ? '' : JSON.stringify(input));
    }
    async function startCollector(state: string) {
      collector = spawn(process.execPath, ['dist/apps/collector/cli.js', 'run', '--state', state], { env, windowsHide: true, stdio: 'ignore' });
      collector.on('error', () => undefined);
    }
    async function close() {
      const results=await Promise.allSettled([stop(collector),stop(server),closeDatabase()]);
      const errors=results.filter(value=>value.status==='rejected').map(value=>(value as PromiseRejectedResult).reason);
      if(errors.length)throw new AggregateError(errors,'Owned sandbox cleanup incomplete');
    }
    const inspected = native ? null : await execute('docker', ['inspect', '--format', '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}', name]);
    const containerDatabaseUrl = native ? databaseUrl : `postgresql://postgres:${password}@${inspected!.stdout.trim()}:5432/${database}`;
    return { directory, env, name, testOwner:owner, containerDatabaseUrl, startServer, stopServer: () => stop(server), crashServer: () => crash(server), startCollector, stopCollector: () => stop(collector),
      provision, collectorCommand, close };
  } catch (error) {
    const cleanup=await Promise.allSettled([stop(collector),stop(server),closeDatabase()]);
    const failed=cleanup.filter(value=>value.status==='rejected');
    if(failed.length)throw new AggregateError([error,...failed.map(value=>(value as PromiseRejectedResult).reason)],'Sandbox failed; owned cleanup requires inspection');
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
