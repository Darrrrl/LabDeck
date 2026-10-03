import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { HostCollectorSnapshot, StorageForecast } from '@labdeck/contracts';
import { telemetryPermitted } from '../db/persistence.js';

const DAY = 86_400_000;
type Filesystem = Extract<HostCollectorSnapshot['capabilities']['filesystems'], { status: 'ok' }>['data'][number];
type Day = { day: number; used_bytes: number; hours_mask: number; observed_at: number; identity: string; total_bytes: number };
const identity = (fs: Filesystem) => createHash('sha256').update(JSON.stringify([fs.id, fs.path, fs.source, fs.fsType, fs.mountIdentity])).digest('hex');

// Called inside the snapshot transaction. Repeated reads never add coverage.
export function recordForecastDays(database: Database.Database, snapshot: HostCollectorSnapshot, now: number): void {
  const capability = snapshot.capabilities.filesystems;
  if (capability.status !== 'ok' || !telemetryPermitted(database)) return;
  const at = Date.parse(capability.observedAt);
  if (at > now + 30_000 || at < now - DAY) return;
  const day = Math.floor(at / DAY) * DAY;
  for (const fs of capability.data) {
    const key = identity(fs);
    const previous = database.prepare('SELECT observed_at, identity, total_bytes FROM filesystem_forecast_days WHERE filesystem_id=? ORDER BY day DESC LIMIT 1').get(fs.id) as Day | undefined;
    if (previous && at <= previous.observed_at) continue;
    if (previous && (previous.identity !== key || previous.total_bytes !== fs.totalBytes)) database.prepare('DELETE FROM filesystem_forecast_days WHERE filesystem_id=?').run(fs.id);
    database.prepare(`INSERT INTO filesystem_forecast_days(filesystem_id,day,identity,total_bytes,used_bytes,observed_at,hours_mask)
      VALUES (?,?,?,?,?,?,?) ON CONFLICT(filesystem_id,day) DO UPDATE SET
      used_bytes=excluded.used_bytes,observed_at=excluded.observed_at,hours_mask=hours_mask | excluded.hours_mask`)
      .run(fs.id, day, key, fs.totalBytes, fs.usedBytes, at, 1 << new Date(at).getUTCHours());
  }
  database.prepare('DELETE FROM filesystem_forecast_days WHERE day < ?').run(day - 30 * DAY);
  const active = new Set(capability.data.map((fs) => fs.id));
  for (const row of database.prepare('SELECT DISTINCT filesystem_id FROM filesystem_forecast_days').all() as { filesystem_id: string }[]) {
    if (!active.has(row.filesystem_id)) database.prepare('DELETE FROM filesystem_forecast_days WHERE filesystem_id=?').run(row.filesystem_id);
  }
}

function hours(mask: number): number { let count = 0; for (let n = mask; n; n >>>= 1) count += n & 1; return count; }
function quantile(sorted: number[], fraction: number): number { return sorted[Math.floor((sorted.length - 1) * fraction)]!; }

export function storageForecast(database: Database.Database, fs: Filesystem, observedAt: number, now: number): StorageForecast {
  const end = Math.floor(now / DAY) * DAY;
  const start = end - 30 * DAY;
  const rows = database.prepare('SELECT day,used_bytes,hours_mask,observed_at,identity,total_bytes FROM filesystem_forecast_days WHERE filesystem_id=? AND day>=? AND day<? ORDER BY day LIMIT 30').all(fs.id, start, end) as Day[];
  // A completed UTC day needs observations in at least 18 distinct hours.
  const valid = rows.filter((row) => hours(row.hours_mask) >= 18 && row.total_bytes === fs.totalBytes && row.identity === identity(fs));
  const result: StorageForecast = { status: 'insufficient', observedAt: new Date(observedAt).toISOString(), windowStart: new Date(start).toISOString(), windowEnd: new Date(end).toISOString(), validDays: valid.length, coverage: valid.length / 30, thresholdBytes: fs.totalBytes * .1, growthBytesPerDay: null, estimatedAt: null, earliestAt: null, latestAt: null };
  if (now - observedAt > 90_000) return { ...result, status: 'stale' };
  if (fs.availableBytes <= result.thresholdBytes) return { ...result, status: 'below-threshold' };
  if (valid.length < 14 || result.coverage < .7 || !valid.at(-1) || end - valid.at(-1)!.day > 2 * DAY) return result;
  const slopes: number[] = [];
  for (let i = 0; i < valid.length; i++) for (let j = i + 1; j < valid.length; j++) {
    slopes.push((valid[j]!.used_bytes - valid[i]!.used_bytes) / ((valid[j]!.observed_at - valid[i]!.observed_at) / DAY));
  }
  slopes.sort((a, b) => a - b);
  const growth = quantile(slopes, .5), low = quantile(slopes, .25), high = quantile(slopes, .75);
  result.growthBytesPerDay = growth;
  if (growth <= 0) return { ...result, status: 'nonpositive' };
  if (low <= 0 || high / low > 3) return { ...result, status: 'unstable' };
  const headroom = fs.availableBytes - result.thresholdBytes;
  if (headroom / low > 180) return { ...result, status: 'beyond-horizon' };
  const date = (rate: number) => new Date(observedAt + headroom / rate * DAY).toISOString();
  return { ...result, status: 'estimated', estimatedAt: date(growth), earliestAt: date(high), latestAt: date(low) };
}
