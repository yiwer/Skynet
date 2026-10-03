import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { initializeControl, askRuntime } from '../apps/collector/runtime-control.js';
import { command, createSandbox, stop, syntheticSession } from './support.js';
import { cleanupOwned } from './owned-command.js';
import type { SessionSummary } from '../packages/contracts/archive.js';

async function until<T>(read: () => Promise<T | null>, message: string): Promise<T> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== null) return value;
    await setTimeout(100);
  }
  throw new Error(message);
}

test('the installed runtime archives daemon-backed Codex TUI sessions without relabeling extension or Desktop work', { timeout: 60_000 }, async () => {
  const sandbox = await createSandbox();
  const state = join(sandbox.directory, 'installed-runtime');
  const home = join(sandbox.directory, 'isolated-home');
  const nativeRoot = join(home, '.codex', 'sessions');
  const runtime = resolve('.');
  const cli = join(runtime, 'dist', 'apps', 'collector', 'cli.js');
  // An installed-state fixture avoids native setup, host configuration, model
  // calls and Windows login tasks. The actual CLI owns supervisor and worker.
  const env: NodeJS.ProcessEnv = {
    ...Object.fromEntries(['SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'PATH'].map(key => [key, process.env[key]])),
    HOME: home, USERPROFILE: home, LOCALAPPDATA: join(home, 'local'), APPDATA: join(home, 'roaming'),
    CODEX_HOME: join(home, '.codex'), CLAUDE_CONFIG_DIR: join(home, '.claude'),
  };
  let child: ChildProcess | undefined;
  let closed = false;
  let diagnostic = '';
  let primary: unknown;
  const run = (action: string, directory = state, input = '') => command(process.execPath,
    [cli, action, '--state', directory], env, input, { timeoutMs: 20_000 });
  try {
    console.log(JSON.stringify({ fixture: sandbox.directory, nativeClient: false, windowsTask: false, modelCalls: false }));
    const origin = await sandbox.startServer();
    const employee = await sandbox.provision('Codex runtime routing fixture');
    const installationId = randomUUID();
    const enrollment = await fetch(`${origin}/api/devices/enroll`, {
      method: 'POST', headers: { Authorization: `Bearer ${employee.enrollmentCredential}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ installationId, name: 'synthetic-runtime-routing' }),
    });
    assert.equal(enrollment.status, 200);
    const device = await enrollment.json();
    const identity = { ...device, server: origin, installationId };
    await mkdir(state, { recursive: true });
    await mkdir(nativeRoot, { recursive: true });
    await writeFile(join(state, 'identity.json'), JSON.stringify(identity));
    const clients = ['codex-cli', 'codex-desktop'].map(source => ({
      source, detected: true, version: '0.160.0', executable: null, nativeRoot,
      configPath: join(home, '.codex', 'hooks.json'), configured: true, capability: 'unverified', notice: 'synthetic fixture',
    }));
    await writeFile(join(state, 'installation.json'), JSON.stringify({
      version: 1, deploymentId: 'synthetic-runtime-routing', node: process.execPath, launcher: cli,
      runtime, installedAt: new Date().toISOString(), clients, configurations: [],
    }));
    for (const { source } of clients) {
      const sourceState = join(state, 'sources', source);
      await mkdir(join(sourceState, 'spool'), { recursive: true });
      await writeFile(join(sourceState, 'settings.json'), JSON.stringify({
        sharedIdentity: '../../identity.json', nativeRoot, source,
        sourceVersion: '0.160.0', sourceOs: process.platform, enrolledAt: device.enrolledAt,
      }));
    }
    await initializeControl(state);
    const cases = [
      { name: 'standalone TUI', source: 'cli', originator: 'codex-tui', cli: true },
      { name: 'exec CLI', source: 'exec', originator: 'codex_exec', cli: true },
      // Observed metadata from the normal Codex CLI 0.160.0 daemon path.
      { name: 'daemon TUI', source: 'vscode', originator: 'codex-tui', cli: true },
      { name: 'VS Code extension', source: 'vscode', originator: 'codex_vscode', cli: false },
      { name: 'Desktop', source: 'vscode', originator: 'desktop', cli: false },
      { name: 'unknown app-server', source: 'vscode', originator: undefined, cli: false },
      { name: 'unverified source with TUI originator', source: 'future-source', originator: 'codex-tui', cli: false },
    ];
    const fixtures = [];
    for (const entry of cases) {
      const native = await syntheticSession(nativeRoot);
      const lines = native.bytes.toString('utf8').split('\n');
      const metadata = JSON.parse(lines[0]!);
      metadata.payload.source = entry.source;
      metadata.payload.originator = entry.originator;
      metadata.payload.cli_version = '0.160.0';
      lines[0] = JSON.stringify(metadata);
      const bytes = Buffer.from(lines.join('\n'));
      await writeFile(native.transcriptPath, bytes);
      await run('hook', join(state, 'inbox', 'codex'), JSON.stringify(native.event));
      fixtures.push({ ...entry, ...native, bytes });
    }
    const queuedAt = Date.now();
    child = spawn(process.execPath, [cli, 'background', '--state', state], { env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    child.stderr!.on('data', part => { diagnostic = (diagnostic + part).slice(-4096); });
    child.once('close', () => { closed = true; });
    child.once('error', error => { diagnostic = error.message; closed = true; });
    const headers = { Authorization: `Bearer ${employee.readerCredential}` };
    const list = async (): Promise<SessionSummary[]> => {
      const response = await fetch(`${origin}/api/sessions`, { headers });
      assert.equal(response.status, 200);
      return (await response.json()).sessions;
    };
    const status = await until(async () => {
      assert.equal(closed, false, `Owned installed runtime exited: ${diagnostic}`);
      const value = JSON.parse(await run('status'));
      return Date.parse(value.lastSweepCompletedAt ?? '') >= queuedAt ? value : null;
    }, 'Installed worker did not complete its first routing and delivery sweep');
    const sessions = await list();
    assert.equal(status.background, 'running');
    assert.equal(status.server.state, 'connected');
    for (const entry of fixtures.slice(0, 2)) {
      assert.ok(sessions.some(session => session.source_session_id === entry.sessionId), `${entry.name} proves the real worker and server upload seam is working`);
    }
    const daemon = fixtures.find(entry => entry.name === 'daemon TUI')!;
    assert.ok(sessions.some(session => session.source_session_id === daemon.sessionId && session.source === 'codex-cli'),
      'Codex CLI 0.160.0 daemon TUI (source=vscode, originator=codex-tui) must become a codex-cli archive');
    assert.equal(sessions.length, 3, 'only the three established CLI forms become archives');
    assert.equal(status.codexUnclassifiedEvents, 4, 'extension, Desktop and unknown origins remain queued');
    assert.ok(status.runtime.errors.some((message: string) => message.includes('not yet verified')));
    for (const entry of fixtures) {
      const session = sessions.find(item => item.source_session_id === entry.sessionId);
      if (!entry.cli) {
        assert.equal(session, undefined, `${entry.name} must not be relabeled as CLI or Desktop`);
        continue;
      }
      assert.ok(session);
      assert.equal(session.source, 'codex-cli');
      assert.equal(session.source_version, '0.160.0');
      const response = await fetch(`${origin}/api/snapshots/${session.id}/raw`, { headers });
      assert.equal(response.status, 200);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), entry.bytes, `${entry.name} preserves every original byte`);
    }
    assert.equal(status.clients.find((client: { source: string }) => client.source === 'codex-cli').confirmedUploads, 3);
    assert.equal(status.clients.find((client: { source: string }) => client.source === 'codex-desktop').confirmedUploads, 0);
    const evidence = { fixture: sandbox.directory, route: 'public hook -> installed supervisor/worker -> HTTP archive/raw',
      nativeClient: false, windowsTask: false, modelCalls: false, cases: cases.map(({ name, cli }) => ({ name, archivedAs: cli ? 'codex-cli' : null })),
      committedSessions: sessions.length, retainedUnclassifiedEvents: status.codexUnclassifiedEvents, exactRawBytes: true };
    await writeFile(join(sandbox.directory, 'codex-runtime-routing-evidence.json'), JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(evidence));
  } catch (error) { primary = error; throw error; }
  finally {
    const closeRuntime = async () => {
      if (!child) return;
      try {
        if (!closed) await run('stop');
        await until(async () => closed ? true : null, 'Owned supervisor did not exit after authenticated stop');
        assert.equal(await askRuntime(state, 'worker'), null, 'Owned worker must release its runtime endpoint');
      } finally { await stop(child); }
    };
    // Retire the owned runtime before its HTTP/DB dependencies, including RED.
    await cleanupOwned([async () => { try { await closeRuntime(); } finally { await sandbox.close(); } }], primary);
  }
});
