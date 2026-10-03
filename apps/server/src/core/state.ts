import type Database from 'better-sqlite3';
import type { HostCollectorSnapshot } from '@labdeck/contracts';
import { recordForecastDays } from './storage-forecast.js';
import { persistEvent, retainEvents } from './events.js';
import { persistMetrics, type MetricObservation } from './metrics.js';

const HOST_INSTANCE = 'host';
const HOST_GROUP = 'snapshot';
type DockerCapability = NonNullable<HostCollectorSnapshot['capabilities']['docker']>;

function observations(snapshot: HostCollectorSnapshot): MetricObservation[] {
  const result: MetricObservation[] = [];
  const summary = snapshot.capabilities.summary;
  if (summary.status === 'ok') {
    const at = Date.parse(summary.observedAt);
    result.push(
      { instanceId: HOST_INSTANCE, entityId: snapshot.hostId, name: 'cpu.utilization', unit: 'percent', value: summary.data.cpu.utilizationPercent, observedAt: at },
      { instanceId: HOST_INSTANCE, entityId: snapshot.hostId, name: 'memory.used', unit: 'bytes', value: summary.data.memory.usedBytes, observedAt: at },
      { instanceId: HOST_INSTANCE, entityId: snapshot.hostId, name: 'swap.used', unit: 'bytes', value: summary.data.swap.usedBytes, observedAt: at }
    );
  }
  const filesystems = snapshot.capabilities.filesystems;
  if (filesystems.status === 'ok') for (const filesystem of filesystems.data) {
    result.push(
      { instanceId: HOST_INSTANCE, entityId: `filesystem:${filesystem.id}`, name: 'filesystem.used', unit: 'bytes', value: filesystem.usedBytes, observedAt: Date.parse(filesystems.observedAt) },
      { instanceId: HOST_INSTANCE, entityId: `filesystem:${filesystem.id}`, name: 'filesystem.available', unit: 'bytes', value: filesystem.availableBytes, observedAt: Date.parse(filesystems.observedAt) }
    );
  }
  const interfaces = snapshot.capabilities.interfaces;
  if (interfaces.status === 'ok') for (const networkInterface of interfaces.data) {
    result.push(
      { instanceId: HOST_INSTANCE, entityId: `interface:${networkInterface.id}`, name: 'network.receive', unit: 'bytes/s', value: networkInterface.receiveBytesPerSecond, observedAt: Date.parse(interfaces.observedAt) },
      { instanceId: HOST_INSTANCE, entityId: `interface:${networkInterface.id}`, name: 'network.transmit', unit: 'bytes/s', value: networkInterface.transmitBytesPerSecond, observedAt: Date.parse(interfaces.observedAt) }
    );
  }
  const blockIo = snapshot.capabilities.blockIo;
  if (blockIo.status === 'ok') for (const device of blockIo.data) {
    result.push(
      { instanceId: HOST_INSTANCE, entityId: `block:${device.id}`, name: 'disk.read', unit: 'bytes/s', value: device.readBytesPerSecond, observedAt: Date.parse(blockIo.observedAt) },
      { instanceId: HOST_INSTANCE, entityId: `block:${device.id}`, name: 'disk.write', unit: 'bytes/s', value: device.writeBytesPerSecond, observedAt: Date.parse(blockIo.observedAt) }
    );
  }
  return result;
}

function previousFilesystemRatios(database: Database.Database): Map<string, number> {
  const row = database.prepare(`SELECT normalized_json FROM capability_state
    WHERE instance_id = ? AND capability = 'host.filesystems'`).get(HOST_INSTANCE) as { normalized_json: string } | undefined;
  if (!row) return new Map();
  try {
    const parsed = JSON.parse(row.normalized_json) as { data?: { id?: unknown; usedRatio?: unknown }[] };
    return new Map((parsed.data ?? []).flatMap((item) => typeof item.id === 'string' && typeof item.usedRatio === 'number' ? [[item.id, item.usedRatio]] : []));
  } catch { return new Map(); }
}

function previousDocker(database: Database.Database): DockerCapability | undefined {
  const row = database.prepare(`SELECT normalized_json FROM capability_state WHERE instance_id='host' AND capability='containers.inventory'`).get() as { normalized_json: string } | undefined;
  if (!row) return undefined;
  try { return JSON.parse(row.normalized_json) as DockerCapability; } catch { return undefined; }
}

export class HostStateStore {
  constructor(private readonly database: Database.Database) {}

  ingest(snapshot: HostCollectorSnapshot, attemptedAt = Date.now()): 'ingested' | 'duplicate' {
    return this.database.transaction(() => {
      const poll = this.database.prepare('SELECT generation, sequence FROM poll_state WHERE instance_id = ? AND group_id = ?')
        .get(HOST_INSTANCE, HOST_GROUP) as { generation: string | null; sequence: number | null } | undefined;
      if (poll?.generation === snapshot.generation && poll.sequence !== null && snapshot.sequence <= poll.sequence) {
        this.database.prepare(`INSERT INTO integration_state(instance_id, config_revision, connection, attempted_at, consecutive_failures)
          VALUES (?, '1', 'reachable', ?, 0)
          ON CONFLICT(instance_id) DO UPDATE SET connection = 'reachable', attempted_at = excluded.attempted_at`)
          .run(HOST_INSTANCE, attemptedAt);
        return 'duplicate';
      }

      const previous = this.database.prepare('SELECT consecutive_failures, succeeded_at FROM integration_state WHERE instance_id = ?')
        .get(HOST_INSTANCE) as { consecutive_failures: number; succeeded_at: number | null } | undefined;
      const oldRatios = previousFilesystemRatios(this.database);
      const oldDocker = previousDocker(this.database);
      for (const [name, capability] of Object.entries(snapshot.capabilities)) {
        if (!capability || capability.status !== 'ok') continue;
        if (name === 'docker' && oldDocker?.observedAt === capability.observedAt) continue;
        if (name === 'docker' && snapshot.capabilities.docker?.status === 'ok' && !snapshot.capabilities.docker.data.inventoryComplete && oldDocker?.status === 'ok') {
          const retained = { ...oldDocker, completeness: 'partial', data: { ...oldDocker.data, inventoryComplete: false } };
          this.database.prepare("UPDATE capability_state SET normalized_json=? WHERE instance_id='host' AND capability='containers.inventory'").run(JSON.stringify(retained));
          continue;
        }
        if (name === 'tailscale') {
          const old = this.database.prepare("SELECT observed_at FROM capability_state WHERE instance_id='host' AND capability='network.peers'").get() as { observed_at: number } | undefined;
          if (old?.observed_at === Date.parse(capability.observedAt) || old && capability.completeness === 'partial') continue;
        }
        let normalized: unknown = capability;
        if (name === 'fileShares' && snapshot.capabilities.fileShares?.status === 'ok') {
          const previous = this.database.prepare("SELECT normalized_json FROM capability_state WHERE instance_id='host' AND capability='host.fileShares'").get() as { normalized_json: string } | undefined;
          const old = previous ? JSON.parse(previous.normalized_json) as { data: { id: string; state: string; totalBytes: number | null; availableBytes: number | null; evidenceAt?: string | null; observedAt: string }[] } : undefined;
          normalized = { ...snapshot.capabilities.fileShares, data: snapshot.capabilities.fileShares.data.map((share) => {
            if (share.state === 'ok') return { ...share, evidenceAt: share.observedAt };
            const prior = old?.data.find((item) => item.id === share.id);
            return { ...share, totalBytes: prior?.totalBytes ?? null, availableBytes: prior?.availableBytes ?? null, evidenceAt: prior?.evidenceAt ?? (prior?.state === 'ok' ? prior.observedAt : null) };
          }) };
        }
        this.database.prepare(`INSERT INTO capability_state(instance_id, capability, schema_version, observed_at, succeeded_at, normalized_json)
          VALUES (?, ?, '1', ?, ?, ?)
          ON CONFLICT(instance_id, capability) DO UPDATE SET schema_version = excluded.schema_version,
          observed_at = excluded.observed_at, succeeded_at = excluded.succeeded_at, normalized_json = excluded.normalized_json`)
          .run(HOST_INSTANCE, name === 'docker' ? 'containers.inventory' : name === 'tailscale' ? 'network.peers' : `host.${name === 'blockIo' ? 'block-io' : name}`, Date.parse(capability.observedAt), attemptedAt, JSON.stringify(normalized));
      }

      const docker = snapshot.capabilities.docker;
      if (docker?.status === 'error') this.database.prepare(`INSERT INTO poll_state(instance_id,group_id,attempted_at,safe_error_code) VALUES ('host','docker',?,?) ON CONFLICT(instance_id,group_id) DO UPDATE SET attempted_at=excluded.attempted_at,safe_error_code=excluded.safe_error_code`).run(attemptedAt, docker.errorCode);
      else if (docker?.status === 'ok' && !docker.data.inventoryComplete) {
        this.database.prepare(`INSERT INTO poll_state(instance_id,group_id,attempted_at,safe_error_code) VALUES ('host','docker',?,'partial-inventory') ON CONFLICT(instance_id,group_id) DO UPDATE SET attempted_at=excluded.attempted_at,safe_error_code='partial-inventory'`).run(attemptedAt);
      } else if (docker?.status === 'ok' && oldDocker?.observedAt !== docker.observedAt) {
        this.database.prepare(`INSERT INTO poll_state(instance_id,group_id,last_success_at,attempted_at,safe_error_code) VALUES ('host','docker',?,?,NULL) ON CONFLICT(instance_id,group_id) DO UPDATE SET last_success_at=excluded.last_success_at,attempted_at=excluded.attempted_at,safe_error_code=NULL`).run(attemptedAt, attemptedAt);
        this.#dockerEvents(docker, oldDocker, attemptedAt);
      }
      const tailscale = snapshot.capabilities.tailscale;
      if (tailscale?.status === 'error') this.database.prepare(`INSERT INTO poll_state(instance_id,group_id,attempted_at,safe_error_code) VALUES ('host','tailscale',?,?) ON CONFLICT(instance_id,group_id) DO UPDATE SET attempted_at=excluded.attempted_at,safe_error_code=excluded.safe_error_code`).run(attemptedAt, tailscale.errorCode);
      else if (tailscale?.status === 'ok' && tailscale.completeness === 'partial') {
        this.database.prepare(`INSERT INTO poll_state(instance_id,group_id,attempted_at,safe_error_code) VALUES ('host','tailscale',?,'partial-inventory') ON CONFLICT(instance_id,group_id) DO UPDATE SET attempted_at=excluded.attempted_at,safe_error_code='partial-inventory'`).run(attemptedAt);
      } else if (tailscale?.status === 'ok') {
        const previousPoll = this.database.prepare("SELECT last_success_at FROM poll_state WHERE instance_id='host' AND group_id='tailscale'").get() as { last_success_at: number | null } | undefined;
        if (!previousPoll || previousPoll.last_success_at === null || previousPoll.last_success_at <= Date.parse(tailscale.observedAt)) this.database.prepare(`INSERT INTO poll_state(instance_id,group_id,last_success_at,attempted_at,safe_error_code) VALUES ('host','tailscale',?,?,NULL) ON CONFLICT(instance_id,group_id) DO UPDATE SET last_success_at=excluded.last_success_at,attempted_at=excluded.attempted_at,safe_error_code=NULL`).run(attemptedAt, attemptedAt);
      }

      this.database.prepare(`INSERT INTO poll_state(instance_id, group_id, generation, sequence, last_success_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(instance_id, group_id) DO UPDATE SET generation = excluded.generation, sequence = excluded.sequence,
        last_success_at = excluded.last_success_at`).run(HOST_INSTANCE, HOST_GROUP, snapshot.generation, snapshot.sequence, attemptedAt);
      this.database.prepare(`INSERT INTO integration_state(instance_id, config_revision, connection, attempted_at, succeeded_at, safe_error_code, consecutive_failures)
        VALUES (?, '1', 'reachable', ?, ?, NULL, 0)
        ON CONFLICT(instance_id) DO UPDATE SET connection = 'reachable', attempted_at = excluded.attempted_at,
        succeeded_at = excluded.succeeded_at, safe_error_code = NULL, consecutive_failures = 0`)
        .run(HOST_INSTANCE, attemptedAt, attemptedAt);

      persistMetrics(this.database, observations(snapshot), attemptedAt);
      recordForecastDays(this.database, snapshot, attemptedAt);
      this.#filesystemEvents(snapshot, oldRatios, attemptedAt);
      if (previous && previous.consecutive_failures >= 2 && previous.succeeded_at !== null) {
        persistEvent(this.database, {
          instanceId: HOST_INSTANCE, kind: 'integration.recovered', severity: 'info', observedAt: attemptedAt,
          origin: 'observed', dedupeKey: `host:recovered:${snapshot.generation}:${snapshot.sequence}`, payload: { integration: HOST_INSTANCE }
        });
      }
      retainEvents(this.database, attemptedAt);
      return 'ingested';
    })();
  }

  recordFailure(errorCode: string, attemptedAt = Date.now()): void {
    this.database.transaction(() => {
      const previous = this.database.prepare('SELECT consecutive_failures, succeeded_at FROM integration_state WHERE instance_id = ?')
        .get(HOST_INSTANCE) as { consecutive_failures: number; succeeded_at: number | null } | undefined;
      const failures = (previous?.consecutive_failures ?? 0) + 1;
      this.database.prepare(`INSERT INTO integration_state(instance_id, config_revision, connection, attempted_at, safe_error_code, consecutive_failures)
        VALUES (?, '1', 'unreachable', ?, ?, ?)
        ON CONFLICT(instance_id) DO UPDATE SET connection = 'unreachable', attempted_at = excluded.attempted_at,
        safe_error_code = excluded.safe_error_code, consecutive_failures = excluded.consecutive_failures`)
        .run(HOST_INSTANCE, attemptedAt, errorCode, failures);
      if (failures === 2 && previous?.succeeded_at !== null && previous?.succeeded_at !== undefined) {
        persistEvent(this.database, {
          instanceId: HOST_INSTANCE, kind: 'integration.outage', severity: 'warning', observedAt: attemptedAt,
          origin: 'observed', dedupeKey: `host:outage:${attemptedAt}`, payload: { integration: HOST_INSTANCE, errorCode }
        });
      }
    })();
  }

  #filesystemEvents(snapshot: HostCollectorSnapshot, previous: Map<string, number>, now: number): void {
    const filesystems = snapshot.capabilities.filesystems;
    if (filesystems.status !== 'ok') return;
    for (const filesystem of filesystems.data) {
      const before = previous.get(filesystem.id);
      const threshold = filesystem.usedRatio >= 0.95 ? 0.95 : filesystem.usedRatio >= 0.9 ? 0.9 : undefined;
      if (threshold !== undefined && (before === undefined || before < threshold)) {
        persistEvent(this.database, {
          instanceId: HOST_INSTANCE, entityId: `filesystem:${filesystem.id}`, kind: 'storage.threshold',
          severity: threshold === 0.95 ? 'critical' : 'warning', observedAt: now, origin: 'threshold',
          dedupeKey: `host:storage:${filesystem.id}:${threshold}:${snapshot.generation}:${snapshot.sequence}`,
          payload: { filesystemId: filesystem.id, usedRatio: filesystem.usedRatio, threshold }
        });
      } else if (before !== undefined && before >= 0.9 && filesystem.usedRatio < 0.9) {
        persistEvent(this.database, {
          instanceId: HOST_INSTANCE, entityId: `filesystem:${filesystem.id}`, kind: 'storage.recovered', severity: 'info',
          observedAt: now, origin: 'threshold', dedupeKey: `host:storage-recovered:${filesystem.id}:${snapshot.generation}:${snapshot.sequence}`,
          payload: { filesystemId: filesystem.id, usedRatio: filesystem.usedRatio }
        });
      }
    }
  }

  #dockerEvents(current: DockerCapability, previous: DockerCapability | undefined, now: number): void {
    if (current.status !== 'ok' || previous?.status !== 'ok') return;
    const oldById = new Map(previous.data.containers.map((item) => [item.id, item]));
    const oldByName = new Map(previous.data.containers.map((item) => [item.name, item.id]));
    for (const item of current.data.containers) {
      const before = oldById.get(item.id);
      if (before && item.restartCount !== null && before.restartCount !== null && item.restartCount > before.restartCount) {
        persistEvent(this.database, { instanceId: 'host', entityId: `container:${item.id}`, kind: 'container.restart-observed', severity: 'warning', observedAt: now, origin: 'observed', dedupeKey: `host:container:restart:${item.id}:${item.restartCount}`, payload: { name: item.name, restartCount: item.restartCount } });
      }
      const replacedId = oldByName.get(item.name);
      if (!before && replacedId && replacedId !== item.id && current.data.inventoryComplete && previous.data.inventoryComplete) {
        persistEvent(this.database, { instanceId: 'host', entityId: `container:${item.id}`, kind: 'container.recreated-observed', severity: 'info', observedAt: now, origin: 'observed', dedupeKey: `host:container:recreated:${item.id}`, payload: { name: item.name } });
      }
    }
  }
}

export class HostStateService {
  current: HostCollectorSnapshot | undefined;
  historyAvailable = true;

  constructor(private readonly store: HostStateStore) {}

  ingest(snapshot: HostCollectorSnapshot, now = Date.now()): 'ingested' | 'duplicate' | 'memory-only' {
    this.current = snapshot;
    try { return this.store.ingest(snapshot, now); }
    catch { this.historyAvailable = false; return 'memory-only'; }
  }

  fail(errorCode: string, now = Date.now()): void {
    try { this.store.recordFailure(errorCode, now); }
    catch { this.historyAvailable = false; }
  }
}
