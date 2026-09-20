import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../../db/database.js';
import { ReadOnlyTransport, SafeTransportError } from '../../core/read-only-transport.js';
import { JellyfinAdapter, type PlaybackObservation } from './adapter.js';
import { JellyfinStateStore } from './state.js';

const fixture = (name: string) => JSON.parse(readFileSync(resolve(`tests/fixtures/jellyfin/10.10.7/${name}.json`), 'utf8')) as unknown;
function response(body: unknown, status = 200, headers: Record<string, string> = {}) { return Promise.resolve(new Response(JSON.stringify(body), { status, headers })); }

describe('Jellyfin vertical slice', () => {
  it('normalizes direct play, direct stream, transcode, pause and unknown runtime without idle sessions', async () => {
    const transport = new ReadOnlyTransport('http://jellyfin.test/prefix', 'LABDECK_SECRET_CANARY_7dcf3d', vi.fn(() => response(fixture('sessions'))));
    const result = await new JellyfinAdapter(transport, () => new Date('2026-09-20T10:00:00Z')).playback();
    expect(result.data.sessions).toHaveLength(3);
    expect(result.data.sessions.map((session) => [session.playbackMode, session.paused])).toEqual([['direct-play', false], ['direct-stream', true], ['transcode', false]]);
    expect(result.data.sessions[0]).toMatchObject({ positionSeconds: 1800, durationSeconds: 7200, progressRatio: 0.25, bitrateBitsPerSecond: null, bitrateSource: null });
    expect(result.data.sessions[2]).toMatchObject({ durationSeconds: null, progressRatio: null, bitrateBitsPerSecond: 2400000, bitrateSource: 'transcode-estimate' });
  });

  it('normalizes counts and bounded recent additions independently', async () => {
    const fetcher = vi.fn((url: string | URL | Request) => response((url instanceof Request ? url.url : url.toString()).includes('Counts') ? fixture('counts') : fixture('recent')));
    const result = await new JellyfinAdapter(new ReadOnlyTransport('http://jellyfin.test', 'secret', fetcher), () => new Date()).library();
    expect(result.data.counts).toEqual({ movies: 42, series: 7, episodes: 128 });
    expect(result.data.recent[0]).toMatchObject({ name: 'Fresh Signals', type: 'episode', seriesName: 'Example Station' });
  });

  it('uses only the configured origin/path prefix, GET, fixed queries and header auth', async () => {
    const fetcher = vi.fn(() => response([]));
    await new JellyfinAdapter(new ReadOnlyTransport('https://media.test/jellyfin', 'sentinel-key', fetcher)).playback();
    const [url, options] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe('https://media.test/jellyfin/Sessions');
    expect(options.method).toBe('GET'); expect(options.redirect).toBe('error');
    expect(options.headers).toMatchObject({ Authorization: 'MediaBrowser Token="sentinel-key"' });
  });

  it.each([[401, 'auth'], [429, 'rate-limited'], [404, 'unsupported-version']])('maps HTTP %i to safe %s', async (status, code) => {
    const transport = new ReadOnlyTransport('http://jellyfin.test', 'secret', vi.fn(() => response({}, status)));
    await expect(transport.get('/Sessions')).rejects.toMatchObject({ code });
  });

  it('rejects oversized and malformed bodies without exposing content', async () => {
    const oversized = new ReadOnlyTransport('http://jellyfin.test', 'secret', vi.fn(() => response({}, 200, { 'content-length': String(2 * 1024 * 1024 + 1) })));
    await expect(oversized.get('/Sessions')).rejects.toBeInstanceOf(SafeTransportError);
    const malformed = new ReadOnlyTransport('http://jellyfin.test', 'secret', vi.fn(() => Promise.resolve(new Response('{not-json'))));
    await expect(malformed.get('/Sessions')).rejects.toMatchObject({ code: 'invalid-response' });
  });

  it('cancels a request at the transport deadline', async () => {
    const fetcher = vi.fn((_url: string | URL | Request, options?: RequestInit) => new Promise<Response>((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))) as typeof fetch;
    const transport = new ReadOnlyTransport('http://jellyfin.test', 'secret', fetcher, 5);
    await expect(transport.get('/Sessions')).rejects.toMatchObject({ code: 'timeout' });
  });

  it('bounds concurrent requests per configured instance', async () => {
    const responders: ((response: Response) => void)[] = [];
    const fetcher = vi.fn(() => new Promise<Response>((resolveResponse) => responders.push(resolveResponse)));
    const transport = new ReadOnlyTransport('http://jellyfin.test', 'secret', fetcher, 1_000, 2);
    const requests = [transport.get('/Sessions'), transport.get('/System/Info'), transport.get('/Items/Counts')];
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    responders[0]!(new Response('{}'));
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    responders[1]!(new Response('{}')); responders[2]!(new Response('{}'));
    await Promise.all(requests);
  });

  it('baselines initial playback, emits additions once, and retains last-good data on failure', () => {
    const database = openDatabase(':memory:'); const state = new JellyfinStateStore(database);
    const first: PlaybackObservation = { observedAt: '2026-09-20T10:00:00Z', data: { sessions: [{ id: 's1', userName: 'Mira', title: 'One', subtitle: null, mediaId: 'm1', paused: false, positionSeconds: null, durationSeconds: null, progressRatio: null, playbackMode: 'unknown', bitrateBitsPerSecond: null, bitrateSource: null }] } };
    state.success('playback', first, Date.parse(first.observedAt));
    expect(database.prepare('SELECT count(*) AS count FROM events').get()).toEqual({ count: 0 });
    const second = structuredClone(first); second.observedAt = '2026-09-20T10:00:10Z'; second.data.sessions.push({ ...first.data.sessions[0]!, id: 's2', mediaId: 'm2', title: 'Two' });
    state.success('playback', second, Date.parse(second.observedAt)); state.success('playback', second, Date.parse(second.observedAt) + 1);
    expect(database.prepare("SELECT count(*) AS count FROM events WHERE kind='media.playback-observed'").get()).toEqual({ count: 1 });
    state.failure('playback', new SafeTransportError('timeout'), Date.parse(second.observedAt) + 2);
    const stored = database.prepare("SELECT normalized_json FROM capability_state WHERE capability='media.playback'").get() as { normalized_json: string };
    expect(stored.normalized_json).toContain('Two'); expect(stored.normalized_json).not.toContain('LABDECK_SECRET');
    database.close();
  });
});
