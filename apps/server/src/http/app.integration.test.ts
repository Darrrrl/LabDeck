import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

describe('foundation HTTP API', () => {
  it('reports liveness', async () => {
    const app = buildApp({ host: '127.0.0.1', port: 7337, logLevel: 'silent' });
    apps.push(app);
    const response = await app.inject({ method: 'GET', url: '/health/live' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it('returns an honest empty overview', async () => {
    const app = buildApp({ host: '127.0.0.1', port: 7337, logLevel: 'silent' });
    apps.push(app);
    const response = await app.inject({ method: 'GET', url: '/api/v1/overview' });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toMatchObject({ overall: 'monitoring-incomplete' });
  });
});
