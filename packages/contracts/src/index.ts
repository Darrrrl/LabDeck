import { z } from 'zod';

export const healthResponseSchema = z.object({
  ok: z.boolean()
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const overviewResponseSchema = z.object({
  overall: z.literal('monitoring-incomplete'),
  title: z.literal('No integrations configured'),
  message: z.string()
});

export type OverviewResponse = z.infer<typeof overviewResponseSchema>;

export const sessionResponseSchema = z.discriminatedUnion('authenticated', [
  z.object({ authenticated: z.literal(false), csrfToken: z.string(), demoMode: z.boolean() }),
  z.object({ authenticated: z.literal(true), csrfToken: z.string(), demoMode: z.boolean() })
]);
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

export const settingsResponseSchema = z.object({
  integrations: z.array(z.never()), authentication: z.literal('configured'), demoMode: z.boolean(), version: z.string()
});
export type SettingsResponse = z.infer<typeof settingsResponseSchema>;

const timestampSchema = z.iso.datetime({ offset: true });
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
