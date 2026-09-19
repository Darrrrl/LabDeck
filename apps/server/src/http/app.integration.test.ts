import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { hashPassword } from '../auth/password.js';
import { buildApp } from './app.js';

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
let passwordHash: string;
beforeAll(async () => { passwordHash = await hashPassword('correct horse battery staple'); });
afterEach(async () => { await Promise.all(apps.splice(0).map(async (app) => app.close())); });

function config(overrides: Record<string, unknown> = {}) {
  return {
    host: '127.0.0.1', port: 7337, logLevel: 'silent' as const, databasePath: ':memory:', webRoot: '/definitely/not/present',
    canonicalOrigin: 'https://labdeck.test', allowedHosts: new Set(['labdeck.test']),
    passwordHash, demoMode: false, ...overrides
  };
}

function cookieValue(setCookie: string | string[] | undefined, name: string): string {
  const values = Array.isArray(setCookie) ? setCookie : [setCookie ?? ''];
  const match = values.join(';').match(new RegExp(`${name}=([^;]+)`));
  if (!match?.[1]) throw new Error(`Missing ${name} cookie`);
  return `${name}=${match[1]}`;
}

async function login(app: Awaited<ReturnType<typeof buildApp>>) {
  const preflight = await app.inject({ method: 'GET', url: '/api/v1/session', headers: { host: 'labdeck.test' } });
  return app.inject({
    method: 'POST', url: '/api/v1/session',
    headers: { host: 'labdeck.test', origin: 'https://labdeck.test', cookie: cookieValue(preflight.headers['set-cookie'], '__Host-labdeck_prelogin') },
    payload: { password: 'correct horse battery staple', csrfToken: preflight.json<{ csrfToken: string }>().csrfToken }
  });
}

describe('foundation HTTP API', () => {
  it('exposes only boolean liveness and readiness', async () => {
    const app = await buildApp(config()); apps.push(app);
    const live = await app.inject({ method: 'GET', url: '/health/live', headers: { host: 'labdeck.test' } });
    const ready = await app.inject({ method: 'GET', url: '/health/ready', headers: { host: 'labdeck.test' } });
    expect(live.json()).toEqual({ ok: true }); expect(ready.json()).toEqual({ ok: true });
  });

  it('fails readiness when auth is not configured', async () => {
    const app = await buildApp(config({ passwordHash: undefined })); apps.push(app);
    const response = await app.inject({ method: 'GET', url: '/health/ready', headers: { host: 'labdeck.test' } });
    expect(response.statusCode).toBe(503); expect(response.json()).toEqual({ ok: false });
  });

  it('requires authentication for operational state', async () => {
    const app = await buildApp(config()); apps.push(app);
    const response = await app.inject({ method: 'GET', url: '/api/v1/overview', headers: { host: 'labdeck.test' } });
    expect(response.statusCode).toBe(401); expect(response.json()).toEqual({ error: 'unauthorized' });
  });

  it('logs in with bound CSRF and sets a hardened cookie', async () => {
    const app = await buildApp(config()); apps.push(app);
    const response = await login(app);
    expect(response.statusCode).toBe(200);
    expect(String(response.headers['set-cookie'])).toContain('__Host-labdeck_session=');
    expect(String(response.headers['set-cookie'])).toContain('HttpOnly');
    expect(String(response.headers['set-cookie'])).toContain('Secure');
    expect(String(response.headers['set-cookie'])).toContain('SameSite=Strict');
    const overview = await app.inject({ method: 'GET', url: '/api/v1/overview', headers: { host: 'labdeck.test', cookie: cookieValue(response.headers['set-cookie'], '__Host-labdeck_session') } });
    expect(overview.statusCode).toBe(200); expect(overview.headers['cache-control']).toBe('no-store');
  });

  it('requires authenticated CSRF for logout and invalidates the session', async () => {
    const app = await buildApp(config()); apps.push(app);
    const loggedIn = await login(app);
    const sessionCookie = cookieValue(loggedIn.headers['set-cookie'], '__Host-labdeck_session');
    const current = await app.inject({ method: 'GET', url: '/api/v1/session', headers: { host: 'labdeck.test', cookie: sessionCookie } });
    const csrfToken = current.json<{ csrfToken: string }>().csrfToken;
    const denied = await app.inject({ method: 'DELETE', url: '/api/v1/session', headers: { host: 'labdeck.test', origin: 'https://labdeck.test', cookie: sessionCookie, 'x-csrf-token': 'wrong-token-that-is-long-enough' } });
    expect(denied.statusCode).toBe(403);
    const logout = await app.inject({ method: 'DELETE', url: '/api/v1/session', headers: { host: 'labdeck.test', origin: 'https://labdeck.test', cookie: sessionCookie, 'x-csrf-token': csrfToken } });
    expect(logout.statusCode).toBe(204);
    const overview = await app.inject({ method: 'GET', url: '/api/v1/overview', headers: { host: 'labdeck.test', cookie: sessionCookie } });
    expect(overview.statusCode).toBe(401);
  });

  it('rejects wrong origin and host with safe errors', async () => {
    const app = await buildApp(config()); apps.push(app);
    expect((await app.inject({ method: 'GET', url: '/health/live', headers: { host: 'attacker.test' } })).statusCode).toBe(400);
    const preflight = await app.inject({ method: 'GET', url: '/api/v1/session', headers: { host: 'labdeck.test' } });
    const response = await app.inject({ method: 'POST', url: '/api/v1/session', headers: { host: 'labdeck.test', origin: 'https://attacker.test', cookie: cookieValue(preflight.headers['set-cookie'], '__Host-labdeck_prelogin') }, payload: { password: 'wrong password', csrfToken: preflight.json<{ csrfToken: string }>().csrfToken } });
    expect(response.statusCode).toBe(403); expect(response.body).not.toContain('wrong password');
  });

  it('rate limits repeated login attempts', async () => {
    const app = await buildApp(config()); apps.push(app);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const preflight = await app.inject({ method: 'GET', url: '/api/v1/session', headers: { host: 'labdeck.test' } });
      await app.inject({ method: 'POST', url: '/api/v1/session', headers: { host: 'labdeck.test', origin: 'https://labdeck.test', cookie: cookieValue(preflight.headers['set-cookie'], '__Host-labdeck_prelogin') }, payload: { password: 'wrong password', csrfToken: preflight.json<{ csrfToken: string }>().csrfToken } });
    }
    const preflight = await app.inject({ method: 'GET', url: '/api/v1/session', headers: { host: 'labdeck.test' } });
    const blocked = await app.inject({ method: 'POST', url: '/api/v1/session', headers: { host: 'labdeck.test', origin: 'https://labdeck.test', cookie: cookieValue(preflight.headers['set-cookie'], '__Host-labdeck_prelogin') }, payload: { password: 'wrong password', csrfToken: preflight.json<{ csrfToken: string }>().csrfToken } });
    expect(blocked.statusCode).toBe(429);
  });

  it('serves the SPA entry for browser routes without caching it', async () => {
    const app = await buildApp(config({ webRoot: resolve('apps/web/dist') })); apps.push(app);
    const response = await app.inject({ method: 'GET', url: '/settings', headers: { host: 'labdeck.test', accept: 'text/html' } });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.headers['cache-control']).toBe('no-store');
  });
});
