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
