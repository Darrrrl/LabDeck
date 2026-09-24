import { lstatSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

const portSchema = z.coerce.number().int().min(1).max(65535);

const environmentSchema = z.object({
  LABDECK_HOST: z.string().min(1).default('127.0.0.1'),
  LABDECK_PORT: portSchema.default(7337),
  LABDECK_LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  LABDECK_DATABASE_PATH: z.string().min(1).default('./data/labdeck.db'),
  LABDECK_WEB_ROOT: z.string().min(1).default('./apps/web/dist'),
  LABDECK_HOST_SNAPSHOT_PATH: z.string().min(1).optional(),
  LABDECK_JELLYFIN_BASE_URL: z.url().optional(),
  LABDECK_JELLYFIN_BROWSER_URL: z.url().optional(),
  LABDECK_JELLYFIN_API_KEY_FILE: z.string().min(1).optional(),
  LABDECK_SONARR_BASE_URL: z.url().optional(), LABDECK_SONARR_BROWSER_URL: z.url().optional(), LABDECK_SONARR_API_KEY_FILE: z.string().min(1).optional(),
  LABDECK_RADARR_BASE_URL: z.url().optional(), LABDECK_RADARR_BROWSER_URL: z.url().optional(), LABDECK_RADARR_API_KEY_FILE: z.string().min(1).optional(),
  LABDECK_PROWLARR_BASE_URL: z.url().optional(), LABDECK_PROWLARR_BROWSER_URL: z.url().optional(), LABDECK_PROWLARR_API_KEY_FILE: z.string().min(1).optional(),
  LABDECK_CANONICAL_ORIGIN: z.url().default('https://labdeck.localhost'),
  LABDECK_ALLOWED_HOSTS: z.string().optional(),
  LABDECK_OWNER_PASSWORD_HASH_FILE: z.string().min(1).optional(),
  LABDECK_OWNER_PASSWORD_HASH: z.string().min(1).optional(),
  LABDECK_DEMO_MODE: z.enum(['true', 'false']).default('false')
}).superRefine((value, context) => {
  if (value.LABDECK_OWNER_PASSWORD_HASH_FILE && value.LABDECK_OWNER_PASSWORD_HASH) {
    context.addIssue({ code: 'custom', message: 'Configure one owner password hash source, not both' });
  }
  const jellyfin = [value.LABDECK_JELLYFIN_BASE_URL, value.LABDECK_JELLYFIN_BROWSER_URL, value.LABDECK_JELLYFIN_API_KEY_FILE];
  if (jellyfin.some(Boolean) && !jellyfin.every(Boolean)) context.addIssue({ code: 'custom', message: 'Jellyfin base URL, browser URL, and API key file must be configured together' });
  for (const [name, fields] of [['Sonarr', [value.LABDECK_SONARR_BASE_URL, value.LABDECK_SONARR_BROWSER_URL, value.LABDECK_SONARR_API_KEY_FILE]], ['Radarr', [value.LABDECK_RADARR_BASE_URL, value.LABDECK_RADARR_BROWSER_URL, value.LABDECK_RADARR_API_KEY_FILE]]] as const) {
    if (fields.some(Boolean) && !fields.every(Boolean)) context.addIssue({ code: 'custom', message: `${name} base URL, browser URL, and API key file must be configured together` });
  }
  const prowlarr = [value.LABDECK_PROWLARR_BASE_URL, value.LABDECK_PROWLARR_BROWSER_URL, value.LABDECK_PROWLARR_API_KEY_FILE];
  if (prowlarr.some(Boolean) && !prowlarr.every(Boolean)) context.addIssue({ code: 'custom', message: 'Prowlarr base URL, browser URL, and API key file must be configured together' });
});

export interface JellyfinConfig { id: 'jellyfin'; name: string; baseUrl: string; browserUrl: string; apiKey: string; }
export interface ArrConfig { id: 'sonarr' | 'radarr'; kind: 'sonarr' | 'radarr'; name: string; baseUrl: string; browserUrl: string; apiKey: string; }
export interface ProwlarrConfig { id: 'prowlarr'; name: string; baseUrl: string; browserUrl: string; apiKey: string; }

export interface AppConfig {
  host: string;
  port: number;
  logLevel: z.infer<typeof environmentSchema>['LABDECK_LOG_LEVEL'];
  databasePath: string;
  webRoot: string;
  hostSnapshotPath?: string;
  jellyfin?: JellyfinConfig;
  arr?: ArrConfig[];
  prowlarr?: ProwlarrConfig;
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

  let jellyfin: JellyfinConfig | undefined;
  if (parsed.LABDECK_JELLYFIN_BASE_URL && parsed.LABDECK_JELLYFIN_BROWSER_URL && parsed.LABDECK_JELLYFIN_API_KEY_FILE) {
    const baseUrl = serviceUrl(parsed.LABDECK_JELLYFIN_BASE_URL, 'Jellyfin base URL', true);
    const browserUrl = serviceUrl(parsed.LABDECK_JELLYFIN_BROWSER_URL, 'Jellyfin browser URL', true);
    const keyPath = resolve(parsed.LABDECK_JELLYFIN_API_KEY_FILE);
    const keyStat = lstatSync(keyPath);
    if (!keyStat.isFile() || keyStat.isSymbolicLink()) throw new Error('Jellyfin API key must be a regular non-symlink file');
    const mode = keyStat.mode & 0o777;
    if ((mode & 0o007) !== 0) throw new Error('Jellyfin API key file must not be accessible to other users');
    const apiKey = readFileSync(keyPath, 'utf8').trim();
    if (!apiKey || apiKey.length > 512 || /[\r\n]/.test(apiKey)) throw new Error('Jellyfin API key file is invalid');
    jellyfin = { id: 'jellyfin', name: 'Jellyfin', baseUrl, browserUrl, apiKey };
  }
  const arr: ArrConfig[] = [];
  const arrInputs = [
    { id: 'sonarr' as const, name: 'Sonarr', base: parsed.LABDECK_SONARR_BASE_URL, browser: parsed.LABDECK_SONARR_BROWSER_URL, key: parsed.LABDECK_SONARR_API_KEY_FILE },
    { id: 'radarr' as const, name: 'Radarr', base: parsed.LABDECK_RADARR_BASE_URL, browser: parsed.LABDECK_RADARR_BROWSER_URL, key: parsed.LABDECK_RADARR_API_KEY_FILE }
  ];
  for (const input of arrInputs) if (input.base && input.browser && input.key) arr.push({ id: input.id, kind: input.id, name: input.name, baseUrl: serviceUrl(input.base, `${input.name} base URL`, true), browserUrl: serviceUrl(input.browser, `${input.name} browser URL`, true), apiKey: secretFile(input.key, `${input.name} API key`) });
  const prowlarr = parsed.LABDECK_PROWLARR_BASE_URL && parsed.LABDECK_PROWLARR_BROWSER_URL && parsed.LABDECK_PROWLARR_API_KEY_FILE ? {
    id: 'prowlarr' as const, name: 'Prowlarr', baseUrl: serviceUrl(parsed.LABDECK_PROWLARR_BASE_URL, 'Prowlarr base URL', true),
    browserUrl: serviceUrl(parsed.LABDECK_PROWLARR_BROWSER_URL, 'Prowlarr browser URL', true), apiKey: secretFile(parsed.LABDECK_PROWLARR_API_KEY_FILE, 'Prowlarr API key')
  } : undefined;

  const configuredHosts = parsed.LABDECK_ALLOWED_HOSTS?.split(',').map((host) => host.trim().toLowerCase()).filter(Boolean);
  const allowedHosts = new Set(configuredHosts?.length ? configuredHosts : [origin.host.toLowerCase()]);
  return {
    host: parsed.LABDECK_HOST,
    port: parsed.LABDECK_PORT,
    logLevel: parsed.LABDECK_LOG_LEVEL,
    databasePath: parsed.LABDECK_DATABASE_PATH,
    webRoot: resolve(parsed.LABDECK_WEB_ROOT),
    ...(parsed.LABDECK_HOST_SNAPSHOT_PATH ? { hostSnapshotPath: resolve(parsed.LABDECK_HOST_SNAPSHOT_PATH) } : {}),
    ...(jellyfin ? { jellyfin } : {}),
    arr,
    ...(prowlarr ? { prowlarr } : {}),
    canonicalOrigin: origin.origin,
    allowedHosts,
    ...(passwordHash ? { passwordHash } : {}),
    demoMode
  };
}

function secretFile(path: string, label: string): string {
  const keyPath = resolve(path); const keyStat = lstatSync(keyPath);
  if (!keyStat.isFile() || keyStat.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file`);
  if ((keyStat.mode & 0o007) !== 0) throw new Error(`${label} file must not be accessible to other users`);
  const value = readFileSync(keyPath, 'utf8').trim(); if (!value || value.length > 512 || /[\r\n]/.test(value)) throw new Error(`${label} file is invalid`);
  return value;
}

function serviceUrl(value: string, label: string, allowPath: boolean): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || (!allowPath && url.pathname !== '/')) {
    throw new Error(`${label} must be an HTTP(S) URL without credentials, query, or fragment`);
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (hostname.startsWith('169.254.') || /^(?:fe8|fe9|fea|feb)[0-9a-f]:/.test(hostname) || hostname === 'metadata.google.internal') throw new Error(`${label} must not target link-local metadata`);
  return url.toString().replace(/\/$/, '');
}
