import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, expect, type Browser } from '@playwright/test';
import { createSandbox } from './support.js';

test('Claude CLI native-shaped messages cross the public collector, API and browser with honest gaps', { timeout: 180_000 }, async () => {
  const sandbox = await createSandbox();
  let browser: Browser | undefined;
  try {
    const employee = await sandbox.provision('Claude 合成员工');
    const reader = await sandbox.provision('Claude 合成读者');
    const origin = await sandbox.startServer();
    const state = join(sandbox.directory, 'collector');
    const nativeRoot = join(sandbox.directory, 'claude', 'projects');
    await mkdir(nativeRoot, { recursive: true });
    await sandbox.collectorCommand('setup', state, { server: origin, enrollmentCredential: employee.enrollmentCredential,
      nativeRoot, source: 'claude-code-cli', sourceVersion: '2.1.281', sourceOs: process.platform });
    const request = (path: string) => fetch(`${origin}${path}`, { headers: { Authorization: `Bearer ${reader.readerCredential}` } });
    const sessionId = randomUUID();
    const timestamp = '2026-09-25T01:02:03.000Z';
    const meta = () => ({ sessionId, version: '2.1.281', uuid: randomUUID(), timestamp, cwd: '/synthetic/project-a' });
    const records = [
      { type: 'queue-operation', operation: 'enqueue', sessionId, timestamp },
      { ...meta(), type: 'user', message: { role: 'user', content: '核查合成代码变更。' } },
      { ...meta(), type: 'assistant', message: { role: 'assistant', content: [
        { type: 'text', text: '查看变更。' },
        { type: 'tool_use', id: 'tool-edit', name: 'Edit', input: { file_path: '/synthetic/example.ts', old_string: 'false', new_string: 'true' } },
      ] } },
      { ...meta(), type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool-edit', content: '合成编辑结果：false → true' }] } },
      { ...meta(), type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '会话记录包含代码变更；未执行测试。' }] } },
      { ...meta(), type: 'user', message: { role: 'user', content: [
        { type: 'text', text: '此文本与图片同一行，不应被当成完整消息。' }, { type: 'image', source: { type: 'base64', data: 'synthetic' } },
      ] } },
    ];
    const bytes = Buffer.from(records.map(record => JSON.stringify(record)).join('\n') + '\n{malformed-native-line}\n');
    const transcriptPath = join(nativeRoot, `${sessionId}.jsonl`);
    await writeFile(transcriptPath, bytes);
    // An uncontinued historic conversation must not be scanned.
    await writeFile(join(nativeRoot, `${randomUUID()}.jsonl`), bytes);
    const event = { session_id: sessionId, transcript_path: transcriptPath, cwd: '/synthetic/project-a' };
    await sandbox.collectorCommand('hook', state, { ...event, hook_event_name: 'SessionStart', transcript_path: join(nativeRoot, 'not-created.jsonl') });
    await sandbox.collectorCommand('hook', state, { ...event, hook_event_name: 'UserPromptSubmit' });
    await sandbox.collectorCommand('hook', state, { ...event, hook_event_name: 'PostToolUse' });
    const status = JSON.parse(await sandbox.collectorCommand('run', state));
    assert.deepEqual(status.errors, [], 'later host path corrects the initial nonexistent resume hint');
    let sessions = (await (await request('/api/sessions')).json()).sessions;
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].source, 'claude-code-cli');
    let detail = await (await request(`/api/snapshots/${sessions[0].id}`)).json();
    assert.equal(detail.manifest.source, 'claude-code-cli');
    assert.equal(detail.manifest.sourceVersion, '2.1.281');
    assert.equal(detail.parserVersion, 'claude-jsonl-1');
    assert.deepEqual(detail.events.map((e: { role: string }) => e.role), ['user', 'assistant', 'tool request', 'tool result', 'assistant']);
    assert.equal(detail.events.filter((e: { role: string }) => e.role === 'user').length, 1, 'tool results are not human turns');
    assert.equal(detail.unrecognizedLines, 3, 'metadata, unsupported images and malformed lines remain visible gaps');
    assert.equal(detail.events[0].timestamp, timestamp, 'old source timestamps survive new activity qualification');
    assert.equal(detail.events[1].line, detail.events[2].line, 'multiple blocks keep the original evidence line');
    assert.deepEqual(Buffer.from(await (await request(`/api/snapshots/${sessions[0].id}/raw`)).arrayBuffer()), bytes);

    // A genuine later path correction for the same ID must not keep reading the old path.
    const moved = join(nativeRoot, `moved-${sessionId}.jsonl`);
    await rename(transcriptPath, moved);
    await sandbox.collectorCommand('hook', state, { ...event, transcript_path: moved, hook_event_name: 'SessionEnd' });
    assert.deepEqual(JSON.parse(await sandbox.collectorCommand('run', state)).errors, []);
    sessions = (await (await request('/api/sessions')).json()).sessions;
    assert.equal(sessions.length, 1);

    const secondId = randomUUID();
    const secondPath = join(nativeRoot, `${secondId}.jsonl`);
    await writeFile(secondPath, JSON.stringify({ ...meta(), sessionId: secondId, type: 'user', message: { role: 'user', content: '第二个项目' } }) + '\n');
    await sandbox.collectorCommand('hook', state, { hook_event_name: 'Stop', session_id: secondId, transcript_path: secondPath, cwd: '/synthetic/project-b' });
    assert.deepEqual(JSON.parse(await sandbox.collectorCommand('run', state)).errors, []);
    await sandbox.collectorCommand('hook', state, { ...event, session_id: randomUUID(), transcript_path: moved, hook_event_name: 'Stop' });
    assert.match(JSON.parse(await sandbox.collectorCommand('run', state)).errors.join('\n'), /identity mismatch/);
    sessions = (await (await request('/api/sessions')).json()).sessions;
    assert.deepEqual(sessions.map((s: { project: string }) => s.project).sort(), ['/synthetic/project-a', '/synthetic/project-b']);

    browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto(origin);
    await page.getByLabel('个人读取凭据').fill(reader.readerCredential);
    await page.getByRole('button', { name: '进入存档' }).click();
    await page.getByRole('link').filter({ hasText: '/synthetic/project-a' }).click();
    const article = page.getByRole('article', { name: '会话详情' });
    await expect(article.getByText('Claude 合成员工 · Claude Code CLI', { exact: true })).toBeVisible();
    await expect(article.getByText('合成编辑结果：false → true', { exact: false })).toBeVisible();
    await expect(article.getByText('此文本与图片同一行，不应被当成完整消息。', { exact: false })).toHaveCount(0);
    await page.screenshot({ path: join(sandbox.directory, 'claude-session.png'), fullPage: true });
    console.log(`Claude synthetic public-flow evidence: ${sandbox.directory}`);
  } finally { try { await browser?.close(); } finally { await sandbox.close(); } }
});
