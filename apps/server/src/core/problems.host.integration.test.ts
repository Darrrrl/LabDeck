import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hostCollectorSnapshotSchema, problemDetailResponseSchema, problemsResponseSchema } from '@labdeck/contracts';
import { openDatabase } from '../db/database.js';
import { HostStateStore } from './state.js';
import { HostQueries } from './queries.js';
import { persistEvent } from './events.js';

describe('cached problem investigation', () => {
  it('links capacity evidence to entity events and history, preserving stale timestamps and stable IDs', () => {
    const database = openDatabase(':memory:');
    const input = hostCollectorSnapshotSchema.parse(JSON.parse(readFileSync('tests/fixtures/host/system-v1.json', 'utf8')));
    if (input.capabilities.filesystems.status !== 'ok') throw new Error('fixture');
    const fs = input.capabilities.filesystems.data[0]!;
    fs.usedRatio = .96; fs.availableBytes = fs.totalBytes * .04;
    const now = Date.parse(input.generatedAt), state = new HostStateStore(database);
    state.ingest(input, now);
    const queries = new HostQueries(database, true, () => true, () => now);
    const problem = problemsResponseSchema.parse(queries.problems()).problems.find((item) => item.entityId === `filesystem:${fs.id}`)!;
    const detail = problemDetailResponseSchema.parse(queries.problem(problem.id));
    expect(detail.problem).toMatchObject({ severity: 'critical', observedAt: new Date(now).toISOString(), detailPath: '/storage' });
    expect(detail.events).toHaveLength(1);
    expect(detail.events[0]).toMatchObject({ origin: 'threshold', entityId: `filesystem:${fs.id}` });
    expect(detail.chart?.points).toHaveLength(1);
    persistEvent(database, { instanceId: 'jellyfin', entityId: `filesystem:${fs.id}`, kind: 'unrelated', severity: 'warning', observedAt: now, origin: 'observed', dedupeKey: 'unrelated', payload: {} });
    const stale = new HostQueries(database, true, () => true, () => now + 100_000).problem(problem.id)!;
    expect(stale.problem.freshness).toBe('stale'); expect(stale.problem.severity).toBe('warning'); expect(stale.problem.title).toContain('last observed'); expect(stale.problem.observedAt).toBe(detail.problem.observedAt);
    expect(stale.events).toHaveLength(1);
    input.sequence++; input.capabilities.filesystems.observedAt = new Date(now + 5000).toISOString(); fs.usedRatio = .5; fs.availableBytes = fs.totalBytes * .5;
    state.ingest(input, now + 5000);
    expect(queries.problem(problem.id)).toBeUndefined();
    database.close();
  });
});
