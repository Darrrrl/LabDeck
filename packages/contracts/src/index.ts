import { z } from 'zod';

export const healthResponseSchema = z.object({
  ok: z.boolean()
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

const timestampSchema = z.iso.datetime({ offset: true });
const freshnessSchema = z.enum(['fresh', 'stale', 'never']);
const overallStatusSchema = z.enum(['healthy', 'warning', 'critical', 'monitoring-incomplete']);
const metricPointSchema = z.object({ at: timestampSchema, value: z.number(), coverage: z.number().min(0).max(1) });
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
const downloadQueueEntrySchema = z.object({ source: z.enum(['sonarr', 'radarr']), id: z.string(), title: z.string(), sizeBytes: z.number().nonnegative().nullable(), remainingBytes: z.number().nonnegative().nullable(), progressRatio: z.number().min(0).max(1).nullable(), eta: timestampSchema.nullable(), stage: z.enum(['downloading', 'import-pending', 'warning', 'unknown']), warnings: z.array(z.string()).max(5) });
const upcomingSchema = z.object({ id: z.string(), title: z.string(), date: timestampSchema.nullable(), releaseKind: z.enum(['episode-air', 'digital', 'physical', 'theatrical', 'unknown']) });
const importSchema = z.object({ id: z.string(), title: z.string(), importedAt: timestampSchema.nullable() });
const downloadServiceSchema = z.object({
  id: z.enum(['sonarr', 'radarr']), name: z.string(), browserUrl: z.url(), connection: connectionSchema, freshness: freshnessSchema,
  observedAt: timestampSchema.nullable(), errorCode: z.string().nullable(), healthWarnings: z.array(z.string()).max(20), queue: z.array(downloadQueueEntrySchema).max(50), queueTotal: z.number().int().nonnegative(), queueTruncated: z.boolean(),
  catalog: z.object({ monitored: z.number().int().nonnegative(), missing: z.number().int().nonnegative(), upcoming: z.array(upcomingSchema).max(50), upcomingTruncated: z.boolean() }).nullable(),
  recentImports: z.array(importSchema).max(20)
});
export const eventSchema = z.object({ id: z.number().int(), kind: z.string(), severity: z.enum(['info', 'warning', 'critical']), observedAt: timestampSchema, entityId: z.string().nullable(), payload: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])) });

export const overviewResponseSchema = z.discriminatedUnion('configured', [
  z.object({ configured: z.literal(false), overall: z.literal('monitoring-incomplete'), title: z.literal('No integrations configured'), message: z.string() }),
  z.object({ configured: z.literal(true), overall: overallStatusSchema, title: z.string(), message: z.string(), freshness: freshnessSchema,
    observedAt: timestampSchema.nullable(), lastAttemptAt: timestampSchema.nullable(), errorCode: z.string().nullable(),
    host: hostSummaryDataSchema.nullable(), storage: filesystemDataSchema.nullable(), network: networkDataSchema.nullable(), diskIo: blockIoDataSchema.nullable(),
    media: mediaSummarySchema.nullable(), downloads: z.array(downloadServiceSchema).max(2), events: z.array(eventSchema).max(10) })
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
  hostCollector: z.object({ configured: z.boolean(), historyAvailable: z.boolean(), message: z.string() })
});
export type SettingsResponse = z.infer<typeof settingsResponseSchema>;

export const systemResponseSchema = z.object({
  configured: z.boolean(), freshness: freshnessSchema, observedAt: timestampSchema.nullable(), data: hostSummaryDataSchema.nullable(),
  interfaces: z.array(networkDataSchema), blockIo: z.array(blockIoDataSchema),
  trends: z.object({ range: z.enum(['1h', '24h']), cpu: z.array(metricPointSchema), memory: z.array(metricPointSchema) })
});
export type SystemResponse = z.infer<typeof systemResponseSchema>;

export const storageResponseSchema = z.object({ configured: z.boolean(), freshness: freshnessSchema, observedAt: timestampSchema.nullable(), filesystems: z.array(filesystemDataSchema), history: z.record(z.string(), z.array(metricPointSchema)) });
export type StorageResponse = z.infer<typeof storageResponseSchema>;

export const eventsResponseSchema = z.object({ events: z.array(eventSchema).max(100), nextCursor: z.number().int().nullable() });
export type EventsResponse = z.infer<typeof eventsResponseSchema>;

export const mediaResponseSchema = z.object({
  configured: z.boolean(), name: z.string().nullable(), browserUrl: z.url().nullable(), connection: z.enum(['unknown', 'reachable', 'unreachable', 'auth-error']),
  playback: z.object({ freshness: freshnessSchema, observedAt: timestampSchema.nullable(), lastSuccessfulRefreshAt: timestampSchema.nullable(), errorCode: z.string().nullable(), sessions: z.array(mediaSessionSchema).max(100) }),
  library: z.object({ freshness: freshnessSchema, observedAt: timestampSchema.nullable(), lastSuccessfulRefreshAt: timestampSchema.nullable(), errorCode: z.string().nullable(), counts: z.object({ movies: z.number().int().nonnegative(), series: z.number().int().nonnegative(), episodes: z.number().int().nonnegative() }).nullable(), recent: z.array(mediaRecentItemSchema).max(20) })
});
export type MediaResponse = z.infer<typeof mediaResponseSchema>;

export const downloadsResponseSchema = z.object({ configured: z.boolean(), services: z.array(downloadServiceSchema).max(2) });
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
    blockIo: capabilitySchema(z.array(z.object({ id: z.string(), name: z.string(), readBytesPerSecond: rateSchema, writeBytesPerSecond: rateSchema })).max(64))
  })
}).strict();

export type HostCollectorSnapshot = z.infer<typeof hostCollectorSnapshotSchema>;
