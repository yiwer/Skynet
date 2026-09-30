import { createServer, request, type Server } from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { optionalJson, jsonFile } from './install-state.js';
import { setTimeout as delay } from 'node:timers/promises';

type Role = 'supervisor' | 'worker';
type Control = { token: string; supervisorPort: number; workerPort: number };
export async function initializeControl(state: string) {
  const path = join(state, 'runtime-control.json');
  if (await optionalJson(path)) return;
  const canonical = await realpath(state);
  const hash = createHash('sha256').update(process.platform === 'win32' ? canonical.toLowerCase() : canonical).digest();
  // The OS listener, not a PID or heartbeat file, owns the single-writer lease.
  // A rare port collision fails visibly; never replace or kill the other listener.
  const value: Control = { token: randomBytes(32).toString('hex'),
    supervisorPort: 20000 + hash.readUInt16BE(0) % 20000, workerPort: 40000 + hash.readUInt16BE(2) % 20000 };
  await writeFile(path, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
}
async function control(state: string): Promise<Control> {
  const value = await jsonFile(join(state, 'runtime-control.json'));
  if (!/^[a-f0-9]{64}$/.test(value.token) || !Number.isInteger(value.supervisorPort) || !Number.isInteger(value.workerPort)
    || value.supervisorPort < 20000 || value.supervisorPort >= 40000 || value.workerPort < 40000 || value.workerPort >= 60000) {
    throw new Error('Invalid local runtime control registration; rerun setup after inspecting local state');
  }
  return value;
}
export async function askRuntime(state: string, role: Role, action: 'status' | 'stop' = 'status'): Promise<any | null> {
  for (let attempt = 0; ; attempt++) {
    try { return await askOnce(state, role, action); }
    catch (error) {
      // A connection accepted concurrently with listener shutdown can reset
      // before its request is read. Re-probe the authenticated endpoint: only
      // a valid reply or a new ECONNREFUSED establishes its current state.
      if ((error as NodeJS.ErrnoException).code !== 'ECONNRESET' || attempt === 3) throw error;
      await delay(25 * (attempt + 1));
    }
  }
}
async function askOnce(state: string, role: Role, action: 'status' | 'stop'): Promise<any | null> {
  const config = await control(state);
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: config[`${role}Port`], path: `/${action}`, method: action === 'stop' ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${config.token}`, Connection: 'close' }, timeout: 1500 }, response => {
      let body = ''; response.setEncoding('utf8');
      response.on('data', part => { body += part; if (body.length > 16_384) response.destroy(new Error('Oversized runtime response')); });
      response.on('error', reject);
      response.on('end', () => {
        if (response.statusCode !== 200) { reject(new Error('Local control endpoint is occupied or rejected authentication; no process was changed')); return; }
        try { const result = JSON.parse(body); if (result.role !== role) throw new Error('Runtime role mismatch'); resolve(result); } catch (error) { reject(error); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Local runtime is unresponsive; no replacement writer was started')));
    req.on('error', error => (error as NodeJS.ErrnoException).code === 'ECONNREFUSED' ? resolve(null) : reject(error));
    req.end();
  });
}
export async function ownRuntime(state: string, role: Role, status: () => object, stop: () => void): Promise<Server> {
  const config = await control(state); const expected = Buffer.from(`Bearer ${config.token}`);
  const server = createServer((req, res) => {
    const supplied = Buffer.from(req.headers.authorization ?? '');
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { res.writeHead(401); res.end(); return; }
    if (!((req.method === 'GET' && req.url === '/status') || (req.method === 'POST' && req.url === '/stop'))) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
    if (req.url === '/stop') res.once('finish', stop);
    res.end(JSON.stringify({ role, ...status() }));
  });
  server.headersTimeout = 3000; server.requestTimeout = 3000; server.keepAliveTimeout = 1000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject); server.listen({ host: '127.0.0.1', port: config[`${role}Port`], exclusive: true }, () => { server.off('error', reject); resolve(); });
  });
  return server;
}
export async function releaseRuntime(server: Server) {
  // Keep in-flight authenticated replies intact. Destroying every connection
  // before close could turn a successful stop into ECONNRESET for its caller.
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => server.closeAllConnections(), 3500);
    server.close(error => { clearTimeout(timer); error ? reject(error) : resolve(); });
    server.closeIdleConnections();
  });
}
