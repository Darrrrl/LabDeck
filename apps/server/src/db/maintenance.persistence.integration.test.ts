import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { openDatabase } from './database.js';
import { databaseIsReady } from './database.js';
import { maintainDatabase } from './maintenance-cli.js';
import { persistEvent, retainEvents } from '../core/events.js';
import { persistMetrics } from '../core/metrics.js';
import { HostQueries } from '../core/queries.js';
import { classifyPressure } from './persistence.js';

describe('SQLite operational recovery', () => {
  it('takes an online verified backup and restores a new database with history but no sessions', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'labdeck-restore-test-'));
    try {
      const source = join(directory, 'source.db'); const backup = join(directory, 'backup.db'); const restored = join(directory, 'restored.db');
      const active = openDatabase(source);
      active.prepare('INSERT INTO sessions(token_hash,csrf_hash,created_at,expires_at) VALUES (?,?,?,?)').run('synthetic-token-hash', 'synthetic-csrf-hash', 1, 100);
      persistEvent(active, { instanceId: 'host', kind: 'test.event', severity: 'info', observedAt: 100, origin: 'observed', dedupeKey: 'persistent-event', payload: { value: 1 } });
      await maintainDatabase('backup', source, backup);
      expect(readFileSync(backup).length).toBeGreaterThan(0);
      const status = new HostQueries(active, false, () => true).settings(false).backup;
      expect(status.lastSuccessfulAt).not.toBeNull();
      expect(status.integrityVerifiedAt).toBe(status.lastSuccessfulAt);
      await expect(maintainDatabase('backup', source, backup)).rejects.toThrow();
      expect(new HostQueries(active, false, () => true).settings(false).backup).toEqual(status);
      await maintainDatabase('restore', backup, restored);
      const copy = new Database(restored, { readonly: true });
      expect(copy.prepare('SELECT count(*) AS count FROM sessions').get()).toEqual({ count: 0 });
      expect(copy.prepare('SELECT count(*) AS count FROM backup_status').get()).toEqual({ count: 0 });
      expect(copy.prepare('SELECT count(*) AS count FROM events').get()).toEqual({ count: 1 });
      expect(copy.prepare('SELECT count(*) AS count FROM event_dedupe').get()).toEqual({ count: 1 });
      expect(copy.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }]);
      copy.close(); active.close();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  it('rejects corrupt source and existing target without replacing either file', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'labdeck-backup-failure-'));
    try {
      const source = join(directory, 'source.db'); const target = join(directory, 'target.db');
      writeFileSync(source, 'not sqlite'); writeFileSync(target, 'owner content');
      await expect(maintainDatabase('backup', source, join(directory, 'new.db'))).rejects.toThrow();
      const valid = openDatabase(join(directory, 'valid.db')); valid.close();
      await expect(maintainDatabase('backup', join(directory, 'valid.db'), target)).rejects.toThrow();
      expect(readFileSync(target, 'utf8')).toBe('owner content');
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  it('keeps event dedupe after feed retention removes the event row', () => {
    const database = openDatabase(':memory:');
    const event = { instanceId: 'host', kind: 'test.event', severity: 'info' as const, observedAt: 1, origin: 'observed' as const, dedupeKey: 'old-event', payload: {} };
    persistEvent(database, event); retainEvents(database, 100 * 86_400_000);
    expect(database.prepare('SELECT count(*) AS count FROM events').get()).toEqual({ count: 0 });
    persistEvent(database, event);
    expect(database.prepare('SELECT count(*) AS count FROM events').get()).toEqual({ count: 0 });
    database.close();
  });
  it('preserves true sample coverage across 400-day downsampling and gaps', () => {
    const database = openDatabase(':memory:'); const now = Date.parse('2026-09-25T12:00:00Z');
    const add = (at: number, value: number) => persistMetrics(database, [{ instanceId: 'host', entityId: 'filesystem:media', name: 'filesystem.used', unit: 'bytes', value, observedAt: at, sampleIntervalMs: 300_000 }], at);
    add(now - 2 * 86_400_000, 10); add(now - 2 * 86_400_000 + 300_000, 20); add(now - 60_000, 30);
    const rows = database.prepare("SELECT count,sum,expected_count,last FROM metric_buckets b JOIN metric_series s ON s.series_id=b.series_id WHERE s.metric_name='filesystem.used' AND resolution='1h' ORDER BY bucket_start").all() as { count: number; sum: number; expected_count: number; last: number }[];
    expect(rows[0]).toMatchObject({ count: 2, sum: 30, expected_count: 12, last: 20 });
    const points = new HostQueries(database, true, () => true, () => now).metric('filesystem.used', '400d', 'filesystem:media');
    expect(points).toHaveLength(2);
    expect(points[0]).toMatchObject({ value: 20, coverage: 2 / 288 });
    expect(points[1]?.value).toBe(30);
    database.close();
  });
  it('returns a bounded daily history from 400 days of accelerated samples', () => {
    const database = openDatabase(':memory:'); const now = Date.parse('2026-09-25T12:00:00Z');
    for (let day = 399; day >= 0; day -= 1) {
      const at = now - day * 86_400_000;
      persistMetrics(database, [{ instanceId: 'jellyfin', entityId: 'jellyfin', name: 'library.movies', unit: 'items', value: 400 - day, observedAt: at, sampleIntervalMs: 86_400_000 }], at);
    }
    const points = new HostQueries(database, true, () => true, () => now).metric('library.movies', '400d', 'jellyfin', 'jellyfin');
    expect(points).toHaveLength(400);
    expect(points[0]?.value).toBe(1);
    expect(points[399]?.value).toBe(400);
    expect(points.every((point) => point.coverage === 1)).toBe(true);
    database.close();
  });
  it('classifies budget pressure and caps series admission', () => {
    const GiB = 1024 ** 3; const MiB = 1024 ** 2;
    expect(classifyPressure(0, GiB)).toBe('normal');
    expect(classifyPressure(GiB, GiB)).toBe('trimming');
    expect(classifyPressure(2 * GiB, GiB)).toBe('paused');
    expect(classifyPressure(0, 511 * MiB)).toBe('paused');
    const database = openDatabase(':memory:'); const at = Date.parse('2026-09-25T12:00:00Z');
    persistMetrics(database, Array.from({ length: 401 }, (_, index) => ({ instanceId: 'host', entityId: `synthetic:${index}`, name: 'cpu.utilization', unit: 'percent', value: index, observedAt: at })), at);
    expect(database.prepare('SELECT count(*) AS count FROM metric_series').get()).toEqual({ count: 400 });
    database.close();
  });
  it('keeps a temporary full database readable and reports the write failure without replacing it', () => {
    const directory = mkdtempSync(join(tmpdir(), 'labdeck-full-test-'));
    try {
      const database = openDatabase(join(directory, 'full.db'));
      database.exec('CREATE TABLE pressure_fixture(payload BLOB NOT NULL)');
      const pages = (database.pragma('page_count') as { page_count: number }[])[0]!.page_count;
      database.pragma(`max_page_count = ${pages + 4}`);
      expect(() => database.exec('INSERT INTO pressure_fixture(payload) VALUES (randomblob(65536))')).toThrow();
      expect(databaseIsReady(database)).toBe(true);
      expect(database.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }]);
      database.close();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  it('restores a prior schema copy and migrates only the restored candidate on startup', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'labdeck-migration-test-'));
    try {
      const source = join(directory, 'schema3.db'); const backup = join(directory, 'schema3-backup.db'); const restored = join(directory, 'candidate.db');
      const database = openDatabase(source);
      database.exec('DROP TABLE event_dedupe; DROP TABLE filesystem_forecast_days; DROP TABLE backup_status; DROP TABLE action_audit'); database.prepare('DELETE FROM schema_migrations WHERE version>=4').run(); database.close();
      await maintainDatabase('backup', source, backup);
      await maintainDatabase('restore', backup, restored);
      const upgraded = openDatabase(restored);
      expect(upgraded.prepare('SELECT max(version) AS version FROM schema_migrations').get()).toEqual({ version: 6 });
      upgraded.close();
      const original = new Database(backup, { readonly: true });
      expect(original.prepare('SELECT max(version) AS version FROM schema_migrations').get()).toEqual({ version: 3 });
      original.close();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
