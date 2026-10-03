import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { createSandbox, syntheticSession } from './support.js';

const exec = promisify(execFile);
const sandbox = await createSandbox();
const appName = `${sandbox.name}-app`;
const volume = `${sandbox.name}-raw`;
let appCreated = false;
try {
  const employee = await sandbox.provision('Linux 合成验证员工');
  const reader = await sandbox.provision('Linux 合成验证读者');
  await exec('docker', ['run', '--detach', '--name', appName,
    '--publish', '127.0.0.1::3000', '--env', `DATABASE_URL=${sandbox.containerDatabaseUrl}`,
    '--mount', `type=volume,source=${volume},target=/data/raw`, 'skynet-v1-issue4:local'], { windowsHide: true });
  appCreated = true;
  const { stdout } = await exec('docker', ['port', appName, '3000/tcp'], { windowsHide: true });
  let origin = `http://${stdout.trim()}`;
  async function healthy() {
    for (let attempt = 0; attempt < 60; attempt++) {
      try { if ((await fetch(`${origin}/health`)).ok) return; } catch { /* Starting process. */ }
      await setTimeout(250);
    }
    const logs = await exec('docker', ['logs', appName], { windowsHide: true });
    throw new Error(`Linux application did not become healthy: ${logs.stdout}\n${logs.stderr}`);
  }
  await healthy();
  const sourceRoot = join(sandbox.directory, 'native');
  const source = await syntheticSession(sourceRoot);
  const state = join(sandbox.directory, 'collector');
  await sandbox.collectorCommand('setup', state, { server: origin, enrollmentCredential: employee.enrollmentCredential,
    nativeRoot: sourceRoot, sourceVersion: 'synthetic-linux-smoke', sourceOs: process.platform });
  await sandbox.collectorCommand('hook', state, source.event);
  const status = JSON.parse(await sandbox.collectorCommand('run', state));
  assert.equal(status.committed, 1); assert.deepEqual(status.errors, []);
  const headers = { Authorization: `Bearer ${reader.readerCredential}` };
  const sessions = await (await fetch(`${origin}/api/sessions`, { headers })).json();
  const id = sessions.sessions[0].id;
  await exec('docker', ['restart', appName], { windowsHide: true });
  const rebound = await exec('docker', ['port', appName, '3000/tcp'], { windowsHide: true });
  origin = `http://${rebound.stdout.trim()}`;
  await healthy();
  assert.deepEqual(Buffer.from(await (await fetch(`${origin}/api/snapshots/${id}/raw`, { headers })).arrayBuffer()), source.bytes);
  assert.match(await (await fetch(origin)).text(), /Skynet/);
  console.log('PASS: Linux Node 24 + PostgreSQL + named raw volume, public capture and exact bytes after container restart');
} finally {
  if (appCreated) await exec('docker', ['rm', '--force', appName], { windowsHide: true });
  await exec('docker', ['volume', 'rm', volume], { windowsHide: true }).catch(() => undefined);
  await sandbox.close();
}
