import { z } from 'zod';
import { SafeTransportError } from '../../core/read-only-transport.js';

const routes = new Set(['/api/v1/system/status', '/api/v1/health', '/api/v1/indexerstatus', '/api/v1/indexer']);
const statusSchema = z.object({ version: z.string().min(1).max(64) }).passthrough();
const indexerSchema = z.array(z.object({ id: z.number().int().nonnegative(), name: z.string().min(1).max(128), enable: z.boolean() }).passthrough()).max(1000);
const indexerStatusSchema = z.array(z.object({ indexerId: z.number().int().nonnegative(), disabledTill: z.string().nullable().optional(), mostRecentFailure: z.string().nullable().optional() }).passthrough()).max(1000);
const healthSchema = z.array(z.object({ type: z.enum(['ok', 'notice', 'warning', 'error']) }).passthrough()).max(100);

export interface IndexerHealth {
  observedAt: string;
  data: {
    indexers: { id: string; name: string; state: 'disabled' | 'failing' | 'no-active-failure'; lastFailureAt: string | null; disabledUntil: string | null }[];
    failingTotal: number;
    disabledTotal: number;
    warnings: { severity: 'notice' | 'warning' | 'error'; text: string }[];
    applications: { connectivity: 'unknown' };
  };
}

export class ProwlarrTransport {
  constructor(private readonly baseUrl: string, private readonly apiKey: string, private readonly fetcher: typeof fetch = fetch) {}
  async get(path: string, signal?: AbortSignal): Promise<unknown> {
    if (!routes.has(path)) throw new SafeTransportError('invalid-response');
    const controller = new AbortController(); const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
      const response = await this.fetcher(new URL(`${this.baseUrl}/${path.slice(1)}`), { method: 'GET', redirect: 'error', signal: controller.signal, headers: { Accept: 'application/json', 'X-Api-Key': this.apiKey } });
      if (response.status === 401 || response.status === 403) throw new SafeTransportError('auth');
      if (response.status === 429) throw new SafeTransportError('rate-limited');
      if (response.status === 404) throw new SafeTransportError('unsupported-version');
      if (!response.ok) throw new SafeTransportError('network');
      const length = Number(response.headers.get('content-length'));
      if (Number.isFinite(length) && length > 2 * 1024 * 1024) throw new SafeTransportError('invalid-response');
      const body = await response.text();
      if (Buffer.byteLength(body) > 2 * 1024 * 1024) throw new SafeTransportError('invalid-response');
      try { return JSON.parse(body) as unknown; } catch { throw new SafeTransportError('invalid-response'); }
    } catch (error) {
      if (error instanceof SafeTransportError) throw error;
      throw new SafeTransportError(controller.signal.aborted ? 'timeout' : 'network');
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
}

export class ProwlarrAdapter {
  constructor(private readonly transport: ProwlarrTransport, private readonly now: () => Date = () => new Date()) {}
  async connection(signal?: AbortSignal): Promise<{ version: string }> {
    const value = statusSchema.safeParse(await this.transport.get('/api/v1/system/status', signal));
    if (!value.success) throw new SafeTransportError('invalid-response');
    return { version: value.data.version };
  }
  async health(signal?: AbortSignal): Promise<IndexerHealth> {
    const [rawHealth, rawStatuses, rawIndexers] = await Promise.all([
      this.transport.get('/api/v1/health', signal), this.transport.get('/api/v1/indexerstatus', signal), this.transport.get('/api/v1/indexer', signal)
    ]);
    const health = healthSchema.safeParse(rawHealth); const statuses = indexerStatusSchema.safeParse(rawStatuses); const indexers = indexerSchema.safeParse(rawIndexers);
    if (!health.success || !statuses.success || !indexers.success) throw new SafeTransportError('invalid-response');
    const observedAt = this.now(); const statusById = new Map(statuses.data.map((item) => [item.indexerId, item]));
    const projected = indexers.data.map((item) => {
      const status = statusById.get(item.id);
      const disabledUntil = date(status?.disabledTill);
      const failing = item.enable && disabledUntil !== null && Date.parse(disabledUntil) > observedAt.valueOf();
      return { id: String(item.id), name: item.name, state: !item.enable ? 'disabled' as const : failing ? 'failing' as const : 'no-active-failure' as const,
        lastFailureAt: date(status?.mostRecentFailure), disabledUntil };
    });
    const warnings = health.data.filter((item) => item.type !== 'ok').slice(0, 20).map((item) => ({ severity: item.type as 'notice' | 'warning' | 'error', text: `Prowlarr reports a ${item.type}` }));
    return { observedAt: observedAt.toISOString(), data: { indexers: projected, failingTotal: projected.filter((item) => item.state === 'failing').length,
      disabledTotal: projected.filter((item) => item.state === 'disabled').length, warnings, applications: { connectivity: 'unknown' } } };
  }
}

function date(value: string | null | undefined): string | null {
  if (!value) return null; const parsed = new Date(value); return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
}
