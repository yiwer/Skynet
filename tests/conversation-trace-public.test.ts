import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { mcpSandbox } from './mcp-support.js';
import { digest } from '../apps/server/database.js';
import type { ConversationPage, ConversationTracePage } from '../packages/contracts/conversation.js';

const params = (value: object) => new URLSearchParams(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, String(item)]));
const json = (value: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
const stringSize = (value: unknown): number => typeof value === 'string' ? value.length
  : value && typeof value === 'object' ? Object.values(value).reduce<number>((total, item) => total + stringSize(item), 0) : 0;

test('conversation trace stays source-grounded across context filters, tool pagination and real OAuth MCP', { timeout: 120_000 }, async () => {
  const sandbox = await mcpSandbox();
  let client: Client | undefined;
  console.log(`Conversation trace evidence directory: ${sandbox.directory}`);
  try {
    const employee = await sandbox.provision('Trace synthetic author');
    const reader = await sandbox.provision('Trace independent reader');
    const enrolled = await sandbox.api('/api/devices/enroll', employee.enrollmentCredential,
      json({ installationId: randomUUID(), name: 'synthetic trace device' }));
    assert.equal(enrolled.status, 200);
    const device = await enrolled.json();
    const api = (path: string, init: RequestInit = {}) => sandbox.api(path, reader.readerCredential, init);
    const timestamp = '2026-10-03T10:00:00.000Z';
    const started = Date.parse(timestamp);
    const sessionId = randomUUID();
    const rows: unknown[] = [];
    const add = (value: unknown) => { rows.push(value); return rows.length; };
    const response = (payload: unknown) => ({ type: 'response_item', timestamp, payload });
    const message = (role: string, text: string, id?: string) => response({ type: 'message', role, id,
      content: [{ type: role === 'assistant' ? 'output_text' : 'input_text', text }] });
    const completed = (item: object, start: number, end: number, turnId = 'turn-one') => ({
      type: 'event_msg', timestamp, payload: { type: 'item_completed', item,
        started_at_ms: start, completed_at_ms: end, thread_id: sessionId, turn_id: turnId },
    });
    const injection = '<script>window.traceInjected=true</script><img src=x onerror="window.traceInjected=true">';
    const longDeveloper = 'PRIVATE_CONTEXT_FIXTURE '.repeat(240) + 'CONTEXT_END';
    const pureEnvironment = '<environment_context>synthetic machine paths only</environment_context>';
    const mixed = `${pureEnvironment}\nKeep this real user request.`;
    const mixedWrappers = '<environment_context>machine A</environment_context>\nReal request between wrappers.\n<environment_context>machine B</environment_context>';
    const argumentsText = 'const payload = '.repeat(210) + injection + '\nARGUMENT_TAIL';
    const output = '工具原始输出😀'.repeat(540) + '\nWall time: 999 seconds\n' + injection + '\nOUTPUT_TAIL';
    const assistantText = 'One original assistant message, also mirrored by item_completed.';
    add({ type: 'session_meta', timestamp, payload: { id: sessionId, source: 'vscode', originator: 'codex-tui', cli_version: '0.160.0' } });
    const developerLine = add(message('developer', longDeveloper));
    const systemLine = add(message('system', 'Synthetic system context'));
    const environmentLine = add(message('user', pureEnvironment));
    const mixedLine = add(message('user', mixed));
    const mixedWrappersLine = add(message('user', mixedWrappers));
    const noTurnLine = add(message('assistant', 'No turn identity is available.', 'no-turn-native'));
    add({ type: 'event_msg', timestamp, payload: { type: 'item_completed',
      item: { type: 'AgentMessage', id: 'no-turn-native' }, started_at_ms: started, completed_at_ms: started + 30 } });
    add({ type: 'event_msg', timestamp, payload: { type: 'task_started', turn_id: 'turn-one', started_at: timestamp } });
    add({ type: 'turn_context', timestamp, payload: { turn_id: 'turn-one', model: 'synthetic-model' } });
    add(completed({ type: 'AgentMessage', id: 'assistant-native', phase: 'commentary', content: [{ type: 'Text', text: assistantText }] }, started, started + 75));
    const assistantLine = add(message('assistant', assistantText, 'assistant-native'));
    const requestLine = add(response({ type: 'custom_tool_call', id: 'request-native', name: 'functions.exec', call_id: 'call-one', input: argumentsText }));
    const independentTraceLine = add(completed({ type: 'CommandExecution', id: 'independent-command', command: ['synthetic'],
      status: 'completed', exit_code: 0, duration: { secs: 2, nanos: 250_000_000 },
      aggregated_output: 'TRACE_OUTPUT_MUST_NOT_BE_DUPLICATED '.repeat(100), stdout: injection, stderr: '' }, started + 100, started + 2350));
    const fillerLine = add(message('assistant', 'A separate page before the tool result. '.repeat(75)));
    const resultLine = add(response({ type: 'custom_tool_call_output', call_id: 'call-one', output }));
    const completedTurnLine = add({ type: 'event_msg', timestamp: new Date(started + 5000).toISOString(),
      payload: { type: 'task_complete', turn_id: 'turn-one', duration_ms: 5000,
        started_at: started / 1000, completed_at: (started + 5000) / 1000, last_agent_message: assistantText } });
    add({ type: 'event_msg', timestamp, payload: { type: 'task_started', turn_id: 'turn-two', started_at: new Date(started + 10_000).toISOString() } });
    add({ type: 'turn_context', timestamp, payload: { turn_id: 'turn-two', model: 'synthetic-model' } });
    const unmatchedRequest = add(response({ type: 'function_call', name: 'Read', call_id: 'request-only', arguments: '{}' }));
    const unmatchedResult = add(response({ type: 'function_call_output', call_id: 'result-only', output: 'No request exists.' }));
    const duplicateRequestA = add(response({ type: 'function_call', name: 'Read', call_id: 'duplicate-call', arguments: '{"file":"A"}' }));
    const duplicateRequestB = add(response({ type: 'function_call', name: 'Read', call_id: 'duplicate-call', arguments: '{"file":"B"}' }));
    const duplicateResult = add(response({ type: 'function_call_output', call_id: 'duplicate-call', output: 'Cannot know which request this belongs to.' }));
    const timedRequest = add(response({ type: 'function_call', id: 'timed-native', name: 'Read', call_id: 'timed-call', arguments: '{}' }));
    const timedTraceLine = add(completed({ type: 'CommandExecution', id: 'timed-native', status: 'completed', exit_code: 0,
      duration: { secs: 0, nanos: 12_000_000 } }, started + 10_010, started + 10_022, 'turn-two'));
    const timedResult = add(response({ type: 'function_call_output', call_id: 'timed-call', output: 'Recorded output.' }));
    const invalidTimingLine = add(completed({ type: 'CommandExecution', id: 'invalid-timing', status: 'completed' }, started + 50, started + 10, 'turn-two'));
    const duplicateNativeA = add(message('assistant', 'First source record with a reused native ID.', 'duplicate-native'));
    const duplicateNativeB = add(message('assistant', 'Second source record with that same native ID.', 'duplicate-native'));
    add(completed({ type: 'AgentMessage', id: 'duplicate-native' }, started + 12_000, started + 12_030, 'turn-two'));
    add(completed({ type: 'Reasoning', id: 'reasoning-native', raw_content: ['REASONING_BODY_NOT_TRACE'], summary_text: ['REASONING_SUMMARY_NOT_TRACE'] }, started, started + 10));
    const trailingContextLine = add(message('developer', 'Trailing context must not create an empty continuation page.'));
    const bytes = Buffer.from(rows.map(row => JSON.stringify(row)).join('\n') + '\n');
    const uploaded = await sandbox.api(`/api/chunks/${digest(bytes)}`, device.deviceCredential,
      { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(bytes) });
    assert.ok([200, 201].includes(uploaded.status));
    const committed = await sandbox.api('/api/snapshots', device.deviceCredential, json({
      protocolVersion: 1, sourceSessionId: sessionId, source: 'codex-cli', sourceVersion: '0.160.0', sourceOs: process.platform,
      project: '/synthetic/conversation-trace', hash: digest(bytes), byteLength: bytes.length,
      qualifiedAt: new Date().toISOString(), capability: 'unverified',
    }));
    assert.equal(committed.status, 200);
    const snapshotId = (await committed.json()).snapshotId as string;
    const path = `/api/snapshots/${snapshotId}/conversation`;
    assert.equal((await sandbox.api(path + '/trace')).status, 401);
    assert.equal((await sandbox.api(path + '/trace', device.deviceCredential)).status, 401);

    const resource = sandbox.origin + '/mcp';
    const registration = await (await api('/oauth/register', json({ client_name: 'Trace public reader',
      redirect_uris: ['http://127.0.0.1:47123/callback'], token_endpoint_auth_method: 'none' }))).json();
    const verifier = randomBytes(48).toString('base64url');
    const callback = new URL(await sandbox.authorizationPage(sandbox.origin + '/oauth/authorize?' + params({
      response_type: 'code', client_id: registration.client_id, redirect_uri: registration.redirect_uris[0],
      scope: 'archive:read', resource, state: randomUUID(), code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    }), reader.readerCredential));
    const token = await (await api('/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params({ grant_type: 'authorization_code', client_id: registration.client_id, code: callback.searchParams.get('code'),
        redirect_uri: registration.redirect_uris[0], code_verifier: verifier, resource }).toString() })).json();
    assert.ok(token.access_token);
    client = new Client({ name: 'conversation-trace-public', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(resource), {
      fetch: sandbox.fetchTls, requestInit: { headers: { Authorization: `Bearer ${token.access_token}` } },
    }));
    async function tool<T>(name: string, input: object): Promise<T> {
      const result = await client!.callTool({ name, arguments: { snapshotId, ...input } });
      assert.notEqual(result.isError, true, JSON.stringify(result));
      return JSON.parse((result.content as { text: string }[])[0]!.text) as T;
    }
    const read = async (query: object = {}): Promise<ConversationPage> => {
      const response = await api(path + '?' + params(query));
      assert.equal(response.status, 200, await response.clone().text());
      return response.json();
    };
    async function collect(includeTools: boolean, includeContext: boolean) {
      const messages: ConversationPage['messages'] = [];
      const pages: ConversationPage[] = [];
      let cursor: string | null = null;
      do {
        const query: { includeTools: boolean; includeContext: boolean; limit: number; cursor?: string } = {
          includeTools, includeContext, limit: 2, ...(cursor ? { cursor } : {}),
        };
        const page = await read(query);
        assert.deepEqual(await tool('read_conversation', query), page);
        assert.equal(page.parserVersion, 'codex-jsonl-4', 'display metadata must not silently change evidence/provenance parsing');
        assert.equal(page.readingVersion, 'conversation-2');
        assert.equal(page.includeContext, includeContext);
        assert.ok(page.messages.length > 0 || page.nextCursor === null, 'a filtered page must make progress');
        assert.ok(page.messages.reduce((total, message) => total + message.text.length + stringSize(message.trace) + stringSize(message.tool), 0) <= 2048,
          'new trace metadata cannot bypass the source-text response budget');
        for (const message of page.messages) assert.ok(!/[\uD800-\uDBFF]$/.test(message.text), 'fragments preserve Unicode surrogate pairs');
        messages.push(...page.messages); pages.push(page); cursor = page.nextCursor;
        assert.ok(pages.length < 60, 'continuation cursor must advance');
      } while (cursor);
      return { messages, pages };
    }
    const ordinary = await collect(false, false);
    assert.deepEqual([...new Set(ordinary.messages.map(message => message.line))],
      [mixedLine, mixedWrappersLine, noTurnLine, assistantLine, fillerLine, duplicateNativeA, duplicateNativeB]);
    assert.equal(ordinary.pages[0]!.totalContextEvents, 4);
    assert.equal(ordinary.messages.filter(message => message.line === assistantLine).map(message => message.text).join(''), assistantText,
      'item_completed and task_complete mirrors must not duplicate response_item messages');
    assert.ok(ordinary.messages.every(message => !message.contextKind));
    const expanded = await collect(true, true);
    const fullText = (line: number) => expanded.messages.filter(message => message.line === line).map(message => message.text).join('');
    assert.equal(fullText(developerLine), longDeveloper);
    assert.equal(fullText(environmentLine), pureEnvironment);
    assert.equal(fullText(mixedLine), mixed); assert.equal(fullText(mixedWrappersLine), mixedWrappers);
    assert.equal(fullText(requestLine), `functions.exec\n${argumentsText}`);
    assert.equal(fullText(resultLine), output);
    assert.equal(expanded.pages[0]!.totalToolCalls, 5);
    assert.equal(expanded.pages[0]!.totalToolEvents, 9);
    const firstAt = (line: number) => expanded.messages.find(message => message.line === line)!;
    for (const [line, kind] of [[developerLine, 'developer'], [systemLine, 'system'], [environmentLine, 'environment'], [trailingContextLine, 'developer']] as const)
      assert.equal(firstAt(line).contextKind, kind);
    assert.deepEqual(firstAt(requestLine).tool?.peer, { line: resultLine, block: 0, role: 'tool result' });
    assert.deepEqual(firstAt(resultLine).tool?.peer, { line: requestLine, block: 0, role: 'tool request' });
    assert.equal(firstAt(requestLine).tool?.association, 'paired');
    assert.equal(firstAt(resultLine).tool?.name, 'functions.exec', 'a unique paired result retains the recorded request tool name');
    assert.notEqual(expanded.pages.findIndex(page => page.messages.some(message => message.line === requestLine)),
      expanded.pages.findIndex(page => page.messages.some(message => message.line === resultLine)), 'the call/result really straddle public pages');
    for (const line of [unmatchedRequest, unmatchedResult]) {
      assert.equal(firstAt(line).tool?.association, 'unmatched'); assert.equal(firstAt(line).tool?.peer, undefined);
    }
    for (const line of [duplicateRequestA, duplicateRequestB, duplicateResult]) {
      assert.equal(firstAt(line).tool?.association, 'ambiguous'); assert.equal(firstAt(line).tool?.peer, undefined);
    }
    assert.equal(firstAt(requestLine).trace?.durationMs, undefined, 'matching output does not establish execution duration');
    assert.equal(firstAt(resultLine).trace?.durationMs, undefined, 'Wall time prose is not native timing metadata');
    assert.notEqual(firstAt(requestLine).trace?.traceLine, independentTraceLine, 'an independent command is not guessed into a custom call');
    assert.equal(firstAt(timedRequest).trace?.traceLine, timedTraceLine);
    assert.equal(firstAt(timedRequest).trace?.durationMs, 12);
    assert.equal(firstAt(timedRequest).tool?.peer?.line, timedResult);
    for (const line of [noTurnLine, duplicateNativeA, duplicateNativeB]) {
      assert.equal(firstAt(line).trace?.traceLine, undefined, 'timing requires a unique response and completion with exact turn/native IDs');
      assert.equal(firstAt(line).trace?.durationMs, undefined);
    }
    const contextAnchor = await read({ line: developerLine, textOffset: longDeveloper.indexOf('CONTEXT_END') });
    assert.equal(contextAnchor.includeContext, true); assert.equal(contextAnchor.messages[0]!.text, 'CONTEXT_END');
    assert.deepEqual(await tool('read_conversation', { anchor: { line: developerLine, textOffset: longDeveloper.indexOf('CONTEXT_END') } }), contextAnchor);
    const anchored = await read({ line: resultLine, textOffset: output.indexOf('OUTPUT_TAIL') });
    assert.equal(anchored.includeTools, true); assert.equal(anchored.messages[0]!.text, 'OUTPUT_TAIL');
    assert.deepEqual(await tool('read_conversation', { anchor: { line: resultLine, textOffset: output.indexOf('OUTPUT_TAIL') } }), anchored);
    assert.ok(expanded.pages[0]!.nextCursor);
    assert.equal((await api(path + '?' + params({ cursor: expanded.pages[0]!.nextCursor, includeTools: true, includeContext: false }))).status, 400,
      'a cursor binds the context filter as well as snapshot and tool filter');
    const legacyCursor = Buffer.from(JSON.stringify({ version: 1, snapshotId, hash: digest(bytes), parserVersion: 'codex-jsonl-4',
      attributionRevision: ordinary.pages[0]!.attributionRevision, includeTools: false, offset: 0, textOffset: 0 })).toString('base64url');
    assert.notEqual((await api(path + '?' + params({ cursor: legacyCursor }))).status, 200, 'old projection cursors cannot silently mix reading versions');

    const spans: ConversationTracePage['spans'] = [];
    let traceCursor: string | null = null;
    let tracePages = 0;
    do {
      const query: { limit: number; cursor?: string } = { limit: 1, ...(traceCursor ? { cursor: traceCursor } : {}) };
      const response = await api(path + '/trace?' + params(query));
      assert.equal(response.status, 200, await response.clone().text());
      const page: ConversationTracePage = await response.json();
      assert.deepEqual(await tool('read_conversation_trace', query), page);
      assert.ok(page.spans.length <= 1);
      assert.ok(!JSON.stringify(page).includes('TRACE_OUTPUT_MUST_NOT_BE_DUPLICATED'));
      assert.ok(!JSON.stringify(page).includes('REASONING_BODY_NOT_TRACE'));
      assert.ok(!JSON.stringify(page).includes('REASONING_SUMMARY_NOT_TRACE'));
      spans.push(...page.spans); traceCursor = page.nextCursor; tracePages++;
      assert.ok(tracePages < 40, 'trace pagination must advance');
    } while (traceCursor);
    const independent = spans.find(span => span.line === independentTraceLine)!;
    assert.ok(independent); assert.equal(independent.executionDurationMs, 2250); assert.equal(independent.exitCode, 0);
    const completedTurn = spans.find(span => span.line === completedTurnLine)!;
    assert.ok(completedTurn); assert.equal(completedTurn.startedAt, timestamp);
    assert.equal(completedTurn.completedAt, new Date(started + 5000).toISOString());
    assert.equal(completedTurn.durationMs, 5000); assert.equal(completedTurn.durationSource, 'recorded');
    const invalid = spans.find(span => span.line === invalidTimingLine)!;
    assert.ok(invalid); assert.equal(invalid.durationMs, undefined, 'negative timestamps cannot manufacture a duration');
    assert.ok(spans.some(span => span.line === timedTraceLine));
    assert.equal(new Set(spans.map(span => span.line)).size, spans.length, 'trace pages do not duplicate source spans');
    assert.equal(ordinary.pages[0]!.traceCount, spans.length);
    const filteredResponse = await api(path + '/trace?' + params({ turnId: 'turn-two', limit: 1 }));
    assert.equal(filteredResponse.status, 200);
    const filtered: ConversationTracePage = await filteredResponse.json();
    assert.ok(filtered.spans.length); assert.ok(filtered.spans.every(span => span.turnId === 'turn-two'));
    assert.deepEqual(await tool('read_conversation_trace', { turnId: 'turn-two', limit: 1 }), filtered);
    if (filtered.nextCursor) assert.equal((await api(path + '/trace?' + params({ cursor: filtered.nextCursor, turnId: 'turn-one' }))).status, 400);
    assert.deepEqual(Buffer.from(await (await api(`/api/snapshots/${snapshotId}/raw`)).arrayBuffer()), bytes);
    const evidence = { snapshotId, parserVersion: ordinary.pages[0]!.parserVersion, readingVersion: ordinary.pages[0]!.readingVersion,
      ordinaryPages: ordinary.pages.length, expandedPages: expanded.pages.length, tracePages,
      originalBytes: bytes.length, toolInputUtf16: argumentsText.length, toolOutputUtf16: output.length,
      contextHiddenByDefault: true, mixedUserTextPreserved: true, exactToolPeersAcrossPages: true,
      ambiguousIdsNotPaired: true, originalBytesPreserved: true, httpMcpParity: true, syntheticOnly: true };
    await writeFile(join(sandbox.directory, 'conversation-trace-public-evidence.json'), JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(evidence));
  } finally { await client?.close(); await sandbox.close(); }
});
