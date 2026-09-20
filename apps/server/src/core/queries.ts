import type Database from 'better-sqlite3';
import type { EventsResponse, HostCollectorSnapshot, MediaResponse, MediaSession, OverviewResponse, StorageResponse, SystemResponse } from '@labdeck/contracts';

type Capability = HostCollectorSnapshot['capabilities'][keyof HostCollectorSnapshot['capabilities']];
type SummaryCapability = HostCollectorSnapshot['capabilities']['summary'];
type FilesystemsCapability = HostCollectorSnapshot['capabilities']['filesystems'];
type InterfacesCapability = HostCollectorSnapshot['capabilities']['interfaces'];
type BlockIoCapability = HostCollectorSnapshot['capabilities']['blockIo'];
type IntegrationRow = { connection: 'unknown' | 'reachable' | 'unreachable' | 'auth-error'; attempted_at: number | null; succeeded_at: number | null; safe_error_code: string | null };
type CapabilityRow = { observed_at: number; normalized_json: string };
type MetricRow = { bucket_start: number; count: number; expected_count: number; sum: number; last: number };
type PollRow = { attempted_at: number | null; last_success_at: number | null; safe_error_code: string | null };
type MediaCapability = { observedAt: string; data: { sessions: MediaSession[] } };
type LibraryCapability = { observedAt: string; data: { counts: { movies: number; series: number; episodes: number }; recent: { id: string; name: string; type: 'movie' | 'series' | 'episode' | 'other'; seriesName: string | null; addedAt: string | null }[] } };
interface MediaConfig { id: string; name: string; browserUrl: string }

const iso = (value: number | null): string | null => value === null ? null : new Date(value).toISOString();
const freshness = (observedAt: number | null, now: number): 'fresh' | 'stale' | 'never' => observedAt === null ? 'never' : now - observedAt > 30_000 ? 'stale' : 'fresh';

function parseCapability<T extends Capability>(row: CapabilityRow | undefined): T | undefined {
  if (!row) return undefined;
  try { return JSON.parse(row.normalized_json) as T; } catch { return undefined; }
}

export class HostQueries {
  constructor(
    private readonly database: Database.Database,
    private readonly configured: boolean,
    private readonly historyAvailable: () => boolean,
    private readonly now: () => number = Date.now,
    private readonly mediaConfig?: MediaConfig
  ) {}

  overview(): OverviewResponse {
    if (!this.configured && !this.mediaConfig) return { configured: false, overall: 'monitoring-incomplete', title: 'No integrations configured', message: 'Configure a supported integration to begin monitoring.' };
    const integration = this.integration();
    const summaryRow = this.capability('host.summary');
    const filesystemRow = this.capability('host.filesystems');
    const summary = parseCapability<SummaryCapability>(summaryRow);
    const filesystems = parseCapability<FilesystemsCapability>(filesystemRow);
    const interfaces = parseCapability<InterfacesCapability>(this.capability('host.interfaces'));
    const blockIo = parseCapability<BlockIoCapability>(this.capability('host.block-io'));
    const observedAt = summaryRow?.observed_at ?? null;
    const currentFreshness = freshness(observedAt, this.now());
    const storage = filesystems?.status === 'ok' ? filesystems.data[0] : undefined;
    const storageStatus = storage && storage.usedRatio >= 0.95 ? 'critical' : storage && storage.usedRatio >= 0.9 ? 'warning' : undefined;
    const media = this.mediaSummary();
    const mediaProblem = media?.connection === 'auth-error' || media?.connection === 'unreachable';
    const overall = storageStatus ?? (integration?.connection === 'unreachable' || mediaProblem ? 'warning' : currentFreshness === 'fresh' && (!media || media.freshness === 'fresh') ? 'healthy' : 'monitoring-incomplete');
    const title = overall === 'healthy' ? 'All observed systems healthy' : overall === 'critical' ? 'Critical storage pressure' : overall === 'warning' ? 'Needs attention' : 'Monitoring incomplete';
    const message = media?.connection === 'auth-error' ? 'Jellyfin rejected its configured credentials. Host observations remain available.'
      : media?.connection === 'unreachable' ? 'Jellyfin is unreachable. Showing its last successful observation.'
      : integration?.connection === 'unreachable'
      ? 'The host collector cannot be read. Showing the last successful observation.'
      : currentFreshness === 'stale' ? 'Host data is stale. Check the collector service and snapshot mount.'
      : currentFreshness === 'never' ? 'Waiting for the first valid host snapshot.'
      : 'Host metrics are current.';
    return {
      configured: true, overall, title, message, freshness: currentFreshness, observedAt: iso(observedAt),
      lastAttemptAt: iso(integration?.attempted_at ?? null), errorCode: integration?.safe_error_code ?? null,
      host: summary?.status === 'ok' ? summary.data : null,
      storage: storage ? { id: storage.id, path: storage.path, source: storage.source, fsType: storage.fsType, totalBytes: storage.totalBytes, usedBytes: storage.usedBytes, availableBytes: storage.availableBytes, reservedBytes: storage.reservedBytes, usedRatio: storage.usedRatio } : null,
      network: interfaces?.status === 'ok' ? interfaces.data[0] ?? null : null,
      diskIo: blockIo?.status === 'ok' ? blockIo.data[0] ?? null : null,
      media,
      events: this.events(5).events
    };
  }

  system(range: '1h' | '24h'): SystemResponse {
    const row = this.capability('host.summary');
    const summary = parseCapability<SummaryCapability>(row);
    const interfaces = parseCapability<InterfacesCapability>(this.capability('host.interfaces'));
    const blockIo = parseCapability<BlockIoCapability>(this.capability('host.block-io'));
    return {
      configured: this.configured, freshness: freshness(row?.observed_at ?? null, this.now()), observedAt: iso(row?.observed_at ?? null),
      data: summary?.status === 'ok' ? summary.data : null,
      interfaces: interfaces?.status === 'ok' ? interfaces.data : [], blockIo: blockIo?.status === 'ok' ? blockIo.data : [],
      trends: { range, cpu: this.metric('cpu.utilization', range), memory: this.metric('memory.used', range) }
    };
  }

  storage(range: '1h' | '24h'): StorageResponse {
    const row = this.capability('host.filesystems');
    const capability = parseCapability<FilesystemsCapability>(row);
    const filesystems = capability?.status === 'ok' ? capability.data.map((filesystem) => ({
      id: filesystem.id, path: filesystem.path, source: filesystem.source, fsType: filesystem.fsType,
      totalBytes: filesystem.totalBytes, usedBytes: filesystem.usedBytes, availableBytes: filesystem.availableBytes,
      reservedBytes: filesystem.reservedBytes, usedRatio: filesystem.usedRatio
    })) : [];
    return {
      configured: this.configured, freshness: freshness(row?.observed_at ?? null, this.now()), observedAt: iso(row?.observed_at ?? null), filesystems,
      history: Object.fromEntries(filesystems.map((filesystem) => [filesystem.id, this.metric('filesystem.used', range, `filesystem:${filesystem.id}`)]))
    };
  }

  events(limit = 50, before?: number): EventsResponse {
    const bounded = Math.max(1, Math.min(limit, 100));
    const rows = this.database.prepare(`SELECT id, entity_id, kind, severity, observed_at, payload_json FROM events
      WHERE (? IS NULL OR id < ?) ORDER BY observed_at DESC, id DESC LIMIT ?`).all(before ?? null, before ?? null, bounded + 1) as {
        id: number; entity_id: string | null; kind: string; severity: 'info' | 'warning' | 'critical'; observed_at: number; payload_json: string
      }[];
    const page = rows.slice(0, bounded);
    return {
      events: page.map((event) => ({ id: event.id, entityId: event.entity_id, kind: event.kind, severity: event.severity, observedAt: new Date(event.observed_at).toISOString(), payload: JSON.parse(event.payload_json) as Record<string, string | number | boolean | null> })),
      nextCursor: rows.length > bounded ? page.at(-1)?.id ?? null : null
    };
  }

  media(): MediaResponse {
    if (!this.mediaConfig) return { configured: false, name: null, browserUrl: null, connection: 'unknown', playback: { freshness: 'never', observedAt: null, lastSuccessfulRefreshAt: null, errorCode: null, sessions: [] }, library: { freshness: 'never', observedAt: null, lastSuccessfulRefreshAt: null, errorCode: null, counts: null, recent: [] } };
    const integration = this.integrationFor('jellyfin');
    const playbackRow = this.capabilityFor('jellyfin', 'media.playback'); const libraryRow = this.capabilityFor('jellyfin', 'media.library');
    const playback = parseJson<MediaCapability>(playbackRow?.normalized_json); const library = parseJson<LibraryCapability>(libraryRow?.normalized_json);
    const playbackPoll = this.poll('jellyfin', 'playback'); const libraryPoll = this.poll('jellyfin', 'library');
    return {
      configured: true, name: this.mediaConfig.name, browserUrl: this.mediaConfig.browserUrl, connection: integration?.connection ?? 'unknown',
      playback: { freshness: freshnessWith(playbackRow?.observed_at ?? null, this.now(), 30_000), observedAt: iso(playbackRow?.observed_at ?? null), lastSuccessfulRefreshAt: iso(playbackPoll?.last_success_at ?? null), errorCode: playbackPoll?.safe_error_code ?? null, sessions: playback?.data.sessions ?? [] },
      library: { freshness: freshnessWith(libraryRow?.observed_at ?? null, this.now(), 15 * 60_000), observedAt: iso(libraryRow?.observed_at ?? null), lastSuccessfulRefreshAt: iso(libraryPoll?.last_success_at ?? null), errorCode: libraryPoll?.safe_error_code ?? null, counts: library?.data.counts ?? null, recent: library?.data.recent ?? [] }
    };
  }

  settings(demoMode: boolean) {
    const integration = this.integration();
    const observedAt = this.capability('host.summary')?.observed_at ?? null;
    return {
      integrations: [
        ...(this.configured ? [{ id: 'host', name: 'Ubuntu host', connection: integration?.connection ?? 'unknown' as const, freshness: freshness(observedAt, this.now()), lastSuccessfulRefreshAt: iso(integration?.succeeded_at ?? null), safeErrorCode: integration?.safe_error_code ?? null }] : []),
        ...(this.mediaConfig ? [{ id: this.mediaConfig.id, name: this.mediaConfig.name, connection: this.integrationFor('jellyfin')?.connection ?? 'unknown' as const, freshness: this.media().playback.freshness, lastSuccessfulRefreshAt: this.media().playback.lastSuccessfulRefreshAt, safeErrorCode: this.integrationFor('jellyfin')?.safe_error_code ?? null }] : [])
      ],
      authentication: 'configured' as const, demoMode, version: '0.2.0',
      hostCollector: { configured: this.configured, historyAvailable: this.historyAvailable(), message: this.configured ? 'Reading the configured snapshot file. The application has no host command or privilege path.' : 'Set LABDECK_HOST_SNAPSHOT_PATH and mount the collector public directory read-only.' }
    };
  }

  #metricRows(name: string, range: '1h' | '24h', entityId?: string): MetricRow[] {
    const resolution = range === '1h' ? '1m' : '15m';
    const since = this.now() - (range === '1h' ? 60 * 60_000 : 24 * 60 * 60_000);
    return this.database.prepare(`SELECT b.bucket_start, b.count, b.expected_count, b.sum, b.last FROM metric_buckets b
      JOIN metric_series s ON s.series_id = b.series_id
      WHERE s.instance_id = 'host' AND s.metric_name = ? AND (? IS NULL OR s.entity_id = ?)
      AND b.resolution = ? AND b.bucket_start >= ? ORDER BY b.bucket_start`).all(name, entityId ?? null, entityId ?? null, resolution, since) as MetricRow[];
  }

  metric(name: string, range: '1h' | '24h', entityId?: string) {
    return this.#metricRows(name, range, entityId).map((row) => ({
      at: new Date(row.bucket_start).toISOString(), value: name === 'cpu.utilization' ? row.sum / row.count : row.last,
      coverage: Math.min(1, row.count / row.expected_count)
    }));
  }

  integration(): IntegrationRow | undefined {
    return this.database.prepare('SELECT connection, attempted_at, succeeded_at, safe_error_code FROM integration_state WHERE instance_id = ?').get('host') as IntegrationRow | undefined;
  }

  integrationFor(instance: string): IntegrationRow | undefined { return this.database.prepare('SELECT connection, attempted_at, succeeded_at, safe_error_code FROM integration_state WHERE instance_id = ?').get(instance) as IntegrationRow | undefined; }
  capabilityFor(instance: string, name: string): (CapabilityRow & { normalized_json: string }) | undefined { return this.database.prepare('SELECT observed_at, normalized_json FROM capability_state WHERE instance_id=? AND capability=?').get(instance, name) as (CapabilityRow & { normalized_json: string }) | undefined; }
  poll(instance: string, group: string): PollRow | undefined { return this.database.prepare('SELECT attempted_at,last_success_at,safe_error_code FROM poll_state WHERE instance_id=? AND group_id=?').get(instance, group) as PollRow | undefined; }

  private mediaSummary() {
    if (!this.mediaConfig) return null;
    const media = this.media();
    return { id: this.mediaConfig.id, name: this.mediaConfig.name, browserUrl: this.mediaConfig.browserUrl, connection: media.connection, freshness: media.playback.freshness, observedAt: media.playback.observedAt, lastSuccessfulRefreshAt: media.playback.lastSuccessfulRefreshAt, errorCode: media.playback.errorCode, sessions: media.playback.sessions };
  }

  capability(name: string): CapabilityRow | undefined {
    return this.database.prepare('SELECT observed_at, normalized_json FROM capability_state WHERE instance_id = ? AND capability = ?').get('host', name) as CapabilityRow | undefined;
  }
}

function parseJson<T>(value: string | undefined): T | undefined { if (!value) return undefined; try { return JSON.parse(value) as T; } catch { return undefined; } }
function freshnessWith(observedAt: number | null, now: number, staleAfter: number): 'fresh' | 'stale' | 'never' { return observedAt === null ? 'never' : now - observedAt > staleAfter ? 'stale' : 'fresh'; }
