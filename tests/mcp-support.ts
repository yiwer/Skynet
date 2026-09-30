import { createServer as httpsServer, request as httpsRequest, Agent } from 'node:https';
import { request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { chromium, type Browser } from '@playwright/test';
import { createApp } from '../apps/server/app.js';
import { connect } from '../apps/server/database.js';
import { command, createSandbox } from './support.js';
const headersObject = (headers: Headers) => { const result: Record<string, string> = {}; headers.forEach((value, key) => { result[key] = value; }); return result; };

export async function mcpSandbox(options: { reportClock?: () => Date } = {}) {
  const sandbox = await createSandbox();
  const openssl = process.env.SKYNET_OPENSSL ?? (process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl');
  const ca = join(sandbox.directory, 'test-ca.pem'); const key = join(sandbox.directory, 'test-key.pem');
  const cert = join(sandbox.directory, 'test-cert.pem');
  await command(openssl, ['req', '-new', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=Skynet isolated test CA',
    '-keyout', join(sandbox.directory, 'ca-key.pem'), '-out', ca], process.env);
  await command(openssl, ['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=localhost', '-keyout', key,
    '-out', join(sandbox.directory, 'test.csr')], process.env);
  await writeFile(join(sandbox.directory, 'tls.ext'), 'subjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n');
  await command(openssl, ['x509', '-req', '-in', join(sandbox.directory, 'test.csr'), '-CA', ca, '-CAkey', join(sandbox.directory, 'ca-key.pem'),
    '-CAcreateserial', '-days', '1', '-extfile', join(sandbox.directory, 'tls.ext'), '-out', cert], process.env);
  const db = connect(sandbox.env.DATABASE_URL!); let target = ''; let browser: Browser | undefined;
  const traffic: { method: string; path: string; status: number }[] = [];
  const proxy = httpsServer({ key: await readFile(key), cert: await readFile(cert) }, (request, response) => {
    if (!target) { response.writeHead(503); response.end(); return; }
    const upstream = httpRequest(new URL(request.url!, target), { method: request.method, headers: request.headers }, result => {
      traffic.push({ method: request.method!, path: request.url!.split('?')[0]!, status: result.statusCode! });
      response.writeHead(result.statusCode!, result.headers); result.pipe(response);
    });
    upstream.on('error', () => { response.writeHead(503); response.end(); }); request.pipe(upstream);
  });
  proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening');
  const origin = `https://127.0.0.1:${(proxy.address() as { port: number }).port}`;
  let app = await createApp({ db, rawDirectory: sandbox.env.RAW_DIRECTORY!, webDirectory: 'dist/web', publicOrigin: origin, reportClock: options.reportClock });
  const serverErrors:{code:string|undefined;message:string}[]=[];
  const observeErrors=()=>app.addHook('onError',async(_request,_reply,error)=>{serverErrors.push({code:error.code,message:error.message});});
  observeErrors();
  await app.listen({ host: '127.0.0.1', port: 0 }); target = app.listeningOrigin;
  const agent = new Agent({ ca: await readFile(ca), keepAlive: true });
  const fetchTls = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.origin !== origin) throw new Error('Test TLS adapter refuses other origins');
    return new Promise((resolveResult, reject) => {
      const req = httpsRequest(url, { agent, method: init.method ?? 'GET', headers: headersObject(new Headers(init.headers)) }, response => {
        const chunks: Buffer[] = [];
        response.on('data', chunk => chunks.push(chunk)); response.on('end', () => {
          const headers = new Headers();
          for (const [key, value] of Object.entries(response.headers)) if (value !== undefined) {
            for (const item of Array.isArray(value) ? value : [value]) headers.append(key, item);
          }
          resolveResult(new Response([204, 205, 304].includes(response.statusCode!) ? null : Buffer.concat(chunks), { status: response.statusCode, headers }));
        });
      });
      req.on('error', reject); req.end(init.body ?? undefined);
    });
  };
  async function authorizationPage(url: string, reader: string, decision: 'approve' | 'deny' = 'approve') {
    browser ??= await chromium.launch({ headless: true });
    const context = await browser.newContext(); const page = await context.newPage();
    let callback = '';
    // The browser uses a strictly CA-validated transport adapter for this one origin. Its global
    // trust store stays untouched. Native CLI clients below perform their own real TLS handshakes.
    await context.route('**/*', async route => {
      const request = route.request(); const targetUrl = new URL(request.url());
      if (targetUrl.origin !== origin) {
        if (targetUrl.hostname === 'localhost' || targetUrl.hostname === '127.0.0.1') { callback = targetUrl.toString(); await route.fulfill({ status: 200, body: 'MCP 授权回调已捕获；测试将交回客户端。' }); }
        else await route.abort();
        return;
      }
      const response = await fetchTls(request.url(), { method: request.method(), headers: await request.allHeaders(), body: request.postData() });
      if (response.status === 303 && targetUrl.pathname === '/oauth/authorize') {
        const location = new URL(response.headers.get('location')!);
        if (!['localhost', '127.0.0.1'].includes(location.hostname)) throw new Error('Unexpected callback host');
        callback = location.toString();
        await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<p>MCP 授权回调已捕获</p>' }); return;
      }
      await route.fulfill({ status: response.status, headers: headersObject(response.headers), body: Buffer.from(await response.arrayBuffer()) });
    });
    try {
      const navigation = await page.goto(url);
      if (navigation?.status() !== 200) {
        const query = new URL(url).searchParams;
        throw new Error(`Consent request rejected: ${await page.locator('body').innerText()}; ${JSON.stringify(Object.fromEntries(['resource', 'scope', 'response_type', 'code_challenge_method', 'redirect_uri'].map(key => [key, query.get(key)])))}`);
      }
      await page.getByLabel('个人读取凭据').fill(reader);
      await page.getByRole('button', { name: decision === 'approve' ? '授权读取' : '取消', exact: true }).click();
      try { await page.getByText('MCP 授权回调已捕获', { exact: true }).waitFor({ timeout: 10_000 }); }
      catch { throw new Error(`Consent page failed: ${await page.locator('body').innerText()}`); }
      if (!callback) throw new Error('No consent callback observed');
      return callback;
    } finally { await context.close(); }
  }
  return { ...sandbox, origin, ca, traffic, fetchTls, authorizationPage, testDatabase: db, serverErrors,
    api: (path: string, token?: string, init: RequestInit = {}) => fetchTls(origin + path, {
      ...init, headers: { ...init.headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) } }),
    restart: async () => { await app.close(); app = await createApp({ db, rawDirectory: sandbox.env.RAW_DIRECTORY!, webDirectory: 'dist/web', publicOrigin: origin, reportClock: options.reportClock });
      observeErrors();
      await app.listen({ host: '127.0.0.1', port: 0 }); target = app.listeningOrigin; },
    close: async () => { await browser?.close(); agent.destroy(); await app.close(); await db.end(); await new Promise<void>(resolve => proxy.close(() => resolve())); await sandbox.close(); },
  };
}
