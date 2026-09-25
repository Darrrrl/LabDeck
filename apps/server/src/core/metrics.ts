import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import { telemetryPermitted } from '../db/persistence.js';

export interface MetricObservation {
  instanceId: string;
  entityId: string;
  name: string;
  unit: string;
  value: number | null;
  observedAt: number;
  sampleIntervalMs?: number;
}

const resolutions = [
  { id: '1m', milliseconds: 60_000, retention: 48 * 60 * 60 * 1_000 },
  { id: '15m', milliseconds: 15 * 60_000, retention: 30 * 24 * 60 * 60 * 1_000 },
  { id: '1h', milliseconds: 60 * 60_000, retention: 400 * 24 * 60 * 60 * 1_000 }
] as const;

function seriesId(metric: MetricObservation): string {
  return createHash('sha256').update(`${metric.instanceId}\0${metric.entityId}\0${metric.name}`).digest('hex').slice(0, 32);
}

export function persistMetrics(database: Database.Database, observations: readonly MetricObservation[], now: number): void {
  if (!telemetryPermitted(database)) return;
  const seriesCount = (database.prepare('SELECT count(*) AS count FROM metric_series').get() as { count: number }).count;
  let admitted = seriesCount;
  for (const observation of observations) {
    if (observation.value === null || !Number.isFinite(observation.value)) continue;
    const id = seriesId(observation);
    const known = database.prepare('SELECT 1 FROM metric_series WHERE series_id = ?').get(id);
    if (!known) {
      if (admitted >= 400) continue;
      database.prepare(`INSERT INTO metric_series(series_id, instance_id, entity_id, metric_name, unit, sampling_class)
        VALUES (?, ?, ?, ?, ?, ?)`).run(id, observation.instanceId, observation.entityId, observation.name, observation.unit, (observation.sampleIntervalMs ?? 5_000) >= 60_000 ? 'slow' : 'fast');
      admitted += 1;
    }
    for (const resolution of resolutions) {
      const bucketStart = Math.floor(observation.observedAt / resolution.milliseconds) * resolution.milliseconds;
      database.prepare(`INSERT INTO metric_buckets(series_id, resolution, bucket_start, count, expected_count, sum, min, max, last, last_at)
        VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(series_id, resolution, bucket_start) DO UPDATE SET
          count = count + 1, sum = sum + excluded.sum, min = min(min, excluded.min), max = max(max, excluded.max),
          last = excluded.last, last_at = excluded.last_at`).run(
        id, resolution.id, bucketStart, resolution.milliseconds / (observation.sampleIntervalMs ?? 5_000), observation.value, observation.value, observation.value, observation.value, observation.observedAt
      );
    }
  }
  for (const resolution of resolutions) {
    database.prepare(`DELETE FROM metric_buckets WHERE rowid IN (
      SELECT rowid FROM metric_buckets WHERE resolution = ? AND bucket_start < ? LIMIT 1000
    )`).run(resolution.id, now - resolution.retention);
  }
}
