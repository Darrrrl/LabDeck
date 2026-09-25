import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ExternalLink, Pause, Play } from 'lucide-react';
import { getMedia, getMetricHistory } from '../../app/api.js';
import type { HistoryRange, MediaSession } from '@labdeck/contracts';
import { duration, relativeTime } from '../../components/format.js';
import { Status } from '../../components/Status.js';
import { Sparkline } from '../../components/Sparkline.js';

export function MediaPage() {
  const [range, setRange] = useState<HistoryRange>('24h');
  const query = useQuery({ queryKey: ['media'], queryFn: getMedia, refetchInterval: 10_000, refetchIntervalInBackground: false });
  const history = useQuery({ queryKey: ['library-history', range], queryFn: async () => Promise.all((['library.movies', 'library.series', 'library.episodes'] as const).map((name) => getMetricHistory(name, range))), enabled: query.data?.configured ?? false });
  return <main id="main-content" tabIndex={-1}>
    <header className="page-header"><div><p className="eyebrow">MEDIA</p><h1>Jellyfin</h1></div>{query.data?.browserUrl ? <a className="text-link" href={query.data.browserUrl} target="_blank" rel="noreferrer">Open Jellyfin <ExternalLink size={14} /></a> : null}</header>
    {query.isPending ? <div className="panel loading-panel" aria-label="Loading media"><span className="skeleton" /></div> : null}
    {query.isError ? <div className="notice" role="alert"><Status tone="critical">Unavailable</Status><h2>Media state could not be loaded</h2></div> : null}
    {query.data && !query.data.configured ? <section className="empty-state"><Status tone="unknown">Not configured</Status><h2>Jellyfin monitoring is off</h2><p>Add the Jellyfin service and key file to the server configuration.</p></section> : null}
    {query.data?.configured ? <>
      <section className="health-strip panel"><div><Status tone={query.data.connection === 'reachable' ? 'healthy' : query.data.connection === 'unknown' ? 'unknown' : 'warning'}>{connectionLabel(query.data.connection)}</Status><p>{playbackMessage(query.data.playback.freshness, query.data.playback.errorCode)}</p></div><span className="refresh-age">Playback observed {relativeTime(query.data.playback.observedAt)}</span></section>
      <section className="panel media-section"><div className="section-heading"><div><h2>Currently watching</h2><p>Playing and paused sessions reported by Jellyfin.</p></div></div>{query.data.playback.sessions.length ? <div className="session-list">{query.data.playback.sessions.map((session) => <SessionCard key={`${session.id}:${session.mediaId}`} session={session} />)}</div> : <p className="muted">{query.data.playback.freshness === 'never' ? 'Waiting for the first playback observation.' : 'Nobody is watching right now.'}</p>}</section>
      <section className="panel media-section"><div className="section-heading"><div><h2>Library</h2><p>{query.data.library.errorCode ? `Refresh failed (${safeError(query.data.library.errorCode)}); showing the last successful counts.` : `Observed ${relativeTime(query.data.library.observedAt)}.`}</p></div>{query.data.library.freshness === 'stale' ? <Status tone="warning">Stale</Status> : null}</div>
        {query.data.library.counts ? <div className="library-counts"><Metric label="Movies" value={query.data.library.counts.movies} /><Metric label="Series" value={query.data.library.counts.series} /><Metric label="Episodes" value={query.data.library.counts.episodes} /></div> : <p className="muted">Library counts are not available yet.</p>}
        <div className="detail-toolbar"><span>Library history</span><div className="segmented" role="group" aria-label="Library history range">{(['24h', '7d', '30d', '400d'] as const).map((item) => <button key={item} type="button" aria-pressed={range === item} className={range === item ? 'active' : ''} onClick={() => setRange(item)}>{item}</button>)}</div></div>
        {history.data ? <div className="library-counts">{history.data.map((series) => <div key={series.name}><span>{series.name.split('.')[1]}</span><Sparkline label={`${series.name} history`} values={series.points.map((point) => point.value)} /></div>)}</div> : <p className="fine-print">{history.isError ? 'Library history unavailable.' : 'Waiting for library history.'}</p>}
        <h3>Recently added</h3>{query.data.library.recent.length ? <ul className="recent-media">{query.data.library.recent.map((item) => <li key={item.id}><span><strong>{item.name}</strong>{item.seriesName ? <small>{item.seriesName}</small> : null}</span><time>{relativeTime(item.addedAt)}</time></li>)}</ul> : <p className="muted">No recent additions reported.</p>}
      </section>
    </> : null}
  </main>;
}

export function SessionCard({ session }: { session: MediaSession }) {
  const progress = session.progressRatio === null ? null : Math.round(session.progressRatio * 100);
  return <article className="session-card"><div className="session-icon" aria-hidden="true">{session.paused ? <Pause size={17} /> : <Play size={17} />}</div><div><strong>{session.title}</strong>{session.subtitle ? <span>{session.subtitle}</span> : null}<small>{session.userName} · {session.paused ? 'Paused' : 'Playing'} · {mode(session.playbackMode)}</small></div><div className="session-progress"><span>{progress === null ? 'Progress unknown' : `${progress}%`}</span><small>{session.positionSeconds === null ? '—' : duration(session.positionSeconds)} / {session.durationSeconds === null ? '—' : duration(session.durationSeconds)}</small></div></article>;
}
function Metric({ label, value }: { label: string; value: number }) { return <div><span>{label}</span><strong>{value.toLocaleString()}</strong></div>; }
function mode(value: MediaSession['playbackMode']) { return ({ 'direct-play': 'Direct play', 'direct-stream': 'Direct stream', transcode: 'Transcoding', unknown: 'Mode unknown' })[value]; }
function connectionLabel(value: 'unknown' | 'reachable' | 'unreachable' | 'auth-error') { return value === 'reachable' ? 'Reachable' : value === 'auth-error' ? 'Credentials rejected' : value === 'unreachable' ? 'Unreachable' : 'Checking connection'; }
function playbackMessage(freshness: 'fresh' | 'stale' | 'never', error: string | null) { return error ? `Playback refresh failed (${safeError(error)}); last-good sessions are retained.` : freshness === 'stale' ? 'Playback data is stale.' : freshness === 'never' ? 'Waiting for playback data.' : 'Playback data is current.'; }
function safeError(value: string) { return value.replaceAll('-', ' '); }
