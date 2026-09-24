import type Database from 'better-sqlite3';
import type { ContainersResponse, DownloadsResponse, EventsResponse, HostCollectorSnapshot, IndexerHealthResponse, MediaResponse, MediaSession, OverviewResponse, StorageResponse, SystemResponse } from '@labdeck/contracts';

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
interface DownloadConfig { id: 'sonarr' | 'radarr'; name: string; browserUrl: string }
interface IndexerConfig { id: 'prowlarr'; name: string; browserUrl: string }

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
    private readonly mediaConfig?: MediaConfig,
    private readonly downloadConfigs: DownloadConfig[] = [],
    private readonly indexerConfig?: IndexerConfig,
    private readonly expectedRunningContainers: ReadonlySet<string> = new Set(),
    private readonly smartConfigured = false
  ) {}

  overview(): OverviewResponse {
    if (!this.configured && !this.mediaConfig && this.downloadConfigs.length === 0 && !this.indexerConfig && !this.smartConfigured) return { configured: false, overall: 'monitoring-incomplete', title: 'No integrations configured', message: 'Configure a supported integration to begin monitoring.' };
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
    const downloads = this.downloadServices();
    const indexers = this.indexers();
    const containers = this.containers();
    const disks = this.smart();
    const serviceProblem = [media?.connection, ...downloads.map((item) => item.connection), indexers?.connection].some((connection) => connection === 'auth-error' || connection === 'unreachable');
    const indexerProblem = !!indexers && indexers.freshness === 'fresh' && ((indexers.failingTotal ?? 0) > 0 || indexers.warnings.some((item) => item.severity === 'warning' || item.severity === 'error'));
    const containerProblem = containers.configured && containers.freshness === 'fresh' && ((containers.unhealthy ?? 0) > 0 || (containers.expectedStopped ?? 0) > 0);
    const overall = disks.configured && disks.freshness === 'fresh' && disks.failed > 0 ? 'critical' : storageStatus === 'critical' ? 'critical' : storageStatus === 'warning' || integration?.connection === 'unreachable' || serviceProblem || indexerProblem || containerProblem || disks.configured && disks.freshness === 'fresh' && disks.warning > 0 ? 'warning' : (!this.configured || currentFreshness === 'fresh') && (!media || media.freshness === 'fresh') && (!indexers || indexers.freshness === 'fresh' && indexers.connection === 'reachable') && (!containers.configured || containers.freshness === 'fresh') && (!disks.configured || disks.freshness === 'fresh') ? 'healthy' : 'monitoring-incomplete';
    const title = overall === 'healthy' ? 'All observed systems healthy' : overall === 'critical' ? disks.freshness === 'fresh' && disks.failed > 0 ? 'Critical disk health evidence' : 'Critical storage pressure' : overall === 'warning' ? 'Needs attention' : 'Monitoring incomplete';
    const message = disks.configured && disks.freshness === 'fresh' && disks.failed > 0 ? 'A physical disk reports SMART failure evidence.'
      : media?.connection === 'auth-error' ? 'Jellyfin rejected its configured credentials. Host observations remain available.'
      : media?.connection === 'unreachable' ? 'Jellyfin is unreachable. Showing its last successful observation.'
      : downloads.some((item) => item.connection === 'auth-error') ? 'A download service rejected its configured credentials. Other observations remain available.'
      : downloads.some((item) => item.connection === 'unreachable') ? 'A download service is unreachable. Showing its last successful observation.'
      : indexers?.connection === 'auth-error' ? 'Prowlarr rejected its configured credentials. Other observations remain available.'
      : indexers?.connection === 'unreachable' ? 'Prowlarr is unreachable. Showing its last successful observation.'
      : indexerProblem ? 'Prowlarr reports indexer or service health issues.'
      : containerProblem ? 'A container healthcheck failed or an expected container is not running.'
      : disks.configured && disks.freshness === 'fresh' && disks.warning > 0 ? 'A physical disk reports a SMART warning.'
      : disks.configured && disks.freshness !== 'fresh' ? 'SMART evidence is missing or stale.'
      : indexers && indexers.freshness !== 'fresh' ? 'Prowlarr health evidence is missing or stale.'
      : containers.configured && containers.freshness !== 'fresh' ? 'Docker observation is missing or stale.'
      : integration?.connection === 'unreachable'
      ? 'The host collector cannot be read. Showing the last successful observation.'
      : currentFreshness === 'stale' ? 'Host data is stale. Check the collector service and snapshot mount.'
      : this.configured && currentFreshness === 'never' ? 'Waiting for the first valid host snapshot.'
      : this.configured ? 'Host metrics are current.' : 'Configured services are current.';
    return {
      configured: true, overall, title, message, freshness: currentFreshness, observedAt: iso(observedAt),
      lastAttemptAt: iso(integration?.attempted_at ?? null), errorCode: integration?.safe_error_code ?? null,
      host: summary?.status === 'ok' ? summary.data : null,
      storage: storage ? { id: storage.id, path: storage.path, source: storage.source, fsType: storage.fsType, totalBytes: storage.totalBytes, usedBytes: storage.usedBytes, availableBytes: storage.availableBytes, reservedBytes: storage.reservedBytes, usedRatio: storage.usedRatio } : null,
      network: interfaces?.status === 'ok' ? interfaces.data[0] ?? null : null,
      diskIo: blockIo?.status === 'ok' ? blockIo.data[0] ?? null : null,
      media, downloads, indexers, containers: containers.configured ? { configured: true, freshness: containers.freshness, observedAt: containers.observedAt, errorCode: containers.errorCode, inventoryComplete: containers.inventoryComplete, total: containers.total, running: containers.running, unhealthy: containers.unhealthy, expectedStopped: containers.expectedStopped } : null,
      disks: disks.configured ? { configured: true, freshness: disks.freshness, observedAt: disks.observedAt, errorCode: disks.errorCode, failed: disks.failed, warning: disks.warning, unavailable: disks.unavailable } : null,
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
      history: Object.fromEntries(filesystems.map((filesystem) => [filesystem.id, this.metric('filesystem.used', range, `filesystem:${filesystem.id}`)])), smart: this.smart()
    };
  }

  smart(): StorageResponse['smart'] {
    const row = this.capabilityFor('smart', 'smart.disks');
    const observed = parseJson<{ disks: Omit<StorageResponse['smart']['disks'][number], 'temperatureWarning'>[] }>(row?.normalized_json);
    const poll = this.poll('smart', 'snapshot');
    let cursor: Record<string, { active?: boolean }> = {};
    try { const cursorRow = this.database.prepare("SELECT cursor_json FROM poll_state WHERE instance_id='smart' AND group_id='snapshot'").get() as { cursor_json: string | null } | undefined; if (cursorRow?.cursor_json) cursor = JSON.parse(cursorRow.cursor_json) as typeof cursor; } catch { cursor = {}; }
    const disks = (observed?.disks ?? []).map((disk) => ({ ...disk, temperatureWarning: cursor[disk.id]?.active === true }));
    return { configured: this.smartConfigured, freshness: freshnessWith(row?.observed_at ?? null, this.now(), 30 * 60_000), observedAt: iso(row?.observed_at ?? null), errorCode: poll?.safe_error_code ?? null,
      failed: disks.filter((disk) => disk.state === 'ok' && disk.health === 'failed').length,
      warning: disks.filter((disk) => disk.state === 'ok' && (disk.health === 'warning' || disk.temperatureWarning)).length,
      unavailable: disks.filter((disk) => disk.state !== 'ok').length, disks };
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

  downloads(): DownloadsResponse { return { configured: this.downloadConfigs.length > 0 || !!this.indexerConfig, services: this.downloadServices(), indexers: this.indexers() }; }

  containers(): ContainersResponse {
    const row = this.capabilityFor('host', 'containers.inventory');
    const observed = parseJson<{ data: { inventoryComplete: boolean; containers: Omit<ContainersResponse['containers'][number], 'expectedRunning'>[] } }>(row?.normalized_json);
    const poll = this.poll('host', 'docker');
    const containers = (observed?.data.containers ?? []).map((item) => ({ ...item, expectedRunning: this.expectedRunningContainers.has(item.name) }));
    return { configured: !!row || !!poll, freshness: freshnessWith(row?.observed_at ?? null, this.now(), 45_000), observedAt: iso(row?.observed_at ?? null), errorCode: poll?.safe_error_code ?? null,
      inventoryComplete: observed?.data.inventoryComplete ?? null, total: observed?.data.inventoryComplete ? containers.length : null,
      running: observed ? containers.filter((item) => item.state === 'running').length : null,
      unhealthy: observed ? containers.filter((item) => item.health === 'unhealthy').length : null,
      expectedStopped: observed ? containers.filter((item) => item.expectedRunning && item.state !== 'running').length : null, containers };
  }

  indexers(): IndexerHealthResponse | null {
    if (!this.indexerConfig) return null;
    const row = this.capabilityFor('prowlarr', 'indexers.health');
    const observation = parseJson<{ data: Pick<IndexerHealthResponse, 'indexers' | 'failingTotal' | 'disabledTotal' | 'warnings' | 'applications'> }>(row?.normalized_json);
    return { configured: true, name: this.indexerConfig.name, browserUrl: this.indexerConfig.browserUrl,
      connection: this.integrationFor('prowlarr')?.connection ?? 'unknown', freshness: freshnessWith(row?.observed_at ?? null, this.now(), 180_000),
      observedAt: iso(row?.observed_at ?? null), errorCode: this.poll('prowlarr', 'health')?.safe_error_code ?? null,
      failingTotal: observation?.data.failingTotal ?? null, disabledTotal: observation?.data.disabledTotal ?? null,
      warnings: observation?.data.warnings ?? [], indexers: observation?.data.indexers ?? [], applications: { connectivity: 'unknown' } };
  }

  settings(demoMode: boolean) {
    const integration = this.integration();
    const observedAt = this.capability('host.summary')?.observed_at ?? null;
    return {
      integrations: [
        ...(this.configured ? [{ id: 'host', name: 'Ubuntu host', connection: integration?.connection ?? 'unknown' as const, freshness: freshness(observedAt, this.now()), lastSuccessfulRefreshAt: iso(integration?.succeeded_at ?? null), safeErrorCode: integration?.safe_error_code ?? null }] : []),
        ...(this.mediaConfig ? [{ id: this.mediaConfig.id, name: this.mediaConfig.name, connection: this.integrationFor('jellyfin')?.connection ?? 'unknown' as const, freshness: this.media().playback.freshness, lastSuccessfulRefreshAt: this.media().playback.lastSuccessfulRefreshAt, safeErrorCode: this.integrationFor('jellyfin')?.safe_error_code ?? null }] : [])
        ,...this.downloadConfigs.map((config) => { const integrationState = this.integrationFor(config.id); const queue = this.capabilityFor(config.id, 'downloads.queue'); return { id: config.id, name: config.name, connection: integrationState?.connection ?? 'unknown' as const, freshness: freshnessWith(queue?.observed_at ?? null, this.now(), 45_000), lastSuccessfulRefreshAt: iso(integrationState?.succeeded_at ?? null), safeErrorCode: integrationState?.safe_error_code ?? null }; }),
        ...(this.indexerConfig ? [{ id: 'prowlarr', name: 'Prowlarr', connection: this.integrationFor('prowlarr')?.connection ?? 'unknown' as const, freshness: this.indexers()?.freshness ?? 'never' as const, lastSuccessfulRefreshAt: iso(this.integrationFor('prowlarr')?.succeeded_at ?? null), safeErrorCode: this.integrationFor('prowlarr')?.safe_error_code ?? null }] : [])
        ,...(this.smartConfigured ? [{ id: 'smart', name: 'Physical disks', connection: this.poll('smart', 'snapshot')?.safe_error_code ? 'unreachable' as const : this.integrationFor('smart')?.connection ?? 'unknown' as const, freshness: this.smart().freshness, lastSuccessfulRefreshAt: iso(this.integrationFor('smart')?.succeeded_at ?? null), safeErrorCode: this.poll('smart', 'snapshot')?.safe_error_code ?? null }] : [])
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

  private downloadServices(): DownloadsResponse['services'] { return this.downloadConfigs.map((config) => {
    const integration = this.integrationFor(config.id); const queueRow = this.capabilityFor(config.id, 'downloads.queue'); const healthRow = this.capabilityFor(config.id, 'downloads.health'); const catalogRow = this.capabilityFor(config.id, 'downloads.catalog'); const historyRow = this.capabilityFor(config.id, 'downloads.history');
    const queue = parseJson<{ data: { entries: DownloadsResponse['services'][number]['queue']; total: number; truncated: boolean } }>(queueRow?.normalized_json);
    const health = parseJson<{ data: { warnings: string[] } }>(healthRow?.normalized_json); const catalog = parseJson<{ data: NonNullable<DownloadsResponse['services'][number]['catalog']> }>(catalogRow?.normalized_json); const history = parseJson<{ data: { imports: DownloadsResponse['services'][number]['recentImports'] } }>(historyRow?.normalized_json); const poll = this.poll(config.id, 'queue');
    return { id: config.id, name: config.name, browserUrl: config.browserUrl, connection: integration?.connection ?? 'unknown', freshness: freshnessWith(queueRow?.observed_at ?? null, this.now(), 45_000), observedAt: iso(queueRow?.observed_at ?? null), errorCode: poll?.safe_error_code ?? null, healthWarnings: health?.data.warnings ?? [], queue: queue?.data.entries ?? [], queueTotal: queue?.data.total ?? 0, queueTruncated: queue?.data.truncated ?? false, catalog: catalog?.data ?? null, recentImports: history?.data.imports ?? [] };
  }); }

  capability(name: string): CapabilityRow | undefined {
    return this.database.prepare('SELECT observed_at, normalized_json FROM capability_state WHERE instance_id = ? AND capability = ?').get('host', name) as CapabilityRow | undefined;
  }
}

function parseJson<T>(value: string | undefined): T | undefined { if (!value) return undefined; try { return JSON.parse(value) as T; } catch { return undefined; } }
function freshnessWith(observedAt: number | null, now: number, staleAfter: number): 'fresh' | 'stale' | 'never' { return observedAt === null ? 'never' : now - observedAt > staleAfter ? 'stale' : 'fresh'; }
