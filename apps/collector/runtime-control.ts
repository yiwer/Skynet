import { createServer, request, type Server } from 'node:http';
import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { optionalJson, jsonFile } from './install-state.js';
import { setTimeout as delay } from 'node:timers/promises';
import { atomicJson } from '../../packages/filesystem.js';

type Role = 'supervisor' | 'worker';
type Control = { token: string; supervisorPort: number; workerPort: number };
export async function initializeControl(state: string) {
  const path = join(state, 'runtime-control.json');
  if (await optionalJson(path)) return;
  await allocateControl(state);
}
async function allocateControl(state: string) {
  // Bind-validate candidates with the OS, retaining the historical role ranges
  // so an actual older payload can read the registration after rollback.
  // Windows excluded/occupied candidates are skipped, never altered or killed.
  const leases: Server[] = [];
  try {
    const ports: number[] = [];
    for (let index = 0; index < 2; index++) {
      const lower = index === 0 ? 20000 : 40000;
      // Keep the worker below the OS dynamic-client range as well as within the
      // old protocol's accepted range; still bind-validate every candidate.
      const width = index === 0 ? 20_000 : 9_152; const offset = randomInt(width);
      let bound = false;
      for (let attempt = 0; attempt < 256; attempt++) {
        const server = createServer(); const port = lower + (offset + attempt * 97) % width;
        try {
          await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen({ host: '127.0.0.1', port, exclusive: true }, resolve); });
          leases.push(server); ports.push(port); bound = true; break;
        } catch (error) { if (!['EACCES', 'EADDRINUSE'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error; }
      }
      if (!bound) throw new Error('No compatible local control endpoint was available; existing registration and evidence retained');
    }
    await atomicJson(join(state, 'runtime-control.json'), { token: randomBytes(32).toString('hex'), supervisorPort: ports[0], workerPort: ports[1] });
  } finally { for (const server of leases) if (server.listening) await releaseRuntime(server); }
}
export async function repairControl(state: string) {
  if (!await optionalJson(join(state, 'runtime-control.json'))) { await initializeControl(state); return; }
  const probe = async (role: Role, action: 'status' | 'stop' = 'status') => {
    try { return await askRuntime(state, role, action); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'SKYNET_ENDPOINT_OCCUPIED') return null; throw error; }
  };
  // Never abandon a known writer or infer ownership from a PID. Authentication
  // rejection proves this listener cannot be our registered endpoint. Timeouts,
  // resets and malformed responses are ambiguous and stop repair instead.
  for (const role of ['supervisor', 'worker'] as const) if (await probe(role)) await probe(role, 'stop');
  for (let attempt = 0; attempt < 200; attempt++) {
    if (!await probe('supervisor') && !await probe('worker')) {
      await allocateControl(state);
      return;
    }
    await delay(100);
  }
  throw new Error('Owned runtime is still stopping; repair retained the existing endpoints and evidence');
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
        if (response.statusCode !== 200) { reject(Object.assign(new Error('Local control endpoint is occupied or rejected authentication; no process was changed'),
          { code: [401, 403].includes(response.statusCode ?? 0) ? 'SKYNET_ENDPOINT_OCCUPIED' : 'SKYNET_ENDPOINT_AMBIGUOUS' })); return; }
        try { const result = JSON.parse(body); if (result.role !== role) throw new Error('Runtime role mismatch'); resolve(result); }
        catch { reject(Object.assign(new Error('Local runtime returned an invalid control response; registration and processes retained'), { code: 'SKYNET_ENDPOINT_AMBIGUOUS' })); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Local runtime is unresponsive; no replacement writer was started')));
    req.on('error', error => {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ECONNREFUSED') resolve(null);
      else if (code?.startsWith('HPE_')) reject(Object.assign(new Error('Local runtime returned an invalid control protocol; registration and processes retained'), { code: 'SKYNET_ENDPOINT_AMBIGUOUS' }));
      else reject(error);
    });
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
