import { SafeTransportError } from '../../../core/read-only-transport.js';

const paths = new Set(['/api/v3/system/status', '/api/v3/health', '/api/v3/queue', '/api/v3/history', '/api/v3/calendar', '/api/v3/wanted/missing', '/api/v3/series', '/api/v3/movie']);
const queries = new Set(['page', 'pageSize', 'sortKey', 'sortDirection', 'eventType', 'includeUnknownSeriesItems', 'includeUnknownMovieItems', 'monitored', 'start', 'end', 'unmonitored', 'includeSeries', 'includeMovie']);

export class ArrTransport {
  constructor(private readonly baseUrl: string, private readonly apiKey: string, private readonly fetcher: typeof fetch = fetch) {}
  async get(path: string, query: Record<string, string> = {}, signal?: AbortSignal): Promise<unknown> {
    if (!paths.has(path)) throw new SafeTransportError('invalid-response');
    const url = new URL(`${this.baseUrl}/${path.slice(1)}`); for (const [key, value] of Object.entries(query)) { if (!queries.has(key)) throw new SafeTransportError('invalid-response'); url.searchParams.set(key, value); }
    const controller = new AbortController(); const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true }); const timer = setTimeout(() => controller.abort(), 5_000);
    try {
      const response = await this.fetcher(url, { method: 'GET', redirect: 'error', signal: controller.signal, headers: { Accept: 'application/json', 'X-Api-Key': this.apiKey } });
      if (response.status === 401 || response.status === 403) throw new SafeTransportError('auth'); if (response.status === 429) throw new SafeTransportError('rate-limited'); if (response.status === 404) throw new SafeTransportError('unsupported-version'); if (!response.ok) throw new SafeTransportError('network');
      const declared = Number(response.headers.get('content-length')); if (Number.isFinite(declared) && declared > 2 * 1024 * 1024) throw new SafeTransportError('invalid-response');
      const body = await response.text(); if (Buffer.byteLength(body) > 2 * 1024 * 1024) throw new SafeTransportError('invalid-response'); try { return JSON.parse(body) as unknown; } catch { throw new SafeTransportError('invalid-response'); }
    } catch (error) { if (error instanceof SafeTransportError) throw error; throw new SafeTransportError(controller.signal.aborted ? 'timeout' : 'network'); }
    finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
  async getPaged(path: '/api/v3/queue' | '/api/v3/history', query: Record<string, string>, signal?: AbortSignal): Promise<{ page: number; pageSize: number; totalRecords: number; records: unknown[]; complete: boolean }> {
    const records: unknown[] = []; let totalRecords = 0; let bytes = 0;
    for (let page = 1; page <= 10; page += 1) {
      const raw = await this.get(path, { ...query, page: String(page), pageSize: '100' }, signal); bytes += Buffer.byteLength(JSON.stringify(raw)); if (bytes > 10 * 1024 * 1024) throw new SafeTransportError('invalid-response');
      if (!raw || typeof raw !== 'object') throw new SafeTransportError('invalid-response'); const candidateRecords: unknown = Reflect.get(raw, 'records'); const candidateTotal: unknown = Reflect.get(raw, 'totalRecords');
      if (!Array.isArray(candidateRecords) || !Number.isSafeInteger(candidateTotal) || Number(candidateTotal) < 0) throw new SafeTransportError('invalid-response');
      totalRecords = Number(candidateTotal); for (const item of candidateRecords as unknown[]) records.push(item); if (records.length >= totalRecords || candidateRecords.length < 100) return { page: 1, pageSize: 100, totalRecords, records, complete: records.length >= totalRecords };
    }
    return { page: 1, pageSize: 100, totalRecords, records, complete: records.length >= totalRecords };
  }
}
