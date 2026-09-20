import type Database from 'better-sqlite3';

export interface EventCandidate {
  instanceId: string;
  entityId?: string;
  kind: string;
  severity: 'info' | 'warning' | 'critical';
  occurredAt?: number;
  observedAt: number;
  origin: 'observed' | 'threshold';
  dedupeKey: string;
  payload: Record<string, string | number | boolean | null>;
}

export function persistEvent(database: Database.Database, event: EventCandidate): void {
  database.prepare(`INSERT OR IGNORE INTO events(instance_id, entity_id, kind, severity, occurred_at, observed_at, origin, dedupe_key, payload_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    event.instanceId, event.entityId ?? null, event.kind, event.severity, event.occurredAt ?? null,
    event.observedAt, event.origin, event.dedupeKey, JSON.stringify(event.payload)
  );
}

export function retainEvents(database: Database.Database, now: number): void {
  database.prepare(`DELETE FROM events WHERE id IN (
    SELECT id FROM events WHERE observed_at < ? ORDER BY observed_at LIMIT 1000
  )`).run(now - 90 * 24 * 60 * 60 * 1_000);
  database.prepare(`DELETE FROM events WHERE id IN (
    SELECT id FROM events ORDER BY observed_at DESC, id DESC LIMIT 1000 OFFSET 50000
  )`).run();
}
