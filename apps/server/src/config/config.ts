import { z } from 'zod';

const portSchema = z.coerce.number().int().min(1).max(65535);

const environmentSchema = z.object({
  LABDECK_HOST: z.string().min(1).default('127.0.0.1'),
  LABDECK_PORT: portSchema.default(7337),
  LABDECK_LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info')
});

export interface AppConfig {
  host: string;
  port: number;
  logLevel: z.infer<typeof environmentSchema>['LABDECK_LOG_LEVEL'];
}

export function loadConfig(environment: NodeJS.ProcessEnv): AppConfig {
  const parsed = environmentSchema.parse(environment);
  return {
    host: parsed.LABDECK_HOST,
    port: parsed.LABDECK_PORT,
    logLevel: parsed.LABDECK_LOG_LEVEL
  };
}
