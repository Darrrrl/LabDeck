import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

const migrations = [
`
CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, csrf_hash TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expires_at ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS auth_state (
  id INTEGER PRIMARY KEY CHECK (id = 1), password_fingerprint TEXT NOT NULL
);`,
`
CREATE TABLE integration_state (
  instance_id TEXT PRIMARY KEY,
  config_revision TEXT NOT NULL,
  connection TEXT NOT NULL,
  attempted_at INTEGER,
  succeeded_at INTEGER,
  safe_error_code TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE capability_state (
  instance_id TEXT NOT NULL,
  capability TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  observed_at INTEGER NOT NULL,
  succeeded_at INTEGER NOT NULL,
  normalized_json TEXT NOT NULL,
  PRIMARY KEY(instance_id, capability)
);
CREATE TABLE poll_state (
  instance_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  generation TEXT,
  sequence INTEGER,
  cursor_json TEXT,
  last_success_at INTEGER,
  PRIMARY KEY(instance_id, group_id)
);
CREATE TABLE metric_series (
  series_id TEXT PRIMARY KEY,
  instance_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  unit TEXT NOT NULL,
  sampling_class TEXT NOT NULL,
  UNIQUE(instance_id, entity_id, metric_name)
);
CREATE TABLE metric_buckets (
  series_id TEXT NOT NULL,
  resolution TEXT NOT NULL,
  bucket_start INTEGER NOT NULL,
  count INTEGER NOT NULL,
  expected_count INTEGER NOT NULL,
  sum REAL NOT NULL,
  min REAL NOT NULL,
  max REAL NOT NULL,
  last REAL NOT NULL,
  last_at INTEGER NOT NULL,
  PRIMARY KEY(series_id, resolution, bucket_start),
  FOREIGN KEY(series_id) REFERENCES metric_series(series_id) ON DELETE CASCADE
);
CREATE INDEX metric_buckets_range ON metric_buckets(resolution, bucket_start);
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instance_id TEXT NOT NULL,
  entity_id TEXT,
  kind TEXT NOT NULL,
  severity TEXT NOT NULL,
  occurred_at INTEGER,
  observed_at INTEGER NOT NULL,
  origin TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL
);
CREATE INDEX events_observed_at ON events(observed_at DESC, id DESC);
`,
`
ALTER TABLE poll_state ADD COLUMN attempted_at INTEGER;
ALTER TABLE poll_state ADD COLUMN safe_error_code TEXT;
`
];

export function openDatabase(path: string): Database.Database {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const database = new Database(path);
  database.pragma('foreign_keys = ON');
  database.pragma('journal_mode = WAL');
  database.pragma('busy_timeout = 5000');
  database.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)');
  const applied = new Set((database.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map((row) => row.version));
  database.transaction(() => {
    migrations.forEach((migration, index) => {
      const version = index + 1;
      if (!applied.has(version)) { database.exec(migration); database.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(version, Date.now()); }
    });
  })();
  return database;
}

export function databaseIsReady(database: Database.Database): boolean {
  try { return database.prepare('SELECT 1 AS value').get() !== undefined; } catch { return false; }
}
