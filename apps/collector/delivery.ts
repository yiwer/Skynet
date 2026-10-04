import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, open, unlink, stat, link } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { atomicJson, syncDirectory } from '../../packages/filesystem.js';
import { hashSchema, manifestSchema, type Manifest } from '../../packages/contracts/archive.js';
import { CHUNK_BYTES } from '../../packages/contracts/materials.js';
import { deliveryFailureSchema, deliveryReceiptSchema, type DeliveryFailure, type DeliveryHealth, type DeliveryReceipt } from '../../packages/contracts/delivery.js';

const digest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const MAX_QUEUE_BYTES = 512 * 1024 * 1024;
const MAX_QUEUE_SNAPSHOTS = 1024;
const payloadSchema = z.object({ hash: hashSchema, byteLength: z.number().int().min(0) }).strict();
const pendingSchema = z.object({ id: z.uuid(), sequence: z.number().int().positive(), createdAt: z.iso.datetime(), manifest: manifestSchema,
  fingerprint: hashSchema, payloads: z.array(payloadSchema).max(129) }).strict();
type Pending = z.infer<typeof pendingSchema>;
const observationSchema = z.object({ disconnectedAttempts: z.number().int().min(0).max(1_000_000_000),
  firstDisconnectedAt: z.iso.datetime().nullable(), lastDisconnectedAt: z.iso.datetime().nullable() }).strict();
const receiptOutboxSchema = z.object({ receipt: deliveryReceiptSchema, attempts: z.number().int().min(0), nextAttemptAt: z.iso.datetime().nullable() }).strict();
const retrySchema = z.object({ attempts: z.number().int().min(0).default(0), nextAttemptAt: z.iso.datetime().nullable().default(null),
  lastSuccessAt: z.iso.datetime().nullable().default(null), lastFailure: deliveryFailureSchema.nullable().default(null),
  lastRejection: deliveryFailureSchema.nullable().default(null), quotaBlocked: z.boolean().default(false) });
type Settings = { server: string; deviceCredential: string };
type Baseline = { snapshotId: string; hash: string; byteLength: number; materialHashes: string[] };
export type DeliveryAck = { snapshotId: string; hash: string; byteLength: number; state: 'committed' };

class DeliveryError extends Error {
  constructor(public kind: DeliveryFailure['kind'], public status?: number, public retryAfter = 0) {
    super(`Delivery ${kind}${status ? ` (${status})` : ''}; immutable local materials retained`);
  }
}
async function request(settings: Settings, path: string, init: RequestInit) {
  let response: Response;
  try {
    response = await fetch(new URL(path, settings.server), { ...init, redirect: 'error',
      headers: { ...init.headers, Authorization: `Bearer ${settings.deviceCredential}` }, signal: AbortSignal.timeout(15_000) });
  } catch { throw new DeliveryError('disconnected'); }
  if (!response.ok) {
    const retryHeader = response.headers.get('Retry-After');
    const retryAfter = retryHeader && /^\d+(?:\.\d+)?$/.test(retryHeader) ? Number(retryHeader) * 1000
      : retryHeader ? Math.max(0, Date.parse(retryHeader) - Date.now()) : 0;
    throw new DeliveryError(response.status === 401 || response.status === 403 ? 'credentials-rejected'
      : response.status === 429 ? 'rate-limited' : response.status >= 500 ? 'server-unavailable' : 'request-rejected',
    response.status, Number.isFinite(retryAfter) ? Math.min(retryAfter, 24 * 60 * 60 * 1000) : 0);
  }
  return response;
}

// One writer per collector state is enforced by the collector/runtime lock. Blobs
// and pending manifests are fsynced before any request is issued. The source path
// is deliberately absent from the delivery plan: retries cannot reread a rewrite.
export class DeliveryQueue {
  private directory: string;
  private pending: Pending[] = [];
  private retry = retrySchema.parse({});
  private constructor(private state: string) { this.directory = join(state, 'delivery'); }
  static async open(state: string) {
    const queue = new DeliveryQueue(state);
    for (const name of ['pending', 'prepared', 'blobs', 'observations', 'receipts']) await mkdir(join(queue.directory, name), { recursive: true, mode: 0o700 });
    for (const file of await readdir(join(queue.directory, 'pending'))) {
      if (!file.endsWith('.json')) continue;
      const item = pendingSchema.parse(JSON.parse(await readFile(join(queue.directory, 'pending', file), 'utf8')));
      if (file !== `${item.id}.json`) throw new Error('Delivery manifest identity mismatch; queue retained');
      queue.pending.push(item);
    }
    queue.pending.sort((a, b) => a.sequence - b.sequence);
    try { queue.retry = retrySchema.parse(JSON.parse(await readFile(join(queue.directory, 'retry.json'), 'utf8'))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    return queue;
  }
  latest(source: string, sessionId: string) {
    return this.pending.filter(item => item.manifest.source === source && item.manifest.sourceSessionId === sessionId).at(-1);
  }
  private async saveRetry() { await atomicJson(join(this.directory, 'retry.json'), this.retry); }
  async retryNow() {
    this.retry.nextAttemptAt = null; await this.saveRetry();
    for (const name of await readdir(join(this.directory, 'receipts'))) if (/^[a-f0-9-]{36}\.json$/.test(name)) {
      const path = join(this.directory, 'receipts', name);
      const entry = receiptOutboxSchema.parse(JSON.parse(await readFile(path, 'utf8')));
      await atomicJson(path, { ...entry, nextAttemptAt: null });
    }
  }
  private async observation(id: string) {
    try { return observationSchema.parse(JSON.parse(await readFile(join(this.directory, 'observations', `${id}.json`), 'utf8'))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return null; }
  }
  private async queueReceipt(entry: Pending, ack: DeliveryAck) {
    const path = join(this.directory, 'receipts', `${entry.id}.json`);
    try { receiptOutboxSchema.parse(JSON.parse(await readFile(path, 'utf8'))); return; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const observation = await this.observation(entry.id);
    // Generations frozen by an older collector did not record connectivity.
    // Absence cannot become a claim that zero disconnections were observed.
    if (!observation) return;
    const receipt: DeliveryReceipt = { uploadId: entry.id, snapshotId: ack.snapshotId,
      capturedAt: entry.createdAt, acknowledgedAt: new Date().toISOString(), ...observation };
    await atomicJson(path, { receipt, attempts: 0, nextAttemptAt: null });
  }
  private async flushReceipts(settings: Settings, errors: string[]) {
    const files = (await readdir(join(this.directory, 'receipts'))).filter(name => /^[a-f0-9-]{36}\.json$/.test(name));
    for (const name of files.slice(0, 8)) {
      const path = join(this.directory, 'receipts', name);
      const entry = receiptOutboxSchema.parse(JSON.parse(await readFile(path, 'utf8')));
      if (entry.nextAttemptAt && Date.parse(entry.nextAttemptAt) > Date.now()) continue;
      try {
        const response = await request(settings, '/api/delivery/receipts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entry.receipt) });
        const ack = await response.json();
        if (ack?.state !== 'recorded' || ack.uploadId !== entry.receipt.uploadId || ack.snapshotId !== entry.receipt.snapshotId) throw new DeliveryError('invalid-ack');
        await unlink(path); await syncDirectory(join(this.directory, 'receipts'));
      } catch (error) {
        const failure = error instanceof DeliveryError ? error : new DeliveryError('local-data');
        const attempts = entry.attempts + 1;
        await atomicJson(path, { ...entry, attempts, nextAttemptAt: new Date(Date.now() + Math.max(failure.retryAfter, Math.min(300_000, 1000 * 2 ** Math.min(attempts, 16)))).toISOString() });
        errors.push(`Delivery observation pending: ${failure.kind}`);
      }
    }
  }
  private async blob(hash: string, byteLength: number) {
    let bytes: Buffer;
    try { bytes = await readFile(join(this.directory, 'blobs', hash)); } catch { throw new DeliveryError('local-data'); }
    if (bytes.length !== byteLength || digest(bytes) !== hash) throw new DeliveryError('local-data');
    return bytes;
  }
  private references() {
    const refs = new Map<string, number>();
    for (const item of this.pending) for (const payload of item.payloads) refs.set(payload.hash, payload.byteLength);
    return refs;
  }
  async enqueue(manifest: Manifest, fingerprint: string, buffers: Buffer[]) {
    const additions = new Map(buffers.map(bytes => [digest(bytes), bytes]));
    const payloads = new Map<string, number>();
    for (const artifact of [{ hash: manifest.hash, byteLength: manifest.byteLength }, ...(manifest.capture?.materials ?? [])]) {
      if (additions.has(artifact.hash)) payloads.set(artifact.hash, artifact.byteLength);
      else {
        // Missing material may still be in an earlier offline generation. Keep
        // that reference until this generation receives its own committed ACK.
        try { await stat(join(this.directory, 'blobs', artifact.hash)); payloads.set(artifact.hash, artifact.byteLength); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      }
    }
    if (!payloads.has(manifest.hash)) throw new Error('Main artifact must be frozen locally');
    const refs = this.references(); for (const [hash, length] of payloads) refs.set(hash, length);
    if (this.pending.length >= MAX_QUEUE_SNAPSHOTS || [...refs.values()].reduce((n, size) => n + size, 0) > MAX_QUEUE_BYTES) {
      this.retry.quotaBlocked = true; await this.saveRetry();
      throw new Error('Delivery queue quota reached; unconfirmed materials retained. Restore delivery or expand managed storage; new capture remains pending at source.');
    }
    for (const [hash, length] of payloads) {
      const bytes = additions.get(hash); if (!bytes) { await this.blob(hash, length); continue; }
      // Publish only a complete blob. A killed partial write cannot poison the
      // immutable hash name and permanently block the next capture attempt.
      const temporary = join(this.directory, 'blobs', `.pending-${randomUUID()}`);
      try {
        const handle = await open(temporary, 'wx', 0o600);
        try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
        await link(temporary, join(this.directory, 'blobs', hash)).catch(async error => {
          if (error.code !== 'EEXIST') throw error;
          await this.blob(hash, length);
        });
      } finally { await unlink(temporary).catch(() => undefined); }
    }
    await syncDirectory(join(this.directory, 'blobs'));
    const entry = pendingSchema.parse({ id: randomUUID(), sequence: (this.pending.at(-1)?.sequence ?? 0) + 1,
      createdAt: new Date().toISOString(), manifest, fingerprint, payloads: [...payloads].map(([hash, byteLength]) => ({ hash, byteLength })) });
    await atomicJson(join(this.directory, 'observations', `${entry.id}.json`), {
      disconnectedAttempts: 0, firstDisconnectedAt: null, lastDisconnectedAt: null });
    await atomicJson(join(this.directory, 'pending', `${entry.id}.json`), entry);
    this.pending.push(entry); this.retry.quotaBlocked = false; await this.saveRetry();
  }
  async health(): Promise<DeliveryHealth> {
    return { pendingSnapshots: this.pending.length, pendingBytes: [...this.references().values()].reduce((n, size) => n + size, 0),
      oldestPendingAt: this.pending[0]?.createdAt ?? null, lastSuccessAt: this.retry.lastSuccessAt,
      attempts: this.retry.attempts, nextAttemptAt: this.retry.nextAttemptAt, lastFailure: this.retry.lastFailure,
      lastRejection: this.retry.lastRejection, quotaBytes: MAX_QUEUE_BYTES, quotaSnapshots: MAX_QUEUE_SNAPSHOTS, quotaBlocked: this.retry.quotaBlocked };
  }
  async deliver(settings: Settings, baseline: (manifest: Manifest) => Baseline | undefined,
    commit: (manifest: Manifest, fingerprint: string, ack: DeliveryAck) => Promise<void>) {
    let committed = 0; let uploadedBytes = 0; let appended = 0; const errors: string[] = [];
    if (this.retry.nextAttemptAt && Date.parse(this.retry.nextAttemptAt) > Date.now()) {
      await this.flushReceipts(settings, errors); return { committed, uploadedBytes, appended, errors };
    }
    const upload = async (bytes: Buffer) => {
      const hash = digest(bytes);
      if (bytes.length && bytes.length <= CHUNK_BYTES) {
        await request(settings, `/api/chunks/${hash}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(bytes) });
      } else {
        const chunks = [];
        for (let start = 0; start < bytes.length; start += CHUNK_BYTES) {
          const part = bytes.subarray(start, start + CHUNK_BYTES); const partHash = digest(part);
          await request(settings, `/api/chunks/${partHash}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(part) });
          chunks.push({ hash: partHash, byteLength: part.length });
        }
        await request(settings, '/api/artifacts/assemble', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hash, byteLength: bytes.length, chunks }) });
      }
      uploadedBytes += bytes.length; return hash;
    };
    // Bound a busy queue's work per sweep so other configured clients get a turn.
    for (const entry of this.pending.slice(0, 8)) {
      try {
        const prior = baseline(entry.manifest);
        let manifest: Manifest;
        const prepared = join(this.directory, 'prepared', `${entry.id}.json`);
        try { manifest = manifestSchema.parse(JSON.parse(await readFile(prepared, 'utf8'))); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          manifest = manifestSchema.parse({ ...entry.manifest, capture: entry.manifest.capture
            ? { ...entry.manifest.capture, previousSnapshotId: prior?.snapshotId } : undefined });
          await atomicJson(prepared, manifest);
        }
        if (manifest.hash !== entry.manifest.hash || manifest.sourceSessionId !== entry.manifest.sourceSessionId
          || manifest.source !== entry.manifest.source) throw new DeliveryError('local-data');
        const bytes = await this.blob(manifest.hash, manifest.byteLength);
        for (const payload of entry.payloads) if (payload.hash !== manifest.hash && !prior?.materialHashes.includes(payload.hash)) {
          await upload(await this.blob(payload.hash, payload.byteLength));
        }
        let response: Response | undefined; let usedAppend = false;
        if (prior && prior.byteLength > 0 && manifest.capture?.previousSnapshotId === prior.snapshotId && bytes.length > prior.byteLength
          && digest(bytes.subarray(0, prior.byteLength)) === prior.hash) {
          const delta = bytes.subarray(prior.byteLength); const appendHash = await upload(delta);
          try {
            response = await request(settings, '/api/snapshots/append', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': entry.id },
              body: JSON.stringify({ manifest, baseSnapshotId: prior.snapshotId, baseHash: prior.hash, baseByteLength: prior.byteLength,
                appendHash, appendByteLength: delta.length }) }); usedAppend = true;
          } catch (error) { if (!(error instanceof DeliveryError) || error.status !== 409) throw error; }
        }
        if (!response) {
          await upload(bytes);
          response = await request(settings, '/api/snapshots', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': entry.id }, body: JSON.stringify(manifest) });
        }
        let ack: DeliveryAck;
        try { ack = z.object({ snapshotId: z.uuid(), state: z.literal('committed'), hash: hashSchema,
          byteLength: z.number().int().min(0), uploadId: z.literal(entry.id) }).parse(await response.json()); }
        catch { throw new DeliveryError('invalid-ack'); }
        if (ack.hash !== manifest.hash || ack.byteLength !== manifest.byteLength) throw new DeliveryError('invalid-ack');
        // A separate durable outbox can retry the observation after the raw ACK
        // retires this generation. Observation transport never blocks raw delivery.
        await this.queueReceipt(entry, ack);
        await commit(manifest, entry.fingerprint, ack);
        // Advance the durable source ACK before retiring the queue item. A crash
        // before unlink replays this exact prepared manifest idempotently.
        await unlink(join(this.directory, 'pending', `${entry.id}.json`)); await syncDirectory(join(this.directory, 'pending'));
        this.pending = this.pending.filter(item => item.id !== entry.id);
        await unlink(prepared); await syncDirectory(join(this.directory, 'prepared'));
        await unlink(join(this.directory, 'observations', `${entry.id}.json`)).catch(error => { if (error.code !== 'ENOENT') throw error; });
        this.retry.attempts = 0; this.retry.nextAttemptAt = null; this.retry.lastFailure = null;
        this.retry.lastSuccessAt = new Date().toISOString(); await this.saveRetry();
        committed++; if (usedAppend) appended++;
      } catch (error) {
        const failure = error instanceof DeliveryError ? error : new DeliveryError('local-data');
        if (failure.kind === 'disconnected') {
          const observation = await this.observation(entry.id); const at = new Date().toISOString();
          await atomicJson(join(this.directory, 'observations', `${entry.id}.json`), {
            disconnectedAttempts: Math.min(1_000_000_000, (observation?.disconnectedAttempts ?? 0) + 1),
            firstDisconnectedAt: observation?.firstDisconnectedAt ?? at, lastDisconnectedAt: at });
        }
        this.retry.attempts++;
        this.retry.lastFailure = { kind: failure.kind, status: failure.status, at: new Date().toISOString() };
        if (failure.kind === 'credentials-rejected' || failure.kind === 'request-rejected') this.retry.lastRejection = this.retry.lastFailure;
        const minimum = failure.kind === 'credentials-rejected' || failure.kind === 'request-rejected' || failure.kind === 'local-data' ? 60_000 : 1000;
        const delay = Math.max(failure.retryAfter, Math.min(300_000, minimum * 2 ** Math.min(this.retry.attempts - 1, 16)));
        this.retry.nextAttemptAt = new Date(Date.now() + delay).toISOString(); await this.saveRetry();
        errors.push(failure.message); break;
      }
    }
    // Never delete a blob still referenced by another pending generation.
    const refs = this.references();
    for (const file of await readdir(join(this.directory, 'blobs'))) if (hashSchema.safeParse(file).success && !refs.has(file)) await unlink(join(this.directory, 'blobs', file));
    await syncDirectory(join(this.directory, 'blobs'));
    await this.flushReceipts(settings, errors);
    return { committed, uploadedBytes, appended, errors };
  }
}
