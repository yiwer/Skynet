import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { installedState, windowsState } from '../apps/collector/install-state.js';

async function fixture(state: string) {
  const runtime = join(state, 'runtime', 'fixture');
  await mkdir(runtime, { recursive: true });
  await writeFile(join(runtime, 'package.json'), JSON.stringify({ version: '0.2.2' }));
  await writeFile(join(state, 'installation.json'), JSON.stringify({ version: 1, deploymentId: 'fixture',
    node: process.execPath, launcher: join(state, 'skynet-launcher.mjs'), runtime,
    installedAt: new Date().toISOString(), clients: [], configurations: [] }));
  await writeFile(join(state, 'identity.json'), JSON.stringify({ server: 'http://127.0.0.1:1',
    installationId: randomUUID(), deviceId: randomUUID(), deviceCredential: 'a'.repeat(32), enrolledAt: new Date().toISOString() }));
}
test('Windows state prefers a valid shared installation, preserves legacy and refuses damaged state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'skynet-state-'));
  const stable = join(root, 'stable'); const legacy = join(root, 'legacy');
  try {
    assert.equal(await windowsState(stable, legacy), stable);
    await fixture(legacy);
    assert.equal(await windowsState(stable, legacy), legacy);
    await fixture(stable);
    assert.equal(await windowsState(stable, legacy), stable);
    await writeFile(join(stable, 'identity.json'), '{}');
    await assert.rejects(windowsState(stable, legacy), /Invalid installation or identity/);
    await rm(stable, { recursive: true }); await mkdir(stable);
    await assert.rejects(windowsState(stable, legacy), /Incomplete installation/);
    await rm(stable, { recursive: true });
    await writeFile(join(legacy, 'installation.json'), 'null');
    await assert.rejects(windowsState(stable, legacy), /Invalid installation or identity/);
    await rm(legacy, { recursive: true }); await mkdir(legacy);
    await assert.rejects(windowsState(stable, legacy), /Incomplete installation/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('explicit installed status uses shared runtime status while legacy source status stays compatible', async () => {
  const root = await mkdtemp(join(tmpdir(), 'skynet-explicit-'));
  const run = async (command: string, state: string) => promisify(execFile)(process.execPath,
    ['--import', 'tsx', resolve('apps/collector/cli.ts'), command, '--state', state], { timeout: 10_000, windowsHide: true });
  try {
    const installed = join(root, 'installed'); await fixture(installed);
    const status = JSON.parse((await run('status', installed)).stdout);
    assert.equal(status.installed, true); assert.equal(status.stateDirectory, installed); assert.equal(status.runtimeVersion, '0.2.2');
    // Installed setup reaches the deployment installer, never waits for the
    // legacy source JSON input. Repository source is not a deployment package.
    await assert.rejects(run('setup', installed), /deployment\.json/);
    const source = join(root, 'source'); await mkdir(source); await writeFile(join(source, 'status.json'), '{"queued":2}');
    assert.equal(await installedState(source), false);
    assert.deepEqual(JSON.parse((await run('status', source)).stdout), { 'status.json': { queued: 2 } });
    await writeFile(join(installed, 'identity.json'), '{"deviceCredential":"never echo this broken input"}');
    await assert.rejects(run('status', installed), error => /Invalid installation or identity/.test(String(error)) && !String(error).includes('never echo'));
    await fixture(installed); await rm(join(installed, 'installation.json'));
    await assert.rejects(run('setup', installed), /deployment\.json/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('setup resumes empty, enrolled and enrollment-pending state without falling back or replacing identity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'skynet-resume-'));
  const stable = join(root, 'stable'); const legacy = join(root, 'legacy');
  try {
    await fixture(legacy); await mkdir(stable);
    assert.equal(await windowsState(stable, legacy, true), legacy, 'empty preferred state cannot shadow an existing identity');
    const pending = { installationId: randomUUID(), server: 'https://example.test', name: 'fixture', enrollmentHash: 'a'.repeat(64), deviceCredential: 'a'.repeat(43) };
    await writeFile(join(stable, 'enrollment.json'), JSON.stringify(pending));
    assert.equal(await windowsState(stable, legacy, true), stable);
    await writeFile(join(stable, 'enrollment.json'), '{broken');
    await assert.rejects(windowsState(stable, legacy, true), /Invalid setup recovery state/);
    await rm(join(stable, 'enrollment.json')); await fixture(stable); await rm(join(stable, 'installation.json'));
    assert.equal(await windowsState(stable, legacy, true), stable);
    await writeFile(join(stable, 'identity.json'), '{}');
    await assert.rejects(windowsState(stable, legacy, true), /Invalid setup recovery state/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
