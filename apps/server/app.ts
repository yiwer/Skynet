import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { z } from 'zod';
import { digest, migrate, newCredential, type Database } from './database.js';
import { RawStore } from './raw-store.js';
import { archiveQuery, exportFormat } from './archive-query.js';
import { registerMcp } from './mcp.js';
import { assembleSchema, CHUNK_BYTES } from '../../packages/contracts/materials.js';
import { appendSnapshotSchema, enrollmentSchema, hashSchema, manifestSchema, MAX_ARTIFACT_BYTES, type Manifest } from '../../packages/contracts/archive.js';
import { credential, HttpError, identities } from './identities.js';

export async function createApp(options: { db: Database; rawDirectory: string; webDirectory?: string; publicOrigin?: string }) {
  const { db } = options;
  await migrate(db);
  const raw = new RawStore(options.rawDirectory);
  const app = Fastify({ bodyLimit: CHUNK_BYTES, logger: false, requestTimeout: 30_000 });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) return reply.code(400).send({ error: '请求格式无效' });
    const code = (error as { statusCode?: number }).statusCode ?? 500;
    return reply.code(code).send({ error: code < 500 ? (error as Error).message : '服务暂时不可用；原件尚未确认，请重试' });
  });
  app.addHook('onSend', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', _request.routeOptions.url === '/oauth/authorize' ? 'same-origin' : 'no-referrer');
    reply.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'");
  });
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_request, body, done) => done(null, body));

  const identity = identities(db);
  const { reader, device } = identity;
  const readerGuard = async (request: { headers: { authorization?: string } }) => { await reader(request.headers.authorization); };
  const deviceGuard = async (request: { headers: { authorization?: string } }) => { await device(request.headers.authorization); };
  const managerGuard = async (request: { headers: { authorization?: string } }) => { await identity.manager(request.headers.authorization); };

  app.get('/api/identities', { onRequest: managerGuard }, async request => {
    const { offset } = z.object({ offset: z.coerce.number().int().min(0).default(0) }).parse(request.query);
    return identity.list(request.headers.authorization, offset);
  });
  app.get('/api/identity-audit', { onRequest: managerGuard }, async request => {
    const { offset } = z.object({ offset: z.coerce.number().int().min(0).default(0) }).parse(request.query);
    return identity.audit(request.headers.authorization, offset);
  });
  for (const kind of ['employee', 'device'] as const) {
    app.post(`/api/identities/${kind}s/:id/disable`, { onRequest: managerGuard }, async request => {
      z.object({}).strict().parse(request.body ?? {});
      const id = z.uuid().parse((request.params as { id: string }).id);
      return identity.disable(request.headers.authorization, kind, id);
    });
  }

  app.get('/health', async () => ({ status: 'ok' }));
  app.post('/api/devices/enroll', async request => {
    const input = enrollmentSchema.parse(request.body);
    const employee = await db.query('SELECT id FROM employees WHERE enrollment_hash=$1 AND active', [digest(credential(request.headers.authorization))]);
    if (!employee.rows[0]) throw new HttpError(401, '接入授权值无效或已停用');
    const id = randomUUID(); const token = newCredential();
    const created = await db.query(`INSERT INTO devices(id,employee_id,installation_id,name,credential_hash)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(employee_id,installation_id) DO NOTHING RETURNING id,enrolled_at`,
    [id, employee.rows[0].id, input.installationId, input.name, digest(token)]);
    if (!created.rowCount) throw new HttpError(409, '该安装已绑定；请使用已有设备凭据');
    return { deviceId: id, deviceCredential: token, employeeId: employee.rows[0].id, enrolledAt: created.rows[0].enrolled_at.toISOString() };
  });

  app.put('/api/chunks/:hash', { onRequest: deviceGuard }, async (request, reply) => {
    const owner = await device(request.headers.authorization);
    const hash = hashSchema.parse((request.params as { hash: string }).hash);
    if (!Buffer.isBuffer(request.body) || request.body.length === 0) throw new HttpError(400, '需要非空原件字节');
    if (digest(request.body) !== hash) throw new HttpError(422, '原件哈希不匹配');
    await raw.write(owner.id, hash, request.body);
    await db.query('INSERT INTO chunks(device_id,hash,byte_length) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [owner.id, hash, request.body.length]);
    return reply.code(201).send({ hash, byteLength: request.body.length, state: 'staged' });
  });

  async function commitSnapshot(owner: { id: string; enrolled_at: Date | null }, input: Manifest) {
    // The uploader cannot choose the historical-activity boundary. Legacy devices remain unknown.
    const manifest = manifestSchema.parse({ ...input, enrolledAt: owner.enrolled_at?.toISOString() });
    const chunk = await db.query('SELECT byte_length FROM chunks WHERE device_id=$1 AND hash=$2', [owner.id, manifest.hash]);
    if (!chunk.rows[0] || chunk.rows[0].byte_length !== manifest.byteLength) throw new HttpError(409, '原件尚未持久化或长度不匹配');
    await raw.read(owner.id, manifest.hash); // Never acknowledge a missing or damaged artifact.
    for (const material of manifest.capture?.materials ?? []) {
      const stored = await db.query('SELECT byte_length FROM chunks WHERE device_id=$1 AND hash=$2', [owner.id, material.hash]);
      if (!stored.rows[0] || stored.rows[0].byte_length !== material.byteLength) throw new HttpError(409, '关联原件尚未持久化或长度不匹配');
      if ((await raw.read(owner.id, material.hash)).length !== material.byteLength) throw new HttpError(409, '关联原件长度不匹配');
    }
    const manifestHash = digest(JSON.stringify(manifest));
    const id = randomUUID();
    const result = await db.query(`INSERT INTO snapshots(id,device_id,source_session_id,manifest_hash,manifest,hash)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(device_id,source,source_session_id,manifest_hash)
      DO UPDATE SET manifest_hash=EXCLUDED.manifest_hash RETURNING id, committed_at`,
    [id, owner.id, manifest.sourceSessionId, manifestHash, manifest, manifest.hash]);
    return { snapshotId: result.rows[0].id, state: 'committed', hash: manifest.hash, byteLength: manifest.byteLength,
      committedAt: result.rows[0].committed_at, backup: 'single-copy' };
  }
  app.post('/api/snapshots', { onRequest: deviceGuard }, async request => {
    return commitSnapshot(await device(request.headers.authorization), manifestSchema.parse(request.body));
  });
  app.post('/api/snapshots/append', { onRequest: deviceGuard }, async request => {
    const owner = await device(request.headers.authorization);
    const input = appendSnapshotSchema.parse(request.body);
    const { manifest } = input;
    const base = await db.query('SELECT hash,manifest FROM snapshots WHERE id=$1 AND device_id=$2', [input.baseSnapshotId, owner.id]);
    const previous = base.rows[0];
    if (!previous || previous.hash !== input.baseHash || previous.manifest.byteLength !== input.baseByteLength
      || previous.manifest.source !== manifest.source || previous.manifest.sourceSessionId !== manifest.sourceSessionId) {
      throw new HttpError(409, '增量基准未确认或不属于当前设备、来源及会话');
    }
    if (input.baseByteLength + input.appendByteLength !== manifest.byteLength) throw new HttpError(422, '增量长度与完整快照不匹配');
    const chunk = await db.query('SELECT byte_length FROM chunks WHERE device_id=$1 AND hash=$2', [owner.id, input.appendHash]);
    if (!chunk.rows[0] || chunk.rows[0].byte_length !== input.appendByteLength) throw new HttpError(409, '增量字节尚未持久化或长度不匹配');
    const bytes = Buffer.concat([await raw.read(owner.id, input.baseHash), await raw.read(owner.id, input.appendHash)]);
    if (bytes.length !== manifest.byteLength || digest(bytes) !== manifest.hash) throw new HttpError(422, '增量组装后的完整快照校验失败');
    // Publish only a fully verified immutable artifact. A pre-commit crash leaves staged bytes,
    // while the old snapshot stays readable; the final database row is the atomic commit point.
    await raw.write(owner.id, manifest.hash, bytes);
    await db.query('INSERT INTO chunks(device_id,hash,byte_length) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [owner.id, manifest.hash, bytes.length]);
    return commitSnapshot(owner, manifest);
  });

  app.post('/api/artifacts/assemble', { onRequest: deviceGuard }, async request => {
    const owner = await device(request.headers.authorization);
    const input = assembleSchema.parse(request.body);
    const parts: Buffer[] = [];
    for (const part of input.chunks) {
      const stored = await db.query('SELECT byte_length FROM chunks WHERE device_id=$1 AND hash=$2', [owner.id, part.hash]);
      if (!stored.rows[0] || stored.rows[0].byte_length !== part.byteLength) throw new HttpError(409, '分块未持久化');
      const bytes = await raw.read(owner.id, part.hash);
      if (bytes.length !== part.byteLength) throw new HttpError(409, '分块长度不匹配');
      parts.push(bytes);
    }
    const bytes = Buffer.concat(parts);
    if (digest(bytes) !== input.hash) throw new HttpError(422, '组装原件哈希不匹配');
    await raw.write(owner.id, input.hash, bytes);
    await db.query('INSERT INTO chunks(device_id,hash,byte_length) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [owner.id, input.hash, bytes.length]);
    return { state: 'staged', hash: input.hash, byteLength: bytes.length };
  });

  app.get('/api/me', { onRequest: readerGuard }, async request => reader(request.headers.authorization));
  const archive = archiveQuery(db, raw);
  app.get('/api/sessions', { onRequest: readerGuard }, async request => {
    const query = z.object({ cursor: z.string().max(1024).optional(), limit: z.coerce.number().int().min(1).max(100).default(100) }).parse(request.query);
    return archive.sessions(query.cursor, query.limit);
  });
  app.get('/api/snapshots/:id', { onRequest: readerGuard }, async request => {
    const { offset } = z.object({ offset: z.coerce.number().int().min(0).default(0) }).parse(request.query);
    return archive.detail((request.params as { id: string }).id, offset);
  });
  app.get('/api/snapshots/:id/evidence', { onRequest: readerGuard }, async request => {
    const query = z.object({ offset: z.coerce.number().int().min(0).default(0), textOffset: z.coerce.number().int().min(0).default(0) }).parse(request.query);
    return archive.evidencePage((request.params as { id: string }).id, query.offset, query.textOffset);
  });
  app.get('/api/snapshots/:id/history', { onRequest: readerGuard }, async request => {
    const { offset } = z.object({ offset: z.coerce.number().int().min(0).default(0) }).parse(request.query);
    return archive.history((request.params as { id: string }).id, offset);
  });
  app.get('/api/snapshots/:id/materials/:materialId/view', { onRequest: readerGuard }, async request => {
    const { id, materialId } = request.params as { id: string; materialId: string };
    const { offset } = z.object({ offset: z.coerce.number().int().min(0).default(0) }).parse(request.query);
    return archive.materialPage(id, materialId, offset);
  });
  app.get('/api/snapshots/:id/materials/:materialId', { onRequest: readerGuard }, async (request, reply) => {
    const { id, materialId } = request.params as { id: string; materialId: string };
    const file = await archive.material(id, materialId);
    return reply.header('Content-Disposition', `attachment; filename="${file.material.id}.bin"`).type('application/octet-stream').send(file.bytes);
  });
  for (const format of exportFormat.options) app.get(`/api/snapshots/:id/${format}`, { onRequest: readerGuard }, async (request, reply) => {
    const file = await archive.exported((request.params as { id: string }).id, format);
    return reply.header('Content-Disposition', `attachment; filename="${file.filename}"`).type(file.contentType).send(file.bytes);
  });
  if (options.publicOrigin) await registerMcp(app, db, archive, options.publicOrigin);
  if (options.webDirectory) {
    await app.register(fastifyStatic, { root: resolve(options.webDirectory), wildcard: false });
  }
  return app;
}
