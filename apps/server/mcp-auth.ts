import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { digest, newCredential, type Database } from './database.js';
import { identities, credential, HttpError } from './identities.js';

const scope = 'archive:read';
const secret = z.string().min(1).max(256);
const fields = z.record(z.string(), z.string().max(2048));
const html = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
const equal = (first: string, second: string) => first.length === second.length && timingSafeEqual(Buffer.from(first), Buffer.from(second));
class OAuthError extends HttpError { constructor(public oauthCode: string, message: string, status = 400) { super(status, message); } }
function redirectUri(value: string) {
  const uri = new URL(value);
  if (uri.username || uri.password || uri.hash || (uri.protocol !== 'https:'
    && !(uri.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(uri.hostname)))) throw new Error('redirect');
  return value;
}

export async function registerMcpAuth(app: FastifyInstance, db: Database, publicOrigin: string) {
  const origin = new URL(publicOrigin);
  if (origin.protocol !== 'https:' || origin.origin !== publicOrigin || origin.username || origin.password) {
    throw new Error('SKYNET_PUBLIC_ORIGIN must be an HTTPS origin, without path or trailing slash');
  }
  const resource = `${publicOrigin}/mcp`;
  await db.query(`BEGIN; SELECT pg_advisory_xact_lock(7402126);
    CREATE TABLE IF NOT EXISTS oauth_clients (
      id text PRIMARY KEY,name text NOT NULL,redirects jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS oauth_pending (
      id text PRIMARY KEY,client_id text NOT NULL REFERENCES oauth_clients(id),request jsonb NOT NULL,
      cookie_hash text NOT NULL,expires_at timestamptz NOT NULL,used boolean NOT NULL DEFAULT false
    );
    CREATE TABLE IF NOT EXISTS oauth_codes (
      hash text PRIMARY KEY,employee_id uuid NOT NULL REFERENCES employees(id),client_id text NOT NULL REFERENCES oauth_clients(id),
      redirect_uri text NOT NULL,challenge text NOT NULL,resource text NOT NULL,scope text NOT NULL,expires_at timestamptz NOT NULL,used boolean NOT NULL DEFAULT false
    );
    CREATE TABLE IF NOT EXISTS oauth_grants (
      id uuid PRIMARY KEY,employee_id uuid NOT NULL REFERENCES employees(id),client_id text NOT NULL REFERENCES oauth_clients(id),
      resource text NOT NULL,scope text NOT NULL,active boolean NOT NULL DEFAULT true,expires_at timestamptz NOT NULL
    );
    CREATE TABLE IF NOT EXISTS oauth_tokens (
      hash text PRIMARY KEY,grant_id uuid NOT NULL REFERENCES oauth_grants(id),kind text NOT NULL CHECK(kind IN ('access','refresh')),
      expires_at timestamptz NOT NULL,used boolean NOT NULL DEFAULT false
    );
    COMMIT;`);
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_request, body, done) => {
    const parameters = new URLSearchParams(body as string); const parsed: Record<string, string> = {};
    for (const [key, value] of parameters) {
      if (Object.hasOwn(parsed, key)) { done(new HttpError(400, '重复的表单字段')); return; }
      Object.defineProperty(parsed, key, { value, enumerable: true });
    }
    done(null, parsed);
  });
  const rates = new Map<string, { count: number; until: number }>();
  const limited = async (request: FastifyRequest) => {
    const now = Date.now();
    for (const [key, rate] of rates) if (rate.until < now) rates.delete(key);
    const key = `${request.ip}:${request.routeOptions.url}`;
    const rate = rates.get(key) ?? { count: 0, until: now + 60_000 };
    if (++rate.count > 60 || rates.size >= 5000) throw new HttpError(429, '授权请求过多，请稍后重试');
    rates.set(key, rate);
  };
  const oauth = async <T>(operation: () => Promise<T>, reply: { code: (code: number) => { send: (body: unknown) => unknown } }) => {
    try { return await operation(); }
    catch (error) {
      if (error instanceof OAuthError) return reply.code(error.statusCode).send({ error: error.oauthCode, error_description: error.message });
      if (error instanceof z.ZodError) return reply.code(400).send({ error: 'invalid_request', error_description: '请求格式无效' });
      throw error;
    }
  };
  const metadata = { resource, authorization_servers: [publicOrigin], scopes_supported: [scope], bearer_methods_supported: ['header'] };
  app.get('/.well-known/oauth-protected-resource/mcp', async () => metadata);
  app.get('/.well-known/oauth-protected-resource', async () => metadata);
  app.get('/.well-known/oauth-authorization-server', async () => ({ issuer: publicOrigin,
    authorization_endpoint: `${publicOrigin}/oauth/authorize`, token_endpoint: `${publicOrigin}/oauth/token`,
    registration_endpoint: `${publicOrigin}/oauth/register`, revocation_endpoint: `${publicOrigin}/oauth/revoke`,
    response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none'], code_challenge_methods_supported: ['S256'], scopes_supported: [scope],
    client_id_metadata_document_supported: false }));

  app.post('/oauth/register', { bodyLimit: 8192, onRequest: limited }, async (request, reply) => oauth(async () => {
    const input = z.object({ client_name: z.string().min(1).max(100).default('MCP client'),
      redirect_uris: z.array(z.string().max(2048)).min(1).max(4), token_endpoint_auth_method: z.literal('none').default('none'),
      grant_types: z.array(z.enum(['authorization_code', 'refresh_token'])).min(1).max(2).default(['authorization_code', 'refresh_token']),
      response_types: z.tuple([z.literal('code')]).default(['code']) }).parse(request.body);
    try { input.redirect_uris.forEach(redirectUri); }
    catch { throw new OAuthError('invalid_redirect_uri', '仅支持已登记的 HTTPS 或本机回调地址'); }
    const clientId = newCredential();
    await db.query('INSERT INTO oauth_clients(id,name,redirects) VALUES($1,$2,$3)', [clientId, input.client_name, JSON.stringify(input.redirect_uris)]);
    return reply.code(201).send({ ...input, client_id: clientId, client_id_issued_at: Math.floor(Date.now() / 1000) });
  }, reply));

  const authorization = z.object({ response_type: z.literal('code'), client_id: secret, redirect_uri: z.string().max(2048),
    scope: z.literal(scope), resource: z.literal(resource), state: z.string().min(1).max(1024),
    code_challenge_method: z.literal('S256'), code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });
  app.get('/oauth/authorize', { onRequest: limited }, async (request, reply) => oauth(async () => {
    const input = authorization.parse(request.query);
    const client = (await db.query('SELECT * FROM oauth_clients WHERE id=$1', [input.client_id])).rows[0];
    if (!client || !client.redirects.includes(input.redirect_uri)) throw new OAuthError('invalid_request', '客户端或回调地址未登记');
    const id = newCredential(); const cookie = newCredential();
    await db.query('DELETE FROM oauth_pending WHERE expires_at < now()');
    await db.query("INSERT INTO oauth_pending(id,client_id,request,cookie_hash,expires_at) VALUES($1,$2,$3,$4,now()+interval '10 minutes')",
      [id, input.client_id, input, digest(cookie)]);
    reply.header('Set-Cookie', `skynet_consent=${cookie}; Path=/oauth/authorize; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
    return reply.type('text/html; charset=utf-8').send(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Skynet MCP 授权</title><body>
      <main><h1>授权读取会话存档</h1><p>客户端：<strong>${html(client.name)}</strong>（客户端自行声明的名称）</p>
      <p>允许读取全体员工全部项目的会话原文、证据和导出材料。此授权不允许上传或维护账号。</p>
      <p>回调地址：<code>${html(input.redirect_uri)}</code></p><p>权限：${scope}</p>
      <form method="post" action="/oauth/authorize"><input type="hidden" name="request" value="${id}">
      <label>个人读取凭据 <input name="credential" type="password" autocomplete="off" required maxlength="256"></label>
      <button name="decision" value="approve" type="submit">授权读取</button>
      <button name="decision" value="deny" type="submit" formnovalidate>取消</button></form></main></body></html>`);
  }, reply));
  app.post('/oauth/authorize', { bodyLimit: 8192, onRequest: limited }, async (request, reply) => oauth(async () => {
    if (request.headers.origin !== publicOrigin) throw new OAuthError('invalid_request', '授权表单来源无效');
    const input = z.object({ request: secret, credential: z.string().max(256).default(''), decision: z.enum(['approve', 'deny']) }).parse(request.body);
    const cookie = /(?:^|; )skynet_consent=([A-Za-z0-9_-]{43})(?:;|$)/.exec(request.headers.cookie ?? '')?.[1];
    if (!cookie) throw new OAuthError('invalid_request', '授权页面已失效，请重新登录');
    const connection = await db.connect();
    try {
      await connection.query('BEGIN');
      const pending = (await connection.query('SELECT * FROM oauth_pending WHERE id=$1 AND expires_at>now() AND NOT used FOR UPDATE', [input.request])).rows[0];
      if (!pending || !equal(digest(cookie), pending.cookie_hash)) throw new OAuthError('invalid_request', '授权页面已失效，请重新登录');
      const parameters = authorization.parse(pending.request);
      const location = new URL(parameters.redirect_uri); location.searchParams.set('state', parameters.state);
      if (input.decision === 'deny') location.searchParams.set('error', 'access_denied');
      else {
        const employee = await identities(db).reader(`Bearer ${input.credential}`, connection, true);
        const code = newCredential();
        await connection.query(`INSERT INTO oauth_codes(hash,employee_id,client_id,redirect_uri,challenge,resource,scope,expires_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,now()+interval '2 minutes')`,
        [digest(code), employee.id, parameters.client_id, parameters.redirect_uri, parameters.code_challenge, resource, scope]);
        location.searchParams.set('code', code);
      }
      await connection.query('UPDATE oauth_pending SET used=true WHERE id=$1', [input.request]);
      await connection.query('COMMIT');
      reply.header('Set-Cookie', 'skynet_consent=; Path=/oauth/authorize; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
      return reply.code(303).header('Location', location.toString()).send();
    } catch (error) { await connection.query('ROLLBACK'); throw error; }
    finally { connection.release(); }
  }, reply));

  app.post('/oauth/token', { bodyLimit: 8192, onRequest: limited }, async (request, reply) => oauth(async () => {
    const input = fields.parse(request.body);
    if (input.resource !== resource) throw new OAuthError('invalid_target', '资源标识不匹配');
    if (input.scope !== undefined && input.scope !== scope) throw new OAuthError('invalid_scope', '仅支持会话读取权限');
    if (!input.client_id || input.client_id.length > 256) throw new OAuthError('invalid_client', '客户端无效');
    const connection = await db.connect();
    try {
      await connection.query('BEGIN');
      let grantId: string;
      if (input.grant_type === 'authorization_code') {
        const verifier = z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/).parse(input.code_verifier);
        const code = (await connection.query(`SELECT c.* FROM oauth_codes c JOIN employees e ON e.id=c.employee_id
          WHERE c.hash=$1 AND c.expires_at>now() AND NOT c.used AND e.active FOR UPDATE OF c`, [digest(secret.parse(input.code))])).rows[0];
        const challenge = createHash('sha256').update(verifier).digest('base64url');
        if (!code || code.client_id !== input.client_id || code.redirect_uri !== input.redirect_uri || code.resource !== resource || !equal(code.challenge, challenge)) {
          throw new OAuthError('invalid_grant', '授权码、回调地址或 PKCE 校验失败');
        }
        grantId = randomUUID();
        await connection.query("INSERT INTO oauth_grants(id,employee_id,client_id,resource,scope,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '30 days')",
          [grantId, code.employee_id, code.client_id, resource, scope]);
        await connection.query('UPDATE oauth_codes SET used=true WHERE hash=$1', [code.hash]);
      } else if (input.grant_type === 'refresh_token') {
        const token = (await connection.query(`SELECT t.*,g.client_id,g.resource FROM oauth_tokens t JOIN oauth_grants g ON g.id=t.grant_id
          JOIN employees e ON e.id=g.employee_id WHERE t.hash=$1 AND t.kind='refresh' AND t.expires_at>now()
          AND g.active AND g.expires_at>now() AND e.active FOR UPDATE OF t,g`, [digest(secret.parse(input.refresh_token))])).rows[0];
        if (!token || token.client_id !== input.client_id || token.resource !== resource) throw new OAuthError('invalid_grant', '刷新授权无效');
        if (token.used) {
          await connection.query('UPDATE oauth_grants SET active=false WHERE id=$1', [token.grant_id]);
          await connection.query('COMMIT');
          throw new OAuthError('invalid_grant', '刷新凭据已使用，此次授权已撤销');
        }
        grantId = token.grant_id;
        await connection.query('UPDATE oauth_tokens SET used=true WHERE hash=$1', [token.hash]);
      } else throw new OAuthError('unsupported_grant_type', '仅支持授权码与轮换刷新');
      const access = newCredential(); const refresh = newCredential();
      await connection.query(`INSERT INTO oauth_tokens(hash,grant_id,kind,expires_at) VALUES
        ($1,$3,'access',now()+interval '15 minutes'),($2,$3,'refresh',now()+interval '30 days')`, [digest(access), digest(refresh), grantId]);
      await connection.query('COMMIT');
      return { access_token: access, token_type: 'Bearer', expires_in: 900, refresh_token: refresh, scope };
    } catch (error) { await connection.query('ROLLBACK'); throw error; }
    finally { connection.release(); }
  }, reply));
  app.post('/oauth/revoke', { bodyLimit: 8192, onRequest: limited }, async (request, reply) => oauth(async () => {
    const input = z.object({ token: secret, client_id: secret }).parse(request.body);
    await db.query(`UPDATE oauth_grants SET active=false WHERE client_id=$1 AND id IN (SELECT grant_id FROM oauth_tokens WHERE hash=$2)`,
      [input.client_id, digest(input.token)]);
    return {};
  }, reply));
  async function authenticate(authorization?: string) {
    const token = credential(authorization);
    const result = await db.query(`SELECT e.id,e.name,g.client_id,g.scope FROM oauth_tokens t JOIN oauth_grants g ON g.id=t.grant_id
      JOIN employees e ON e.id=g.employee_id WHERE t.hash=$1 AND t.kind='access' AND NOT t.used AND t.expires_at>now()
      AND g.active AND g.expires_at>now() AND g.resource=$2 AND g.scope=$3 AND e.active`, [digest(token), resource, scope]);
    if (!result.rows[0]) throw new HttpError(401, 'MCP 读取授权无效、过期或已停用');
    return result.rows[0];
  }
  async function guard(request: FastifyRequest, reply: { header: (name: string, value: string) => unknown }) {
    if (request.headers.origin && request.headers.origin !== publicOrigin) throw new HttpError(403, '请求来源无效');
    try { await authenticate(request.headers.authorization); }
    catch (error) {
      reply.header('WWW-Authenticate', `Bearer resource_metadata="${publicOrigin}/.well-known/oauth-protected-resource/mcp", scope="${scope}"`);
      throw error;
    }
  }
  return { guard, resource };
}
