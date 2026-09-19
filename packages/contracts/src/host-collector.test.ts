import { describe, expect, it } from 'vitest';
import { hostCollectorSnapshotSchema } from './index.js';
import snapshotFixture from '../../../tests/fixtures/host/system-v1.json';

describe('hostCollectorSnapshotSchema', () => {
  it('accepts the shared synthetic Go collector fixture', () => {
    expect(hostCollectorSnapshotSchema.parse(snapshotFixture).hostId).toBe('synthetic-server');
  });

  it('rejects unsafe integer counters and unknown protocol versions', () => {
    const base = {
      schemaVersion: '1', collectorVersion: '0.1.0', hostId: 'server', bootId: 'boot', generation: 'a'.repeat(32), sequence: 1,
      generatedAt: '2026-09-19T20:00:00Z', capabilities: {
        summary: { status: 'error', observedAt: '2026-09-19T20:00:00Z', completeness: 'complete', errorCode: 'read-failed' },
        filesystems: { status: 'error', observedAt: '2026-09-19T20:00:00Z', completeness: 'complete', errorCode: 'read-failed' },
        interfaces: { status: 'error', observedAt: '2026-09-19T20:00:00Z', completeness: 'complete', errorCode: 'read-failed' },
        blockIo: { status: 'error', observedAt: '2026-09-19T20:00:00Z', completeness: 'complete', errorCode: 'read-failed' }
      }
    };
    expect(hostCollectorSnapshotSchema.safeParse(base).success).toBe(true);
    expect(hostCollectorSnapshotSchema.safeParse({ ...base, schemaVersion: '2' }).success).toBe(false);
  });
});
