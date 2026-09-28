import { mkdir, readFile, readdir, realpath, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';
import { hostEventSchema, manifestSchema, MAX_ARTIFACT_BYTES, sourceSchema, type Source } from '../../packages/contracts/archive.js';
import { atomicJson } from '../../packages/filesystem.js';
import { claudeIdentity } from '../../packages/native/claude.js';
import { readCollectorSettings } from './settings.js';
import { captureSchema, CHUNK_BYTES } from '../../packages/contracts/materials.js';
import { discoverMaterials, readNativeFile, safeNativePath } from './materials.js';
export { atomicJson } from '../../packages/filesystem.js';
export { recordHook } from './hook.js';

const settingsSchema = z.object({
  server: z.url(), deviceId: z.uuid(), deviceCredential: z.string().min(32),
  nativeRoot: z.string(), nativeTempRoot: z.string().optional(), sourceVersion: z.string(), sourceOs: z.string(), enrolledAt: z.iso.datetime(),
  source: sourceSchema.default('codex-desktop'),
});
type Settings = z.infer<typeof settingsSchema>;
const trackedSchema = z.object({ source: sourceSchema.optional(), sessionId: z.string(), transcriptPath: z.string(), project: z.string(), qualifiedAt: z.iso.datetime(), lastObservedAt: z.iso.datetime().optional(), acknowledgedHash: z.string().optional(),
  acknowledgedSnapshotId: z.uuid().optional(), acknowledgedByteLength: z.number().int().min(0).optional(),
  appendRejected: z.boolean().optional(),
  capture: captureSchema.optional(), materialFingerprint: z.string().optional(), nativeVersion: z.string().optional() });
type Tracked = z.infer<typeof trackedSchema>;
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

async function readJson(path: string) { return JSON.parse(await readFile(path, 'utf8')); }

export async function setup(state: string, input: { server: string; enrollmentCredential: string; nativeRoot: string; nativeTempRoot?: string; sourceVersion: string; sourceOs: string; source?: Source }) {
  await mkdir(state, { recursive: true, mode: 0o700 });
  try {
    const existing = settingsSchema.parse(await readJson(join(state, 'settings.json')));
    if (existing.server !== input.server || existing.nativeRoot !== await realpath(input.nativeRoot) || existing.nativeTempRoot !== (input.nativeTempRoot ? await realpath(input.nativeTempRoot) : undefined) || existing.source !== (input.source ?? 'codex-desktop')) throw new Error('This state is already bound to another server, source, or native root');
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
  const settings = settingsSchema.parse({ ...result, server: input.server, nativeRoot, nativeTempRoot: input.nativeTempRoot ? await realpath(input.nativeTempRoot) : undefined,
    source: input.source, sourceVersion: input.sourceVersion, sourceOs: input.sourceOs, enrolledAt: new Date().toISOString() });
  await atomicJson(join(state, 'settings.json'), settings);
  await mkdir(join(state, 'spool'), { mode: 0o700, recursive: true });
  return { deviceId: result.deviceId, state: 'bound', capability: 'unverified' };
}

async function qualifiedPath(settings: Settings, transcriptPath: string) {
  if (!isAbsolute(transcriptPath)) throw new Error('Transcript path must be absolute');
  const actual = await safeNativePath(settings.nativeRoot, transcriptPath);
  if (!actual.endsWith('.jsonl')) {
    throw new Error('Transcript is outside the configured native root or is not a JSONL artifact');
  }
  return actual;
}

async function send(settings: Settings, path: string, init: RequestInit) {
  const response = await fetch(new URL(path, settings.server), { ...init,
    headers: { ...init.headers, Authorization: `Bearer ${settings.deviceCredential}` }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new ArchiveRequestError(response.status);
  return response;
}
class ArchiveRequestError extends Error {
  constructor(public status: number) { super(`Archive request failed (${status}); local state retained`); }
}

export async function collectOnce(state: string) {
  const settings = settingsSchema.parse(await readCollectorSettings(state));
  let tracked: Tracked[] = [];
  try { tracked = z.array(trackedSchema).parse(await readJson(join(state, 'tracked.json'))).map(entry => ({ ...entry, source: entry.source ?? settings.source })); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const errors: string[] = [];
  const queuedEvents: { file: string; event: z.infer<typeof hostEventSchema>; observedAt: string }[] = [];
  for (const file of await readdir(join(state, 'spool'))) {
    if (!file.endsWith('.json')) continue;
    try {
      const queued = await readJson(join(state, 'spool', file));
      const event = hostEventSchema.parse(queued.event);
      const observedAt = z.iso.datetime().parse(queued.observedAt);
      queuedEvents.push({ file, event, observedAt });
    } catch (error) { errors.push((error as Error).message); }
  }
  // A resumed Claude session can initially report a path derived from the new cwd,
  // then correct it at UserPromptSubmit. Prefer the latest real host observation.
  queuedEvents.sort((a, b) => b.observedAt.localeCompare(a.observedAt));
  for (const { file, event, observedAt } of queuedEvents) {
    try {
      if (observedAt < settings.enrolledAt) throw new Error('Activity predates enrollment');
      const existing = tracked.find(entry => entry.source === settings.source && entry.sessionId === event.session_id);
      if (existing?.lastObservedAt && existing.lastObservedAt >= observedAt) {
        await unlink(join(state, 'spool', file)); continue;
      }
      const transcriptPath = await qualifiedPath(settings, event.transcript_path);
      if (existing) {
        // The immutable ACK remains a valid prefix candidate even if the host relocates this session.
        existing.transcriptPath = transcriptPath; existing.project = event.cwd ?? existing.project; existing.lastObservedAt = observedAt;
      } else {
        const qualifiedAt = queuedEvents.filter(item => item.event.session_id === event.session_id && item.observedAt >= settings.enrolledAt)
          .reduce((earliest, item) => item.observedAt < earliest ? item.observedAt : earliest, observedAt);
        tracked.push({ source: settings.source, sessionId: event.session_id, transcriptPath, project: event.cwd ?? '', qualifiedAt, lastObservedAt: observedAt });
      }
      await atomicJson(join(state, 'tracked.json'), tracked);
      await unlink(join(state, 'spool', file));
    } catch (error) { errors.push((error as Error).message); }
  }
  let committed = 0;
  let uploadedBytes = 0; let appended = 0;
  async function upload(bytes: Buffer) {
    if (bytes.length > MAX_ARTIFACT_BYTES) throw new Error('Artifact exceeds 64 MiB; material remains pending');
    const chunkHash = hash(bytes);
    if (bytes.length > 0 && bytes.length <= CHUNK_BYTES) {
      await send(settings, `/api/chunks/${chunkHash}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(bytes) });
    } else {
      const chunks = [];
      for (let start = 0; start < bytes.length; start += CHUNK_BYTES) {
        const part = bytes.subarray(start, start + CHUNK_BYTES); const partHash = hash(part);
        await send(settings, `/api/chunks/${partHash}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(part) });
        chunks.push({ hash: partHash, byteLength: part.length });
      }
      await send(settings, '/api/artifacts/assemble', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hash: chunkHash, byteLength: bytes.length, chunks }) });
    }
    uploadedBytes += bytes.length;
    return chunkHash;
  }
  for (const source of tracked) {
    try {
      if (source.source !== settings.source) throw new Error('Tracked source does not match this collector binding');
      const transcriptPath = await qualifiedPath(settings, source.transcriptPath);
      const bytes = await readNativeFile(settings.nativeRoot, transcriptPath);
      const artifactHash = hash(bytes);
      // Read identity from the source artifact, never accept a hook pointing at another session.
      let sourceVersion = source.nativeVersion ?? settings.sourceVersion;
      let identityUnavailable = false;
      if (settings.source === 'claude-code-cli') {
        try { sourceVersion = claudeIdentity(bytes, source.sessionId).version; }
        catch (error) {
          // A previously identified tracked file can be truncated during native rewrite. Preserve bytes and old generations.
          if (!source.acknowledgedSnapshotId || (error as Error).message.includes('mismatch')) throw error;
          identityUnavailable = true;
        }
      }
      else {
        let metadata;
        try { metadata = JSON.parse(bytes.toString('utf8').split('\n')[0]!); } catch { /* Partial rewrite is preserved only after prior identification. */ }
        if (metadata?.type === 'session_meta' && metadata.payload?.id !== source.sessionId) throw new Error('Native session identity mismatch');
        if (metadata?.type !== 'session_meta' && !source.acknowledgedSnapshotId) throw new Error('Native session identity unavailable; material remains pending');
        identityUnavailable = metadata?.type !== 'session_meta';
        if (settings.source === 'codex-cli' && metadata?.payload?.cli_version) sourceVersion = z.string().min(1).max(256).parse(metadata.payload.cli_version);
      }
      const discovered = await discoverMaterials({ source: settings.source, nativeRoot: settings.nativeRoot, nativeTempRoot: settings.nativeTempRoot,
        transcriptPath, sessionId: source.sessionId, project: source.project, bytes, previous: source.capture?.materials });
      if (identityUnavailable) discovered.gaps.push({ code: 'unknown-format', reference: '当前原件无法重新读取完整身份；沿用此前已确认绑定，保留重写或截断字节' });
      const materials = discovered.artifacts.map(item => item.material);
      const fingerprint = hash(JSON.stringify({ materials, gaps: discovered.gaps, lineage: discovered.lineage, compacted: discovered.compacted, partialLine: discovered.partialLine }));
      if (source.acknowledgedHash === artifactHash && source.materialFingerprint === fingerprint) continue;
      const prefixMatches = source.acknowledgedByteLength !== undefined && bytes.length > source.acknowledgedByteLength
        && hash(bytes.subarray(0, source.acknowledgedByteLength)) === source.acknowledgedHash;
      const change = !source.acknowledgedHash ? 'initial' : source.acknowledgedHash === artifactHash ? 'materials'
        : prefixMatches ? 'append' : bytes.length < source.acknowledgedByteLength! ? 'truncate' : 'rewrite';
      const generation = source.capture && (change === 'append' || change === 'materials') ? source.capture.generation
        : hash(`${settings.source}/${source.sessionId}/${source.qualifiedAt}/${source.acknowledgedSnapshotId ?? ''}/${artifactHash}`);
      const capture = captureSchema.parse({ generation, revision: (source.capture?.revision ?? 0) + 1, change,
        previousSnapshotId: source.acknowledgedSnapshotId, materials, gaps: discovered.gaps, lineage: discovered.lineage,
        compacted: discovered.compacted, partialLine: discovered.partialLine });
      const manifest = manifestSchema.parse({ protocolVersion: 1, sourceSessionId: source.sessionId, source: settings.source,
        sourceVersion, sourceOs: settings.sourceOs, project: source.project,
        hash: artifactHash, byteLength: bytes.length, qualifiedAt: source.qualifiedAt, capability: 'unverified', capture });
      for (const item of discovered.artifacts) {
        if (item.bytes && !source.capture?.materials.some(old => old.hash === item.material.hash)) await upload(item.bytes);
      }
      let response: Response | undefined; let usedAppend = false;
      if (!source.appendRejected && source.acknowledgedSnapshotId && source.acknowledgedHash && source.acknowledgedByteLength
        && bytes.length > source.acknowledgedByteLength
        && hash(bytes.subarray(0, source.acknowledgedByteLength)) === source.acknowledgedHash) {
        const delta = bytes.subarray(source.acknowledgedByteLength);
        const appendHash = await upload(delta);
        try {
          response = await send(settings, '/api/snapshots/append', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ manifest, baseSnapshotId: source.acknowledgedSnapshotId, baseHash: source.acknowledgedHash,
              baseByteLength: source.acknowledgedByteLength, appendHash, appendByteLength: delta.length }) });
          usedAppend = true;
        } catch (error) {
          if (!(error instanceof ArchiveRequestError) || error.status !== 409) throw error;
          // An unconfirmed baseline cannot justify an append. Retain the source and retry in full.
          source.appendRejected = true;
          await atomicJson(join(state, 'tracked.json'), tracked);
        }
      }
      if (!response) {
        await upload(bytes);
        response = await send(settings, '/api/snapshots', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(manifest) });
      }
      const ack = z.object({ snapshotId: z.uuid(), state: z.literal('committed'), hash: z.string(), byteLength: z.number() }).parse(await response.json());
      if (ack.hash !== artifactHash || ack.byteLength !== bytes.length) throw new Error('Archive acknowledgement does not match the snapshot');
      if (usedAppend) appended++;
      source.acknowledgedHash = artifactHash; source.capture = capture; source.materialFingerprint = fingerprint; source.nativeVersion = sourceVersion;
      delete source.appendRejected;
      source.acknowledgedSnapshotId = ack.snapshotId; source.acknowledgedByteLength = ack.byteLength;
      await atomicJson(join(state, 'tracked.json'), tracked);
      committed++;
    } catch (error) { errors.push((error as Error).message); }
  }
  const status = { checkedAt: new Date().toISOString(), tracked: tracked.length, committed, uploadedBytes, appended, errors, capability: 'unverified' };
  await atomicJson(join(state, 'status.json'), status);
  return status;
}
