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
