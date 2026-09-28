import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, symlink, truncate, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { chromium, expect, type Browser } from '@playwright/test';
import { createSandbox, command } from './support.js';
import { sourceSchema } from '../packages/contracts/archive.js';
import { readRecoveryPackage } from '../packages/recovery.js';

const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const jsonl = (...records: unknown[]) => Buffer.from(records.map(record => JSON.stringify(record)).join('\n') + '\n');

test('three sources retain generations, related bytes, bounded large output and honest gaps through public capture, export and history UI', { timeout: 240_000 }, async () => {
  const sandbox = await createSandbox(); let browser: Browser | undefined;
  try {
    const origin = await sandbox.startServer(); const employee = await sandbox.provision('关联材料合成员工'); const reader = await sandbox.provision('关联材料读者');
    const api = (path: string, credential = reader.readerCredential, init: RequestInit = {}) => fetch(`${origin}${path}`, { ...init, headers: { ...init.headers, Authorization: `Bearer ${credential}` } });
    const last: { id: string; firstId: string; largeId?: string }[] = [];
    for (const source of sourceSchema.options) {
      const home = join(sandbox.directory, source); const root = join(home, source === 'claude-code-cli' ? 'projects' : 'sessions');
      const project = join(root, 'synthetic-project'); await mkdir(project, { recursive: true });
      const sessionId = randomUUID(); const path = join(project, `${sessionId}.jsonl`); const state = join(home, 'collector');
      const version = source === 'codex-cli' ? '0.157.1' : '0.158.0-alpha.2.1';
      await sandbox.collectorCommand('setup', state, { server: origin, enrollmentCredential: employee.enrollmentCredential, nativeRoot: root,
        source, sourceVersion: source === 'claude-code-cli' ? '2.1.281' : source === 'codex-cli' ? version : '26.924.2738.0', sourceOs: process.platform });
      const timestamp = new Date().toISOString();
      const parentId = randomUUID(); const parent = jsonl({ type: 'session_meta', timestamp, payload: { id: parentId, cli_version: version } },
        { type: 'response_item', timestamp, payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'CONTEXT_ONLY_PARENT' }] } });
      const message = (text: string) => source === 'claude-code-cli' ? { type: 'user', timestamp, sessionId, uuid: randomUUID(), version: '2.1.281', message: { role: 'user', content: text } }
        : { type: 'response_item', timestamp, payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } };
      const header = source === 'claude-code-cli' ? [] : [{ type: 'session_meta', timestamp, payload: { id: sessionId, cli_version: version,
        forked_from_id: parentId, history_base: { thread_id: parentId, end_byte_offset: parent.length, end_ordinal_exclusive: 2 } } }];
      const initial = jsonl(...header, message('same repeated activity'), message('same repeated activity'));
      await writeFile(path, initial);
      let sidecar: string | undefined; let largeBytes: Buffer | undefined;
      if (source === 'claude-code-cli') {
        const sessionDir = join(project, sessionId); await mkdir(join(sessionDir, 'subagents'), { recursive: true }); await mkdir(join(sessionDir, 'tool-results'));
        sidecar = join(sessionDir, 'tool-results', 'large.txt'); largeBytes = Buffer.from('<script>window.materialInjected=true</script>\n' + 'large-output '.repeat(800_000)); await writeFile(sidecar, largeBytes);
        await writeFile(join(sessionDir, 'subagents', 'agent-child.jsonl'), jsonl(message('ASSOCIATED_CHILD')));
        await writeFile(join(sessionDir, 'subagents', 'agent-child.meta.json'), JSON.stringify({ agentType: 'general-purpose' }));
        await writeFile(join(sessionDir, 'subagents', 'auth.json'), 'NEVER_UPLOAD_AUTH_MARKER');
        const outside = join(home, 'outside'); await mkdir(outside); await writeFile(join(outside, 'secret.txt'), 'NEVER_UPLOAD_SYMLINK_MARKER');
        await symlink(outside, join(sessionDir, 'subagents', 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
        await writeFile(join(project, `${sessionId}.jsonl.superseded-1`), jsonl(message('OLD_NATIVE_SUPERSEDED')));
        const backups = join(home, 'file-history', sessionId); await mkdir(backups, { recursive: true }); await writeFile(join(backups, 'backup@v1'), 'checkpoint bytes');
        await appendFile(path, jsonl({ type: 'file-history-snapshot', snapshot: { trackedFileBackups: { 'src/example.ts': { backupFileName: 'backup@v1' }, '.env': { backupFileName: 'secret@v1' } } } }));
      } else {
        const parentPath = join(project, `${parentId}.jsonl`); await writeFile(parentPath, parent);
        const db = new DatabaseSync(join(home, 'state_5.sqlite'));
        db.exec('CREATE TABLE threads(id TEXT PRIMARY KEY,rollout_path TEXT); CREATE TABLE thread_attachments(id TEXT,thread_id TEXT,attachment_type TEXT,identity_key TEXT,payload TEXT,created_at INTEGER)');
        db.prepare('INSERT INTO threads VALUES(?,?)').run(parentId, parentPath);
        db.prepare('INSERT INTO threads VALUES(?,?)').run(randomUUID(), join(home, 'unrelated-do-not-read.jsonl'));
        db.prepare('INSERT INTO thread_attachments VALUES(?,?,?,?,?,?)').run(randomUUID(), sessionId, 'synthetic', 'attachment-one', JSON.stringify({ marker: 'ASSOCIATED_ATTACHMENT' }), 1);
        db.prepare('INSERT INTO thread_attachments VALUES(?,?,?,?,?,?)').run(randomUUID(), randomUUID(), 'synthetic', 'unrelated', 'NEVER_UPLOAD_UNRELATED', 1); db.close();
      }
      const original = await readFile(path);
      await sandbox.collectorCommand('hook', state, { hook_event_name: 'Stop', session_id: sessionId, transcript_path: path, cwd: '/synthetic/project' });
      const collect = async () => { const result = JSON.parse(await sandbox.collectorCommand('run', state)); assert.deepEqual(result.errors, []); return result; };
      assert.equal((await collect()).committed, 1);
      const latest = async () => (await (await api('/api/sessions')).json()).sessions.find((item: any) => item.source === source);
      const details = async (id: string) => (await api(`/api/snapshots/${id}`)).json();
      const firstId = (await latest()).id; const first = await details(firstId); const capture = first.manifest.capture;
      assert.equal(first.events.filter((event: any) => event.text === 'same repeated activity').length, 2, 'same text in two records remains two activities');
      assert.equal(first.activity.today.counts.userTurns, 2, 'two same-text native records count twice; related parent context never adds activity');
      assert.ok(capture.materials.length >= 2); assert.ok(!JSON.stringify(capture).includes('NEVER_UPLOAD'));
      if (source === 'claude-code-cli') {
        assert.equal(capture.materials.find((item: any) => item.name === 'subagents/agent-child.meta.json').sourceSessionId, 'child');
        assert.deepEqual(capture.lineage.filter((item: any) => item.relation === 'child').map((item: any) => item.sessionId), ['child']);
      }
      if (source !== 'claude-code-cli') {
        const parentMaterial = capture.materials.find((item: any) => item.role === 'parent-transcript'); assert.ok(parentMaterial);
        assert.deepEqual(Buffer.from(await (await api(`/api/snapshots/${firstId}/materials/${parentMaterial.id}`)).arrayBuffer()), parent);
        assert.equal((await latest()).source_session_id, sessionId);
      }
      const bundleBytes = Buffer.from(await (await api(`/api/snapshots/${firstId}/recovery`)).arrayBuffer());
      const bundle = readRecoveryPackage(bundleBytes); assert.equal(bundle.packageVersion, 2); assert.deepEqual(bundle.bytes, original);
      assert.equal(bundle.materials.length, capture.materials.length);
      if (source === 'claude-code-cli' && process.env.SKYNET_CLAUDE_RUNTIME) {
        const packagePath = join(home, 'metadata-recovery.json'); const target = join(home, 'metadata-restored');
        await writeFile(packagePath, bundleBytes);
        await command(process.execPath, ['dist/apps/collector/cli.js', 'restore', '--package', packagePath, '--target', target,
          '--runtime', process.env.SKYNET_CLAUDE_RUNTIME], sandbox.env);
        assert.equal(await readFile(join(target, 'projects', 'skynet-restored', sessionId, 'subagents', 'agent-child.meta.json'), 'utf8'), JSON.stringify({ agentType: 'general-purpose' }));
        assert.deepEqual(await readFile(join(target, 'projects', 'skynet-restored', sessionId, 'subagents', 'agent-child.jsonl')),
          bundle.materials.find(item => item.material.name === 'subagents/agent-child.jsonl')!.bytes);
      }
      for (const item of bundle.materials) { assert.equal(hash(item.bytes), item.material.hash); assert.ok(!item.bytes.includes(Buffer.from('NEVER_UPLOAD'))); }
      const bad = JSON.parse(bundleBytes.toString()); bad.materials.pop(); const { packageSha256: _, ...content } = bad; bad.packageSha256 = hash(JSON.stringify(content));
      assert.throws(() => readRecoveryPackage(Buffer.from(JSON.stringify(bad))), /material set is incomplete/);
      const corrupt = JSON.parse(bundleBytes.toString()); corrupt.materials[0].data = Buffer.from('corrupt-associated-bytes').toString('base64');
      const { packageSha256: _ignored, ...corruptContent } = corrupt; corrupt.packageSha256 = hash(JSON.stringify(corruptContent));
      assert.throws(() => readRecoveryPackage(Buffer.from(JSON.stringify(corrupt))), /SHA-256 mismatch/);
      const unsafe = JSON.parse(bundleBytes.toString()); unsafe.manifest.capture.materials[0].name = '../../auth.json';
      assert.throws(() => readRecoveryPackage(Buffer.from(JSON.stringify(unsafe))), /Malformed or unsupported/);
      const settings = JSON.parse(await readFile(join(state, 'settings.json'), 'utf8'));
      const missing = structuredClone(first.manifest); missing.capture.materials[0].hash = 'a'.repeat(64);
      assert.equal((await api('/api/snapshots', settings.deviceCredential, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(missing) })).status, 409, 'all material bytes must be durable before snapshot ACK');
      const readable = await (await api(`/api/snapshots/${firstId}/readable`)).text(); assert.ok(readable.includes('关联材料')); assert.ok(readable.endsWith(original.toString()));
      assert.equal((await api(`/api/snapshots/${firstId}/materials/${capture.materials[0].id}`, '')).status, 401);
      assert.equal((await api(`/api/snapshots/${firstId}/materials/${'a'.repeat(64)}`)).status, 404);
      const nextRecord = jsonl(message('new record')); const split = Math.floor(nextRecord.length / 2);
      await appendFile(path, nextRecord.subarray(0, split)); await collect(); const partial = await details((await latest()).id);
      assert.equal(partial.manifest.capture.partialLine, true); assert.equal(partial.manifest.capture.generation, capture.generation);
      await appendFile(path, nextRecord.subarray(split)); await collect(); assert.equal((await details((await latest()).id)).manifest.capture.partialLine, false);
      if (source === 'codex-desktop') {
        const largeDelta = jsonl({ type: 'response_item', timestamp, payload: { type: 'function_call_output', call_id: 'large-output', output: 'NATIVE_LARGE_OUTPUT '.repeat(500_000) } });
        await appendFile(path, largeDelta); const status = await collect(); assert.equal(status.appended, 1); assert.equal(status.uploadedBytes, largeDelta.length);
        const largeSnapshot = (await latest()).id; const raw = Buffer.from(await (await api(`/api/snapshots/${largeSnapshot}/raw`)).arrayBuffer());
        assert.deepEqual(raw, Buffer.concat([original, nextRecord, largeDelta]), 'large append chunk assembly preserves the entire native original');
      }
      const compact = source === 'claude-code-cli' ? { type: 'system', subtype: 'compact_boundary' } : { type: 'compacted', payload: { message: 'native compact summary' } };
      await writeFile(path, jsonl(...header, message('compact summary'), compact)); await collect(); const rewritten = await details((await latest()).id);
      assert.notEqual(rewritten.manifest.capture.generation, capture.generation); assert.equal(rewritten.manifest.capture.compacted, true);
      assert.deepEqual(Buffer.from(await (await api(`/api/snapshots/${firstId}/raw`)).arrayBuffer()), original);
      await writeFile(path, ''); await collect(); const empty = await details((await latest()).id); assert.equal(empty.manifest.byteLength, 0); assert.equal(empty.recovery.preparation, 'unsupported');
      await writeFile(path, original); await collect();
      let largeId: string | undefined;
      if (sidecar && largeBytes) {
        const current = await details((await latest()).id); largeId = current.manifest.capture.materials.find((item: any) => item.name === 'tool-results/large.txt').id;
        assert.deepEqual(Buffer.from(await (await api(`/api/snapshots/${current.snapshotId}/materials/${largeId}`)).arrayBuffer()), largeBytes);
        const preview = await (await api(`/api/snapshots/${current.snapshotId}/materials/${largeId}/view`)).json(); assert.equal(preview.nextOffset, 32_768);
        assert.equal(preview.text, largeBytes.toString().slice(0, 32_768));
        await unlink(sidecar); await collect(); const missing = await details((await latest()).id);
        assert.equal(missing.manifest.capture.change, 'materials'); assert.ok(missing.manifest.capture.gaps.some((gap: any) => gap.code === 'missing'));
        assert.ok(missing.manifest.capture.materials.some((item: any) => item.id === largeId && item.hash === hash(largeBytes!)), 'source deletion retains archived evidence');
      }
      const finalId = (await latest()).id;
      const history = await (await api(`/api/snapshots/${finalId}/history`)).json(); assert.ok(history.snapshots.some((item: any) => item.id === firstId)); assert.ok(history.snapshots.length >= 6);
      await truncate(path, 65 * 1024 * 1024); const oversized = JSON.parse(await sandbox.collectorCommand('run', state)); assert.equal(oversized.committed, 0); assert.ok(oversized.errors.some((error: string) => error.includes('size-limit')));
      assert.equal((await latest()).id, finalId, 'oversized pending file never removes last committed archive');
      await writeFile(path, original); last.push({ id: finalId, firstId, largeId });
    }
    assert.equal((await (await api('/api/sessions')).json()).sessions.length, 3, 'related parents do not gain host qualification');
    const selected = last.at(-1)!;
    browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(`${origin}#${selected.id}`); await page.getByLabel('个人读取凭据').fill(reader.readerCredential); await page.getByRole('button', { name: '进入存档' }).click();
    const section = page.getByRole('region', { name: '快照历史与关联材料' }); await expect(section).toContainText('关联材料变化');
    await expect(section.getByLabel('材料缺口')).toContainText('保留已存档版本');
    await section.getByRole('button', { name: '阅读 tool-results/large.txt', exact: true }).click();
    await expect(section.getByRole('region', { name: '关联材料阅读' })).toContainText('<script>window.materialInjected=true</script>');
    assert.equal(await page.evaluate(() => 'materialInjected' in window), false);
    await section.getByText(/查看旧快照/).click(); await section.locator(`a[href="#${selected.firstId}"]`).click(); await expect(page.getByRole('region', { name: '快照历史与关联材料' })).toContainText('首次捕获');
    await page.screenshot({ path: join(sandbox.directory, 'materials-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 375, height: 900 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: join(sandbox.directory, 'materials-mobile.png'), fullPage: true });
    console.log(`Associated materials synthetic evidence: ${sandbox.directory}`);
  } finally { await browser?.close(); await sandbox.close(); }
});
