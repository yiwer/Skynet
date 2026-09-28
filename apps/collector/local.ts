import { mkdir, readFile, readdir, realpath, stat, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { isAbsolute, join, relative, sep } from 'node:path';
import { z } from 'zod';
import { hostEventSchema, manifestSchema, MAX_ARTIFACT_BYTES, sourceSchema, type Source } from '../../packages/contracts/archive.js';
import { atomicJson } from '../../packages/filesystem.js';
export { atomicJson } from '../../packages/filesystem.js';
export { recordHook } from './hook.js';

const settingsSchema = z.object({
  server: z.url(), deviceId: z.uuid(), deviceCredential: z.string().min(32),
  nativeRoot: z.string(), sourceVersion: z.string(), sourceOs: z.string(), enrolledAt: z.iso.datetime(),
  source: sourceSchema.default('codex-desktop'),
});
type Settings = z.infer<typeof settingsSchema>;
type Tracked = { sessionId: string; transcriptPath: string; project: string; qualifiedAt: string; acknowledgedHash?: string };
const trackedSchema = z.object({ sessionId: z.string(), transcriptPath: z.string(), project: z.string(), qualifiedAt: z.iso.datetime(), acknowledgedHash: z.string().optional() });
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

async function readJson(path: string) { return JSON.parse(await readFile(path, 'utf8')); }

export async function setup(state: string, input: { server: string; enrollmentCredential: string; nativeRoot: string; sourceVersion: string; sourceOs: string; source?: Source }) {
  await mkdir(state, { recursive: true, mode: 0o700 });
  try {
    const existing = settingsSchema.parse(await readJson(join(state, 'settings.json')));
    if (existing.server !== input.server || existing.nativeRoot !== await realpath(input.nativeRoot) || existing.source !== (input.source ?? 'codex-desktop')) throw new Error('This state is already bound to another server, source, or native root');
    return { deviceId: existing.deviceId, state: 'already-bound' };
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const server = new URL(input.server);
  if (server.protocol !== 'https:' && !(server.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(server.hostname))) {
    throw new Error('Use HTTPS; HTTP is permitted only for isolated loopback development');
  }
  if (server.username || server.password || server.search || server.hash || server.pathname !== '/') throw new Error('Expected a server origin without credentials');
  const nativeRoot = await realpath(input.nativeRoot);
  const response = await fetch(new URL('/api/devices/enroll', server), {
    method: 'POST', headers: { Authorization: `Bearer ${input.enrollmentCredential}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ installationId: randomUUID(), name: hostname() }), signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Enrollment failed (${response.status})`);
  const result = z.object({ deviceId: z.uuid(), deviceCredential: z.string() }).parse(await response.json());
  const settings = settingsSchema.parse({ ...result, server: input.server, nativeRoot,
    source: input.source, sourceVersion: input.sourceVersion, sourceOs: input.sourceOs, enrolledAt: new Date().toISOString() });
  await atomicJson(join(state, 'settings.json'), settings);
  await mkdir(join(state, 'spool'), { mode: 0o700, recursive: true });
  return { deviceId: result.deviceId, state: 'bound', capability: 'unverified' };
}

async function qualifiedPath(settings: Settings, transcriptPath: string) {
  if (!isAbsolute(transcriptPath)) throw new Error('Transcript path must be absolute');
  const actual = await realpath(transcriptPath);
  const remainder = relative(settings.nativeRoot, actual);
  if (remainder === '' || remainder === '..' || remainder.startsWith(`..${sep}`) || isAbsolute(remainder) || !actual.endsWith('.jsonl')) {
    throw new Error('Transcript is outside the configured native root or is not a JSONL artifact');
  }
  return actual;
}

async function send(settings: Settings, path: string, init: RequestInit) {
  const response = await fetch(new URL(path, settings.server), { ...init,
    headers: { ...init.headers, Authorization: `Bearer ${settings.deviceCredential}` }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Archive request failed (${response.status}); local state retained`);
  return response;
}

export async function collectOnce(state: string) {
  const settings = settingsSchema.parse(await readJson(join(state, 'settings.json')));
  let tracked: Tracked[] = [];
  try { tracked = z.array(trackedSchema).parse(await readJson(join(state, 'tracked.json'))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const errors: string[] = [];
  for (const file of await readdir(join(state, 'spool'))) {
    if (!file.endsWith('.json')) continue;
    try {
      const queued = await readJson(join(state, 'spool', file));
      const event = hostEventSchema.parse(queued.event);
      const observedAt = z.iso.datetime().parse(queued.observedAt);
      if (observedAt < settings.enrolledAt) throw new Error('Activity predates enrollment');
      const transcriptPath = await qualifiedPath(settings, event.transcript_path);
      if (!tracked.find(entry => entry.sessionId === event.session_id && entry.transcriptPath === transcriptPath)) {
        tracked.push({ sessionId: event.session_id, transcriptPath, project: event.cwd ?? '', qualifiedAt: observedAt });
      }
      await atomicJson(join(state, 'tracked.json'), tracked);
      await unlink(join(state, 'spool', file));
    } catch (error) { errors.push((error as Error).message); }
  }
  let committed = 0;
  for (const source of tracked) {
    try {
      const transcriptPath = await qualifiedPath(settings, source.transcriptPath);
      const size = (await stat(transcriptPath)).size;
      if (size > MAX_ARTIFACT_BYTES) throw new Error('Artifact exceeds the 8 MiB first-slice limit; material remains pending');
      const bytes = await readFile(transcriptPath);
      if (bytes.length === 0) continue;
      const artifactHash = hash(bytes);
      if (source.acknowledgedHash === artifactHash) continue;
      // Read identity from the source artifact, never accept a hook pointing at another session.
      const metadata = JSON.parse(bytes.toString('utf8').split('\n')[0]!);
      if (metadata.type !== 'session_meta' || metadata.payload?.id !== source.sessionId) throw new Error('Native session identity mismatch');
      const sourceVersion = settings.source === 'codex-cli' ? z.string().min(1).max(256).parse(metadata.payload.cli_version) : settings.sourceVersion;
      const manifest = manifestSchema.parse({ protocolVersion: 1, sourceSessionId: source.sessionId, source: settings.source,
        sourceVersion, sourceOs: settings.sourceOs, project: source.project,
        hash: artifactHash, byteLength: bytes.length, qualifiedAt: source.qualifiedAt, capability: 'unverified' });
      await send(settings, `/api/chunks/${artifactHash}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(bytes) });
      const response = await send(settings, '/api/snapshots', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(manifest) });
      const ack = z.object({ snapshotId: z.uuid(), state: z.literal('committed'), hash: z.string(), byteLength: z.number() }).parse(await response.json());
      if (ack.hash !== artifactHash || ack.byteLength !== bytes.length) throw new Error('Archive acknowledgement does not match the snapshot');
      source.acknowledgedHash = artifactHash;
      await atomicJson(join(state, 'tracked.json'), tracked);
      committed++;
    } catch (error) { errors.push((error as Error).message); }
  }
  const status = { checkedAt: new Date().toISOString(), tracked: tracked.length, committed, errors, capability: 'unverified' };
  await atomicJson(join(state, 'status.json'), status);
  return status;
}
