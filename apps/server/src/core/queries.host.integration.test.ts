import { readFileSync } from 'node:fs';
import { hostCollectorSnapshotSchema } from '@labdeck/contracts';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db/database.js';
import { HostQueries } from './queries.js';
import { HostStateStore } from './state.js';

describe('cached host queries', () => {
  it('builds overview, system, storage, and event DTOs without invoking collection', () => {
    const database = openDatabase(':memory:');
    const input = hostCollectorSnapshotSchema.parse(JSON.parse(readFileSync('tests/fixtures/host/system-v1.json', 'utf8')));
    const now = Date.parse('2026-09-19T20:00:10Z');
    new HostStateStore(database).ingest(input, now);
    const queries = new HostQueries(database, true, () => true, () => now);
    const watermarkBefore = database.prepare('SELECT generation, sequence FROM poll_state').get();

    const overview = queries.overview();
    expect(overview.configured && overview.host?.hostname).toBe('synthetic-server');
    expect(overview.configured && overview.freshness).toBe('fresh');
    expect(queries.system('1h').data?.cpu.utilizationPercent).toBe(18.5);
    expect(queries.storage('1h').filesystems[0]?.availableBytes).toBe(390_000_000_000);
    expect(queries.events().events).toHaveLength(0);
    expect(database.prepare('SELECT generation, sequence FROM poll_state').get()).toEqual(watermarkBefore);
    database.close();
  });

  it('never makes an old observation fresh and reports a failed connection separately', () => {
    const database = openDatabase(':memory:');
    const input = hostCollectorSnapshotSchema.parse(JSON.parse(readFileSync('tests/fixtures/host/system-v1.json', 'utf8')));
    const state = new HostStateStore(database);
    state.ingest(input, Date.parse('2026-09-19T20:00:06Z'));
    state.recordFailure('not-found', Date.parse('2026-09-19T21:00:00Z'));
    const queries = new HostQueries(database, true, () => true, () => Date.parse('2026-09-19T21:00:00Z'));
    const overview = queries.overview();
    expect(overview.configured && overview.freshness).toBe('stale');
    expect(overview.configured && overview.errorCode).toBe('not-found');
    expect(overview.configured && overview.observedAt).toBe('2026-09-19T20:00:05.000Z');
    database.close();
  });
});
