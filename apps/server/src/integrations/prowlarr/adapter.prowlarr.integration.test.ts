import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../../db/database.js';
import { HostQueries } from '../../core/queries.js';
import { ProwlarrAdapter, ProwlarrTransport } from './adapter.js';
import { ProwlarrStateStore } from './state.js';

const fixture = () => JSON.parse(readFileSync('tests/fixtures/prowlarr/1.0-synthetic/data.json', 'utf8')) as Record<string, unknown>;
function adapter(source: Record<string, unknown>, calls: { url: string; init?: RequestInit }[] = [], status = 200) {
  const fetcher = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input.toString(); calls.push({ url, ...(init ? { init } : {}) });
    const key = new URL(url).pathname.split('/').at(-1) === 'status' && url.includes('/system/') ? 'status' : new URL(url).pathname.split('/').at(-1)!;
    return Promise.resolve(new Response(JSON.stringify(source[key]), { status }));
  });
  return new ProwlarrAdapter(new ProwlarrTransport('http://prowlarr.test/prefix', 'test-secret', fetcher), () => new Date('2026-09-24T12:00:00Z'));
}

describe('Prowlarr health', () => {
  it('uses only fixed GET v1 routes and header auth with a path prefix', async () => {
    const calls: { url: string; init?: RequestInit }[] = []; const subject = adapter(fixture(), calls);
    await subject.connection(); await subject.health();
    expect(calls.map((item) => new URL(item.url).pathname)).toEqual(['/prefix/api/v1/system/status', '/prefix/api/v1/health', '/prefix/api/v1/indexerstatus', '/prefix/api/v1/indexer']);
    expect(calls.every((item) => item.init?.method === 'GET' && item.init?.redirect === 'error')).toBe(true);
    expect(calls[0]?.init?.headers).toMatchObject({ 'X-Api-Key': 'test-secret' });
    await expect(new ProwlarrTransport('http://prowlarr.test', 'key').get('/api/v1/indexer/test')).rejects.toThrow('invalid-response');
  });
  it('distinguishes current failures, disabled indexers, expired failures and missing evidence without leaking nested fields', async () => {
    const result = (await adapter(fixture()).health()).data;
    expect(result.indexers.map((item) => item.state)).toEqual(['failing', 'disabled', 'no-active-failure', 'no-active-failure']);
    expect(result).toMatchObject({ failingTotal: 1, disabledTotal: 1, applications: { connectivity: 'unknown' } });
    expect(result.warnings).toEqual([{ severity: 'warning', text: 'Prowlarr reports a warning' }]);
    expect(JSON.stringify(result)).not.toContain('LABDECK_SECRET_CANARY_7dcf3d');
  });
  it('handles empty, malformed, unsupported, unauthorized and oversized responses', async () => {
    const empty = fixture(); empty.health = []; empty.indexerstatus = []; empty.indexer = [];
    expect((await adapter(empty).health()).data.failingTotal).toBe(0);
    const malformed = fixture(); malformed.indexer = { fields: [] };
    await expect(adapter(malformed).health()).rejects.toThrow('invalid-response');
    await expect(adapter(fixture(), [], 404).health()).rejects.toThrow('unsupported-version');
    await expect(adapter(fixture(), [], 401).connection()).rejects.toThrow('auth');
    const huge = fixture(); huge.indexer = [{ id: 1, name: 'x', enable: true, fields: [{ value: 'a'.repeat(2 * 1024 * 1024) }] }];
    await expect(adapter(huge).health()).rejects.toThrow('invalid-response');
  });
  it('baselines failure transitions and preserves last good state on errors', async () => {
    const database = openDatabase(':memory:'); const state = new ProwlarrStateStore(database);
    const first = await adapter(fixture()).health(); state.success('health', first, Date.parse(first.observedAt));
    expect(database.prepare('SELECT count(*) AS count FROM events').get()).toEqual({ count: 0 });
    const second = structuredClone(first); second.data.indexers[2]!.state = 'failing'; second.data.failingTotal = 2;
    state.success('health', second, Date.parse(first.observedAt) + 1); state.success('health', second, Date.parse(first.observedAt) + 2);
    expect(database.prepare("SELECT count(*) AS count FROM events WHERE kind='indexer.failure-observed'").get()).toEqual({ count: 1 });
    state.failure('health', new Error('some upstream secret'), Date.parse(first.observedAt) + 3);
    expect((database.prepare("SELECT normalized_json FROM capability_state WHERE instance_id='prowlarr'").get() as { normalized_json: string }).normalized_json).not.toContain('some upstream secret');
    database.close();
  });
  it('serves a cached Prowlarr-only overview and Downloads projection without raw fields', async () => {
    const database = openDatabase(':memory:'); const state = new ProwlarrStateStore(database);
    const observation = await adapter(fixture()).health(); const now = Date.parse(observation.observedAt);
    state.success('connection', { version: 'synthetic-1.0' }, now); state.success('health', observation, now);
    const queries = new HostQueries(database, false, () => true, () => now, undefined, [], { id: 'prowlarr', name: 'Prowlarr', browserUrl: 'https://prowlarr.example.test' });
    expect(queries.overview()).toMatchObject({ configured: true, overall: 'warning', indexers: { failingTotal: 1, disabledTotal: 1 } });
    expect(queries.downloads()).toMatchObject({ configured: true, services: [], indexers: { connection: 'reachable', freshness: 'fresh' } });
    expect(JSON.stringify(queries.downloads())).not.toContain('LABDECK_SECRET_CANARY_7dcf3d');
    database.close();
  });
});
