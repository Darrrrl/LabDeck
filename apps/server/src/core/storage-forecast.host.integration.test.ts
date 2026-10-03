import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hostCollectorSnapshotSchema, storageForecastSchema } from '@labdeck/contracts';
import { openDatabase } from '../db/database.js';
import { recordForecastDays, storageForecast } from './storage-forecast.js';

const DAY = 86_400_000, now = Date.parse('2026-09-27T12:00:00Z');
function setup(growth = 1000, days = 30, sampledHours = 24) {
  const database = openDatabase(':memory:');
  const snapshot = hostCollectorSnapshotSchema.parse(JSON.parse(readFileSync('tests/fixtures/host/system-v1.json', 'utf8')));
  const capability = snapshot.capabilities.filesystems;
  if (capability.status !== 'ok') throw new Error('bad fixture');
  const fs = capability.data[0]!;
  capability.data = [fs];
  fs.totalBytes = 100_000; fs.availableBytes = 30_000;
  for (let day = 0; day < days; day++) for (let hour = 0; hour < sampledHours; hour++) {
    const at = Math.floor(now / DAY) * DAY - (days - day) * DAY + hour * 3_600_000;
    capability.observedAt = new Date(at).toISOString(); fs.usedBytes = 30_000 + day * growth;
    recordForecastDays(database, snapshot, at);
  }
  capability.observedAt = new Date(now).toISOString();
  return { database, snapshot, capability, fs };
}
describe('storage growth forecast', () => {
  it('fits steady growth, uses allocatable headroom and reports actual coverage', () => {
    const { database, fs } = setup();
    const forecast = storageForecastSchema.parse(storageForecast(database, fs, now, now));
    expect(forecast).toMatchObject({ status: 'estimated', validDays: 30, coverage: 1, thresholdBytes: 10_000, growthBytesPerDay: 1000 });
    expect(Date.parse(forecast.estimatedAt!)).toBe(now + 20 * DAY);
    database.close();
  });
  it('rejects sparse days, missing days and stale evidence', () => {
    for (const [days, hours] of [[30, 1], [20, 24]]) {
      const { database, fs } = setup(1000, days, hours);
      expect(storageForecast(database, fs, now, now).status).toBe('insufficient');
      database.close();
    }
    const { database, fs } = setup();
    expect(storageForecast(database, fs, now - 100_000, now).status).toBe('stale'); database.close();
  });
  it('handles flat or negative growth, horizon and an already crossed threshold', () => {
    for (const growth of [0, -100]) {
      const { database, fs } = setup(growth);
      expect(storageForecast(database, fs, now, now).status).toBe('nonpositive'); database.close();
    }
    const { database, fs } = setup(10);
    expect(storageForecast(database, fs, now, now).status).toBe('beyond-horizon');
    fs.availableBytes = 1000;
    expect(storageForecast(database, fs, now, now).status).toBe('below-threshold'); database.close();
  });
  it('resets on capacity or identity change, and repeated snapshots do not inflate hours', () => {
    for (const change of ['totalBytes', 'mountIdentity'] as const) {
      const { database, fs, snapshot } = setup();
      if (change === 'totalBytes') fs.totalBytes += 1000; else fs.mountIdentity = 'replacement';
      expect(storageForecast(database, fs, now, now).status).toBe('insufficient');
      for (let i = 0; i < 50; i++) recordForecastDays(database, snapshot, now);
      expect(database.prepare('SELECT count(*) AS count FROM filesystem_forecast_days').get()).toEqual({ count: 1 });
      expect(database.prepare('SELECT hours_mask FROM filesystem_forecast_days').get()).toEqual({ hours_mask: 1 << 12 });
      database.close();
    }
  });
  it('resists one bulk import, and declines unstable deletion/import patterns', () => {
    const { database, fs } = setup();
    database.prepare('UPDATE filesystem_forecast_days SET used_bytes=used_bytes+20000 WHERE day=?').run(Math.floor(now / DAY) * DAY - 10 * DAY);
    expect(storageForecast(database, fs, now, now).growthBytesPerDay).toBe(1000);
    const rows = database.prepare('SELECT day FROM filesystem_forecast_days ORDER BY day').all() as { day: number }[];
    rows.forEach((row, i) => database.prepare('UPDATE filesystem_forecast_days SET used_bytes=? WHERE day=?').run(30_000 + i * 100 + (i % 2 ? 10000 : 0), row.day));
    expect(storageForecast(database, fs, now, now).status).toBe('unstable'); database.close();
  });
});
