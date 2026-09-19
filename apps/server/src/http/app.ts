import { timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import staticFiles from '@fastify/static';
import Fastify, { LogController, type FastifyInstance, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { LoginLimiter } from '../auth/login-limiter.js';
import { verifyPassword } from '../auth/password.js';
import { PreloginCsrfStore } from '../auth/prelogin-csrf.js';
import { SessionStore } from '../auth/session-store.js';
import { type AppConfig } from '../config/config.js';
import { databaseIsReady, openDatabase } from '../db/database.js';
import { HostStateService, HostStateStore } from '../core/state.js';
import { HostQueries } from '../core/queries.js';
import { HostMonitor } from '../integrations/host/monitor.js';

const loginSchema = z.object({ password: z.string().min(1).max(1024), csrfToken: z.string().min(20).max(256) }).strict();
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
  const hostQueries = new HostQueries(database, config.hostSnapshotPath !== undefined, () => hostState.historyAvailable);
  const hostMonitor = config.hostSnapshotPath ? new HostMonitor(config.hostSnapshotPath, hostState) : undefined;
  const sessions = new SessionStore(database);
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
  app.addHook('onReady', (done) => { hostMonitor?.start(); done(); });
  app.addHook('onClose', async () => { await hostMonitor?.stop(); database.close(); });
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
    const range = (request.query as { range?: string }).range === '24h' ? '24h' : '1h';
    return hostQueries.system(range);
  });
  app.get('/api/v1/storage', (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const range = (request.query as { range?: string }).range === '24h' ? '24h' : '1h';
    return hostQueries.storage(range);
  });
  app.get('/api/v1/events', (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const query = request.query as { limit?: string; before?: string };
    const limit = query.limit === undefined ? 50 : Number.parseInt(query.limit, 10);
    const before = query.before === undefined ? undefined : Number.parseInt(query.before, 10);
    if (!Number.isSafeInteger(limit) || (before !== undefined && !Number.isSafeInteger(before))) return reply.code(400).send({ error: 'invalid-request' });
    return hostQueries.events(limit, before);
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
