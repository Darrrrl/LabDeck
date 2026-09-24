import type Database from 'better-sqlite3';
import { persistEvent, retainEvents } from '../../core/events.js';
import { SafeTransportError } from '../../core/read-only-transport.js';
import type { IndexerHealth } from './adapter.js';

export class ProwlarrStateStore {
  historyAvailable = true;
  constructor(private readonly database: Database.Database) {}

  success(group: 'connection' | 'health', value: { version: string } | IndexerHealth, now = Date.now()): void {
    try { this.database.transaction(() => {
      if (group === 'health' && 'observedAt' in value) {
        const prior = this.database.prepare('SELECT normalized_json FROM capability_state WHERE instance_id=? AND capability=?').get('prowlarr', 'indexers.health') as { normalized_json: string } | undefined;
        this.database.prepare(`INSERT INTO capability_state(instance_id,capability,schema_version,observed_at,succeeded_at,normalized_json) VALUES ('prowlarr','indexers.health','1',?,?,?) ON CONFLICT(instance_id,capability) DO UPDATE SET observed_at=excluded.observed_at,succeeded_at=excluded.succeeded_at,normalized_json=excluded.normalized_json`).run(Date.parse(value.observedAt), now, JSON.stringify(value));
        if (prior) {
          const previous = JSON.parse(prior.normalized_json) as IndexerHealth;
          const states = new Map(previous.data.indexers.map((item) => [item.id, item.state]));
          for (const item of value.data.indexers) {
            const before = states.get(item.id);
            if (before && before !== item.state && (before === 'failing' || item.state === 'failing')) {
              persistEvent(this.database, { instanceId: 'prowlarr', entityId: `indexer:${item.id}`, kind: item.state === 'failing' ? 'indexer.failure-observed' : 'indexer.failure-cleared', severity: item.state === 'failing' ? 'warning' : 'info', observedAt: now, origin: 'observed', dedupeKey: `prowlarr:indexer:${item.id}:${item.state}:${now}`, payload: { indexer: item.name } });
            }
          }
        }
      }
      this.database.prepare(`INSERT INTO poll_state(instance_id,group_id,last_success_at,attempted_at,safe_error_code) VALUES ('prowlarr',?,?,?,NULL) ON CONFLICT(instance_id,group_id) DO UPDATE SET last_success_at=excluded.last_success_at,attempted_at=excluded.attempted_at,safe_error_code=NULL`).run(group, now, now);
      if (group === 'connection') {
        const prior = this.database.prepare('SELECT consecutive_failures,succeeded_at FROM integration_state WHERE instance_id=?').get('prowlarr') as { consecutive_failures: number; succeeded_at: number | null } | undefined;
        this.database.prepare(`INSERT INTO integration_state(instance_id,config_revision,connection,attempted_at,succeeded_at,safe_error_code,consecutive_failures) VALUES ('prowlarr','1','reachable',?,?,NULL,0) ON CONFLICT(instance_id) DO UPDATE SET connection='reachable',attempted_at=excluded.attempted_at,succeeded_at=excluded.succeeded_at,safe_error_code=NULL,consecutive_failures=0`).run(now, now);
        if (prior && prior.consecutive_failures >= 2 && prior.succeeded_at) persistEvent(this.database, { instanceId: 'prowlarr', kind: 'integration.recovered', severity: 'info', observedAt: now, origin: 'observed', dedupeKey: `prowlarr:recovered:${now}`, payload: { integration: 'prowlarr' } });
      }
      retainEvents(this.database, now);
    })(); } catch { this.historyAvailable = false; }
  }

  failure(group: 'connection' | 'health', error: unknown, now = Date.now()): void {
    const code = error instanceof SafeTransportError ? error.code : 'internal';
    try { this.database.transaction(() => {
      this.database.prepare(`INSERT INTO poll_state(instance_id,group_id,attempted_at,safe_error_code) VALUES ('prowlarr',?,?,?) ON CONFLICT(instance_id,group_id) DO UPDATE SET attempted_at=excluded.attempted_at,safe_error_code=excluded.safe_error_code`).run(group, now, code);
      if (group === 'connection') {
        const prior = this.database.prepare('SELECT consecutive_failures,succeeded_at FROM integration_state WHERE instance_id=?').get('prowlarr') as { consecutive_failures: number; succeeded_at: number | null } | undefined;
        const failures = (prior?.consecutive_failures ?? 0) + 1;
        this.database.prepare(`INSERT INTO integration_state(instance_id,config_revision,connection,attempted_at,safe_error_code,consecutive_failures) VALUES ('prowlarr','1',?,?,?,?) ON CONFLICT(instance_id) DO UPDATE SET connection=excluded.connection,attempted_at=excluded.attempted_at,safe_error_code=excluded.safe_error_code,consecutive_failures=excluded.consecutive_failures`).run(code === 'auth' ? 'auth-error' : 'unreachable', now, code, failures);
        if (failures === 2 && prior?.succeeded_at) persistEvent(this.database, { instanceId: 'prowlarr', kind: 'integration.outage', severity: 'warning', observedAt: now, origin: 'observed', dedupeKey: `prowlarr:outage:${now}`, payload: { integration: 'prowlarr', errorCode: code } });
      }
    })(); } catch { this.historyAvailable = false; }
  }
}
