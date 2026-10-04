import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { assessmentFixture } from './assessment-fixture.js';

test('OAuth MCP returns the same fixed employee profile and bounded section pages as HTTP', { timeout: 120000 }, async () => {
  const sandbox = await assessmentFixture(); let client: Client | undefined;
  try {
    const owner = await sandbox.owner('Profile MCP'); await sandbox.session(owner);
    const profile = await (await sandbox.api(owner, '/api/capability-profiles/' + owner.employeeId)).json();
    const api = (path: string, init: RequestInit = {}) => sandbox.nativeApi(path, owner.readerCredential, init);
    const json = (body: unknown) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const registration = await (await api('/oauth/register', json({ client_name: 'Employee profile', redirect_uris: ['http://127.0.0.1:47129/callback'], token_endpoint_auth_method: 'none' }))).json();
    const verifier = randomBytes(48).toString('base64url'), resource = sandbox.origin + '/mcp';
    const callback = new URL(await sandbox.authorizationPage(sandbox.origin + '/oauth/authorize?' + new URLSearchParams({ response_type: 'code', client_id: registration.client_id,
      redirect_uri: registration.redirect_uris[0], scope: 'archive:read', resource, state: randomUUID(), code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url') }), owner.readerCredential));
    const token = await (await api('/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code',
      client_id: registration.client_id, code: callback.searchParams.get('code')!, redirect_uri: registration.redirect_uris[0], code_verifier: verifier, resource }).toString() })).json();
    client = new Client({ name: 'profile-public', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(resource), { fetch: sandbox.fetchTls, requestInit: { headers: { Authorization: `Bearer ${token.access_token}` } } }));
    const reply = await client.callTool({ name: 'get_capability_profile', arguments: { employeeId: owner.employeeId, version: profile.version } });
    assert.notEqual(reply.isError, true, JSON.stringify(reply));
    assert.deepEqual(JSON.parse((reply.content as { text: string }[])[0]!.text), profile);
    const args = { employeeId: owner.employeeId, version: profile.version, section: 'sessions', offset: 0 };
    const section = await client.callTool({ name: 'get_capability_profile', arguments: args });
    assert.notEqual(section.isError, true);
    assert.deepEqual(JSON.parse((section.content as { text: string }[])[0]!.text), await (await api('/api/capability-profiles/' + owner.employeeId + '?version=' + profile.version + '&section=sessions')).json());
    const rejected = await client.callTool({ name: 'get_capability_profile', arguments: { employeeId: owner.employeeId, offset: 20 } });
    assert.equal(rejected.isError, true);
  } finally { await client?.close(); await sandbox.close(); }
});
