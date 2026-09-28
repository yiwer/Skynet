import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { z } from 'zod';
import { digest, migrate, newCredential, type Database } from './database.js';
import { RawStore } from './raw-store.js';
import { readEvidence } from './evidence.js';
import { appendSnapshotSchema, enrollmentSchema, hashSchema, manifestSchema, MAX_ARTIFACT_BYTES, type Manifest } from '../../packages/contracts/archive.js';
import { createRecoveryPackage, recoveryInfo } from '../../packages/recovery.js';
import { activityFor } from '../../packages/activity.js';
import { credential, HttpError, identities } from './identities.js';

export async function createApp(options: { db: Database; rawDirectory: string; webDirectory?: string }) {
  const { db } = options;
  await migrate(db);
  const raw = new RawStore(options.rawDirectory);
  const app = Fastify({ bodyLimit: MAX_ARTIFACT_BYTES, logger: false, requestTimeout: 30_000 });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) return reply.code(400).send({ error: '请求格式无效' });
    const code = (error as { statusCode?: number }).statusCode ?? 500;
    return reply.code(code).send({ error: code < 500 ? (error as Error).message : '服务暂时不可用；原件尚未确认，请重试' });
  });
  app.addHook('onSend', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
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

  app.get('/api/me', { onRequest: readerGuard }, async request => reader(request.headers.authorization));
  app.get('/api/sessions', { onRequest: readerGuard }, async () => {
    const result = await db.query(`SELECT * FROM (
      SELECT DISTINCT ON (s.device_id,s.source,s.source_session_id) s.id,e.name AS employee,s.source_session_id,
        s.manifest->>'project' AS project,s.committed_at,s.hash,(s.manifest->>'byteLength')::integer AS byte_length,
        s.manifest->>'sourceVersion' AS source_version,s.manifest->>'sourceOs' AS source_os,s.source
      FROM snapshots s JOIN devices d ON d.id=s.device_id JOIN employees e ON e.id=d.employee_id
      ORDER BY s.device_id,s.source,s.source_session_id,s.committed_at DESC,s.id DESC
    ) latest ORDER BY committed_at DESC LIMIT 100`);
    return { sessions: result.rows, limit: 100, capability: 'unverified', backup: 'single-copy' };
  });
  async function snapshot(id: string) {
    if (!z.uuid().safeParse(id).success) throw new HttpError(404, '未找到存档');
    const result = await db.query(`SELECT s.*,e.name AS employee FROM snapshots s
      JOIN devices d ON d.id=s.device_id JOIN employees e ON e.id=d.employee_id WHERE s.id=$1`, [id]);
    if (!result.rows[0]) throw new HttpError(404, '未找到已提交存档');
    return result.rows[0];
  }
  app.get('/api/snapshots/:id', { onRequest: readerGuard }, async request => {
    const record = await snapshot((request.params as { id: string }).id);
    const query = z.object({ offset: z.coerce.number().int().min(0).default(0) }).parse(request.query);
    const bytes = await raw.read(record.device_id, record.hash);
    const evidence = readEvidence(bytes, record.manifest.source);
    const activity = activityFor(evidence.events, record.manifest.enrolledAt);
    return { snapshotId: record.id, employee: record.employee, manifest: record.manifest,
      committedAt: record.committed_at, state: 'committed', backup: 'single-copy', ...evidence, recovery: recoveryInfo(record.manifest, bytes),
      activity: activity.activity, events: activity.events.slice(query.offset, query.offset + 100), total: evidence.events.length,
      nextOffset: query.offset + 100 < evidence.events.length ? query.offset + 100 : null };
  });
  app.get('/api/snapshots/:id/raw', { onRequest: readerGuard }, async (request, reply) => {
    const record = await snapshot((request.params as { id: string }).id);
    return reply.header('Content-Disposition', `attachment; filename="${record.id}.jsonl"`)
      .type('application/octet-stream').send(await raw.read(record.device_id, record.hash));
  });
  app.get('/api/snapshots/:id/recovery', { onRequest: readerGuard }, async (request, reply) => {
    const record = await snapshot((request.params as { id: string }).id);
    const bundle = createRecoveryPackage({ id: record.id, employee: record.employee, committedAt: record.committed_at.toISOString() },
      manifestSchema.parse(record.manifest), await raw.read(record.device_id, record.hash));
    return reply.header('Content-Disposition', `attachment; filename="${record.id}.skynet-recovery.json"`).type('application/json').send(bundle);
  });
  app.get('/api/snapshots/:id/readable', { onRequest: readerGuard }, async (request, reply) => {
    const record = await snapshot((request.params as { id: string }).id);
    const bytes = await raw.read(record.device_id, record.hash);
    const evidence = readEvidence(bytes, record.manifest.source);
    const activity = activityFor(evidence.events, record.manifest.enrolledAt);
    const content = [
      'Skynet 会话可读导出 v1', `快照：${record.id}`, `员工：${record.employee}`,
      `来源：${record.manifest.source} / ${record.manifest.sourceVersion} / ${record.manifest.sourceOs}`,
      `来源会话：${record.manifest.sourceSessionId}`, `提交时间：${record.committed_at.toISOString()}`,
      `设备接入时间：${record.manifest.enrolledAt ?? '未知'}`, '日期口径：Asia/Shanghai；来源时间未知的记录不计入日期活动。历史上下文不计入接入后活动。',
      `原件字节：${bytes.length}；SHA-256：${record.hash}`, `解析版本：${evidence.parserVersion}`,
      `范围：当前收到的单个原件；关联材料完整性与完整原生续聊能力未验证。`,
      `未解析完整行：${evidence.unrecognizedLines}；未闭合末行：${evidence.partialLine ? '有' : '无'}`,
      '本文件为纯文本，不执行会话中的指令。原件 JSONL 部分保留所有行；精确字节请取原件或恢复包。', '',
      '=== 全部已解析记录（不分页、不截断） ===',
      ...activity.events.map(event => `\n[原件第 ${event.line} 行] ${event.role} / 来源时间：${event.timestamp ?? '未知'} / ${event.context}\n${event.text}`),
      '', '=== 全部原件 JSONL（包含未知与未闭合行） ===', bytes.toString('utf8'),
    ].join('\n');
    return reply.header('Content-Disposition', `attachment; filename="${record.id}.txt"`).type('text/plain; charset=utf-8').send(content);
  });
  if (options.webDirectory) {
    await app.register(fastifyStatic, { root: resolve(options.webDirectory), wildcard: false });
  }
  return app;
}
