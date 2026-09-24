import { closeSync, constants, fstatSync, openSync, readFileSync } from 'node:fs';
import { smartSnapshotSchema, type SmartSnapshot } from '@labdeck/contracts';
import { SnapshotReadError } from './snapshot-reader.js';

export function readSmartSnapshot(path: string, now = Date.now()): SmartSnapshot {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = fstatSync(descriptor);
    if (!stat.isFile()) throw new SnapshotReadError('invalid-file');
    if (stat.size > 2 * 1024 * 1024) throw new SnapshotReadError('oversized');
    const body = readFileSync(descriptor);
    if (body.length > 2 * 1024 * 1024) throw new SnapshotReadError('oversized');
    let raw: unknown; try { raw = JSON.parse(body.toString('utf8')); } catch { throw new SnapshotReadError('invalid-response'); }
    const parsed = smartSnapshotSchema.safeParse(raw);
    if (!parsed.success) throw new SnapshotReadError('invalid-response');
    if ([parsed.data.generatedAt, ...parsed.data.disks.map((disk) => disk.observedAt)].some((at) => Date.parse(at) > now + 30_000)) throw new SnapshotReadError('future-timestamp');
    return parsed.data;
  } catch (error) {
    if (error instanceof SnapshotReadError) throw error;
    const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
    throw new SnapshotReadError(code === 'ENOENT' ? 'not-found' : code === 'EACCES' || code === 'EPERM' ? 'permission' : 'invalid-file');
  } finally { if (descriptor !== undefined) closeSync(descriptor); }
}
