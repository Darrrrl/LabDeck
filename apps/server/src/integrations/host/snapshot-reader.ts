import { closeSync, constants, fstatSync, openSync, readFileSync } from 'node:fs';
import { hostCollectorSnapshotSchema, type HostCollectorSnapshot } from '@labdeck/contracts';

const MAXIMUM_SNAPSHOT_BYTES = 2 * 1024 * 1024;
const MAXIMUM_FUTURE_SKEW_MS = 30_000;

export type SnapshotReadErrorCode = 'not-found' | 'permission' | 'invalid-file' | 'oversized' | 'invalid-response' | 'future-timestamp';

export class SnapshotReadError extends Error {
  constructor(readonly code: SnapshotReadErrorCode) { super(code); this.name = 'SnapshotReadError'; }
}

function mappedError(error: unknown): SnapshotReadError {
  if (error instanceof SnapshotReadError) return error;
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
  if (code === 'ENOENT') return new SnapshotReadError('not-found');
  if (code === 'EACCES' || code === 'EPERM') return new SnapshotReadError('permission');
  return new SnapshotReadError('invalid-file');
}

export function readHostSnapshot(path: string, now = Date.now()): HostCollectorSnapshot {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = fstatSync(descriptor);
    if (!stat.isFile()) throw new SnapshotReadError('invalid-file');
    if (stat.size > MAXIMUM_SNAPSHOT_BYTES) throw new SnapshotReadError('oversized');
    const bytes = readFileSync(descriptor);
    if (bytes.length > MAXIMUM_SNAPSHOT_BYTES) throw new SnapshotReadError('oversized');
    let decoded: unknown;
    try { decoded = JSON.parse(bytes.toString('utf8')); } catch { throw new SnapshotReadError('invalid-response'); }
    const parsed = hostCollectorSnapshotSchema.safeParse(decoded);
    if (!parsed.success) throw new SnapshotReadError('invalid-response');
    const timestamps = [parsed.data.generatedAt, ...Object.values(parsed.data.capabilities).map((capability) => capability.observedAt)];
    if (timestamps.some((timestamp) => Date.parse(timestamp) > now + MAXIMUM_FUTURE_SKEW_MS)) {
      throw new SnapshotReadError('future-timestamp');
    }
    return parsed.data;
  } catch (error) {
    throw mappedError(error);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}
