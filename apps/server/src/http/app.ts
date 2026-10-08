import { randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import staticFiles from '@fastify/static';
import Fastify, { LogController, type FastifyInstance, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { dockerActionRequestSchema, historyRangeSchema, smartTestRequestSchema, youtubeCommandSchema } from '@labdeck/contracts';
import { YoutubeMonitor, youtubeOperation } from '../integrations/host/youtube-control.js';
import { LoginLimiter } from '../auth/login-limiter.js';
import { verifyPassword } from '../auth/password.js';
import { PreloginCsrfStore } from '../auth/prelogin-csrf.js';
import { SessionStore } from '../auth/session-store.js';
import { type AppConfig } from '../config/config.js';
import { databaseIsReady, openDatabase } from '../db/database.js';
import { HostStateService, HostStateStore } from '../core/state.js';
import { HostQueries } from '../core/queries.js';
import { HostMonitor } from '../integrations/host/monitor.js';
import { SmartMonitor } from '../integrations/host/smart-monitor.js';
import { fileOperation } from '../integrations/host/file-control.js';
import { SmartStateStore } from '../integrations/host/smart-state.js';
import { runDockerAction } from '../integrations/host/docker-action-control.js';
import { startSmartTest } from '../integrations/host/smart-test-control.js';
import { ReadOnlyTransport } from '../core/read-only-transport.js';
import { JellyfinAdapter } from '../integrations/jellyfin/adapter.js';
import { JellyfinMonitor } from '../integrations/jellyfin/monitor.js';
import { JellyfinStateStore } from '../integrations/jellyfin/state.js';
import { ArrTransport } from '../integrations/arr/common/transport.js';
import { ArrAdapter } from '../integrations/arr/adapter.js';
import { ArrMonitor } from '../integrations/arr/monitor.js';
import { ArrStateStore } from '../integrations/arr/state.js';
import { ProwlarrAdapter, ProwlarrTransport } from '../integrations/prowlarr/adapter.js';
import { ProwlarrMonitor } from '../integrations/prowlarr/monitor.js';
import { ProwlarrStateStore } from '../integrations/prowlarr/state.js';

const loginSchema = z.object({ password: z.string().min(1).max(1024), csrfToken: z.string().min(20).max(256) }).strict();
const filePathSchema = z.string().min(1).max(2048);
const uploadIdSchema = z.string().regex(/^[a-f0-9]{32}$/);
const fileRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list'), path: z.string().max(2048), cursor: z.string().max(255).optional() }).strict(),
  z.object({ action: z.literal('start'), path: filePathSchema, size: z.number().int().min(0).max(100 * 1024 ** 3), resumeId: uploadIdSchema.optional() }).strict(),
  z.object({ action: z.literal('chunk'), uploadId: uploadIdSchema, offset: z.number().int().nonnegative(), data: z.string().min(1).max(4 * 1024 ** 2 * 4 / 3 + 8) }).strict(),
  z.object({ action: z.literal('finish'), uploadId: uploadIdSchema }).strict(),
  z.object({ action: z.literal('rename'), from: filePathSchema, to: filePathSchema }).strict(),
  z.object({ action: z.literal('delete'), path: filePathSchema }).strict(),
  z.object({ action: z.literal('mkdir'), path: filePathSchema }).strict()
]);
function exactEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function requestHost(request: FastifyRequest): string {
  return (request.headers.host ?? '').trim().toLowerCase();
}

export async function buildApp(config: AppConfig): Promise<FastifyInstance> {
  const database = openDatabase(config.databasePath);
  const hostState = new HostStateService(new HostStateStore(database));
  const smartState = new SmartStateStore(database);
  const jellyfinState = new JellyfinStateStore(database);
  const arrStates = (config.arr ?? []).map((item) => ({ config: item, state: new ArrStateStore(database, item.kind) }));
  const prowlarrState = new ProwlarrStateStore(database);
  const hostQueries = new HostQueries(database, config.hostSnapshotPath !== undefined, () => hostState.historyAvailable && smartState.historyAvailable && jellyfinState.historyAvailable && arrStates.every(({ state }) => state.historyAvailable) && prowlarrState.historyAvailable, Date.now,
    config.jellyfin ? { id: config.jellyfin.id, name: config.jellyfin.name, browserUrl: config.jellyfin.browserUrl } : undefined,
    (config.arr ?? []).map(({ id, name, browserUrl }) => ({ id, name, browserUrl })),
    config.prowlarr ? { id: 'prowlarr', name: 'Prowlarr', browserUrl: config.prowlarr.browserUrl } : undefined,
    config.expectedRunningContainers, config.smartSnapshotPath !== undefined, Boolean(config.smartControlSocketPath && !config.demoMode));
  const hostMonitor = config.hostSnapshotPath ? new HostMonitor(config.hostSnapshotPath, hostState) : undefined;
  const smartMonitor = config.smartSnapshotPath ? new SmartMonitor(config.smartSnapshotPath, smartState) : undefined;
  const jellyfinMonitor = config.jellyfin ? new JellyfinMonitor(new JellyfinAdapter(new ReadOnlyTransport(config.jellyfin.baseUrl, config.jellyfin.apiKey)), jellyfinState) : undefined;
  const arrMonitors = arrStates.map(({ config: item, state }) => new ArrMonitor(new ArrAdapter(item.kind, new ArrTransport(item.baseUrl, item.apiKey)), state));
  const prowlarrMonitor = config.prowlarr ? new ProwlarrMonitor(new ProwlarrAdapter(new ProwlarrTransport(config.prowlarr.baseUrl, config.prowlarr.apiKey)), prowlarrState) : undefined;
  const sessions = new SessionStore(database);
  const youtubeMonitor = config.youtubeSocketPath && !config.demoMode ? new YoutubeMonitor(config.youtubeSocketPath) : undefined;
  if (config.passwordHash) sessions.reconcilePasswordHash(config.passwordHash);
  const prelogin = new PreloginCsrfStore();
  const limiter = new LoginLimiter();
  const secureCookies = !config.demoMode;
  const sessionCookie = secureCookies ? '__Host-labdeck_session' : 'labdeck_dev_session';
  const preloginCookie = secureCookies ? '__Host-labdeck_prelogin' : 'labdeck_dev_prelogin';
  const app = Fastify({
    trustProxy: false,
    logger: config.logLevel === 'silent' ? false : {
      level: config.logLevel,
      redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers.set-cookie']
    },
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: 64 * 1024
  });
  let checkpointTimer: ReturnType<typeof setInterval> | undefined;
  let dockerActionInFlight = false;
  let fileRequestsInFlight = 0;
  let youtubeRequestsInFlight = 0;
  app.addHook('onReady', () => { youtubeMonitor?.start(); });
  app.addHook('onClose', async () => { await youtubeMonitor?.stop(); });
  app.get('/api/v1/youtube', (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return youtubeMonitor?.read() ?? { configured: false, available: false, observedAt: null, jobs: [] };
  });
  app.post('/api/v1/youtube', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const token = request.cookies[sessionCookie];
    const csrf = typeof request.headers['x-csrf-token'] === 'string' ? request.headers['x-csrf-token'] : undefined;
    if (!request.headers.origin || !exactEqual(request.headers.origin, config.canonicalOrigin) || !sessions.verifyCsrf(token, csrf)) return reply.code(403).send({ error: 'forbidden' });
    const parsed = youtubeCommandSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid-request' });
    if (!youtubeMonitor || !config.youtubeSocketPath) return reply.code(503).send({ error: 'not-configured' });
    if (youtubeRequestsInFlight >= 2) return reply.code(429).send({ error: 'busy' });
    youtubeRequestsInFlight++;
    try { return reply.code(202).send(await youtubeOperation(config.youtubeSocketPath, parsed.data)); }
    catch { return reply.code(409).send({ error: 'worker-unavailable-or-rejected' }); }
    finally { youtubeRequestsInFlight--; }
  });

  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: { directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"], imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"], objectSrc: ["'none'"], baseUri: ["'none'"], frameAncestors: ["'none'"]
    } },
    crossOriginEmbedderPolicy: false
  });

  app.addHook('onRequest', (request, reply, done) => {
    if (!config.allowedHosts.has(requestHost(request))) {
      void reply.code(400).send({ error: 'invalid-request' });
      return;
    }
    done();
  });
  app.addHook('onReady', (done) => { hostMonitor?.start(); smartMonitor?.start(); jellyfinMonitor?.start(); for (const monitor of arrMonitors) monitor.start(); prowlarrMonitor?.start(); checkpointTimer = setInterval(() => { try { database.pragma('wal_checkpoint(PASSIVE)'); } catch { hostState.historyAvailable = false; } }, 60 * 60_000); checkpointTimer.unref(); done(); });
  app.addHook('onClose', async () => { if (checkpointTimer) clearInterval(checkpointTimer); await Promise.all([hostMonitor?.stop(), smartMonitor?.stop(), jellyfinMonitor?.stop(), ...arrMonitors.map((monitor) => monitor.stop()), prowlarrMonitor?.stop()]); database.close(); });
  app.setErrorHandler((error, _request, reply) => {
    if (typeof error === 'object' && error !== null && 'validation' in error) { void reply.code(400).send({ error: 'invalid-request' }); return; }
    app.log.error({ err: { name: error instanceof Error ? error.name : 'UnknownError' } }, 'request failed');
    void reply.code(500).send({ error: 'internal' });
  });

  app.get('/health/live', () => ({ ok: true }));
  app.get('/health/ready', (_request, reply) => {
    const ok = databaseIsReady(database) && config.passwordHash !== undefined;
    return reply.code(ok ? 200 : 503).send({ ok });
  });

  app.get('/api/v1/session', (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const sessionToken = request.cookies[sessionCookie];
    const sessionCsrf = sessions.rotateCsrf(sessionToken);
    if (sessionCsrf) return { authenticated: true, csrfToken: sessionCsrf, demoMode: config.demoMode };
    const csrf = prelogin.issue();
    reply.setCookie(preloginCookie, csrf.context, { httpOnly: true, secure: secureCookies, sameSite: 'strict', path: '/', maxAge: 600 });
    return { authenticated: false, csrfToken: csrf.token, demoMode: config.demoMode };
  });

  app.post('/api/v1/session', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const origin = request.headers.origin;
    if (!origin || !exactEqual(origin, config.canonicalOrigin)) return reply.code(403).send({ error: 'forbidden' });
    if (!limiter.allow(request.ip)) return reply.code(429).send({ error: 'rate-limited' });
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success || !prelogin.consume(request.cookies[preloginCookie], parsed.data.csrfToken)) {
      return reply.code(403).send({ error: 'invalid-credentials' });
    }
    if (!config.passwordHash || !(await verifyPassword(config.passwordHash, parsed.data.password))) {
      return reply.code(config.passwordHash ? 401 : 503).send({ error: config.passwordHash ? 'invalid-credentials' : 'not-configured' });
    }
    const session = sessions.create();
    reply.clearCookie(preloginCookie, { path: '/' });
    reply.setCookie(sessionCookie, session.token, { httpOnly: true, secure: secureCookies, sameSite: 'strict', path: '/', maxAge: 8 * 60 * 60 });
    return { authenticated: true, csrfToken: session.csrfToken, expiresAt: new Date(session.expiresAt).toISOString() };
  });

  app.delete('/api/v1/session', (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const origin = request.headers.origin;
    const token = request.cookies[sessionCookie];
    const csrfToken = typeof request.headers['x-csrf-token'] === 'string' ? request.headers['x-csrf-token'] : undefined;
    if (!origin || !exactEqual(origin, config.canonicalOrigin) || !sessions.verifyCsrf(token, csrfToken)) {
      return reply.code(403).send({ error: 'forbidden' });
    }
    sessions.delete(token);
    reply.clearCookie(sessionCookie, { path: '/' });
    return reply.code(204).send();
  });

  app.addHook('preHandler', (request, reply, done) => {
    if (!request.url.startsWith('/api/v1/') || request.url === '/api/v1/session') return done();
    if (!sessions.verify(request.cookies[sessionCookie])) { void reply.code(401).send({ error: 'unauthorized' }); return; }
    done();
  });

  app.get('/api/v1/overview', (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return hostQueries.overview();
  });
  app.get('/api/v1/system', (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const range = historyRangeSchema.safeParse((request.query as { range?: string }).range).data ?? '1h';
    return hostQueries.system(range);
  });
  app.get('/api/v1/storage', (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const range = historyRangeSchema.safeParse((request.query as { range?: string }).range).data ?? '1h';
    return hostQueries.storage(range);
  });
  app.post('/api/v1/storage/smart-tests', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const origin = request.headers.origin;
    const token = request.cookies[sessionCookie];
    const csrfToken = typeof request.headers['x-csrf-token'] === 'string' ? request.headers['x-csrf-token'] : undefined;
    if (!origin || !exactEqual(origin, config.canonicalOrigin) || !sessions.verifyCsrf(token, csrfToken)) return reply.code(403).send({ error: 'forbidden' });
    if (!config.smartControlSocketPath || config.demoMode) return reply.code(503).send({ error: 'not-configured' });
    const parsed = smartTestRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid-request' });
    const smart = hostQueries.smart();
    const disk = smart.disks.find((item) => item.id === parsed.data.diskId);
    if (!disk || disk.protocol !== 'ATA' || disk.state !== 'ok' || disk.selfTest?.state === 'running' || smart.freshness !== 'fresh' || smart.errorCode) return reply.code(409).send({ error: 'disk-unavailable' });
    try {
      const status = await startSmartTest(config.smartControlSocketPath, parsed.data.diskId, parsed.data.type);
      if (status === 'started') return reply.code(202).send({ status });
      if (status === 'rate-limited') return reply.code(429).send({ status });
      return reply.code(409).send({ status: status === 'device-unavailable' ? status : 'rejected' });
    } catch { return reply.code(503).send({ error: 'control-unavailable' }); }
  });
  app.get('/api/v1/events', (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const query = request.query as { limit?: string; before?: string };
    const limit = query.limit === undefined ? 50 : Number.parseInt(query.limit, 10);
    const before = query.before === undefined ? undefined : Number.parseInt(query.before, 10);
    if (!Number.isSafeInteger(limit) || (before !== undefined && !Number.isSafeInteger(before))) return reply.code(400).send({ error: 'invalid-request' });
    return hostQueries.events(limit, before);
  });
  app.get('/api/v1/media', (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return hostQueries.media();
  });
  app.get('/api/v1/downloads', (_request, reply) => { reply.header('Cache-Control', 'no-store'); return hostQueries.downloads(); });
  app.get('/api/v1/containers', (_request, reply) => { reply.header('Cache-Control', 'no-store'); return { ...hostQueries.containers(), controls: { available: Boolean(config.dockerControlSocketPath && !config.demoMode), containers: [...(config.dockerControlContainers ?? [])], projects: [...(config.dockerControlProjects ?? [])] } }; });
  app.post('/api/v1/containers/actions', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const origin = request.headers.origin;
    const csrfToken = typeof request.headers['x-csrf-token'] === 'string' ? request.headers['x-csrf-token'] : undefined;
    if (!origin || !exactEqual(origin, config.canonicalOrigin) || !sessions.verifyCsrf(request.cookies[sessionCookie], csrfToken)) return reply.code(403).send({ error: 'forbidden' });
    if (!config.dockerControlSocketPath || config.demoMode) return reply.code(503).send({ error: 'not-configured' });
    const parsed = dockerActionRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid-request' });
    const target = parsed.data;
    const inventory = hostQueries.containers();
    if (inventory.freshness !== 'fresh' || inventory.errorCode || inventory.inventoryComplete !== true) return reply.code(409).send({ error: 'inventory-unavailable' });
    if (target.kind === 'container' && (!/^[a-f0-9]{64}$/.test(target.id) || !inventory.containers.some((item) => item.id === target.id && config.dockerControlContainers?.has(item.name)))) return reply.code(409).send({ error: 'target-unavailable' });
    if (target.kind === 'project' && (!config.dockerControlProjects?.has(target.id) || !inventory.containers.some((item) => item.composeProject === target.id))) return reply.code(409).send({ error: 'target-unavailable' });
    if (dockerActionInFlight) return reply.code(429).send({ error: 'action-in-progress' });
    const id = randomUUID(), requestedAt = Date.now();
    database.prepare('INSERT INTO action_audit(id,kind,target_id,action,requested_at,result) VALUES (?,?,?,?,?,?)').run(id, target.kind, target.id, target.action, requestedAt, 'requested');
    dockerActionInFlight = true;
    let status: 'completed' | 'rejected';
    try { status = await runDockerAction(config.dockerControlSocketPath, target); }
    catch { database.prepare('UPDATE action_audit SET completed_at=?,result=? WHERE id=?').run(Date.now(), 'unavailable', id); return reply.code(503).send({ id, error: 'control-unavailable' }); }
    finally { dockerActionInFlight = false; }
    database.prepare('UPDATE action_audit SET completed_at=?,result=? WHERE id=?').run(Date.now(), status, id);
    database.prepare('DELETE FROM action_audit WHERE id IN (SELECT id FROM action_audit ORDER BY requested_at DESC LIMIT -1 OFFSET 1000)').run();
    return reply.code(status === 'completed' ? 200 : 409).send({ id, status });
  });
  app.get('/api/v1/containers/actions', (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const rows = database.prepare("SELECT id,kind,target_id AS targetId,action,requested_at AS requestedAt,completed_at AS completedAt,result FROM action_audit WHERE kind IN ('container','project') ORDER BY requested_at DESC LIMIT 20").all() as { id: string; kind: string; targetId: string; action: string; requestedAt: number; completedAt: number | null; result: string }[];
    return { actions: rows.map((row) => ({ ...row, requestedAt: new Date(row.requestedAt).toISOString(), completedAt: row.completedAt === null ? null : new Date(row.completedAt).toISOString() })) };
  });
  app.get('/api/v1/network', (_request, reply) => { reply.header('Cache-Control', 'no-store'); return hostQueries.network(); });
  app.get('/api/v1/files/shares', (_request, reply) => { reply.header('Cache-Control', 'no-store'); return { ...hostQueries.fileShares(), control: { available: Boolean(config.fileControlSocketPath && !config.demoMode), shareId: config.fileControlShareId ?? null } }; });
  app.post('/api/v1/files/operations', { bodyLimit: 6 * 1024 * 1024 }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const origin = request.headers.origin;
    const csrfToken = typeof request.headers['x-csrf-token'] === 'string' ? request.headers['x-csrf-token'] : undefined;
    if (!origin || !exactEqual(origin, config.canonicalOrigin) || !sessions.verifyCsrf(request.cookies[sessionCookie], csrfToken)) return reply.code(403).send({ error: 'forbidden' });
    if (!config.fileControlSocketPath || !config.fileControlShareId || config.demoMode) return reply.code(503).send({ error: 'not-configured' });
    const parsed = fileRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid-request' });
    const health = hostQueries.fileShares();
    if (health.freshness !== 'fresh' || !health.shares.some((share) => share.id === config.fileControlShareId && share.state === 'ok')) return reply.code(409).send({ error: 'share-unavailable' });
    if (fileRequestsInFlight >= 2) return reply.code(429).send({ error: 'file-service-busy' });
    const action = parsed.data.action;
    const auditId = action !== 'list' && action !== 'chunk' ? randomUUID() : undefined;
    if (auditId) database.prepare('INSERT INTO action_audit(id,kind,target_id,action,requested_at,result) VALUES (?,?,?,?,?,?)').run(auditId, 'file', config.fileControlShareId, action, Date.now(), 'requested');
    fileRequestsInFlight += 1;
    try {
      const result = await fileOperation(config.fileControlSocketPath, parsed.data);
      if (auditId) {
        database.prepare('UPDATE action_audit SET completed_at=?,result=? WHERE id=?').run(Date.now(), result.ok ? 'completed' : 'rejected', auditId);
        database.prepare('DELETE FROM action_audit WHERE id IN (SELECT id FROM action_audit ORDER BY requested_at DESC LIMIT -1 OFFSET 1000)').run();
      }
      if (!result.ok) return reply.code(result.error === 'collision' ? 409 : 400).send({ error: result.error ?? 'rejected' });
      return result;
    } catch {
      if (auditId) database.prepare('UPDATE action_audit SET completed_at=?,result=? WHERE id=?').run(Date.now(), 'unavailable', auditId);
      return reply.code(503).send({ error: 'file-service-unavailable' });
    } finally { fileRequestsInFlight -= 1; }
  });
  app.get('/api/v1/files/actions', (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const rows = database.prepare("SELECT id,action,requested_at AS requestedAt,completed_at AS completedAt,result FROM action_audit WHERE kind='file' ORDER BY requested_at DESC LIMIT 20").all() as { id: string; action: string; requestedAt: number; completedAt: number | null; result: string }[];
    return { actions: rows.map((row) => ({ ...row, requestedAt: new Date(row.requestedAt).toISOString(), completedAt: row.completedAt === null ? null : new Date(row.completedAt).toISOString() })) };
  });
  app.get('/api/v1/problems', (_request, reply) => { reply.header('Cache-Control', 'no-store'); return hostQueries.problems(); });
  app.get('/api/v1/problems/:id', (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const { id } = request.params as { id: string };
    if (!/^[a-f0-9]{24}$/.test(id)) return reply.code(400).send({ error: 'invalid-request' });
    const detail = hostQueries.problem(id);
    return detail ?? reply.code(404).send({ error: 'not-current' });
  });
  app.get('/api/v1/metrics', (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const parsed = z.object({ name: z.enum(['library.movies', 'library.series', 'library.episodes', 'filesystem.used', 'filesystem.available']), range: historyRangeSchema, entity: z.string().regex(/^[a-zA-Z0-9:_-]{1,80}$/).optional() }).strict().safeParse(request.query);
    if (!parsed.success || parsed.data.name.startsWith('filesystem.') && !parsed.data.entity) return reply.code(400).send({ error: 'invalid-request' });
    return { name: parsed.data.name, range: parsed.data.range, points: hostQueries.metric(parsed.data.name, parsed.data.range, parsed.data.name.startsWith('library.') ? 'jellyfin' : parsed.data.entity, parsed.data.name.startsWith('library.') ? 'jellyfin' : 'host') };
  });
  app.get('/api/v1/settings', (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return hostQueries.settings(config.demoMode);
  });
  if (existsSync(config.webRoot)) {
    await app.register(staticFiles, { root: config.webRoot, wildcard: false, index: false, immutable: true, maxAge: '1h' });
    app.addHook('onSend', (_request, reply, payload, done) => {
      if (String(reply.getHeader('content-type') ?? '').includes('text/html')) reply.header('Cache-Control', 'no-store');
      done(null, payload);
    });
    app.setNotFoundHandler((request, reply) => {
      if (request.method === 'GET' && !request.url.startsWith('/api/') && !request.url.startsWith('/health/')) {
        return reply.header('Cache-Control', 'no-store').sendFile('index.html', { maxAge: 0, immutable: false });
      }
      return reply.code(404).send({ error: 'not-found' });
    });
  }
  return app;
}
