import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

const portSchema = z.coerce.number().int().min(1).max(65535);

const environmentSchema = z.object({
  LABDECK_HOST: z.string().min(1).default('127.0.0.1'),
  LABDECK_PORT: portSchema.default(7337),
  LABDECK_LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  LABDECK_DATABASE_PATH: z.string().min(1).default('./data/labdeck.db'),
  LABDECK_CANONICAL_ORIGIN: z.url().default('https://labdeck.localhost'),
  LABDECK_ALLOWED_HOSTS: z.string().optional(),
  LABDECK_OWNER_PASSWORD_HASH_FILE: z.string().min(1).optional(),
  LABDECK_OWNER_PASSWORD_HASH: z.string().min(1).optional(),
  LABDECK_DEMO_MODE: z.enum(['true', 'false']).default('false')
}).superRefine((value, context) => {
  if (value.LABDECK_OWNER_PASSWORD_HASH_FILE && value.LABDECK_OWNER_PASSWORD_HASH) {
    context.addIssue({ code: 'custom', message: 'Configure one owner password hash source, not both' });
  }
});

export interface AppConfig {
  host: string;
  port: number;
  logLevel: z.infer<typeof environmentSchema>['LABDECK_LOG_LEVEL'];
  databasePath: string;
  canonicalOrigin: string;
  allowedHosts: ReadonlySet<string>;
  passwordHash?: string;
  demoMode: boolean;
}

export function loadConfig(environment: NodeJS.ProcessEnv): AppConfig {
  const parsed = environmentSchema.parse(environment);
  const origin = new URL(parsed.LABDECK_CANONICAL_ORIGIN);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('LABDECK_CANONICAL_ORIGIN must be an HTTP(S) origin without credentials, path, query, or fragment');
  }
  const demoMode = parsed.LABDECK_DEMO_MODE === 'true';
  if (demoMode && !['127.0.0.1', '::1', 'localhost'].includes(parsed.LABDECK_HOST)) {
    throw new Error('Demo mode must bind to a loopback address');
  }

  let passwordHash = parsed.LABDECK_OWNER_PASSWORD_HASH;
  if (parsed.LABDECK_OWNER_PASSWORD_HASH_FILE) {
    const hashPath = resolve(parsed.LABDECK_OWNER_PASSWORD_HASH_FILE);
    const mode = statSync(hashPath).mode & 0o777;
    if ((mode & 0o007) !== 0) throw new Error('Owner password hash file must not be accessible to other users');
    passwordHash = readFileSync(hashPath, 'utf8').trim();
  }
  if (passwordHash && !passwordHash.startsWith('$argon2id$')) throw new Error('Owner password hash must use Argon2id');

  const configuredHosts = parsed.LABDECK_ALLOWED_HOSTS?.split(',').map((host) => host.trim().toLowerCase()).filter(Boolean);
  const allowedHosts = new Set(configuredHosts?.length ? configuredHosts : [origin.host.toLowerCase()]);
  return {
    host: parsed.LABDECK_HOST,
    port: parsed.LABDECK_PORT,
    logLevel: parsed.LABDECK_LOG_LEVEL,
    databasePath: parsed.LABDECK_DATABASE_PATH,
    canonicalOrigin: origin.origin,
    allowedHosts,
    ...(passwordHash ? { passwordHash } : {}),
    demoMode
  };
}
