import type Database from 'better-sqlite3';
import { persistEvent, retainEvents } from '../../core/events.js';
import { SafeTransportError } from '../../core/read-only-transport.js';
import type { LibraryObservation, PlaybackObservation } from './adapter.js';

const INSTANCE = 'jellyfin';
type Group = 'connection' | 'playback' | 'library';

export class JellyfinStateStore {
  historyAvailable = true;
  constructor(private readonly database: Database.Database) {}

  success(group: Group, observation: PlaybackObservation | LibraryObservation | { version: string }, now = Date.now()): void {
    try { this.database.transaction(() => {
      const oldSessions = group === 'playback' ? this.previousSessions() : undefined;
      if ('observedAt' in observation) {
        const capability = group === 'playback' ? 'media.playback' : 'media.library';
        this.database.prepare(`INSERT INTO capability_state(instance_id, capability, schema_version, observed_at, succeeded_at, normalized_json)
          VALUES (?, ?, '1', ?, ?, ?) ON CONFLICT(instance_id, capability) DO UPDATE SET observed_at=excluded.observed_at,
          succeeded_at=excluded.succeeded_at, normalized_json=excluded.normalized_json`).run(INSTANCE, capability, Date.parse(observation.observedAt), now, JSON.stringify(observation));
      }
      this.database.prepare(`INSERT INTO poll_state(instance_id, group_id, last_success_at, attempted_at, safe_error_code, cursor_json)
        VALUES (?, ?, ?, ?, NULL, ?) ON CONFLICT(instance_id, group_id) DO UPDATE SET last_success_at=excluded.last_success_at,
        attempted_at=excluded.attempted_at, safe_error_code=NULL, cursor_json=COALESCE(excluded.cursor_json,poll_state.cursor_json)`)
        .run(INSTANCE, group, now, now, group === 'playback' ? JSON.stringify(sessionKeys(observation as PlaybackObservation)) : null);
      if (group === 'connection') this.connectionSuccess(now);
      if (group === 'playback' && oldSessions !== undefined) this.playbackEvents(oldSessions, observation as PlaybackObservation, now);
      retainEvents(this.database, now);
    })(); } catch { this.historyAvailable = false; }
  }

  failure(group: Group, error: unknown, now = Date.now()): void {
    const code = error instanceof SafeTransportError ? error.code : error instanceof Error && error.message === 'invalid-response' ? 'invalid-response' : 'internal';
    try { this.database.transaction(() => {
      this.database.prepare(`INSERT INTO poll_state(instance_id, group_id, attempted_at, safe_error_code)
        VALUES (?, ?, ?, ?) ON CONFLICT(instance_id, group_id) DO UPDATE SET attempted_at=excluded.attempted_at, safe_error_code=excluded.safe_error_code`).run(INSTANCE, group, now, code);
      if (group === 'connection') {
        const previous = this.database.prepare('SELECT consecutive_failures, succeeded_at FROM integration_state WHERE instance_id=?').get(INSTANCE) as { consecutive_failures: number; succeeded_at: number | null } | undefined;
        const failures = (previous?.consecutive_failures ?? 0) + 1; const connection = code === 'auth' ? 'auth-error' : 'unreachable';
        this.database.prepare(`INSERT INTO integration_state(instance_id,config_revision,connection,attempted_at,safe_error_code,consecutive_failures)
          VALUES (?,'1',?,?,?,?) ON CONFLICT(instance_id) DO UPDATE SET connection=excluded.connection,attempted_at=excluded.attempted_at,safe_error_code=excluded.safe_error_code,consecutive_failures=excluded.consecutive_failures`)
          .run(INSTANCE, connection, now, code, failures);
        if (failures === 2 && previous?.succeeded_at) persistEvent(this.database, { instanceId: INSTANCE, kind: 'integration.outage', severity: 'warning', observedAt: now, origin: 'observed', dedupeKey: `${INSTANCE}:outage:${now}`, payload: { integration: INSTANCE, errorCode: code } });
      }
      retainEvents(this.database, now);
    })(); } catch { this.historyAvailable = false; }
  }

  private connectionSuccess(now: number): void {
    const previous = this.database.prepare('SELECT consecutive_failures,succeeded_at FROM integration_state WHERE instance_id=?').get(INSTANCE) as { consecutive_failures: number; succeeded_at: number | null } | undefined;
    this.database.prepare(`INSERT INTO integration_state(instance_id,config_revision,connection,attempted_at,succeeded_at,safe_error_code,consecutive_failures)
      VALUES (?,'1','reachable',?,?,NULL,0) ON CONFLICT(instance_id) DO UPDATE SET connection='reachable',attempted_at=excluded.attempted_at,succeeded_at=excluded.succeeded_at,safe_error_code=NULL,consecutive_failures=0`).run(INSTANCE, now, now);
    if (previous && previous.consecutive_failures >= 2 && previous.succeeded_at) persistEvent(this.database, { instanceId: INSTANCE, kind: 'integration.recovered', severity: 'info', observedAt: now, origin: 'observed', dedupeKey: `${INSTANCE}:recovered:${now}`, payload: { integration: INSTANCE } });
  }
  private previousSessions(): Set<string> | undefined {
    const row = this.database.prepare('SELECT cursor_json FROM poll_state WHERE instance_id=? AND group_id=?').get(INSTANCE, 'playback') as { cursor_json: string | null } | undefined;
    if (!row?.cursor_json) return undefined;
    try { return new Set(JSON.parse(row.cursor_json) as string[]); } catch { return undefined; }
  }
  private playbackEvents(previous: Set<string>, observation: PlaybackObservation, now: number): void {
    for (const session of observation.data.sessions) {
      const key = `${session.id}:${session.mediaId}`; if (previous.has(key)) continue;
      persistEvent(this.database, { instanceId: INSTANCE, entityId: `session:${session.id}`, kind: 'media.playback-observed', severity: 'info', observedAt: now, origin: 'observed', dedupeKey: `${INSTANCE}:playback:${key}:${now}`, payload: { userName: session.userName, title: session.title, paused: session.paused, mode: session.playbackMode } });
    }
  }
}
function sessionKeys(observation: PlaybackObservation): string[] { return observation.data.sessions.map((session) => `${session.id}:${session.mediaId}`).sort(); }
