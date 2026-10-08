import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../auth/password.js';
import { buildApp } from './app.js';

let passwordHash: string;
const cleanup: (() => Promise<void>)[] = [];
beforeAll(async () => { passwordHash = await hashPassword('youtube fixture password'); });
afterEach(async () => { for (const stop of cleanup.splice(0).reverse()) await stop(); });

async function fixture(enabled = true) {
  const directory = mkdtempSync('/tmp/labdeck-youtube-api-');
  const path = join(directory, 'worker.sock');
  const received: Record<string, unknown>[] = [];
  const server = createServer({ allowHalfOpen: true }, (socket) => {
    let body = '';
    socket.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    socket.on('end', () => {
      const request = JSON.parse(body) as Record<string, unknown>;
      received.push(request);
      socket.end(JSON.stringify(request.action === 'status' ? { ok: true, jobs: [] } : { ok: true, id: 'a'.repeat(32) }));
    });
  });
  await new Promise<void>((resolve) => server.listen(path, resolve));
  cleanup.push(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); rmSync(directory, { recursive: true, force: true }); });
  const app = await buildApp({ host: '127.0.0.1', port: 7337, logLevel: 'silent', databasePath: ':memory:', webRoot: '/missing', canonicalOrigin: 'https://labdeck.test', allowedHosts: new Set(['labdeck.test']), passwordHash, demoMode: false, ...(enabled ? { youtubeSocketPath: path } : {}) });
  cleanup.push(async () => { await app.close(); });
  await app.ready();
  const preflight = await app.inject({ method: 'GET', url: '/api/v1/session', headers: { host: 'labdeck.test' } });
  const session = await app.inject({ method: 'POST', url: '/api/v1/session', headers: { host: 'labdeck.test', origin: 'https://labdeck.test', cookie: String(preflight.headers['set-cookie']).split(';')[0]! }, payload: { password: 'youtube fixture password', csrfToken: preflight.json<{ csrfToken: string }>().csrfToken } });
  expect(session.statusCode).toBe(200);
  const sessionCookie = String(session.headers['set-cookie']).match(/__Host-labdeck_session=([^;]+)/)?.[0];
  if (!sessionCookie) throw new Error('Missing session cookie');
  const headers = { host: 'labdeck.test', origin: 'https://labdeck.test', cookie: sessionCookie, 'x-csrf-token': session.json<{ csrfToken: string }>().csrfToken };
  return { app, headers, received };
}

describe('YouTube owner boundary', () => {
  it('authenticates cached reads and protects every mutation', async () => {
    const { app, headers, received } = await fixture();
    expect((await app.inject({ method: 'GET', url: '/api/v1/youtube', headers: { host: 'labdeck.test' } })).statusCode).toBe(401);
    for (const payload of [{ action: 'prepare', request: { kind: 'movie', source: 'https://youtu.be/abcdefghijk', name: 'Film' } }, { action: 'submit', id: 'a'.repeat(32) }, { action: 'cancel', id: 'a'.repeat(32) }, { action: 'retry', id: 'a'.repeat(32) }]) {
      expect((await app.inject({ method: 'POST', url: '/api/v1/youtube', headers: { host: 'labdeck.test' }, payload })).statusCode).toBe(401);
      expect((await app.inject({ method: 'POST', url: '/api/v1/youtube', headers: { ...headers, origin: 'https://evil.test' }, payload })).statusCode).toBe(403);
      expect((await app.inject({ method: 'POST', url: '/api/v1/youtube', headers: { ...headers, 'x-csrf-token': 'wrong' }, payload })).statusCode).toBe(403);
      expect((await app.inject({ method: 'POST', url: '/api/v1/youtube', headers, payload })).statusCode).toBe(202);
    }
    const before = received.length;
    for (let index = 0; index < 5; index++) {
      const response = await app.inject({ method: 'GET', url: '/api/v1/youtube', headers });
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.json()).toMatchObject({ configured: true, available: true, jobs: [] });
    }
    expect(received.length).toBe(before);
    expect((await app.inject({ method: 'POST', url: '/api/v1/youtube', headers, payload: { action: 'prepare', request: { kind: 'movie', source: 'https://127.0.0.1', name: 'Film', path: '/srv' } } })).statusCode).toBe(400);
  });
  it('is disabled without the optional socket', async () => {
    const { app, headers } = await fixture(false);
    expect((await app.inject({ method: 'GET', url: '/api/v1/youtube', headers })).json()).toEqual({ configured: false, available: false, observedAt: null, jobs: [] });
    expect((await app.inject({ method: 'POST', url: '/api/v1/youtube', headers, payload: { action: 'cancel', id: 'a'.repeat(32) } })).statusCode).toBe(503);
  });
});
