import { chmodSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readHostSnapshot, SnapshotReadError } from './snapshot-reader.js';

const directories: string[] = [];
function fixture(): Record<string, unknown> {
  return JSON.parse(readFileSync('tests/fixtures/host/system-v1.json', 'utf8')) as Record<string, unknown>;
}
function directory(): string { const path = mkdtempSync(join(tmpdir(), 'labdeck-host-')); directories.push(path); return path; }

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('host snapshot reader', () => {
  it('reads only a valid regular snapshot and preserves collector time', () => {
    const path = join(directory(), 'system.json');
    writeFileSync(path, JSON.stringify(fixture()), { mode: 0o640 });
    const snapshot = readHostSnapshot(path, Date.parse('2026-09-19T20:00:10Z'));
    expect(snapshot.generatedAt).toBe('2026-09-19T20:00:05Z');
  });

  it.each([
    ['malformed', '{', 'invalid-response'],
    ['oversized', 'x'.repeat(2 * 1024 * 1024 + 1), 'oversized']
  ])('rejects %s input with a safe error', (_name, contents, code) => {
    const path = join(directory(), 'system.json');
    writeFileSync(path, contents);
    expect(() => readHostSnapshot(path)).toThrowError(expect.objectContaining({ code }));
  });

  it('rejects symlinks', () => {
    const root = directory();
    const target = join(root, 'target.json');
    writeFileSync(target, JSON.stringify(fixture()));
    const path = join(root, 'system.json');
    symlinkSync(target, path);
    expect(() => readHostSnapshot(path)).toThrowError(SnapshotReadError);
  });

  it('rejects collector or capability timestamps more than 30 seconds ahead', () => {
    const root = directory();
    const document = fixture();
    document.generatedAt = '2026-09-19T20:01:00Z';
    const path = join(root, 'system.json');
    writeFileSync(path, JSON.stringify(document));
    chmodSync(path, 0o640);
    expect(() => readHostSnapshot(path, Date.parse('2026-09-19T20:00:00Z')))
      .toThrowError(expect.objectContaining({ code: 'future-timestamp' }));
  });
});
