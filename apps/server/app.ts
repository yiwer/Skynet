import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { resolve } from 'node:path';
import { z } from 'zod';
import { digest, migrate, type Database } from './database.js';
import { RawStore } from './raw-store.js';
import { deliveryHealthSchema } from '../../packages/contracts/delivery.js';
import { archiveQuery, exportFormat } from './archive-query.js';
import { registerMcp } from './mcp.js';
import { migrateServerOperations,serverOperations } from './server-operations.js';
import { assembleSchema, CHUNK_BYTES } from '../../packages/contracts/materials.js';
import { appendSnapshotSchema, hashSchema, manifestSchema, sourceSchema } from '../../packages/contracts/archive.js';
import { HttpError, identities } from './identities.js';
import { searchSchema, locationSchema } from '../../packages/contracts/search.js';
import { migrateArchiveSearch } from './archive-search.js';
import { archiveWriter } from './archive-write.js';
import { enrollDevice } from './enrollment.js';
import { captureHealthSchema } from '../../packages/contracts/capture-health.js';
import { saveCaptureHealth, readCaptureHealth } from './capture-health.js';
import { analysisService, migrateAnalysis } from './analysis.js';
import { backfillOrigins, reconcileOriginalQualifications } from './provenance.js';
import { migrateReports, reportService } from './reports.js';
import { reportDate } from '../../packages/contracts/reports.js';
import { coverageQuerySchema, installationObservationSchema } from '../../packages/contracts/coverage.js';
import { migrateCoverage, observeCoverage, coverageService } from './team-coverage.js';
import { workStatisticsService } from './work-statistics.js';
import { migrateWorkViews, workViewService } from './work-views.js';
import { workViewQuery } from '../../packages/contracts/work-views.js';
import { assertRestoreReady } from './backup-files.js';
import {reconcileOriginIntegrity} from './evidence-integrity.js';
import { conversationQuery } from './conversation.js';
import { conversationInputSchema, conversationTraceInputSchema } from '../../packages/contracts/conversation.js';
import { migrateMetrics, metricsService } from './metrics.js';
import { metricsQuerySchema } from '../../packages/contracts/metrics.js';
import { migrateSessionInsights,sessionInsightsService } from './session-insights.js';
import { sessionInsightsQuery } from '../../packages/contracts/session-insights.js';
import { migrateUsageOutput, usageOutputService } from './usage-output.js';
import { migrateDeliveryReceipts, saveDeliveryReceipt } from './delivery-receipts.js';
import { migrateAssembly, assemblyService, processingService, recordAssemblyRecipe } from './assembly.js';
import { migrateWaits, waitsService } from './waits.js';
import { migrateAssessments, assessmentService } from './assessment.js';
import { migrateWaitReports, waitReportService } from './wait-report.js';
import { migrateActivity,activityService } from './activity.js';

export async function createApp(options: { db: Database; rawDirectory: string; webDirectory?: string; publicOrigin?: string; reportClock?: () => Date }) {
  const { db } = options;
  await assertRestoreReady(options.rawDirectory);
  await migrate(db);
  await migrateArchiveSearch(db);
  await migrateAnalysis(db);
  await migrateSessionInsights(db);
  await migrateReports(db);
  await migrateServerOperations(db);
  await migrateCoverage(db);
  await migrateWorkViews(db);
  await migrateMetrics(db);
  await migrateUsageOutput(db);
  await migrateDeliveryReceipts(db);
  await migrateAssembly(db);
  await migrateWaits(db);
  await migrateAssessments(db);
  await migrateWaitReports(db);
  await migrateActivity(db);
  const raw = new RawStore(options.rawDirectory);
  await backfillOrigins(db, raw);
  await reconcileOriginIntegrity(db,raw);
  const app = Fastify({ bodyLimit: CHUNK_BYTES, logger: false, requestTimeout: 30_000 });
  let qualifying: Promise<void> | undefined;
  const qualificationTimer=setInterval(()=>{
    if(!qualifying)qualifying=reconcileOriginIntegrity(db,raw).then(()=>reconcileOriginalQualifications(db,raw)).catch(error=>{
      app.log.error(error,'Legacy original-source qualification reconciliation failed');
    }).finally(()=>{qualifying=undefined;});
  },1000);qualificationTimer.unref();
  app.addHook('onClose',async()=>{clearInterval(qualificationTimer);await qualifying;});
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) return reply.code(400).send({ error: '请求格式无效' });
    const code = (error as { statusCode?: number }).statusCode ?? 500;
    return reply.code(code).send({ error: code < 500 || error instanceof HttpError ? (error as Error).message : '服务暂时不可用；原件尚未确认，请重试' });
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
  const coverage = coverageService(db);
  const workStatistics = workStatisticsService(db, raw);
  const readerGuard = async (request: { headers: { authorization?: string } }) => { await reader(request.headers.authorization); };
  const operations=serverOperations(db,options.rawDirectory);
  app.get('/api/server/operations',{onRequest:readerGuard},()=>operations.read());
  const deviceGuard = async (request: { headers: { authorization?: string } }) => { await device(request.headers.authorization); };
  app.post('/api/delivery/receipts', { onRequest: deviceGuard }, async request =>
    saveDeliveryReceipt(db, (await device(request.headers.authorization)).id, request.body));
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
  app.post('/api/devices/health', { onRequest: deviceGuard }, async request => {
    const owner = await device(request.headers.authorization);
    const { nonce, source, delivery, capture, installation } = z.object({ nonce: z.uuid(), source: sourceSchema.optional(), delivery: deliveryHealthSchema.optional(), capture: captureHealthSchema.optional(), installation: installationObservationSchema.optional() }).strict()
      .refine(value => Boolean(value.source) === Boolean(value.delivery || value.capture), 'Source and report must be provided together').parse(request.body);
    await db.query(`INSERT INTO device_health(device_id) VALUES($1) ON CONFLICT(device_id) DO UPDATE SET received_at=now(),live_valid=true`, [owner.id]);
    if (source && delivery) await db.query(`INSERT INTO device_delivery_health(device_id,source,report) VALUES($1,$2,$3)
      ON CONFLICT(device_id,source) DO UPDATE SET report=EXCLUDED.report,received_at=now()`, [owner.id, source, delivery]);
    if (source && capture) await saveCaptureHealth(db, owner.id, source, capture);
    await observeCoverage(db, owner.id, { source, capture, delivery, installation });
    return { deviceId: owner.id, nonce, checkedAt: new Date().toISOString(), state: 'connected' };
  });
  app.get('/api/team-coverage', { onRequest: readerGuard }, async request => {
    const { date, offset } = coverageQuerySchema.parse(request.query); return coverage.matrix(date, offset);
  });
  app.get('/api/team-coverage/:employeeId/observations', { onRequest: readerGuard }, async request => {
    const employeeId = z.uuid().parse((request.params as { employeeId: string }).employeeId);
    const { date, offset } = coverageQuerySchema.parse(request.query); return coverage.observations(employeeId, date, offset);
  });
  app.get('/api/work-statistics/:employeeId', { onRequest: readerGuard }, async request => {
    const employeeId = z.uuid().parse((request.params as { employeeId: string }).employeeId);
    const { date, offset, revision } = coverageQuerySchema.extend({ revision: z.coerce.number().int().min(1).optional() }).parse(request.query);
    return workStatistics.read(employeeId, date, offset, revision);
  });
  app.get('/api/devices/status', { onRequest: readerGuard }, async request => {
    const { offset } = z.object({ offset: z.coerce.number().int().min(0).default(0) }).parse(request.query);
    const result = await db.query(`SELECT d.id,d.name,e.name AS employee,d.active AND e.active AS active,h.received_at AS "lastSeenAt",
      h.live_valid AND h.received_at > now()-interval '90 seconds' AS connected
      FROM devices d JOIN employees e ON e.id=d.employee_id LEFT JOIN device_health h ON h.device_id=d.id ORDER BY e.name,d.name,d.id LIMIT 51 OFFSET $1`, [offset]);
    const devices = result.rows.slice(0, 50);
    const reports = await db.query(`SELECT device_id AS "deviceId",source,report,received_at AS "receivedAt" FROM device_delivery_health WHERE device_id=ANY($1::uuid[]) ORDER BY source`, [devices.map(item => item.id)]);
    const captureSources = await db.query(`SELECT device_id,source FROM device_capture_health WHERE device_id=ANY($1::uuid[]) ORDER BY source`, [devices.map(item => item.id)]);
    const captures = await Promise.all(captureSources.rows.map(async item => ({ deviceId: item.device_id, ...await readCaptureHealth(db, item.device_id, item.source) })));
    return { checkedAt: new Date().toISOString(), devices: devices.map(item => ({ ...item,
      capture: captures.filter(report => report.deviceId === item.id),
      sources: reports.rows.filter(report => report.deviceId === item.id).map(({ deviceId: _id, ...report }) => report) })),
      nextOffset: result.rows.length > 50 ? offset + 50 : null };
  });
  app.post('/api/devices/enroll', async request => {
    return enrollDevice(db, request.headers.authorization, request.body);
  });

  app.put('/api/chunks/:hash', { onRequest: deviceGuard }, async (request, reply) => {
    const owner = await device(request.headers.authorization);
    const hash = hashSchema.parse((request.params as { hash: string }).hash);
    if (!Buffer.isBuffer(request.body) || request.body.length === 0) throw new HttpError(400, '需要非空原件字节');
    if (digest(request.body) !== hash) throw new HttpError(422, '原件哈希不匹配');
    await raw.write(owner.id, hash, request.body);
    await db.query(`WITH stored AS (INSERT INTO chunks(device_id,hash,byte_length) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING 1)
      INSERT INTO assembly_transports(device_id,hash,kind,duplicate) SELECT $1,$2,'chunk',NOT EXISTS(SELECT 1 FROM stored)`, [owner.id, hash, request.body.length]);
    return reply.code(201).send({ hash, byteLength: request.body.length, state: 'staged' });
  });

  const commitSnapshot = archiveWriter(db, raw);
  const uploadKey = (headers: Record<string, unknown>) => z.uuid().optional().parse(headers['idempotency-key']);
  app.post('/api/snapshots', { onRequest: deviceGuard }, async request => {
    return commitSnapshot(await device(request.headers.authorization), manifestSchema.parse(request.body), uploadKey(request.headers));
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
    await recordAssemblyRecipe(db, owner.id, manifest.hash, [input.baseHash, input.appendHash]);
    return commitSnapshot(owner, manifest, uploadKey(request.headers));
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
    await recordAssemblyRecipe(db, owner.id, input.hash, input.chunks.map(part => part.hash));
    return { state: 'staged', hash: input.hash, byteLength: bytes.length };
  });

  app.get('/api/me', { onRequest: readerGuard }, async request => reader(request.headers.authorization));
  const archive = archiveQuery(db, raw);
  const conversation = conversationQuery(db, raw);
  const metrics = metricsService(db, raw, options.reportClock);
  const waits = waitsService(db, raw, options.reportClock);
  const waitReport = waitReportService(db, waits);
  app.get('/api/wait-report', { onRequest: readerGuard }, request => waitReport.read(request.query));
  app.get('/api/wait-report/export', { onRequest: readerGuard }, async (request, reply) => {
    const data = await waitReport.read(request.query);
    return reply.header('Content-Disposition', `attachment; filename="skynet-wait-report-${data.version}.json"`).type('application/json').send(data);
  });
  app.get('/api/waits', { onRequest: readerGuard }, request => waits.read(request.query));
  app.post('/api/waits/recompute', { onRequest: readerGuard }, request => waits.recompute(request.body));
  app.get('/api/waits/export', { onRequest: readerGuard }, async (request, reply) => {
    const data = await waits.export(request.query);
    return reply.header('Content-Disposition', `attachment; filename="skynet-waits-${data.version}.json"`).type('application/json').send(data);
  });
  const assembly = assemblyService(db, raw);
  const processing = processingService(db, metrics);
  app.get('/api/processing', { onRequest: readerGuard }, request => processing(request.query));
  app.get('/api/processing/export', { onRequest: readerGuard }, async (request, reply) =>
    reply.header('Content-Disposition', 'attachment; filename="skynet-processing.json"').send(await processing(request.query)));
  app.get('/api/assembly', { onRequest: readerGuard }, request => assembly.list(request.query));
  app.get('/api/snapshots/:id/assembly', { onRequest: readerGuard }, request => assembly.read(z.uuid().parse((request.params as { id: string }).id), request.query));
  app.get('/api/assembly/export', { onRequest: readerGuard }, async (request, reply) => {
    const { snapshotId, ...query } = z.object({ snapshotId: z.uuid(), version: z.string().optional() }).strict().parse(request.query);
    return reply.header('Content-Disposition', `attachment; filename="assembly-${snapshotId}.json"`).send(await assembly.export(snapshotId, query));
  });
  app.get('/api/snapshots/:id/conversation', { onRequest: readerGuard }, async request => {
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const q = z.object({ readingVersion: z.enum(['conversation-2', 'conversation-3']).optional(), cursor: z.string().optional(), includeTools: z.enum(['true', 'false']).optional(), includeContext: z.enum(['true', 'false']).optional(),
      limit: z.coerce.number().optional(), line: z.coerce.number().optional(), block: z.coerce.number().optional(),
      textOffset: z.coerce.number().optional(), parserVersion: z.string().optional() }).strict().parse(request.query);
    return conversation.page(id, conversationInputSchema.parse({ readingVersion: q.readingVersion, cursor: q.cursor, includeTools: q.includeTools === 'true', includeContext: q.includeContext === 'true', limit: q.limit,
      ...(q.line === undefined ? {} : { anchor: { line: q.line, block: q.block, textOffset: q.textOffset, parserVersion: q.parserVersion } }) }));
  });
  app.get('/api/snapshots/:id/conversation/trace', { onRequest: readerGuard }, async request => {
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const q = z.object({ cursor: z.string().optional(), turnId: z.string().optional(), limit: z.coerce.number().optional() }).strict().parse(request.query);
    return conversation.trace(id, conversationTraceInputSchema.parse(q));
  });
  app.get('/api/metrics/catalog', { onRequest: readerGuard }, () => metrics.readMetricCatalog());
  app.get('/api/metrics', { onRequest: readerGuard }, request => metrics.readMetrics(metricsQuerySchema.parse(request.query)));
  app.get('/api/team-coverage/metrics', { onRequest: readerGuard }, request => metrics.readCoverageMetrics(request.query));
  app.get('/api/snapshots/:id/metrics', { onRequest: readerGuard }, request => {
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    return metrics.readSnapshotMetrics(id, metricsQuerySchema.parse(request.query));
  });
  app.post('/api/metrics/recompute', { onRequest: readerGuard }, request => metrics.recompute(metricsQuerySchema.parse(request.body)));
  app.get('/api/metrics/export', { onRequest: readerGuard }, async (request, reply) => {
    const data = await metrics.exportMetrics(metricsQuerySchema.parse(request.query));
    return reply.header('Content-Disposition', `attachment; filename="skynet-metrics-${data.version}.json"`).type('application/json').send(data);
  });
  const analysis = analysisService(db, archive);
  const insights = sessionInsightsService(db, archive, analysis, raw);
  const activity = activityService(db,raw,insights,options.reportClock);
  app.get('/api/activity',{onRequest:readerGuard},request=>activity.read(request.query));
  app.post('/api/activity/recompute',{onRequest:readerGuard},request=>activity.recompute(request.body));
  app.get('/api/activity/export',{onRequest:readerGuard},async(request,reply)=>{const data=await activity.export(request.query);return reply.header('Content-Disposition',`attachment; filename="skynet-activity-${data.version}.json"`).type('application/json').send(data);});
  const usage = usageOutputService(db, metrics, insights);
  app.get('/api/usage-output', { onRequest: readerGuard }, request => usage.read(request.query));
  app.post('/api/usage-output/recompute', { onRequest: readerGuard }, request => usage.recompute(request.body));
  app.get('/api/usage-output/export', { onRequest: readerGuard }, async (request, reply) => {
    const data = await usage.export(request.query);
    return reply.header('Content-Disposition', `attachment; filename="skynet-usage-output-${data.version}.json"`).type('application/json').send(data);
  });
  const assessments = assessmentService(db, usage, insights, waits, options.reportClock);
  app.get('/api/assessment-models/:version', { onRequest: readerGuard }, request => assessments.model(hashSchema.parse((request.params as { version: string }).version)));
  app.get('/api/assessment-baselines/:version', { onRequest: readerGuard }, request => assessments.baseline(hashSchema.parse((request.params as { version: string }).version)));
  app.get('/api/assessments/:id', { onRequest: readerGuard }, request => assessments.read(z.uuid().parse((request.params as { id: string }).id), request.query));
  app.post('/api/assessments/:id/recompute', { onRequest: readerGuard }, request => assessments.recompute(z.uuid().parse((request.params as { id: string }).id), request.body));
  app.get('/api/assessments/:id/export', { onRequest: readerGuard }, async (request, reply) => {
    const value = await assessments.export(z.uuid().parse((request.params as { id: string }).id), request.query);
    return reply.header('Content-Disposition', `attachment; filename="assessment-${value.version}.json"`).send(value);
  });
  app.get('/api/snapshots/:id/insights', { onRequest: readerGuard }, async request => insights.read(z.uuid().parse((request.params as {id:string}).id), sessionInsightsQuery.parse(request.query)));
  const reports = reportService(db, analysis,workStatistics, options.reportClock);
  const workViews = workViewService(db, reports, options.reportClock);
  const reportQuery = z.object({ offset: z.coerce.number().int().min(0).max(100000).default(0),
    revision: z.coerce.number().int().min(1).optional() }).strict();
  app.get('/api/daily-reports', { onRequest: readerGuard }, async request => reports.list(reportQuery.parse(request.query).offset));
  app.get('/api/daily-report-employees', { onRequest: readerGuard }, async request => reports.employees(reportQuery.parse(request.query).offset));
  app.get('/api/daily-reports/:employeeId/:date', { onRequest: readerGuard }, async request => {
    const { employeeId, date } = z.object({ employeeId: z.uuid(), date: reportDate }).parse(request.params);
    const { offset, revision } = reportQuery.parse(request.query);
    return reports.read(employeeId, date, offset, revision);
  });
  app.post('/api/daily-reports/:employeeId/:date', { onRequest: readerGuard }, async (request, reply) => {
    z.object({}).strict().parse(request.body ?? {});
    const { employeeId, date } = z.object({ employeeId: z.uuid(), date: reportDate }).parse(request.params);
    return reply.code(202).send(await reports.request(employeeId, date));
  });
  app.get('/api/daily-reports/:employeeId/:date/corrections',{onRequest:readerGuard},async request=>{
    const {employeeId,date}=z.object({employeeId:z.uuid(),date:reportDate}).parse(request.params);
    const {offset}=reportQuery.omit({revision:true}).parse(request.query);return reports.correctionHistory(employeeId,date,offset);
  });
  app.post('/api/daily-reports/:employeeId/:date/corrections',{onRequest:readerGuard},async(request,reply)=>{
    const {employeeId,date}=z.object({employeeId:z.uuid(),date:reportDate}).parse(request.params);
    const actor=await reader(request.headers.authorization);return reply.code(202).send(await reports.correct(employeeId,date,actor.id,request.body));
  });
  app.get('/api/work-views', { onRequest: readerGuard }, async request => {
    const { offset } = reportQuery.parse(request.query); return workViews.list(offset);
  });
  app.get('/api/work-projects', { onRequest: readerGuard }, async request => workViews.projects(reportQuery.parse(request.query).offset));
  app.get('/api/work-view', { onRequest: readerGuard }, async request => {
    const { offset, revision, ...selection } = workViewQuery.parse(request.query); return workViews.read(selection, offset, revision);
  });
  app.post('/api/work-view', { onRequest: readerGuard }, async (request, reply) => {
    z.object({}).strict().parse(request.body ?? {});
    const selection = workViewQuery.omit({ offset: true, revision: true }).parse(request.query);
    return reply.code(202).send(await workViews.request(selection));
  });
  let reporting = false;
  const tickReports = async () => {
    if (reporting) return; reporting = true;
    try { await reports.tick(); await workViews.tick(); } catch (error) { app.log.error(error, 'Report scheduling failed'); }
    finally { reporting = false; }
  };
  const reportTimer = setInterval(() => { void tickReports(); }, 5000); reportTimer.unref();
  app.addHook('onReady', async () => { void tickReports(); });
  app.addHook('onClose', async () => { clearInterval(reportTimer); while (reporting) await new Promise(resolve => setTimeout(resolve, 20)); });
  // Preparation happens after archive commit, on a separate bounded poll; never on ACK.
  let preparing: Promise<void> | undefined;
  const analysisTimer = setInterval(() => {
    if (!preparing) preparing = analysis.enqueueLatestIfReady().catch(() => {}).finally(() => { preparing = undefined; });
  }, 1000);
  analysisTimer.unref();
  app.addHook('onClose', async () => { clearInterval(analysisTimer); await preparing; });
  app.get('/api/analysis/operations', { onRequest: readerGuard }, async request => {
    const { offset } = z.object({ offset: z.coerce.number().int().min(0).max(100000).default(0) }).strict().parse(request.query);
    return analysis.operations(offset);
  });
  app.post('/api/analysis/:id/retry', { onRequest: readerGuard }, async request => {
    z.object({}).strict().parse(request.body ?? {});
    const actor = await reader(request.headers.authorization);
    return analysis.retry(z.uuid().parse((request.params as { id: string }).id), actor.id);
  });
  app.get('/api/snapshots/:id/analysis', { onRequest: readerGuard }, async request => {
    const id = z.uuid().parse((request.params as { id: string }).id);
    const { offset } = z.object({ offset: z.coerce.number().int().min(0).max(100000).default(0) }).strict().parse(request.query);
    return analysis.list(id, offset);
  });
  app.post('/api/snapshots/:id/analysis', { onRequest: readerGuard }, async (request, reply) => {
    const id = z.uuid().parse((request.params as { id: string }).id);
    z.object({}).strict().parse(request.body ?? {});
    const actor = await reader(request.headers.authorization);
    return reply.code(202).send(await analysis.request(id, actor.id));
  });
  app.get('/api/analysis/:id', { onRequest: readerGuard }, async request => analysis.get(z.uuid().parse((request.params as { id: string }).id)));
  app.get('/api/activity-statistics', { onRequest: readerGuard }, async request => {
    const { offset } = z.object({ offset: z.coerce.number().int().min(0).default(0) }).parse(request.query);
    return archive.statistics(offset);
  });
  app.get('/api/snapshots/:id/capture-status', { onRequest: readerGuard }, async request => {
    const { offset } = z.object({ offset: z.coerce.number().int().min(0).default(0) }).parse(request.query);
    return archive.captureStatus((request.params as { id: string }).id, offset);
  });
  app.get('/api/devices/:id/capture-status', { onRequest: readerGuard }, async request => {
    const { source, offset } = z.object({ source: sourceSchema, offset: z.coerce.number().int().min(0).default(0) }).parse(request.query);
    return readCaptureHealth(db, z.uuid().parse((request.params as { id: string }).id), source, undefined, offset);
  });
  app.get('/api/search', { onRequest: readerGuard }, async request => {
    const query = request.query as Record<string, unknown>;
    return archive.search(searchSchema.parse({ ...query, ...(query.limit === undefined ? {} : { limit: Number(query.limit) }) }));
  });
  app.get('/api/sessions', { onRequest: readerGuard }, async request => {
    const query = z.object({ cursor: z.string().max(1024).optional(), limit: z.coerce.number().int().min(1).max(100).default(100) }).parse(request.query);
    return archive.sessions(query.cursor, query.limit);
  });
  app.get('/api/snapshots/:id', { onRequest: readerGuard }, async request => {
    const { offset, summary } = z.object({ offset: z.coerce.number().int().min(0).default(0), summary: z.enum(['true', 'false']).default('false') }).parse(request.query);
    return archive.detail((request.params as { id: string }).id, offset, summary === 'true');
  });
  app.get('/api/snapshots/:id/location', { onRequest: readerGuard }, async request => {
    const query = request.query as Record<string, unknown>;
    const location = locationSchema.parse({ ...query, ...Object.fromEntries(['offset', 'line', 'block', 'textOffset']
      .filter(key => query[key] !== undefined).map(key => [key, Number(query[key])])) });
    return archive.locationPage((request.params as { id: string }).id, location);
  });
  app.get('/api/snapshots/:id/evidence', { onRequest: readerGuard }, async request => {
    const query = z.object({ offset: z.coerce.number().int().min(0).default(0), textOffset: z.coerce.number().int().min(0).default(0) }).parse(request.query);
    return archive.evidencePage((request.params as { id: string }).id, query.offset, query.textOffset);
  });
  app.get('/api/snapshots/:id/manifest', { onRequest: readerGuard }, async request => {
    const { textOffset } = z.object({ textOffset: z.coerce.number().int().min(0).default(0) }).parse(request.query);
    return archive.manifestPage((request.params as { id: string }).id, textOffset);
  });
  app.get('/api/snapshots/:id/history', { onRequest: readerGuard }, async request => {
    const { offset } = z.object({ offset: z.coerce.number().int().min(0).default(0) }).parse(request.query);
    return archive.history((request.params as { id: string }).id, offset);
  });
  app.get('/api/snapshots/:id/materials/:materialId/view', { onRequest: readerGuard }, async request => {
    const { id, materialId } = request.params as { id: string; materialId: string };
    const { offset, limit } = z.object({ offset: z.coerce.number().int().min(0).default(0), limit: z.coerce.number().int().min(1).max(32_768).default(32_768) }).parse(request.query);
    return archive.materialPage(id, materialId, offset, limit);
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
  if (options.publicOrigin) await registerMcp(app, db, archive, options.publicOrigin, analysis, reports, coverage, workStatistics, workViews,operations,conversation,metrics,assembly,processing,insights,waits,usage,waitReport,activity,assessments);
  if (options.webDirectory) {
    await app.register(fastifyStatic, { root: resolve(options.webDirectory), wildcard: false });
  }
  return app;
}
