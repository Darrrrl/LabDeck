import { mkdtempSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hostCollectorSnapshotSchema, type HostCollectorSnapshot } from '@labdeck/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../db/database.js';
import { HostStateStore } from './state.js';

const directories: string[] = [];
function snapshot(): HostCollectorSnapshot {
  return hostCollectorSnapshotSchema.parse(JSON.parse(readFileSync('tests/fixtures/host/system-v1.json', 'utf8')));
}
afterEach(async () => Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

describe('host state persistence', () => {
  it('atomically deduplicates generation/sequence metrics and survives restart', () => {
    const root = mkdtempSync(join(tmpdir(), 'labdeck-db-')); directories.push(root);
    const path = join(root, 'labdeck.db');
    let database = openDatabase(path);
    const state = new HostStateStore(database);
    const input = snapshot();
    if (input.capabilities.filesystems.status !== 'ok') throw new Error('fixture');
    input.capabilities.filesystems.data[0]!.usedRatio = 0.91;
    expect(state.ingest(input, Date.parse('2026-09-19T20:00:06Z'))).toBe('ingested');
    const bucketCount = (database.prepare('SELECT count(*) AS count FROM metric_buckets').get() as { count: number }).count;
    expect(state.ingest(input, Date.parse('2026-09-19T20:00:09Z'))).toBe('duplicate');
    expect((database.prepare('SELECT count(*) AS count FROM metric_buckets').get() as { count: number }).count).toBe(bucketCount);
    expect((database.prepare("SELECT observed_at FROM capability_state WHERE capability = 'host.summary'").get() as { observed_at: number }).observed_at)
      .toBe(Date.parse('2026-09-19T20:00:05Z'));
    database.close();

    database = openDatabase(path);
    expect((database.prepare('SELECT generation, sequence FROM poll_state').get() as { generation: string; sequence: number }))
      .toEqual({ generation: input.generation, sequence: 2 });
    expect(new HostStateStore(database).ingest(input)).toBe('duplicate');
    expect((database.prepare("SELECT count(*) AS count FROM events WHERE kind = 'storage.threshold'").get() as { count: number }).count).toBe(1);
    database.close();
  });

  it('preserves last good capabilities and emits one outage then one recovery', () => {
    const database = openDatabase(':memory:');
    const state = new HostStateStore(database);
    const first = snapshot();
    state.ingest(first, 1_000);
    state.recordFailure('not-found', 2_000);
    state.recordFailure('not-found', 3_000);
    state.recordFailure('not-found', 4_000);
    expect((database.prepare('SELECT count(*) AS count FROM capability_state').get() as { count: number }).count).toBe(4);
    expect((database.prepare("SELECT count(*) AS count FROM events WHERE kind = 'integration.outage'").get() as { count: number }).count).toBe(1);
    const second = structuredClone(first);
    second.sequence = 3;
    second.generatedAt = '2026-09-19T20:00:10Z';
    state.ingest(second, 5_000);
    expect((database.prepare("SELECT count(*) AS count FROM events WHERE kind = 'integration.recovered'").get() as { count: number }).count).toBe(1);
    expect((database.prepare('SELECT consecutive_failures FROM integration_state').get() as { consecutive_failures: number }).consecutive_failures).toBe(0);
    database.close();
  });

  it('does not declare a startup failure as an outage', () => {
    const database = openDatabase(':memory:');
    const state = new HostStateStore(database);
    state.recordFailure('not-found', 1_000);
    state.recordFailure('not-found', 2_000);
    expect((database.prepare('SELECT count(*) AS count FROM events').get() as { count: number }).count).toBe(0);
    database.close();
  });

  it('preserves a successful capability when another snapshot section fails', () => {
    const database = openDatabase(':memory:');
    const state = new HostStateStore(database);
    const first = snapshot();
    state.ingest(first, 1_000);
    const partial = structuredClone(first);
    partial.sequence = 3;
    partial.capabilities.summary = { status: 'error', observedAt: '2026-09-19T20:00:10Z', completeness: 'complete', errorCode: 'read-failed' };
    if (partial.capabilities.filesystems.status !== 'ok') throw new Error('fixture');
    partial.capabilities.filesystems.observedAt = '2026-09-19T20:00:10Z';
    partial.capabilities.filesystems.data[0]!.availableBytes = 380_000_000_000;
    state.ingest(partial, 2_000);
    const summary = database.prepare("SELECT observed_at FROM capability_state WHERE capability = 'host.summary'").get() as { observed_at: number };
    const filesystems = database.prepare("SELECT observed_at FROM capability_state WHERE capability = 'host.filesystems'").get() as { observed_at: number };
    expect(summary.observed_at).toBe(Date.parse('2026-09-19T20:00:05Z'));
    expect(filesystems.observed_at).toBe(Date.parse('2026-09-19T20:00:10Z'));
    database.close();
  });

  it('merges metric samples into rollups and removes expired buckets in bounded maintenance', () => {
    const database = openDatabase(':memory:');
    const state = new HostStateStore(database);
    const first = snapshot();
    const base = Date.parse(first.generatedAt);
    state.ingest(first, base);
    const second = structuredClone(first);
    second.sequence = 3;
    second.generatedAt = '2026-09-19T20:00:10Z';
    for (const capability of Object.values(second.capabilities)) capability.observedAt = second.generatedAt;
    state.ingest(second, base + 5_000);
    const bucket = database.prepare(`SELECT count, sum FROM metric_buckets b JOIN metric_series s ON s.series_id = b.series_id
      WHERE s.metric_name = 'cpu.utilization' AND b.resolution = '1m'`).get() as { count: number; sum: number };
    expect(bucket).toEqual({ count: 2, sum: 37 });

    const expired = structuredClone(second);
    expired.sequence = 4;
    state.ingest(expired, base + 401 * 24 * 60 * 60 * 1_000);
    expect((database.prepare('SELECT count(*) AS count FROM metric_buckets').get() as { count: number }).count).toBe(0);
    database.close();
  });

  it('records storage threshold transitions without replay', () => {
    const database = openDatabase(':memory:');
    const state = new HostStateStore(database);
    const first = snapshot();
    if (first.capabilities.filesystems.status !== 'ok') throw new Error('fixture');
    first.capabilities.filesystems.data[0]!.usedRatio = 0.91;
    state.ingest(first, 1_000);
    const second = structuredClone(first); second.sequence = 3;
    state.ingest(second, 2_000);
    expect((database.prepare("SELECT count(*) AS count FROM events WHERE kind = 'storage.threshold'").get() as { count: number }).count).toBe(1);
    database.close();
  });
});
