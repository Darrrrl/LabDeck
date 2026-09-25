import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hostCollectorSnapshotSchema, type HostCollectorSnapshot } from '@labdeck/contracts';
import { openDatabase } from '../db/database.js';
import { HostQueries } from './queries.js';
import { HostStateStore } from './state.js';

function snapshot(): HostCollectorSnapshot {
  const host = hostCollectorSnapshotSchema.parse(JSON.parse(readFileSync('tests/fixtures/host/system-v1.json', 'utf8')));
  host.capabilities.tailscale = { status: 'ok', observedAt: host.generatedAt, completeness: 'complete', data: { version: '1.90-synthetic', backendState: 'Running', selfName: 'server', selfIPs: ['100.101.102.103'], inventoryComplete: true, peers: [
    { id: 'n-a', name: 'laptop', ips: ['100.101.102.104'], online: true, lastSeen: null },
    { id: 'n-b', name: 'tablet', ips: ['100.101.102.105'], online: false, lastSeen: null }
  ] } };
  return host;
}

describe('local Tailscale status', () => {
  it('distinguishes online from offline with unknown last-seen and keeps offline peers neutral', () => {
    const database = openDatabase(':memory:'); const input = snapshot(); const now = Date.parse(input.generatedAt);
    new HostStateStore(database).ingest(input, now);
    const queries = new HostQueries(database, true, () => true, () => now);
    expect(queries.network()).toMatchObject({ configured: true, freshness: 'fresh', total: 2, online: 1, peers: [{ online: true, lastSeen: null }, { online: false, lastSeen: null }] });
    expect(queries.overview().configured && queries.overview().overall).toBe('healthy');
    database.close();
  });
  it('retains dated peers through permission denial and partial inventory', () => {
    const database = openDatabase(':memory:'); const state = new HostStateStore(database); const first = snapshot(); const now = Date.parse(first.generatedAt); state.ingest(first, now);
    const denied = structuredClone(first); denied.sequence += 1; denied.capabilities.tailscale = { status: 'error', observedAt: new Date(now + 30_000).toISOString(), completeness: 'complete', errorCode: 'permission-denied' };
    state.ingest(denied, now + 30_000);
    const afterDenial = new HostQueries(database, true, () => true, () => now + 30_000);
    expect(afterDenial.network()).toMatchObject({ errorCode: 'permission-denied', total: 2, observedAt: new Date(now).toISOString() });
    expect(afterDenial.overview().configured && afterDenial.overview().overall).toBe('warning');
    const partial = structuredClone(first); partial.sequence += 2; partial.capabilities.tailscale!.observedAt = new Date(now + 60_000).toISOString();
    if (partial.capabilities.tailscale!.status === 'ok') { partial.capabilities.tailscale!.completeness = 'partial'; partial.capabilities.tailscale!.data.inventoryComplete = false; partial.capabilities.tailscale!.data.peers = []; }
    state.ingest(partial, now + 60_000);
    expect(new HostQueries(database, true, () => true, () => now + 60_000).network()).toMatchObject({ errorCode: 'partial-inventory', total: 2, observedAt: new Date(now).toISOString() });
    database.close();
  });
});
