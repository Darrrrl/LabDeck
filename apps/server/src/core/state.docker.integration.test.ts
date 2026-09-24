import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hostCollectorSnapshotSchema, type HostCollectorSnapshot } from '@labdeck/contracts';
import { openDatabase } from '../db/database.js';
import { HostQueries } from './queries.js';
import { HostStateStore } from './state.js';

const id = (character: string) => character.repeat(64);
function snapshot(): HostCollectorSnapshot {
  const raw = JSON.parse(readFileSync('tests/fixtures/host/system-v1.json', 'utf8')) as Record<string, unknown>;
  const host = hostCollectorSnapshotSchema.parse(raw);
  const at = '2026-09-19T20:00:05Z';
  host.capabilities.docker = { status: 'ok', observedAt: at, completeness: 'complete', data: { apiVersion: '1.45', inventoryComplete: true, containers: [
    { id: id('a'), name: 'media', image: 'example:1', createdAt: at, startedAt: at, state: 'running', health: 'no-healthcheck', restartCount: 0, cpuPercent: null, memoryBytes: 0, memoryLimitBytes: 1024, memoryKind: 'working-set', statsObservedAt: at },
    { id: id('b'), name: 'optional', image: 'example:1', createdAt: at, startedAt: null, state: 'exited', health: 'no-healthcheck', restartCount: 0, cpuPercent: null, memoryBytes: null, memoryLimitBytes: null, memoryKind: 'unknown', statsObservedAt: null }
  ] } };
  return host;
}
function dockerOk(value: HostCollectorSnapshot) { const capability = value.capabilities.docker; if (!capability || capability.status !== 'ok') throw new Error('Docker fixture unavailable'); return capability; }

describe('Docker snapshot state', () => {
  it('keeps optional stopped containers neutral and expected stopped containers visible', () => {
    const database = openDatabase(':memory:'); const state = new HostStateStore(database); const input = snapshot(); const now = Date.parse(input.generatedAt);
    state.ingest(input, now);
    const optional = new HostQueries(database, true, () => true, () => now).containers();
    expect(optional).toMatchObject({ configured: true, total: 2, running: 1, expectedStopped: 0, unhealthy: 0 });
    const expected = new HostQueries(database, true, () => true, () => now, undefined, [], undefined, new Set(['optional'])).containers();
    expect(expected.expectedStopped).toBe(1);
    expect(expected.containers[1]?.expectedRunning).toBe(true);
    database.close();
  });
  it('deduplicates repeated Docker samples and observes restart and recreation by ID', () => {
    const database = openDatabase(':memory:'); const state = new HostStateStore(database); const first = snapshot(); const now = Date.parse(first.generatedAt);
    state.ingest(first, now);
    const sameSample = structuredClone(first); sameSample.sequence += 1; dockerOk(sameSample).data.containers[0]!.restartCount = 1;
    state.ingest(sameSample, now + 5_000);
    expect(database.prepare("SELECT count(*) AS count FROM events WHERE kind LIKE 'container.%'").get()).toEqual({ count: 0 });
    const next = structuredClone(sameSample); next.sequence += 1; next.capabilities.docker!.observedAt = '2026-09-19T20:00:20Z';
    state.ingest(next, now + 15_000);
    expect(database.prepare("SELECT count(*) AS count FROM events WHERE kind='container.restart-observed'").get()).toEqual({ count: 1 });
    const recreated = structuredClone(next); recreated.sequence += 1; dockerOk(recreated).observedAt = '2026-09-19T20:00:35Z'; dockerOk(recreated).data.containers[0]!.id = id('c'); dockerOk(recreated).data.containers[0]!.restartCount = 0;
    state.ingest(recreated, now + 30_000);
    expect(database.prepare("SELECT count(*) AS count FROM events WHERE kind='container.recreated-observed'").get()).toEqual({ count: 1 });
    database.close();
  });
  it('retains last good inventory through failed and partial snapshots without fabricated disappearance', () => {
    const database = openDatabase(':memory:'); const state = new HostStateStore(database); const first = snapshot(); const now = Date.parse(first.generatedAt); state.ingest(first, now);
    const failed = structuredClone(first); failed.sequence += 1; failed.capabilities.docker = { status: 'error', observedAt: '2026-09-19T20:00:20Z', completeness: 'complete', errorCode: 'read-failed' };
    state.ingest(failed, now + 15_000);
    expect(new HostQueries(database, true, () => true, () => now + 15_000).containers()).toMatchObject({ errorCode: 'read-failed', total: 2 });
    const partial = structuredClone(first); partial.sequence += 2; dockerOk(partial).observedAt = '2026-09-19T20:00:35Z'; dockerOk(partial).completeness = 'partial'; dockerOk(partial).data.inventoryComplete = false; dockerOk(partial).data.containers = [];
    state.ingest(partial, now + 30_000);
    expect(new HostQueries(database, true, () => true, () => now + 30_000).containers()).toMatchObject({ inventoryComplete: false, total: null });
    expect(database.prepare("SELECT count(*) AS count FROM events WHERE kind LIKE 'container.%'").get()).toEqual({ count: 0 });
    database.close();
  });
});
