export type SafeTransportErrorCode = 'timeout' | 'network' | 'auth' | 'rate-limited' | 'invalid-response' | 'unsupported-version';

export class SafeTransportError extends Error {
  constructor(readonly code: SafeTransportErrorCode) { super(code); }
}

export class ReadOnlyTransport {
  #active = 0;
  readonly #waiters: (() => void)[] = [];
  constructor(private readonly baseUrl: string, private readonly apiKey: string, private readonly fetcher: typeof fetch = fetch, private readonly timeoutMs = 5_000, private readonly maximumConcurrency = 2) {}

  async get(path: string, query: Readonly<Record<string, string>> = {}, signal?: AbortSignal): Promise<unknown> {
    if (!path.startsWith('/') || path.includes('..') || !ALLOWED_PATHS.has(path)) throw new SafeTransportError('invalid-response');
    const url = new URL(`${this.baseUrl}/${path.slice(1)}`);
    for (const [name, value] of Object.entries(query)) {
      if (!ALLOWED_QUERY.has(name)) throw new SafeTransportError('invalid-response');
      url.searchParams.set(name, value);
    }
    const release = await this.#acquire();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    try {
      const response = await this.fetcher(url, { method: 'GET', redirect: 'error', signal: controller.signal, headers: {
        Accept: 'application/json', Authorization: `MediaBrowser Token="${this.apiKey}"`
      } });
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
      if (controller.signal.aborted) throw new SafeTransportError('timeout');
      throw new SafeTransportError('network');
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', abort); release();
    }
  }

  async #acquire(): Promise<() => void> {
    if (this.#active < this.maximumConcurrency) this.#active += 1;
    else await new Promise<void>((resolve) => this.#waiters.push(resolve));
    let released = false;
    return () => {
      if (released) return; released = true;
      const next = this.#waiters.shift(); if (next) next(); else this.#active -= 1;
    };
  }
}

const ALLOWED_PATHS = new Set(['/System/Info', '/Sessions', '/Items/Counts', '/Items']);
const ALLOWED_QUERY = new Set(['Limit', 'Recursive', 'SortBy', 'SortOrder', 'IncludeItemTypes', 'Fields', 'EnableImages', 'EnableTotalRecordCount']);
