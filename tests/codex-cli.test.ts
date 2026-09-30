import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, expect, type Browser } from '@playwright/test';
import { createSandbox } from './support.js';

test('Codex CLI preserves two projects, native version, tool results and available patch text through public capture and Web', { timeout: 180_000 }, async () => {
  const sandbox = await createSandbox(); let browser: Browser | undefined;
  try {
    const employee = await sandbox.provision('合成 CLI 员工');
    const reader = await sandbox.provision('合成 CLI 读者');
    const origin = await sandbox.startServer();
    const state = join(sandbox.directory, 'collector');
    const root = join(sandbox.directory, 'native'); await mkdir(root);
    await sandbox.collectorCommand('setup', state, { server: origin, enrollmentCredential: employee.enrollmentCredential,
      source: 'codex-cli', nativeRoot: root, sourceVersion: 'stale-config-value', sourceOs: process.platform });
    await assert.rejects(sandbox.collectorCommand('setup', state, { server: origin, enrollmentCredential: employee.enrollmentCredential,
      source: 'codex-desktop', nativeRoot: root, sourceVersion: 'stale-config-value', sourceOs: process.platform }), /already bound/);
    for (const project of ['alpha', 'beta']) {
      const id = randomUUID(); const path = join(root, `${id}.jsonl`);
      const rows = [
        { timestamp: '2026-09-28T01:02:03Z', type: 'session_meta', payload: { id, cli_version: '0.157.1', source: 'cli' } },
        { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: `合成 ${project} 修改请求` }] } },
        { type: 'response_item', payload: { type: 'custom_tool_call', name: 'apply_patch', call_id: 'patch1', input: '*** Begin Patch\n*** Add File: sample.ts\n+export const value = 42;\n*** End Patch' } },
        { type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'patch1', output: 'Synthetic fixture: patch applied to sample.ts' } },
        { type: 'response_item', payload: { type: 'function_call', name: 'exec_command', call_id: 'test1', arguments: '{"cmd":"synthetic-test"}' } },
        { type: 'response_item', payload: { type: 'function_call_output', call_id: 'test1', output: [{ type: 'input_text', text: `Synthetic ${project}: 2 tests passed` }] } },
        { type: 'unsupported_image', payload: { availableOnlyInRaw: true } },
      ];
      const bytes = Buffer.from(rows.map(row => JSON.stringify(row)).join('\n') + '\n'); await writeFile(path, bytes);
      await sandbox.collectorCommand('hook', state, { hook_event_name: 'Stop', session_id: id, transcript_path: path, cwd: `/synthetic/${project}` });
    }
    const collected = JSON.parse(await sandbox.collectorCommand('run', state));
    assert.equal(collected.committed, 2); assert.deepEqual(collected.errors, []);
    const headers = { Authorization: `Bearer ${reader.readerCredential}` };
    const sessions = (await (await fetch(`${origin}/api/sessions`, { headers })).json()).sessions;
    assert.equal(sessions.length, 2);
    assert.ok(sessions.every((item: any) => item.source === 'codex-cli' && item.source_version === '0.157.1'));
    const alpha = sessions.find((item: any) => item.project === '/synthetic/alpha');
    const detail = await (await fetch(`${origin}/api/snapshots/${alpha.id}`, { headers })).json();
    assert.equal(detail.events.length, 5); assert.equal(detail.unrecognizedLines, 1);
    assert.equal(detail.parserVersion, 'codex-jsonl-4');
    assert.ok(detail.events.some((item: any) => item.text.includes('export const value = 42;')));
    assert.equal(detail.recovery.desktopUi, 'not-applicable');
    browser = await chromium.launch(); const page = await browser.newPage();
    await page.goto(origin); await page.getByLabel('个人读取凭据').fill(reader.readerCredential);
    await page.getByRole('button', { name: '进入存档' }).click();
    await page.getByRole('link').filter({ hasText: '/synthetic/alpha' }).click();
    await expect(page.getByRole('article').getByText('合成 CLI 员工 · Codex CLI', { exact: true })).toBeVisible();
    await expect(page.getByText('Synthetic alpha: 2 tests passed', { exact: true })).toBeVisible();
    await expect(page.getByText('export const value = 42;', { exact: false })).toBeVisible();
    await expect(page.getByText('1 行未解析', { exact: false })).toBeVisible();
    await page.getByText('查看 CLI 恢复准备步骤').click();
    await expect(page.getByText('工具返回值及代码变更仅反映原会话可提供的材料', { exact: false })).toBeVisible();
  } finally { try { await browser?.close(); } finally { await sandbox.close(); } }
});
