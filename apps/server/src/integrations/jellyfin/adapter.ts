import { z } from 'zod';
import type { MediaSession } from '@labdeck/contracts';
import type { ReadOnlyTransport } from '../../core/read-only-transport.js';

const itemSchema = z.object({
  Id: z.string().min(1), Name: z.string().min(1).max(512), SeriesName: z.string().max(512).optional(), Type: z.string().optional(),
  RunTimeTicks: z.number().nonnegative().optional(), DateCreated: z.string().optional()
}).passthrough();
const sessionSchema = z.object({
  Id: z.string().min(1), UserName: z.string().min(1).max(128).optional(), NowPlayingItem: itemSchema.optional(),
  PlayState: z.object({ PositionTicks: z.number().nonnegative().optional(), IsPaused: z.boolean().optional(), PlayMethod: z.string().optional() }).passthrough().optional(),
  TranscodingInfo: z.object({ Bitrate: z.number().int().nonnegative().optional() }).passthrough().optional()
}).passthrough();
const countsSchema = z.object({ MovieCount: z.number().int().nonnegative().default(0), SeriesCount: z.number().int().nonnegative().default(0), EpisodeCount: z.number().int().nonnegative().default(0) }).passthrough();
const itemsSchema = z.object({ Items: z.array(itemSchema).max(100), TotalRecordCount: z.number().int().nonnegative().optional() }).passthrough();
const systemSchema = z.object({ Version: z.string().min(1).max(64) }).passthrough();

export interface PlaybackObservation { observedAt: string; data: { sessions: MediaSession[] } }
export interface LibraryObservation { observedAt: string; data: { counts: { movies: number; series: number; episodes: number }; recent: { id: string; name: string; type: 'movie' | 'series' | 'episode' | 'other'; seriesName: string | null; addedAt: string | null }[] } }

export class JellyfinAdapter {
  constructor(private readonly transport: ReadOnlyTransport, private readonly now: () => Date = () => new Date()) {}

  async connection(signal?: AbortSignal): Promise<{ version: string }> {
    const parsed = systemSchema.safeParse(await this.transport.get('/System/Info', {}, signal));
    if (!parsed.success) throw new Error('invalid-response');
    return { version: parsed.data.Version };
  }

  async playback(signal?: AbortSignal): Promise<PlaybackObservation> {
    const parsed = z.array(sessionSchema).max(100).safeParse(await this.transport.get('/Sessions', {}, signal));
    if (!parsed.success) throw new Error('invalid-response');
    return { observedAt: this.now().toISOString(), data: { sessions: parsed.data.flatMap((session) => session.NowPlayingItem ? [normalizeSession(session)] : []) } };
  }

  async library(signal?: AbortSignal): Promise<LibraryObservation> {
    const [rawCounts, rawItems] = await Promise.all([
      this.transport.get('/Items/Counts', {}, signal),
      this.transport.get('/Items', { Limit: '12', Recursive: 'true', SortBy: 'DateCreated', SortOrder: 'Descending', IncludeItemTypes: 'Movie,Series,Episode', Fields: 'DateCreated', EnableImages: 'false', EnableTotalRecordCount: 'false' }, signal)
    ]);
    const counts = countsSchema.safeParse(rawCounts); const items = itemsSchema.safeParse(rawItems);
    if (!counts.success || !items.success) throw new Error('invalid-response');
    return { observedAt: this.now().toISOString(), data: {
      counts: { movies: counts.data.MovieCount, series: counts.data.SeriesCount, episodes: counts.data.EpisodeCount },
      recent: items.data.Items.slice(0, 12).map((item) => ({ id: item.Id, name: item.Name, type: itemType(item.Type), seriesName: item.SeriesName ?? null, addedAt: validDate(item.DateCreated) }))
    } };
  }
}

function normalizeSession(session: z.infer<typeof sessionSchema>): MediaSession {
  const item = session.NowPlayingItem!; const playState = session.PlayState;
  const durationSeconds = ticks(item.RunTimeTicks); const positionSeconds = ticks(playState?.PositionTicks);
  const method = playState?.PlayMethod?.toLowerCase();
  const playbackMode = method === 'directplay' ? 'direct-play' : method === 'directstream' ? 'direct-stream' : method === 'transcode' ? 'transcode' : 'unknown';
  const transcodeBitrate = session.TranscodingInfo?.Bitrate;
  return {
    id: session.Id, userName: session.UserName ?? 'Unknown user', title: item.SeriesName ?? item.Name,
    subtitle: item.SeriesName ? item.Name : null, mediaId: item.Id, paused: playState?.IsPaused ?? false,
    positionSeconds, durationSeconds, progressRatio: positionSeconds !== null && durationSeconds !== null && durationSeconds > 0 ? Math.min(1, positionSeconds / durationSeconds) : null,
    playbackMode, bitrateBitsPerSecond: transcodeBitrate ?? null,
    bitrateSource: transcodeBitrate !== undefined ? 'transcode-estimate' : null
  };
}
function ticks(value: number | undefined): number | null { return value === undefined ? null : value / 10_000_000; }
function itemType(value: string | undefined): 'movie' | 'series' | 'episode' | 'other' { const type = value?.toLowerCase(); return type === 'movie' || type === 'series' || type === 'episode' ? type : 'other'; }
function validDate(value: string | undefined): string | null { if (!value) return null; const date = new Date(value); return Number.isNaN(date.valueOf()) ? null : date.toISOString(); }
