import { statfsSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import type Database from 'better-sqlite3';

const MiB = 1024 * 1024;
export type Pressure = 'normal' | 'trimming' | 'paused';
export function classifyPressure(bytes: number, freeBytes: number): Pressure {
  if (bytes >= 2 * 1024 * MiB || freeBytes < 512 * MiB) return 'paused';
  if (bytes >= 1024 * MiB) return 'trimming';
  return 'normal';
}
export function persistenceDiagnostics(database: Database.Database): { databaseBytes: number; walBytes: number; freeBytes: number | null; seriesCount: number; eventCount: number; pressure: Pressure } {
  const path = (database.pragma('database_list') as { name: string; file: string }[]).find((entry) => entry.name === 'main')?.file;
  const size = (file: string): number => { try { return statSync(file).size; } catch { return 0; } };
  const databaseBytes = path ? size(path) : 0;
  const walBytes = path ? size(`${path}-wal`) : 0;
  let freeBytes: number | null = null;
  if (path) { try { const stat = statfsSync(dirname(path)); freeBytes = stat.bavail * stat.bsize; } catch { freeBytes = null; } }
  const seriesCount = (database.prepare('SELECT count(*) AS count FROM metric_series').get() as { count: number }).count;
  const eventCount = (database.prepare('SELECT count(*) AS count FROM events').get() as { count: number }).count;
  return { databaseBytes, walBytes, freeBytes, seriesCount, eventCount, pressure: path ? classifyPressure(databaseBytes + walBytes, freeBytes ?? Number.MAX_SAFE_INTEGER) : 'normal' };
}

export function telemetryPermitted(database: Database.Database): boolean {
  const diagnostics = persistenceDiagnostics(database);
  if (diagnostics.pressure === 'trimming') {
    database.prepare(`DELETE FROM metric_buckets WHERE rowid IN (SELECT rowid FROM metric_buckets WHERE resolution='1h' ORDER BY bucket_start LIMIT 1000)`).run();
  }
  return diagnostics.pressure !== 'paused';
}
