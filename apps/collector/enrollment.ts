import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { realpath } from 'node:fs/promises';
import { z } from 'zod';
import { atomicJson } from '../../packages/filesystem.js';
import { identitySchema, optionalJson, serverOrigin } from './install-state.js';

const pendingSchema = z.object({ installationId: z.uuid(), server: z.string(), name: z.string(),
  enrollmentHash: z.string(), deviceCredential: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict();

// An OS-owned endpoint is released even when setup is forcibly terminated. No
// stale PID file is treated as proof of liveness and no process is ever killed.
export async function setupLock(state: string, purpose = 'setup') {
  const path = await realpath(state);
  const digest = createHash('sha256').update(`${purpose}/${process.platform === 'win32' ? path.toLowerCase() : path}`).digest();
  const server = createServer(socket => socket.destroy());
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      if (process.platform === 'win32') server.listen(`\\\\.\\pipe\\skynet-${purpose}-${digest.toString('hex')}`, resolve);
      else server.listen({ host: '127.0.0.1', port: 4096 + digest.readUInt16BE(0) % 28_672, exclusive: true }, resolve);
    });
  } catch { throw new Error(`Another ${purpose} or local service holds this installation lock; retry after it exits`); }
  server.unref();
  return () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

export async function enroll(state: string, origin: string, personalKey: string) {
  const server = serverOrigin(origin);
  if (!personalKey || personalKey.length < 32 || personalKey.length > 256 || /\s/.test(personalKey)) {
    throw new Error('Set the personal SKYNET_KEY enrollment value before setup; never paste it into an Agent conversation');
  }
  const enrollmentHash = createHash('sha256').update(`skynet-enrollment:${personalKey}`).digest('hex');
  const saved = await optionalJson(join(state, 'enrollment.json'));
  // Older incomplete installations only persisted installationId. They cannot
  // recover an already issued unknown secret, but keep their identity for an
  // explicit operator repair instead of silently creating another device.
  const pending = pendingSchema.parse(saved?.deviceCredential ? saved : {
    installationId: saved ? z.uuid().parse(saved.installationId) : randomUUID(), server,
    name: hostname(), enrollmentHash, deviceCredential: randomBytes(32).toString('base64url'),
  });
  if (pending.server !== server || pending.enrollmentHash !== enrollmentHash) throw new Error('Pending enrollment belongs to another server or personal authorization; original identity retained');
  await atomicJson(join(state, 'enrollment.json'), pending);
  let response: Response;
  try {
    response = await fetch(new URL('/api/devices/enroll', server), { method: 'POST', redirect: 'error',
      headers: { Authorization: `Bearer ${personalKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ installationId: pending.installationId, name: pending.name, deviceCredential: pending.deviceCredential }),
      signal: AbortSignal.timeout(15_000) });
  } catch { throw new Error('Enrollment response unavailable; private recovery proof retained. Retry setup with the same personal authorization.'); }
  if (!response.ok) throw new Error(`Device enrollment failed (${response.status}); private recovery proof retained; setup did not install hooks`);
  const identity = identitySchema.parse({ ...await response.json(), server, installationId: pending.installationId });
  if (identity.deviceCredential !== pending.deviceCredential) throw new Error('Enrollment confirmation does not match the persisted proof; retry setup');
  return identity;
}
