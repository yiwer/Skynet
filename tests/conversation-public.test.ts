import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createApp } from '../apps/server/app.js';
import { connect, digest } from '../apps/server/database.js';
import type { ConversationPage } from '../packages/contracts/conversation.js';
import { createSandbox } from './support.js';

test('public conversation freezes originals across continuation/restart, keeps full text and resolves precise source anchors', { timeout: 120_000 }, async () => {
  const sandbox = await createSandbox(); const db = connect(sandbox.env.DATABASE_URL!);
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  try {
    app = await createApp({ db, rawDirectory: sandbox.env.RAW_DIRECTORY! });
    const employee = await sandbox.provision('对话合成员工'); const reader = await sandbox.provision('对话合成读者');
    const api = (url: string, credential?: string, method: 'GET' | 'POST' | 'PUT' = 'GET', payload?: object | Buffer) => app!.inject({
      method, url, headers: { ...(credential ? { authorization: `Bearer ${credential}` } : {}),
        ...(payload ? { 'content-type': Buffer.isBuffer(payload) ? 'application/octet-stream' : 'application/json' } : {}) },
      ...(payload ? { payload: Buffer.isBuffer(payload) ? payload : JSON.stringify(payload) } : {}),
    });
    const enrollment = await api('/api/devices/enroll', employee.enrollmentCredential, 'POST', { installationId: randomUUID(), name: 'synthetic conversation' });
    assert.equal(enrollment.statusCode, 200, enrollment.body); const device = enrollment.json();
    const sourceSessionId = randomUUID(); const childSessionId = randomUUID();
    const record = (payload: unknown, timestamp = '2026-09-01T00:00:00Z') => ({ type: 'response_item', timestamp, payload });
    const message = (role: 'user' | 'assistant', text: string) => record({ type: 'message', role, content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }] });
    const large = '原句😀'.repeat(1700) + 'EXACT_CONVERSATION_MATCH' + '\n尾部🚀'.repeat(1800);
    const records = [
      { type: 'session_meta', payload: { id: sourceSessionId } }, message('user', '旧内容\n不可改写'),
      message('assistant', '所有测试通过（没有工具结果的自述）'),
      record({ type: 'function_call', name: 'shell', arguments: '{"command":"synthetic"}', call_id: 'call-1' }),
      record({ type: 'function_call_output', output: '真实原件文本：测试未运行', call_id: 'call-1' }),
      message('assistant', large), { type: 'future-event', untouched: '未解析字段仍在原件' },
      record({ type: 'function_call', name: 'Read', arguments: '{}', call_id: 'pending-tail' }),
    ];
    const bytes = Buffer.from(records.map(value => JSON.stringify(value)).join('\n') + '\n{"partial":');
    const childBytes = Buffer.from(JSON.stringify(message('assistant', '子会话原文')) + '\n');
    async function put(content: Buffer) {
      const response = await api(`/api/chunks/${digest(content)}`, device.deviceCredential, 'PUT', content);
      assert.ok([200, 201].includes(response.statusCode), response.body);
    }
    await put(childBytes);
    const child = { id: digest('conversation child'), role: 'child-transcript', name: 'children/synthetic.jsonl', placement: 'portable',
      sourceSessionId: childSessionId, hash: digest(childBytes), byteLength: childBytes.length, mediaType: 'jsonl' };
    async function commit(content: Buffer, revision = 1, previousSnapshotId?: string) {
      await put(content);
      const response = await api('/api/snapshots', device.deviceCredential, 'POST', {
        protocolVersion: 1, sourceSessionId, source: 'codex-cli', sourceVersion: '0.157.1', sourceOs: 'win32', project: '/synthetic/conversation',
        hash: digest(content), byteLength: content.length, qualifiedAt: new Date().toISOString(), capability: 'unverified',
        capture: { generation: digest('conversation generation'), revision, change: previousSnapshotId ? 'append' : 'initial', previousSnapshotId,
          materials: [child], lineage: [{ relation: 'child', sessionId: childSessionId, materialId: child.id }],
          gaps: [{ code: 'history-unavailable', reference: 'synthetic missing history' }], compacted: true, partialLine: true },
      });
      assert.equal(response.statusCode, 200, response.body); return response.json().snapshotId as string;
    }
    const id = await commit(bytes); const path = `/api/snapshots/${id}/conversation`;
    assert.equal((await api(path)).statusCode, 401);
    assert.equal((await api(path, device.deviceCredential)).statusCode, 401);
    const read = async (query: Record<string, string | number | boolean> = {}) => {
      const response = await api(`${path}?${new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]))}`, reader.readerCredential);
      assert.equal(response.statusCode, 200, response.body); return response.json<ConversationPage>();
    };
    const first = await read({ limit: 1 }); assert.ok(first.nextCursor); assert.equal(first.messages[0]!.text, '旧内容\n不可改写');
    assert.equal(first.messages[0]!.context, 'historical'); assert.equal(first.status.compacted, true);
    assert.equal(first.status.partialLine, true); assert.equal(first.status.unrecognizedLines, 1);
    assert.equal(first.status.captureGapCount, 1); assert.equal(first.status.offlineBackfill, 'unknown'); assert.equal(first.status.ongoing, 'unknown');
    assert.equal(first.totalToolCalls, 2); assert.equal(first.totalToolEvents, 3); assert.equal(first.trailingHiddenToolCalls, 0);
    assert.equal(first.relatedTotal, 1); assert.equal(first.related[0]!.materialId, child.id);
    const newer = await commit(Buffer.concat([bytes, Buffer.from('\n' + JSON.stringify(message('user', '新追加不进入旧快照')) + '\n')]), 2, id);
    assert.notEqual(newer, id);
    await app.close(); app = await createApp({ db, rawDirectory: sandbox.env.RAW_DIRECTORY! });
    const all = [...first.messages]; let cursor: string | null = first.nextCursor;
    while (cursor) { const page = await read({ cursor, limit: 1 }); all.push(...page.messages); cursor = page.nextCursor; }
    assert.deepEqual([...new Set(all.map(event => event.id))], ['2:0', '3:0', '6:0']);
    assert.equal(all.find(event => event.line === 3)!.toolEvidence, 'none-observed');
    assert.equal(all.find(event => event.line === 6)!.hiddenToolCalls, 1);
    assert.equal(all.find(event => event.line === 6)!.toolEvidence, 'present-not-assessed');
    assert.equal(all.filter(event => event.line === 6).map(event => event.text).join(''), large);
    assert.equal(all.filter(event => event.line === 6).reduce((total, event) => total + event.hiddenToolCalls, 0), 1,
      'one original assistant message reports preceding hidden calls only once across its text segments');
    const legacy = await read({ readingVersion: 'conversation-2', limit: 1 });
    assert.equal(legacy.readingVersion, 'conversation-2'); assert.equal(legacy.trailingHiddenToolCalls, 1);
    const legacyContinued = await read({ cursor: legacy.nextCursor!, limit: 1 });
    assert.equal(legacyContinued.readingVersion, 'conversation-2', 'an existing cursor preserves its original reading interpretation');
    for (const event of all) {
      assert.equal(event.text, (event.line === 6 ? large : event.line === 2 ? '旧内容\n不可改写' : '所有测试通过（没有工具结果的自述）').slice(event.textOffset, event.textOffset + event.text.length));
      assert.ok(!/[\uD800-\uDBFF]$/.test(event.text), 'page must not split a Unicode surrogate pair');
    }
    const tools: ConversationPage['messages'] = []; cursor = null;
    do { const page = await read({ includeTools: true, ...(cursor ? { cursor } : {}) }); tools.push(...page.messages); cursor = page.nextCursor; } while (cursor);
    assert.deepEqual([...new Set(tools.map(event => event.line))], [2, 3, 4, 5, 6, 8]);
    assert.equal(tools.filter(event => event.line === 5).map(event => event.text).join(''), '真实原件文本：测试未运行');
    const at = large.indexOf('EXACT_CONVERSATION_MATCH');
    const anchored = await read({ line: 6, block: 0, textOffset: at, parserVersion: first.parserVersion });
    assert.ok(anchored.messages[0]!.text.startsWith('EXACT_CONVERSATION_MATCH'));
    assert.equal(anchored.messages[0]!.textOffset, at); assert.equal(anchored.anchor!.line, 6);
    const toolAnchor = await read({ line: 5, textOffset: 0 });
    assert.equal(toolAnchor.includeTools, true); assert.equal(toolAnchor.messages[0]!.role, 'tool result');
    assert.equal((await api(`${path}?line=6&parserVersion=old-parser`, reader.readerCredential)).statusCode, 409);
    assert.equal((await api(`${path}?line=7`, reader.readerCredential)).statusCode, 404);
    assert.equal((await api(`${path}?cursor=${encodeURIComponent(first.nextCursor!)}&includeTools=true`, reader.readerCredential)).statusCode, 400);
    assert.equal((await api(`/api/snapshots/${newer}/conversation?cursor=${encodeURIComponent(first.nextCursor!)}`, reader.readerCredential)).statusCode, 400);
    assert.deepEqual((await api(`/api/snapshots/${id}/raw`, reader.readerCredential)).rawPayload, bytes);

    // A material restored by B is initially context-only. Only A's subsequent normal
    // primary capture can qualify it; an old conversation cursor must reject this change.
    const copyEmployee = await sandbox.provision('对话材料复制者');
    const copyEnrollment = await api('/api/devices/enroll', copyEmployee.enrollmentCredential, 'POST', { installationId: randomUUID(), name: 'synthetic copy' });
    assert.equal(copyEnrollment.statusCode, 200, copyEnrollment.body); const copyDevice = copyEnrollment.json();
    const materialSession = randomUUID(); const parentSession = randomUUID();
    const afterEnrollment = new Date(Date.now() + 1000).toISOString();
    const materialBytes = Buffer.from([
      { type: 'session_meta', payload: { id: materialSession } },
      message('user', '材料中的旧内容'),
      record({ type: 'message', role: 'user', content: [{ type: 'input_text', text: '原设备接入后的真实来源记录' }] }, afterEnrollment),
    ].map(value => JSON.stringify(value)).join('\n') + '\n');
    const parentBytes = Buffer.from([
      { type: 'session_meta', payload: { id: parentSession, forked_from_id: materialSession } }, message('user', '父会话原件'),
    ].map(value => JSON.stringify(value)).join('\n') + '\n');
    const qualifiedMaterial = { ...child, id: digest('qualification conversation material'), sourceSessionId: materialSession,
      placement: 'codex-rollout', hash: digest(materialBytes), byteLength: materialBytes.length };
    async function publish(content: Buffer, sessionId: string, credential: string, extra: object = {}) {
      const uploaded = await api(`/api/chunks/${digest(content)}`, credential, 'PUT', content);
      assert.ok([200, 201].includes(uploaded.statusCode), uploaded.body);
      const response = await api('/api/snapshots', credential, 'POST', { protocolVersion: 1, sourceSessionId: sessionId,
        source: 'codex-cli', sourceVersion: '0.157.1', sourceOs: 'win32', project: '/synthetic/original-material',
        hash: digest(content), byteLength: content.length, qualifiedAt: new Date().toISOString(), capability: 'unverified', ...extra });
      assert.equal(response.statusCode, 200, response.body); return response.json().snapshotId as string;
    }
    await put(materialBytes);
    const parent = await publish(parentBytes, parentSession, device.deviceCredential, { capture: {
      generation: digest('conversation parent qualification'), revision: 1, change: 'initial', materials: [qualifiedMaterial],
      lineage: [{ relation: 'child', sessionId: materialSession, materialId: qualifiedMaterial.id }], gaps: [], compacted: false, partialLine: false,
    } });
    const copy = await publish(materialBytes, materialSession, copyDevice.deviceCredential, { project: '/synthetic/copied-material',
      restoredFrom: { snapshotId: parent, materialId: qualifiedMaterial.id, hash: digest(materialBytes), byteLength: materialBytes.length } });
    const copyPath = `/api/snapshots/${copy}/conversation`;
    const initialCopy = await api(`${copyPath}?limit=1`, reader.readerCredential);
    assert.equal(initialCopy.statusCode, 200, initialCopy.body); const before = initialCopy.json<ConversationPage>();
    assert.ok(before.nextCursor); assert.equal(before.messages[0]!.context, 'historical');
    const oldSecond = await api(`${copyPath}?cursor=${encodeURIComponent(before.nextCursor!)}`, reader.readerCredential);
    assert.equal(oldSecond.statusCode, 200, oldSecond.body);
    assert.equal(oldSecond.json<ConversationPage>().messages[0]!.context, 'historical');
    const proofSnapshot = await publish(materialBytes, materialSession, device.deviceCredential);
    assert.equal((await api(`${copyPath}?cursor=${encodeURIComponent(before.nextCursor!)}`, reader.readerCredential)).statusCode, 409,
      'a trusted public qualification must not silently change origins inside an ongoing conversation');
    const currentCopy = await api(copyPath, reader.readerCredential); assert.equal(currentCopy.statusCode, 200, currentCopy.body);
    const qualified = currentCopy.json<ConversationPage>();
    assert.notEqual(qualified.attributionRevision, before.attributionRevision);
    assert.deepEqual(qualified.messages.map(event => event.context), ['historical', 'after-enrollment']);
    assert.equal(qualified.messages[1]!.origin!.employeeId, employee.employeeId);
    assert.equal(qualified.messages[1]!.origin!.qualification!.proofSnapshotId, proofSnapshot);
    assert.equal(qualified.hash, before.hash);
    assert.deepEqual((await api(`/api/snapshots/${copy}/raw`, reader.readerCredential)).rawPayload, materialBytes);
    await writeFile(join(sandbox.directory, 'conversation-public-evidence.json'), JSON.stringify({ snapshotId: id, newerSnapshotId: newer,
      hash: digest(bytes), parserVersion: first.parserVersion, totalMessages: first.totalMessages, totalToolCalls: first.totalToolCalls,
      fragments: all.length, fullTextUtf16: large.length, exactAnchor: anchored.anchor, sourceOrder: [...new Set(tools.map(event => event.line))],
      status: first.status, related: first.related,
      qualification: { copy, proofSnapshot, oldRevision: before.attributionRevision, currentRevision: qualified.attributionRevision,
        currentContexts: qualified.messages.map(event => event.context), oldCursorRejected: true, rawUnchanged: true } }, null, 2));
  } finally {
    await app?.close(); await db.end(); await sandbox.close();
  }
});
