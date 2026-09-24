import type Database from 'better-sqlite3';
import type { SmartSnapshot } from '@labdeck/contracts';
import { persistEvent, retainEvents } from '../../core/events.js';

type Disk = SmartSnapshot['disks'][number] & { evidenceAt: string | null };
type Cursor = Record<string, { identity: string; hot: number; cool: number; active: boolean }>;

export class SmartStateStore {
  historyAvailable = true;
  constructor(private readonly database: Database.Database) {}

  ingest(snapshot: SmartSnapshot, now = Date.now()): void {
    try { this.database.transaction(() => {
      const prior = this.database.prepare("SELECT observed_at,normalized_json FROM capability_state WHERE instance_id='smart' AND capability='smart.disks'").get() as { observed_at: number; normalized_json: string } | undefined;
      if (prior && Date.parse(snapshot.generatedAt) <= prior.observed_at) return;
      const previous = prior ? JSON.parse(prior.normalized_json) as { disks: Disk[] } : { disks: [] };
      const old = new Map(previous.disks.map((disk) => [disk.id, disk]));
      const poll = this.database.prepare("SELECT cursor_json FROM poll_state WHERE instance_id='smart' AND group_id='snapshot'").get() as { cursor_json: string | null } | undefined;
      let cursor: Cursor = {}; try { if (poll?.cursor_json) cursor = JSON.parse(poll.cursor_json) as Cursor; } catch { cursor = {}; }
      const nextCursor: Cursor = { ...cursor };
      const disks: Disk[] = snapshot.disks.map((disk) => {
        const before = old.get(disk.id);
        if (disk.state !== 'ok') return before ? { ...before, state: disk.state, observedAt: disk.observedAt } : { ...disk, evidenceAt: null };
        const current: Disk = { ...disk, evidenceAt: disk.observedAt };
        const sameIdentity = !!before?.identity && before.identity === disk.identity;
        const previousCursor = nextCursor[disk.id];
        const episode = previousCursor?.identity === disk.identity ? previousCursor : { identity: disk.identity, hot: 0, cool: 0, active: false };
        if (before?.identity && disk.identity && before.identity !== disk.identity) {
          persistEvent(this.database, { instanceId: 'smart', entityId: `disk:${disk.id}`, kind: 'disk.replaced-observed', severity: 'info', observedAt: now, origin: 'observed', dedupeKey: `smart:${disk.id}:replaced:${disk.identity}`, payload: { diskId: disk.id } });
        }
        if (disk.health === 'failed' && (!sameIdentity || before?.health !== 'failed')) this.event('disk.smart-failed', 'critical', disk.id, snapshot.generatedAt, now);
        if (disk.health === 'warning' && (!sameIdentity || before?.health !== 'warning')) this.event('disk.smart-warning', 'warning', disk.id, snapshot.generatedAt, now);
        if (sameIdentity && before?.capacityBytes !== null && disk.capacityBytes !== null && before.capacityBytes !== disk.capacityBytes) this.event('disk.capacity-changed', 'info', disk.id, snapshot.generatedAt, now);
        if (sameIdentity && before?.state === 'ok') {
          for (const [name, previousValue, currentValue] of [
            ['ata.pending', before.ata?.pending, disk.ata?.pending], ['ata.uncorrectable', before.ata?.uncorrectable, disk.ata?.uncorrectable],
            ['nvme.mediaErrors', before.nvme?.mediaErrors, disk.nvme?.mediaErrors], ['nvme.errorLogEntries', before.nvme?.errorLogEntries, disk.nvme?.errorLogEntries],
            ['scsi.readUncorrected', before.scsi?.readUncorrected, disk.scsi?.readUncorrected]
          ] as const) {
            if (previousValue && currentValue && BigInt(currentValue) > BigInt(previousValue)) this.event('disk.error-increase', 'warning', disk.id, snapshot.generatedAt, now, { counter: name });
          }
        }
        if (disk.temperatureCelsius !== null) {
          if (disk.temperatureCelsius >= 45) { episode.hot += 1; episode.cool = 0; if (!episode.active && episode.hot >= 2) { episode.active = true; this.event('disk.temperature-high', 'warning', disk.id, snapshot.generatedAt, now); } }
          else if (disk.temperatureCelsius < 42) { episode.cool += 1; episode.hot = 0; if (episode.active && episode.cool >= 2) { episode.active = false; this.event('disk.temperature-recovered', 'info', disk.id, snapshot.generatedAt, now); } }
          else { episode.hot = 0; episode.cool = 0; }
        }
        nextCursor[disk.id] = episode;
        return current;
      });
      this.database.prepare(`INSERT INTO capability_state(instance_id,capability,schema_version,observed_at,succeeded_at,normalized_json) VALUES ('smart','smart.disks','1',?,?,?) ON CONFLICT(instance_id,capability) DO UPDATE SET observed_at=excluded.observed_at,succeeded_at=excluded.succeeded_at,normalized_json=excluded.normalized_json`).run(Date.parse(snapshot.generatedAt), now, JSON.stringify({ disks }));
      this.database.prepare(`INSERT INTO poll_state(instance_id,group_id,cursor_json,last_success_at,attempted_at,safe_error_code) VALUES ('smart','snapshot',?,?,?,NULL) ON CONFLICT(instance_id,group_id) DO UPDATE SET cursor_json=excluded.cursor_json,last_success_at=excluded.last_success_at,attempted_at=excluded.attempted_at,safe_error_code=NULL`).run(JSON.stringify(nextCursor), now, now);
      this.database.prepare(`INSERT INTO integration_state(instance_id,config_revision,connection,attempted_at,succeeded_at,safe_error_code,consecutive_failures) VALUES ('smart','1','reachable',?,?,NULL,0) ON CONFLICT(instance_id) DO UPDATE SET connection='reachable',attempted_at=excluded.attempted_at,succeeded_at=excluded.succeeded_at,safe_error_code=NULL,consecutive_failures=0`).run(now, now);
      retainEvents(this.database, now);
    })(); } catch (error) { this.historyAvailable = false; throw error; }
  }

  failure(code: string, now = Date.now()): void {
    try { this.database.prepare(`INSERT INTO poll_state(instance_id,group_id,attempted_at,safe_error_code) VALUES ('smart','snapshot',?,?) ON CONFLICT(instance_id,group_id) DO UPDATE SET attempted_at=excluded.attempted_at,safe_error_code=excluded.safe_error_code`).run(now, code); }
    catch { this.historyAvailable = false; }
  }

  private event(kind: string, severity: 'info' | 'warning' | 'critical', diskId: string, generation: string, now: number, extra: Record<string, string> = {}) {
    persistEvent(this.database, { instanceId: 'smart', entityId: `disk:${diskId}`, kind, severity, observedAt: now, origin: 'observed', dedupeKey: `smart:${diskId}:${kind}:${generation}`, payload: { diskId, ...extra } });
  }
}
