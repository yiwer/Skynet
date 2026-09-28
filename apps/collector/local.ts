import { mkdir, readFile, readdir, realpath, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';
import { hostEventSchema, manifestSchema, sourceSchema, type Source } from '../../packages/contracts/archive.js';
import { atomicJson } from '../../packages/filesystem.js';
import { claudeIdentity } from '../../packages/native/claude.js';
import { readCollectorSettings } from './settings.js';
import { captureSchema } from '../../packages/contracts/materials.js';
import { DeliveryQueue } from './delivery.js';
import { reportDeliveryHealth } from './health.js';
import { enroll, setupLock } from './enrollment.js';
import { protectState } from './install-state.js';
import { discoverMaterials, readNativeFile, safeNativePath } from './materials.js';
import { CaptureMonitor } from './capture-health.js';
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
  await protectState(state);
  const releaseSetup = await setupLock(state);
  try {
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
  const result = await enroll(state, server.origin, input.enrollmentCredential);
  const settings = settingsSchema.parse({ ...result, server: input.server, nativeRoot, nativeTempRoot: input.nativeTempRoot ? await realpath(input.nativeTempRoot) : undefined,
    source: input.source, sourceVersion: input.sourceVersion, sourceOs: input.sourceOs, enrolledAt: result.enrolledAt });
  await atomicJson(join(state, 'settings.json'), settings);
  await mkdir(join(state, 'spool'), { mode: 0o700, recursive: true });
  return { deviceId: result.deviceId, state: 'bound', capability: 'unverified' };
  } finally { await releaseSetup(); }
}

async function qualifiedPath(settings: Settings, transcriptPath: string) {
  if (!isAbsolute(transcriptPath)) throw new Error('Transcript path must be absolute');
  const actual = await safeNativePath(settings.nativeRoot, transcriptPath);
  if (!actual.endsWith('.jsonl')) {
    throw new Error('Transcript is outside the configured native root or is not a JSONL artifact');
  }
  return actual;
}

export async function collectOnce(state: string, options: { capture?: boolean } = {}) {
  const settings = settingsSchema.parse(await readCollectorSettings(state));
  const monitor = await CaptureMonitor.open(state);
  monitor.setEnabled(options.capture !== false);
  try {
    try { if (options.capture !== false) { await readFile(join(state, 'hook-gap.json')); monitor.fail(null, undefined, 'hook-unobserved'); } }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') monitor.fail(error); }
    const status = await collectSources(state, settings, monitor, options);
    if (options.capture !== false) monitor.recover();
    const capture = await monitor.save();
    await reportDeliveryHealth(state, settings, status.delivery, capture);
    return { ...status, coverage: capture };
  } catch (error) {
    monitor.fail(error);
    const capture = await monitor.save();
    // Even ENOSPC can be reported while this worker and its credentials remain
    // readable. If both disk and network fail, no durable report is asserted.
    await reportDeliveryHealth(state, settings, undefined, capture);
    return { checkedAt: new Date().toISOString(), errors: [(error as Error).message], coverage: capture, capability: 'unverified' };
  }
}

async function collectSources(state: string, settings: Settings, monitor: CaptureMonitor, options: { capture?: boolean }) {
  const delivery = await DeliveryQueue.open(state);
  try {
    await readFile(join(state, 'retry-request.json'));
    await delivery.retryNow();
    await unlink(join(state, 'delivery-health.json')).catch(error => { if (error.code !== 'ENOENT') throw error; });
    await unlink(join(state, 'retry-request.json'));
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  let tracked: Tracked[] = [];
  try { tracked = z.array(trackedSchema).parse(await readJson(join(state, 'tracked.json'))).map(entry => ({ ...entry, source: entry.source ?? settings.source })); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const errors: string[] = [];
  const queuedEvents: { file: string; event: z.infer<typeof hostEventSchema>; observedAt: string }[] = [];
  for (const file of options.capture === false ? [] : await readdir(join(state, 'spool'))) {
    if (!file.endsWith('.json')) continue;
    try {
      const queued = await readJson(join(state, 'spool', file));
      const event = hostEventSchema.parse(queued.event);
      const observedAt = z.iso.datetime().parse(queued.observedAt);
      queuedEvents.push({ file, event, observedAt });
    } catch (error) { errors.push((error as Error).message); monitor.fail(error); }
  }
  // A resumed Claude session can initially report a path derived from the new cwd,
  // then correct it at UserPromptSubmit. Prefer the latest real host observation.
  queuedEvents.sort((a, b) => b.observedAt.localeCompare(a.observedAt));
  for (const { file, event, observedAt } of queuedEvents) {
    monitor.observe();
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
    } catch (error) { errors.push((error as Error).message); monitor.fail(error, event.session_id); }
  }
  for (const source of options.capture === false ? [] : tracked) {
    monitor.observe();
    try {
      const pending = delivery.latest(settings.source, source.sessionId);
      // Compare new bytes with the latest frozen generation, even while offline.
      // Server ACK state remains separate until delivery actually commits.
      const previous = pending ? { ...source, acknowledgedHash: pending.manifest.hash,
        acknowledgedByteLength: pending.manifest.byteLength, capture: pending.manifest.capture,
        materialFingerprint: pending.fingerprint, nativeVersion: pending.manifest.sourceVersion } : source;
      if (source.source !== settings.source) throw new Error('Tracked source does not match this collector binding');
      const transcriptPath = await qualifiedPath(settings, source.transcriptPath);
      const bytes = await readNativeFile(settings.nativeRoot, transcriptPath);
      const artifactHash = hash(bytes);
      // Read identity from the source artifact, never accept a hook pointing at another session.
      let sourceVersion = previous.nativeVersion ?? settings.sourceVersion;
      let identityUnavailable = false;
      if (settings.source === 'claude-code-cli') {
        try { sourceVersion = claudeIdentity(bytes, source.sessionId).version; }
        catch (error) {
          // A previously identified tracked file can be truncated during native rewrite. Preserve bytes and old generations.
          if (!previous.capture || (error as Error).message.includes('mismatch')) throw error;
          identityUnavailable = true;
        }
      }
      else {
        let metadata;
        try { metadata = JSON.parse(bytes.toString('utf8').split('\n')[0]!); } catch { /* Partial rewrite is preserved only after prior identification. */ }
        if (metadata?.type === 'session_meta' && metadata.payload?.id !== source.sessionId) throw new Error('Native session identity mismatch');
        if (metadata?.type !== 'session_meta' && !previous.capture) throw new Error('Native session identity unavailable; material remains pending');
        identityUnavailable = metadata?.type !== 'session_meta';
        if (settings.source === 'codex-cli' && metadata?.payload?.cli_version) sourceVersion = z.string().min(1).max(256).parse(metadata.payload.cli_version);
      }
      const discovered = await discoverMaterials({ source: settings.source, nativeRoot: settings.nativeRoot, nativeTempRoot: settings.nativeTempRoot,
        transcriptPath, sessionId: source.sessionId, project: source.project, bytes, previous: previous.capture?.materials });
      if (discovered.gaps.some(gap => ['missing', 'unreadable', 'unsafe-path', 'size-limit'].includes(gap.code))) monitor.fail(null, source.sessionId, 'capture-unavailable');
      if (identityUnavailable) discovered.gaps.push({ code: 'unknown-format', reference: '当前原件无法重新读取完整身份；沿用此前已确认绑定，保留重写或截断字节' });
      const materials = discovered.artifacts.map(item => item.material);
      const fingerprint = hash(JSON.stringify({ materials, gaps: discovered.gaps, lineage: discovered.lineage, compacted: discovered.compacted, partialLine: discovered.partialLine }));
      if (previous.acknowledgedHash === artifactHash && previous.materialFingerprint === fingerprint) { monitor.recover(source.sessionId); continue; }
      const prefixMatches = previous.acknowledgedByteLength !== undefined && bytes.length > previous.acknowledgedByteLength
        && hash(bytes.subarray(0, previous.acknowledgedByteLength)) === previous.acknowledgedHash;
      const change = !previous.acknowledgedHash ? 'initial' : previous.acknowledgedHash === artifactHash ? 'materials'
        : prefixMatches ? 'append' : bytes.length < previous.acknowledgedByteLength! ? 'truncate' : 'rewrite';
      const generation = previous.capture && (change === 'append' || change === 'materials') ? previous.capture.generation
        : hash(`${settings.source}/${source.sessionId}/${source.qualifiedAt}/${previous.capture?.generation ?? ''}/${artifactHash}`);
      const capture = captureSchema.parse({ generation, revision: (previous.capture?.revision ?? 0) + 1, change,
        previousSnapshotId: source.acknowledgedSnapshotId, materials, gaps: discovered.gaps, lineage: discovered.lineage,
        compacted: discovered.compacted, partialLine: discovered.partialLine });
      const manifest = manifestSchema.parse({ protocolVersion: 1, sourceSessionId: source.sessionId, source: settings.source,
        sourceVersion, sourceOs: settings.sourceOs, project: source.project,
        hash: artifactHash, byteLength: bytes.length, qualifiedAt: source.qualifiedAt, capability: 'unverified', capture });
      await delivery.enqueue(manifest, fingerprint, [bytes, ...discovered.artifacts.flatMap(item => item.bytes ? [item.bytes] : [])]);
      monitor.recover(source.sessionId);
    } catch (error) { errors.push((error as Error).message); monitor.fail(error, source.sessionId); }
  }
  const delivered = await delivery.deliver(settings, manifest => {
    const source = tracked.find(item => item.source === manifest.source && item.sessionId === manifest.sourceSessionId);
    return source?.acknowledgedSnapshotId && source.acknowledgedHash && source.acknowledgedByteLength !== undefined
      ? { snapshotId: source.acknowledgedSnapshotId, hash: source.acknowledgedHash, byteLength: source.acknowledgedByteLength,
        materialHashes: source.capture?.materials.map(item => item.hash) ?? [] } : undefined;
  }, async (manifest, fingerprint, ack) => {
    const source = tracked.find(item => item.source === manifest.source && item.sessionId === manifest.sourceSessionId);
    if (!source) throw new Error('Frozen delivery no longer has its source binding');
    source.acknowledgedHash = ack.hash; source.acknowledgedSnapshotId = ack.snapshotId; source.acknowledgedByteLength = ack.byteLength;
    source.capture = manifest.capture; source.materialFingerprint = fingerprint; source.nativeVersion = manifest.sourceVersion;
    delete source.appendRejected;
    await atomicJson(join(state, 'tracked.json'), tracked);
  });
  const status = { checkedAt: new Date().toISOString(), tracked: tracked.length, ...delivered, errors: [...errors, ...delivered.errors],
    delivery: await delivery.health(), capability: 'unverified', capture: options.capture === false ? 'disabled; frozen-delivery-only' : 'enabled' };
  await atomicJson(join(state, 'status.json'), status);
  return status;
}
