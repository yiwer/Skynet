import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { lstat, mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { command, createSandbox } from './support.js';

const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

test('authenticated full exports and CLI restoration reject corrupt, incompatible and unsafe input without writes', { timeout: 180_000 }, async () => {
  const sandbox = await createSandbox();
  try {
    const employee = await sandbox.provision('合成恢复材料所有者');
    const reader = await sandbox.provision('合成导出读者');
    const origin = await sandbox.startServer();
    const api = (path: string, credential?: string, init: RequestInit = {}) => fetch(`${origin}${path}`, {
      ...init, headers: { ...init.headers, ...(credential ? { Authorization: `Bearer ${credential}` } : {}) },
    });
    const enrollment = await (await api('/api/devices/enroll', employee.enrollmentCredential, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ installationId: randomUUID(), name: 'synthetic-export-device' }) })).json();
    const id = randomUUID();
    const bytes = Buffer.from([
      { timestamp: '2026-09-28T01:02:03Z', type: 'session_meta', payload: { id, cli_version: '0.158.0-alpha.2.1' } },
      ...Array.from({ length: 121 }, (_, index) => ({ type: 'response_item', payload: { type: 'message', role: 'user',
        content: [{ type: 'input_text', text: `合成导出第 ${index + 1} 条消息` }] } })),
      { type: 'unknown_future_event', payload: { retained: 'unknown source material' } },
    ].map(item => JSON.stringify(item)).join('\n') + '\n');
    const hash = digest(bytes);
    assert.equal((await api(`/api/chunks/${hash}`, enrollment.deviceCredential, { method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' }, body: bytes })).status, 201);
    const manifest = { protocolVersion: 1, sourceSessionId: id, source: 'codex-desktop', sourceVersion: '26.924.2738.0',
      sourceOs: 'win32', project: '/synthetic/restore', hash, byteLength: bytes.length, qualifiedAt: new Date().toISOString(), capability: 'unverified' };
    const committed = await (await api('/api/snapshots', enrollment.deviceCredential, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(manifest) })).json();
    assert.equal(committed.state, 'committed');
    const route = `/api/snapshots/${committed.snapshotId}`;
    for (const kind of ['readable', 'recovery']) {
      assert.equal((await api(`${route}/${kind}`)).status, 401);
      assert.equal((await api(`${route}/${kind}`, enrollment.deviceCredential)).status, 401);
      assert.equal((await api(`/api/snapshots/${randomUUID()}/${kind}`, reader.readerCredential)).status, 404);
    }
    const detail = await (await api(route, reader.readerCredential)).json();
    assert.equal(detail.events.length, 100, 'the view is paginated');
    assert.equal(detail.recovery.desktopUi, 'unverified');
    const readableResponse = await api(`${route}/readable`, reader.readerCredential);
    assert.equal(readableResponse.headers.get('cache-control'), 'no-store');
    assert.match(readableResponse.headers.get('content-type')!, /^text\/plain/);
    const readable = await readableResponse.text();
    assert.ok(readable.includes('合成导出第 121 条消息'), 'export is never limited to the visible page');
    assert.ok(readable.endsWith(bytes.toString('utf8')), 'readable export includes all unknown source lines');
    const bundle = await (await api(`${route}/recovery`, reader.readerCredential)).json();
    assert.deepEqual(Buffer.from(bundle.artifact.data, 'base64'), bytes);
    assert.equal(bundle.snapshot.employee, '合成恢复材料所有者', 'exporting as another reader keeps historical ownership');
    assert.equal(bundle.manifest.sourceSessionId, id);
    assert.equal(bundle.manifest.capability, 'unverified');
    const packagePath = join(sandbox.directory, 'downloaded.skynet-recovery.json');
    const target = join(sandbox.directory, 'restore-target');
    const restore = (version = '26.924.2738.0', path = target) => command(process.execPath, ['dist/apps/collector/cli.js', 'restore',
      '--package', packagePath, '--target', path, '--desktop-version', version, '--runtime', process.execPath], sandbox.env);
    const save = async (value: unknown) => writeFile(packagePath, JSON.stringify(value));
    const absent = async () => assert.rejects(lstat(target), { code: 'ENOENT' });
    const resign = (value: any) => { const { packageSha256: _, ...content } = value; return { ...content, packageSha256: digest(JSON.stringify(content)) }; };

    await save(bundle);
    await assert.rejects(restore('0.0.0'), /Unsupported source\/target/); await absent();
    await save(resign({ ...bundle, manifest: { ...bundle.manifest, sourceOs: 'unsupported-os' } }));
    await assert.rejects(restore(), /Unsupported source\/target/); await absent();
    await save(bundle);
    if (process.platform !== 'win32') { await assert.rejects(restore(), /Unsupported source\/target/); await absent(); }
    else { await assert.rejects(restore(), /Target native runtime version/); await absent(); }
    await save({ ...bundle, manifest: { ...bundle.manifest, sourceVersion: 'changed' } });
    await assert.rejects(restore(), /metadata checksum mismatch/); await absent();
    await save(resign({ ...bundle, artifact: { encoding: 'base64', data: Buffer.from('damaged').toString('base64') } }));
    await assert.rejects(restore(), /length or SHA-256 mismatch/); await absent();
    await save({ ...bundle, manifest: { ...bundle.manifest, path: '../../outside' } });
    await assert.rejects(restore(), /Malformed or unsupported/); await absent();
    await save({ ...bundle, artifact: { ...bundle.artifact, path: '../outside' } });
    await assert.rejects(restore(), /Malformed or unsupported/); await absent();
    await save({ ...bundle, packageVersion: 900 });
    await assert.rejects(restore(), /Malformed or unsupported/); await absent();
    await save(resign({ ...bundle, manifest: { ...bundle.manifest, sourceSessionId: randomUUID() } }));
    await assert.rejects(restore(), /Native session identity/); await absent();
    const partial = bytes.subarray(0, bytes.length - 1);
    await save(resign({ ...bundle, manifest: { ...bundle.manifest, byteLength: partial.length, hash: digest(partial) },
      artifact: { encoding: 'base64', data: partial.toString('base64') } }));
    await assert.rejects(restore(), /incomplete last line/); await absent();
    await save(bundle);
    await mkdir(target); await writeFile(join(target, 'keep.txt'), 'existing target must survive');
    await assert.rejects(restore(), /already exists/);
    assert.deepEqual(await readdir(target), ['keep.txt']);
    assert.equal(await readFile(join(target, 'keep.txt'), 'utf8'), 'existing target must survive');
    const link = join(sandbox.directory, 'linked-parent');
    await symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(restore('26.924.2738.0', join(link, 'new')), /symlinks or junctions/);
    assert.deepEqual(await readdir(target), ['keep.txt']);
    await assert.rejects(restore('26.924.2738.0', 'relative-target'), /absolute NEW private directory/);
    assert.deepEqual(Buffer.from(await (await api(`${route}/raw`, reader.readerCredential)).arrayBuffer()), bytes, 'restore failures never alter the archived evidence');
  } finally { await sandbox.close(); }
});
