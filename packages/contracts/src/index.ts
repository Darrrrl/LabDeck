import { z } from 'zod';

export const healthResponseSchema = z.object({
  ok: z.boolean()
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

const timestampSchema = z.iso.datetime({ offset: true });
const freshnessSchema = z.enum(['fresh', 'stale', 'never']);
const overallStatusSchema = z.enum(['healthy', 'warning', 'critical', 'monitoring-incomplete']);
const metricPointSchema = z.object({ at: timestampSchema, value: z.number(), coverage: z.number().min(0).max(1) });
export const historyRangeSchema = z.enum(['1h', '24h', '7d', '30d', '400d']);
export type HistoryRange = z.infer<typeof historyRangeSchema>;
export const metricHistoryResponseSchema = z.object({ name: z.string(), range: historyRangeSchema, points: z.array(metricPointSchema).max(1000) });
const hostSummaryDataSchema = z.object({
  hostname: z.string(), uptimeSeconds: z.number(),
  cpu: z.object({ model: z.string(), logicalProcessors: z.number().int(), utilizationPercent: z.number().nullable() }),
  load: z.object({ one: z.number(), five: z.number(), fifteen: z.number() }),
  memory: z.object({ totalBytes: z.number(), usedBytes: z.number(), availableBytes: z.number() }),
  swap: z.object({ totalBytes: z.number(), usedBytes: z.number(), freeBytes: z.number() })
});
const filesystemDataSchema = z.object({
  id: z.string(), path: z.string(), source: z.string(), fsType: z.string(), totalBytes: z.number(), usedBytes: z.number(),
  availableBytes: z.number(), reservedBytes: z.number(), usedRatio: z.number()
});
const smartCounterSchema = z.string().regex(/^\d*$/);
const smartDiskSchema = z.object({
  id: z.string(), label: z.string(), state: z.enum(['ok', 'asleep', 'unsupported', 'permission-denied', 'timeout', 'read-failed']),
  observedAt: timestampSchema, evidenceAt: timestampSchema.nullable(), temperatureWarning: z.boolean(), identity: z.string(), serialSuffix: z.string(),
  protocol: z.enum(['ATA', 'NVME', 'SCSI', 'unknown']), model: z.string(), capacityBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
  temperatureCelsius: z.number().nullable(), health: z.enum(['passed', 'warning', 'failed', 'unknown']), powerOnHours: z.number().int().nonnegative().nullable(),
  ata: z.object({ reallocated: smartCounterSchema, pending: smartCounterSchema, uncorrectable: smartCounterSchema }).nullable(),
  nvme: z.object({ criticalWarning: z.number().int().nonnegative().nullable(), availableSparePercent: z.number().int().nonnegative().nullable(), percentageUsed: z.number().int().nonnegative().nullable(), mediaErrors: smartCounterSchema, errorLogEntries: smartCounterSchema }).nullable(),
  scsi: z.object({ grownDefects: smartCounterSchema, readUncorrected: smartCounterSchema }).nullable()
});
const smartSummarySchema = z.object({ configured: z.boolean(), freshness: freshnessSchema, observedAt: timestampSchema.nullable(), errorCode: z.string().nullable(), failed: z.number().int().nonnegative(), warning: z.number().int().nonnegative(), unavailable: z.number().int().nonnegative() });
const networkDataSchema = z.object({ id: z.string(), name: z.string(), receiveBytesPerSecond: z.number().nullable(), transmitBytesPerSecond: z.number().nullable() });
const blockIoDataSchema = z.object({ id: z.string(), name: z.string(), readBytesPerSecond: z.number().nullable(), writeBytesPerSecond: z.number().nullable() });
export const mediaSessionSchema = z.object({
  id: z.string(), userName: z.string(), title: z.string(), subtitle: z.string().nullable(), mediaId: z.string(),
  paused: z.boolean(), positionSeconds: z.number().nonnegative().nullable(), durationSeconds: z.number().nonnegative().nullable(),
  progressRatio: z.number().min(0).max(1).nullable(), playbackMode: z.enum(['direct-play', 'direct-stream', 'transcode', 'unknown']),
  bitrateBitsPerSecond: z.number().int().nonnegative().nullable(), bitrateSource: z.enum(['transcode-estimate', 'media-source']).nullable()
});
export type MediaSession = z.infer<typeof mediaSessionSchema>;
const mediaRecentItemSchema = z.object({ id: z.string(), name: z.string(), type: z.enum(['movie', 'series', 'episode', 'other']), seriesName: z.string().nullable(), addedAt: timestampSchema.nullable() });
const mediaSummarySchema = z.object({
  id: z.string(), name: z.string(), browserUrl: z.url(), connection: z.enum(['unknown', 'reachable', 'unreachable', 'auth-error']),
  freshness: freshnessSchema, observedAt: timestampSchema.nullable(), lastSuccessfulRefreshAt: timestampSchema.nullable(), errorCode: z.string().nullable(),
  sessions: z.array(mediaSessionSchema).max(100)
});
const connectionSchema = z.enum(['unknown', 'reachable', 'unreachable', 'auth-error']);
const dockerContainerSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{64}$/), name: z.string().max(128), image: z.string().max(160),
  createdAt: timestampSchema.nullable(), startedAt: timestampSchema.nullable(),
  state: z.enum(['created', 'running', 'paused', 'restarting', 'exited', 'dead', 'unknown']),
  health: z.enum(['healthy', 'unhealthy', 'starting', 'no-healthcheck', 'unknown']), restartCount: z.number().int().nonnegative().nullable(),
  cpuPercent: z.number().nonnegative().nullable(), memoryBytes: z.number().int().nonnegative().nullable(),
  memoryLimitBytes: z.number().int().nonnegative().nullable(), memoryKind: z.enum(['working-set', 'raw', 'unknown']), statsObservedAt: timestampSchema.nullable()
});
const containerSummarySchema = z.object({ configured: z.boolean(), freshness: freshnessSchema, observedAt: timestampSchema.nullable(), errorCode: z.string().nullable(),
  inventoryComplete: z.boolean().nullable(), total: z.number().int().nonnegative().nullable(), running: z.number().int().nonnegative().nullable(),
  unhealthy: z.number().int().nonnegative().nullable(), expectedStopped: z.number().int().nonnegative().nullable() });
export const containersResponseSchema = containerSummarySchema.extend({ containers: z.array(dockerContainerSchema.extend({ expectedRunning: z.boolean() })).max(100) });
export type ContainersResponse = z.infer<typeof containersResponseSchema>;
const tailscalePeerSchema = z.object({ id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/), name: z.string().max(128), ips: z.array(z.ipv4().or(z.ipv6())).max(2), online: z.boolean(), lastSeen: timestampSchema.nullable() });
const tailscaleSummarySchema = z.object({ configured: z.boolean(), freshness: freshnessSchema, observedAt: timestampSchema.nullable(), errorCode: z.string().nullable(), backendState: z.string().nullable(), inventoryComplete: z.boolean().nullable(), total: z.number().int().nonnegative().nullable(), online: z.number().int().nonnegative().nullable() });
export const networkResponseSchema = tailscaleSummarySchema.extend({ version: z.string().nullable(), selfName: z.string().nullable(), selfIPs: z.array(z.ipv4().or(z.ipv6())).max(2), peers: z.array(tailscalePeerSchema).max(250) });
export type NetworkResponse = z.infer<typeof networkResponseSchema>;
const downloadQueueEntrySchema = z.object({ source: z.enum(['sonarr', 'radarr']), id: z.string(), title: z.string(), sizeBytes: z.number().nonnegative().nullable(), remainingBytes: z.number().nonnegative().nullable(), progressRatio: z.number().min(0).max(1).nullable(), eta: timestampSchema.nullable(), stage: z.enum(['downloading', 'import-pending', 'warning', 'unknown']), warnings: z.array(z.string()).max(5) });
const upcomingSchema = z.object({ id: z.string(), title: z.string(), date: timestampSchema.nullable(), releaseKind: z.enum(['episode-air', 'digital', 'physical', 'theatrical', 'unknown']) });
const importSchema = z.object({ id: z.string(), title: z.string(), importedAt: timestampSchema.nullable() });
const downloadServiceSchema = z.object({
  id: z.enum(['sonarr', 'radarr']), name: z.string(), browserUrl: z.url(), connection: connectionSchema, freshness: freshnessSchema,
  observedAt: timestampSchema.nullable(), errorCode: z.string().nullable(), healthWarnings: z.array(z.string()).max(20), queue: z.array(downloadQueueEntrySchema).max(50), queueTotal: z.number().int().nonnegative(), queueTruncated: z.boolean(),
  catalog: z.object({ monitored: z.number().int().nonnegative(), missing: z.number().int().nonnegative(), upcoming: z.array(upcomingSchema).max(50), upcomingTruncated: z.boolean() }).nullable(),
  recentImports: z.array(importSchema).max(20)
});
const indexerHealthSchema = z.object({
  configured: z.boolean(), name: z.string().nullable(), browserUrl: z.url().nullable(), connection: connectionSchema,
  freshness: freshnessSchema, observedAt: timestampSchema.nullable(), errorCode: z.string().nullable(),
  failingTotal: z.number().int().nonnegative().nullable(), disabledTotal: z.number().int().nonnegative().nullable(),
  warnings: z.array(z.object({ severity: z.enum(['notice', 'warning', 'error']), text: z.string() })).max(20),
  indexers: z.array(z.object({ id: z.string(), name: z.string(), state: z.enum(['disabled', 'failing', 'no-active-failure']), lastFailureAt: timestampSchema.nullable(), disabledUntil: timestampSchema.nullable() })).max(1000),
  applications: z.object({ connectivity: z.literal('unknown') })
});
export type IndexerHealthResponse = z.infer<typeof indexerHealthSchema>;
export const eventSchema = z.object({ id: z.number().int(), kind: z.string(), severity: z.enum(['info', 'warning', 'critical']), observedAt: timestampSchema, entityId: z.string().nullable(), payload: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])) });

export const overviewResponseSchema = z.discriminatedUnion('configured', [
  z.object({ configured: z.literal(false), overall: z.literal('monitoring-incomplete'), title: z.literal('No integrations configured'), message: z.string() }),
  z.object({ configured: z.literal(true), overall: overallStatusSchema, title: z.string(), message: z.string(), freshness: freshnessSchema,
    observedAt: timestampSchema.nullable(), lastAttemptAt: timestampSchema.nullable(), errorCode: z.string().nullable(),
    host: hostSummaryDataSchema.nullable(), storage: filesystemDataSchema.nullable(), network: networkDataSchema.nullable(), diskIo: blockIoDataSchema.nullable(),
    media: mediaSummarySchema.nullable(), downloads: z.array(downloadServiceSchema).max(2), indexers: indexerHealthSchema.nullable(), containers: containerSummarySchema.nullable(), disks: smartSummarySchema.nullable(), tailscale: tailscaleSummarySchema.nullable(), events: z.array(eventSchema).max(10) })
]);

export type OverviewResponse = z.infer<typeof overviewResponseSchema>;

export const sessionResponseSchema = z.discriminatedUnion('authenticated', [
  z.object({ authenticated: z.literal(false), csrfToken: z.string(), demoMode: z.boolean() }),
  z.object({ authenticated: z.literal(true), csrfToken: z.string(), demoMode: z.boolean() })
]);
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

export const settingsResponseSchema = z.object({
  integrations: z.array(z.object({ id: z.string(), name: z.string(), connection: z.enum(['unknown', 'reachable', 'unreachable', 'auth-error']), freshness: freshnessSchema, lastSuccessfulRefreshAt: timestampSchema.nullable(), safeErrorCode: z.string().nullable() })),
  authentication: z.literal('configured'), demoMode: z.boolean(), version: z.string(),
  hostCollector: z.object({ configured: z.boolean(), historyAvailable: z.boolean(), message: z.string() }),
  persistence: z.object({ databaseBytes: z.number().nonnegative(), walBytes: z.number().nonnegative(), freeBytes: z.number().nonnegative().nullable(), seriesCount: z.number().int().nonnegative(), eventCount: z.number().int().nonnegative(), pressure: z.enum(['normal', 'trimming', 'paused']) })
});
export type SettingsResponse = z.infer<typeof settingsResponseSchema>;

export const systemResponseSchema = z.object({
  configured: z.boolean(), freshness: freshnessSchema, observedAt: timestampSchema.nullable(), data: hostSummaryDataSchema.nullable(),
  interfaces: z.array(networkDataSchema), blockIo: z.array(blockIoDataSchema),
  trends: z.object({ range: historyRangeSchema, cpu: z.array(metricPointSchema).max(1000), memory: z.array(metricPointSchema).max(1000) })
});
export type SystemResponse = z.infer<typeof systemResponseSchema>;

export const storageResponseSchema = z.object({ configured: z.boolean(), freshness: freshnessSchema, observedAt: timestampSchema.nullable(), filesystems: z.array(filesystemDataSchema), history: z.record(z.string(), z.array(metricPointSchema)), smart: smartSummarySchema.extend({ disks: z.array(smartDiskSchema).max(16) }) });
export type StorageResponse = z.infer<typeof storageResponseSchema>;

export const eventsResponseSchema = z.object({ events: z.array(eventSchema).max(100), nextCursor: z.number().int().nullable() });
export type EventsResponse = z.infer<typeof eventsResponseSchema>;

export const mediaResponseSchema = z.object({
  configured: z.boolean(), name: z.string().nullable(), browserUrl: z.url().nullable(), connection: z.enum(['unknown', 'reachable', 'unreachable', 'auth-error']),
  playback: z.object({ freshness: freshnessSchema, observedAt: timestampSchema.nullable(), lastSuccessfulRefreshAt: timestampSchema.nullable(), errorCode: z.string().nullable(), sessions: z.array(mediaSessionSchema).max(100) }),
  library: z.object({ freshness: freshnessSchema, observedAt: timestampSchema.nullable(), lastSuccessfulRefreshAt: timestampSchema.nullable(), errorCode: z.string().nullable(), counts: z.object({ movies: z.number().int().nonnegative(), series: z.number().int().nonnegative(), episodes: z.number().int().nonnegative() }).nullable(), recent: z.array(mediaRecentItemSchema).max(20) })
});
export type MediaResponse = z.infer<typeof mediaResponseSchema>;

export const downloadsResponseSchema = z.object({ configured: z.boolean(), services: z.array(downloadServiceSchema).max(2), indexers: indexerHealthSchema.nullable() });
export type DownloadsResponse = z.infer<typeof downloadsResponseSchema>;

const bytesSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const rateSchema = z.number().nonnegative().finite().nullable();
const capabilitySchema = <T extends z.ZodType>(data: T) => z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), observedAt: timestampSchema, completeness: z.literal('complete'), data }),
  z.object({ status: z.literal('error'), observedAt: timestampSchema, completeness: z.literal('complete'), errorCode: z.enum(['read-failed']) })
]);

export const hostCollectorSnapshotSchema = z.object({
  schemaVersion: z.literal('1'),
  collectorVersion: z.string().min(1).max(32),
  hostId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/),
  bootId: z.string().min(1).max(128),
  generation: z.string().regex(/^[a-f0-9]{32}$/),
  sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  generatedAt: timestampSchema,
  capabilities: z.object({
    summary: capabilitySchema(z.object({
      hostname: z.string().min(1).max(255), uptimeSeconds: z.number().nonnegative().finite(),
      cpu: z.object({ model: z.string().min(1).max(512), logicalProcessors: z.number().int().positive(), utilizationPercent: z.number().min(0).max(100).nullable() }),
      load: z.object({ one: z.number().nonnegative(), five: z.number().nonnegative(), fifteen: z.number().nonnegative() }),
      memory: z.object({ totalBytes: bytesSchema, usedBytes: bytesSchema, availableBytes: bytesSchema }),
      swap: z.object({ totalBytes: bytesSchema, usedBytes: bytesSchema, freeBytes: bytesSchema })
    })),
    filesystems: capabilitySchema(z.array(z.object({
      id: z.string(), path: z.string(), source: z.string(), fsType: z.string(), mountIdentity: z.string(),
      totalBytes: bytesSchema, freeBytes: bytesSchema, availableBytes: bytesSchema, usedBytes: bytesSchema, reservedBytes: bytesSchema,
      usedRatio: z.number().min(0).max(1)
    })).max(64)),
    interfaces: capabilitySchema(z.array(z.object({ id: z.string(), name: z.string(), receiveBytesPerSecond: rateSchema, transmitBytesPerSecond: rateSchema })).max(64)),
    blockIo: capabilitySchema(z.array(z.object({ id: z.string(), name: z.string(), readBytesPerSecond: rateSchema, writeBytesPerSecond: rateSchema })).max(64)),
    docker: z.discriminatedUnion('status', [
      z.object({ status: z.literal('ok'), observedAt: timestampSchema, completeness: z.enum(['complete', 'partial']), data: z.object({ apiVersion: z.string().regex(/^1\.\d{2}$/), inventoryComplete: z.boolean(), containers: z.array(dockerContainerSchema).max(100) }) }),
      z.object({ status: z.literal('error'), observedAt: timestampSchema, completeness: z.literal('complete'), errorCode: z.enum(['read-failed']) })
    ]).optional(),
    tailscale: z.discriminatedUnion('status', [
      z.object({ status: z.literal('ok'), observedAt: timestampSchema, completeness: z.enum(['complete', 'partial']), data: z.object({ version: z.string().min(1).max(128), backendState: z.string().min(1).max(32), selfName: z.string().max(128), selfIPs: z.array(z.ipv4().or(z.ipv6())).max(2), inventoryComplete: z.boolean(), peers: z.array(tailscalePeerSchema).max(250) }) }),
      z.object({ status: z.literal('error'), observedAt: timestampSchema, completeness: z.literal('complete'), errorCode: z.enum(['read-failed', 'permission-denied', 'invalid-response']) })
    ]).optional()
  })
}).strict();

export type HostCollectorSnapshot = z.infer<typeof hostCollectorSnapshotSchema>;

export const smartSnapshotSchema = z.object({ schemaVersion: z.literal('1'), generatedAt: timestampSchema,
  disks: z.array(smartDiskSchema.omit({ evidenceAt: true, temperatureWarning: true })).max(16) }).strict();
export type SmartSnapshot = z.infer<typeof smartSnapshotSchema>;
