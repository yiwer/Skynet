import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { mcpSandbox } from './mcp-support.js';

const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const form = (body: Record<string, string>): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

test('HTTPS OAuth consent, per-request revocation, MCP/Web evidence and complete paged exports', { timeout: 180_000 }, async () => {
  const sandbox = await mcpSandbox(); let client: Client | undefined;
  try {
    const employee = await sandbox.provision('合成 MCP 存档员工'); const reader = await sandbox.provision('合成 MCP 读者');
    const manager = await sandbox.provision('合成 MCP 维护者', true);
    const enrollment = await (await sandbox.api('/api/devices/enroll', employee.enrollmentCredential, json({ installationId: randomUUID(), name: 'MCP fixture' }))).json();
    const sessionId = randomUUID(); const largeText = '大工具完整输出🛰'.repeat(10_000) + 'SKYNET_MCP_LAST_CHARACTER';
    const bytes = Buffer.from([
      { type: 'session_meta', payload: { id: sessionId, cli_version: '0.158.0-alpha.2.1' } },
      { type: 'response_item', payload: { type: 'function_call_output', call_id: 'large', output: largeText } },
      ...Array.from({ length: 123 }, (_, index) => ({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: `证据 ${index}` }] } })),
      { type: 'future_material', unknown: 'preserve verbatim' },
    ].map(line => JSON.stringify(line)).join('\n') + '\n');
    const manifest = { protocolVersion: 1, sourceSessionId: sessionId, source: 'codex-desktop', sourceVersion: '26.924.2738.0', sourceOs: 'win32',
      project: '/synthetic/mcp', hash: hash(bytes), byteLength: bytes.length, qualifiedAt: new Date().toISOString(), capability: 'unverified' };
    assert.equal((await sandbox.api(`/api/chunks/${manifest.hash}`, enrollment.deviceCredential, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes })).status, 201);
    const commit = await (await sandbox.api('/api/snapshots', enrollment.deviceCredential, json(manifest))).json();
    assert.ok(commit.snapshotId);

    for (const token of [undefined, enrollment.deviceCredential, reader.readerCredential, employee.enrollmentCredential]) {
      const denied = await sandbox.api('/mcp', token, json({ jsonrpc: '2.0', id: 1, method: 'tools/list' }));
      assert.equal(denied.status, 401); assert.match(denied.headers.get('www-authenticate')!, /oauth-protected-resource\/mcp/);
    }
    const resource = `${sandbox.origin}/mcp`;
    const discovery = await (await sandbox.api('/.well-known/oauth-protected-resource/mcp')).json();
    assert.equal(discovery.resource, resource); assert.deepEqual(discovery.scopes_supported, ['archive:read']);
    const metadata = await (await sandbox.api('/.well-known/oauth-authorization-server')).json();
    assert.deepEqual(metadata.code_challenge_methods_supported, ['S256']);
    assert.equal((await sandbox.api('/oauth/register', undefined, json({ redirect_uris: ['javascript:alert(1)'] }))).status, 400);
    assert.equal((await sandbox.api('/oauth/register', undefined, json({ redirect_uris: ['http://example.com/callback'] }))).status, 400);
    const registration = await (await sandbox.api('/oauth/register', undefined, json({ client_name: '<img src=x onerror=alert(1)> test reader',
      redirect_uris: ['http://127.0.0.1:47123/callback'], token_endpoint_auth_method: 'none' }))).json();
    const verifier = randomBytes(48).toString('base64url');
    const parameters = { response_type: 'code', client_id: registration.client_id, redirect_uri: registration.redirect_uris[0], scope: 'archive:read', resource,
      state: randomUUID(), code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url') };
    const authorize = (changes = {}) => `${sandbox.origin}/oauth/authorize?${new URLSearchParams({ ...parameters, ...changes })}`;
    for (const changes of [{ redirect_uri: 'http://127.0.0.1:47123/evil' }, { resource: `${sandbox.origin}/other` }, { scope: 'archive:write' },
      { code_challenge_method: 'plain' }, { client_id: 'https://127.0.0.1/private-metadata' }]) {
      assert.equal((await sandbox.fetchTls(authorize(changes))).status, 400);
    }
    const denial = new URL(await sandbox.authorizationPage(authorize(), reader.readerCredential, 'deny'));
    assert.equal(denial.searchParams.get('error'), 'access_denied');
    const callback = new URL(await sandbox.authorizationPage(authorize(), reader.readerCredential));
    assert.equal(callback.searchParams.get('state'), parameters.state);
    const exchange = { grant_type: 'authorization_code', client_id: registration.client_id, code: callback.searchParams.get('code')!,
      redirect_uri: parameters.redirect_uri, code_verifier: verifier, resource };
    for (const changes of [{ code_verifier: randomBytes(48).toString('base64url') }, { redirect_uri: 'http://127.0.0.1:47123/evil' },
      { resource: `${sandbox.origin}/other` }, { scope: 'archive:write' }, { client_id: 'different-client' }] as Record<string, string>[]) {
      assert.equal((await sandbox.api('/oauth/token', undefined, form({ ...exchange, ...changes }))).status, 400);
    }
    const tokens = await (await sandbox.api('/oauth/token', undefined, form(exchange))).json(); assert.ok(tokens.access_token);
    assert.equal((await sandbox.api('/oauth/token', undefined, form(exchange))).status, 400, 'authorization code replay rejected');
    assert.equal((await sandbox.api('/api/sessions', tokens.access_token)).status, 401, 'MCP token never acts as Web credential');
    assert.equal((await sandbox.api('/mcp', tokens.access_token, { ...json({}), headers: { 'Content-Type': 'application/json', Origin: 'https://attacker.invalid' } })).status, 403);
    assert.equal((await sandbox.api('/mcp', tokens.access_token, { ...json({}), body: 'x'.repeat(65_537) })).status, 413);
    await sandbox.restart();
    client = new Client({ name: 'public-product-test', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(resource), { fetch: sandbox.fetchTls,
      requestInit: { headers: { Authorization: `Bearer ${tokens.access_token}` } } }));
    assert.equal((await client.listTools()).tools.length, 5);
    async function tool(name: string, args: Record<string, unknown>) {
      const result = await client!.callTool({ name, arguments: args });
      assert.notEqual(result.isError, true, JSON.stringify(result)); assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 96 * 1024);
      return JSON.parse((result.content as { text: string }[])[0]!.text);
    }
    const sessions = await tool('list_sessions', { limit: 1 }); assert.equal(sessions.sessions[0].id, commit.snapshotId);
    assert.deepEqual(sessions, await (await sandbox.api('/api/sessions?limit=1', reader.readerCredential)).json());
    let position = { offset: 0, textOffset: 0 }; const fragments: any[] = []; let pages = 0;
    while (true) {
      const result = await tool('read_snapshot', { snapshotId: commit.snapshotId, ...position });
      const web = await (await sandbox.api(`/api/snapshots/${commit.snapshotId}/evidence?${new URLSearchParams({ offset: String(position.offset), textOffset: String(position.textOffset) })}`, reader.readerCredential)).json();
      assert.deepEqual(result, web); fragments.push(...result.events); pages++;
      if (!result.next) break; position = result.next;
    }
    assert.ok(pages > 10); assert.equal(fragments.filter(event => event.line === 2).map(event => event.text).join(''), largeText);
    assert.equal(fragments.at(-1).text, '证据 122');
    for (const format of ['raw', 'readable', 'recovery']) {
      const prepared = await tool('prepare_export', { snapshotId: commit.snapshotId, format });
      assert.equal((await sandbox.api(prepared.downloadPath)).status, 401);
      assert.equal((await sandbox.api(prepared.downloadPath, enrollment.deviceCredential)).status, 401);
      const web = Buffer.from(await (await sandbox.api(`/api/snapshots/${commit.snapshotId}/${format}`, reader.readerCredential)).arrayBuffer());
      assert.equal(prepared.sha256, hash(web)); assert.equal(prepared.byteLength, web.length);
      const parts = []; let offset = 0;
      while (true) {
        const page = await tool('read_export', { snapshotId: commit.snapshotId, format, offset });
        assert.equal(page.sha256, prepared.sha256); parts.push(Buffer.from(page.data, 'base64'));
        if (page.nextOffset === null) break; offset = page.nextOffset;
      }
      assert.deepEqual(Buffer.concat(parts), web);
      assert.deepEqual(Buffer.from(await (await sandbox.api(prepared.downloadPath, tokens.access_token)).arrayBuffer()), web);
    }
    // New rows cannot shift a previously issued cursor; immutable snapshot references still resolve.
    for (let index = 0; index < 3; index++) await sandbox.api('/api/snapshots', enrollment.deviceCredential, json({ ...manifest, sourceSessionId: randomUUID() }));
    const first = await tool('list_sessions', { limit: 2 }); assert.ok(first.nextCursor);
    await sandbox.api('/api/snapshots', enrollment.deviceCredential, json({ ...manifest, sourceSessionId: randomUUID() }));
    const second = await tool('list_sessions', { limit: 2, cursor: first.nextCursor });
    assert.equal(new Set([...first.sessions, ...second.sessions].map(row => row.id)).size, 4);
    assert.equal(second.nextCursor, null);
    const refreshed = await (await sandbox.api('/oauth/token', undefined, form({ grant_type: 'refresh_token', client_id: registration.client_id,
      refresh_token: tokens.refresh_token, resource }))).json(); assert.ok(refreshed.access_token);
    assert.equal((await sandbox.api('/oauth/token', undefined, form({ grant_type: 'refresh_token', client_id: registration.client_id,
      refresh_token: tokens.refresh_token, resource }))).status, 400, 'reuse revokes the token family');
    assert.equal((await sandbox.api('/mcp', refreshed.access_token, json({}))).status, 401);
    const callback2 = new URL(await sandbox.authorizationPage(authorize(), reader.readerCredential));
    const tokens2 = await (await sandbox.api('/oauth/token', undefined, form({ ...exchange, code: callback2.searchParams.get('code')! }))).json();
    assert.ok(tokens2.access_token);
    assert.equal((await sandbox.api(`/api/identities/employees/${reader.employeeId}/disable`, manager.readerCredential, json({}))).status, 200);
    assert.equal((await sandbox.api('/mcp', tokens2.access_token, json({}))).status, 401);
    assert.equal((await sandbox.api(`/mcp/exports/${commit.snapshotId}/raw`, tokens2.access_token)).status, 401);
    assert.equal((await sandbox.api('/oauth/token', undefined, form({ grant_type: 'refresh_token', client_id: registration.client_id,
      refresh_token: tokens2.refresh_token, resource }))).status, 400);
    assert.equal((await sandbox.api('/api/snapshots', enrollment.deviceCredential, json({ ...manifest, sourceSessionId: randomUUID() }))).status, 200,
      'failed query authentication does not block existing device uploads');
    assert.equal((await sandbox.api(`/api/snapshots/${commit.snapshotId}/raw`, manager.readerCredential)).status, 200);
    console.log(`HTTPS OAuth public-flow evidence: ${sandbox.directory}; ${pages} evidence pages; complete three-format exports`);
  } finally { await client?.close(); await sandbox.close(); }
});
