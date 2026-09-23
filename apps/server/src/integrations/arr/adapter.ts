import { z } from 'zod';
import type { ArrTransport } from './common/transport.js';

export type ArrKind = 'sonarr' | 'radarr';
export interface ArrObservation<T> { observedAt: string; data: T }
export interface QueueEntry { source: ArrKind; id: string; title: string; sizeBytes: number | null; remainingBytes: number | null; progressRatio: number | null; eta: string | null; stage: 'downloading' | 'import-pending' | 'warning' | 'unknown'; warnings: string[] }
export interface CatalogData { monitored: number; missing: number; upcoming: { id: string; title: string; date: string | null; releaseKind: 'episode-air' | 'digital' | 'physical' | 'theatrical' | 'unknown' }[]; upcomingTruncated: boolean }
export interface HistoryData { imports: { id: string; title: string; importedAt: string | null }[] }
const pageSchema = z.object({ page: z.number().int().optional(), pageSize: z.number().int().optional(), totalRecords: z.number().int().nonnegative(), records: z.array(z.unknown()).max(1000) }).passthrough();
const queueRecord = z.object({ id: z.union([z.number(), z.string()]), title: z.string().max(512).optional(), size: z.number().nonnegative().optional(), sizeleft: z.number().nonnegative().nullable().optional(), estimatedCompletionTime: z.string().optional(), status: z.string().optional(), trackedDownloadStatus: z.string().optional() }).passthrough();
const healthSchema = z.array(z.object({ type: z.string().optional() }).passthrough()).max(100);
const catalogItem = z.object({ monitored: z.boolean().optional() }).passthrough();
const upcomingItem = z.object({ id: z.union([z.number(), z.string()]), title: z.string().max(512).optional(), airDateUtc: z.string().optional(), digitalRelease: z.string().optional(), physicalRelease: z.string().optional(), inCinemas: z.string().optional(), series: z.object({ title: z.string().max(512).optional() }).passthrough().optional() }).passthrough();
const historyRecord = z.object({ id: z.union([z.number(), z.string()]), eventType: z.string(), date: z.string().optional(), sourceTitle: z.string().max(512).optional(), series: z.object({ title: z.string().max(512).optional() }).passthrough().optional(), movie: z.object({ title: z.string().max(512).optional() }).passthrough().optional() }).passthrough();

export class ArrAdapter {
  constructor(readonly kind: ArrKind, private readonly transport: ArrTransport, private readonly now: () => Date = () => new Date()) {}
  async connection(signal?: AbortSignal) { const value = z.object({ version: z.string().min(1).max(64) }).passthrough().safeParse(await this.transport.get('/api/v3/system/status', {}, signal)); if (!value.success) throw new Error('invalid-response'); return { version: value.data.version }; }
  async health(signal?: AbortSignal): Promise<ArrObservation<{ warnings: string[] }>> { const value = healthSchema.safeParse(await this.transport.get('/api/v3/health', {}, signal)); if (!value.success) throw new Error('invalid-response'); return this.observation({ warnings: value.data.slice(0, 20).map((item) => item.type?.toLowerCase() === 'error' ? 'Service reports an error' : 'Service reports a warning') }); }
  async queue(signal?: AbortSignal): Promise<ArrObservation<{ entries: QueueEntry[]; total: number; truncated: boolean }>> {
    const value = pageSchema.safeParse(await this.transport.getPaged('/api/v3/queue', { [this.kind === 'sonarr' ? 'includeUnknownSeriesItems' : 'includeUnknownMovieItems']: 'true' }, signal)); if (!value.success) throw new Error('invalid-response');
    const entries = value.data.records.flatMap((raw) => { const parsed = queueRecord.safeParse(raw); return parsed.success ? [queueEntry(this.kind, parsed.data)] : []; });
    return this.observation({ entries: entries.slice(0, 50), total: value.data.totalRecords, truncated: value.data.totalRecords > 50 || entries.length > 50 });
  }
  async catalog(signal?: AbortSignal): Promise<ArrObservation<CatalogData>> {
    const start = this.now(); const end = new Date(start.valueOf() + 14 * 86400_000);
    const [rawCatalog, rawMissing, rawUpcoming] = await Promise.all([
      this.transport.get(this.kind === 'sonarr' ? '/api/v3/series' : '/api/v3/movie', {}, signal),
      this.transport.get('/api/v3/wanted/missing', { page: '1', pageSize: '1', monitored: 'true' }, signal),
      this.transport.get('/api/v3/calendar', { start: start.toISOString(), end: end.toISOString(), unmonitored: 'false', [this.kind === 'sonarr' ? 'includeSeries' : 'includeMovie']: 'true' }, signal)
    ]);
    const catalog = z.array(catalogItem).max(10_000).safeParse(rawCatalog); const missing = pageSchema.safeParse(rawMissing); const upcoming = z.array(upcomingItem).max(1000).safeParse(rawUpcoming); if (!catalog.success || !missing.success || !upcoming.success) throw new Error('invalid-response');
    return this.observation({ monitored: catalog.data.filter((item) => item.monitored === true).length, missing: missing.data.totalRecords, upcoming: upcoming.data.slice(0, 50).map((item) => normalizeUpcoming(this.kind, item)), upcomingTruncated: upcoming.data.length > 50 });
  }
  async history(signal?: AbortSignal): Promise<ArrObservation<HistoryData>> {
    const value = pageSchema.safeParse(await this.transport.getPaged('/api/v3/history', { sortKey: 'date', sortDirection: 'descending', eventType: 'downloadFolderImported' }, signal)); if (!value.success) throw new Error('invalid-response');
    const imports = value.data.records.flatMap((raw) => { const item = historyRecord.safeParse(raw); if (!item.success || !['downloadfolderimported', 'downloadFolderImported'].includes(item.data.eventType)) return []; return [{ id: String(item.data.id), title: item.data.movie?.title ?? item.data.series?.title ?? item.data.sourceTitle ?? 'Imported item', importedAt: date(item.data.date) }]; }).slice(0, 20);
    return this.observation({ imports });
  }
  private observation<T>(data: T): ArrObservation<T> { return { observedAt: this.now().toISOString(), data }; }
}
function queueEntry(source: ArrKind, item: z.infer<typeof queueRecord>): QueueEntry { const size = item.size ?? null; const remaining = item.sizeleft ?? null; const tracked = item.trackedDownloadStatus?.toLowerCase(); const status = item.status?.toLowerCase(); return { source, id: String(item.id), title: item.title ?? 'Untitled queue entry', sizeBytes: size, remainingBytes: remaining, progressRatio: size && remaining !== null ? Math.max(0, Math.min(1, (size - remaining) / size)) : null, eta: date(item.estimatedCompletionTime), stage: tracked === 'warning' ? 'warning' : status === 'completed' ? 'import-pending' : status === 'downloading' ? 'downloading' : 'unknown', warnings: tracked === 'warning' ? ['Download reported a warning'] : [] }; }
function normalizeUpcoming(kind: ArrKind, item: z.infer<typeof upcomingItem>): CatalogData['upcoming'][number] { const candidates = kind === 'sonarr' ? [['episode-air', item.airDateUtc]] as const : [['digital', item.digitalRelease], ['physical', item.physicalRelease], ['theatrical', item.inCinemas]] as const; const selected = candidates.find(([, value]) => date(value) !== null); return { id: String(item.id), title: item.series?.title ?? item.title ?? 'Upcoming item', date: date(selected?.[1]), releaseKind: selected?.[0] ?? 'unknown' }; }
function date(value: string | undefined): string | null { if (!value) return null; const parsed = new Date(value); return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString(); }
