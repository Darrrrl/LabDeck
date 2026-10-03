import { usePreferences } from '../../app/preferences.js';
import { OrderedWidgets, useSelectedStorage } from '../../components/OrderedWidgets.js';
import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { getOverview } from '../../app/api.js';
import { bytes, duration, relativeTime } from '../../components/format.js';
import { Status } from '../../components/Status.js';

export function WallboardPage() {
  const query = useQuery({ queryKey: ['overview'], queryFn: getOverview, refetchInterval: 5_000, refetchIntervalInBackground: false });
  const [fullscreenError, setFullscreenError] = useState(false);
  const data = query.data;
  const [preferences, updatePreferences] = usePreferences();
  const selected = useSelectedStorage(data?.configured ? data.storage : null);
  const storage = selected.storage;
  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
      setFullscreenError(false);
    } catch { setFullscreenError(true); }
  }
  return <main id="main-content" tabIndex={-1} className="wallboard">
    <header className="wallboard-header"><div><p className="eyebrow">LABDECK · WALLBOARD</p><h1>{data?.configured ? data.host?.hostname ?? 'Your homelab' : 'Your homelab'}</h1></div><div className="wallboard-actions"><Link className="text-link" to="/">Overview</Link><button type="button" aria-pressed={preferences.hideWatchingTitles} onClick={() => updatePreferences({ hideWatchingTitles: !preferences.hideWatchingTitles })}>Hide watching titles</button><button type="button" onClick={() => { void fullscreen(); }}>Toggle fullscreen</button></div></header>
    {fullscreenError ? <p role="alert">Fullscreen is unavailable. Use your browser’s fullscreen control.</p> : null}
    {query.isError ? <p role="alert">Refresh failed. Displayed values are from the last successful request.</p> : null}
    {!data ? <p>{query.isPending ? 'Loading wallboard…' : 'Cached state unavailable.'}</p> : !data.configured ? <section className="notice"><h2>{data.title}</h2><p>{data.message}</p><Link to="/settings">Review setup</Link></section> : <>
      <section className="wallboard-health"><Status tone={data.overall === 'monitoring-incomplete' ? 'unknown' : data.overall}>{data.title}</Status><span>{data.message}</span></section>
      <OrderedWidgets className="wallboard-grid">
        <Widget data-widget="system" title="System" to="/system" freshness={data.freshness} observedAt={data.observedAt} error={data.errorCode}>
          <strong className="wallboard-value">{data.host?.cpu.utilizationPercent == null ? '—' : `${data.host.cpu.utilizationPercent.toFixed(1)}%`} <small>CPU</small></strong>
          <p>Memory {data.host ? `${Math.round(data.host.memory.usedBytes / data.host.memory.totalBytes * 100)}%` : 'unknown'} · Uptime {data.host ? duration(data.host.uptimeSeconds) : 'unknown'}</p>
          <p>↓ {rate(data.network?.receiveBytesPerSecond)} · ↑ {rate(data.network?.transmitBytesPerSecond)}</p>
        </Widget>
        <Widget data-widget="storage" title="Storage" to="/storage" freshness={selected.freshness ?? data.freshness} observedAt={selected.observedAt ?? data.observedAt} error={selected.failed ? 'refresh-failed' : data.errorCode}>
          <strong className="wallboard-value">{storage ? bytes(storage.availableBytes) : '—'} <small>available</small></strong>
          <p>{storage ? `${storage.id} · ${Math.round(storage.usedRatio * 100)}% used` : 'No selected volume'}</p>
          {data.disks ? <p>Disks: {data.disks.failed} failed · {data.disks.warning} warnings · {data.disks.unavailable} unavailable<br />{data.disks.freshness} · {relativeTime(data.disks.observedAt)}{data.disks.errorCode ? ' · Read failed' : ''}</p> : <p>Disk health not configured</p>}
        </Widget>
        <Widget data-widget="docker" title="Docker" to="/containers" freshness={data.containers?.freshness} observedAt={data.containers?.observedAt} error={data.containers?.errorCode}>
          <strong className="wallboard-value">{data.containers?.running ?? '—'} <small>running / {data.containers?.total ?? '—'}</small></strong>
          <p>{data.containers ? `${data.containers.unhealthy ?? 'Unknown'} unhealthy · ${data.containers.expectedStopped ?? 'Unknown'} expected but stopped` : 'Not configured'}</p>
          {data.containers?.inventoryComplete === false ? <p>Partial inventory</p> : null}
        </Widget>
        <Widget data-widget="watching" title="Watching" to="/media" freshness={data.media?.freshness} observedAt={data.media?.observedAt} error={data.media?.errorCode}>
          <strong className="wallboard-value">{data.media && data.media.freshness !== 'never' ? data.media.sessions.length : '—'} <small>sessions · {data.media?.connection ?? 'unknown'}</small></strong>
          {!preferences.hideWatchingTitles && data.media?.sessions.slice(0, 2).map((session) => <p className="wallboard-line" key={session.id} title={session.title}>{session.paused ? 'Paused' : 'Playing'} · {session.title}</p>)}
          {preferences.hideWatchingTitles ? <p>Watching titles hidden</p> : null}
          {(data.media?.sessions.length ?? 0) > 2 ? <p>+{data.media!.sessions.length - 2} more in Media</p> : null}
          {!data.media ? <p>Not configured</p> : null}
        </Widget>
        <Widget data-widget="downloads" title="Downloads" to="/downloads">
          {data.downloads.length ? data.downloads.map((service) => <div key={service.id}><p>{service.name}: <strong>{service.freshness === 'never' ? 'Unknown' : service.queueTotal}</strong> queued · {service.healthWarnings.length} warnings</p><small>{service.connection} · {service.freshness} · {relativeTime(service.observedAt)}{service.errorCode ? ' · Refresh failed' : ''}</small></div>) : <p>Not configured</p>}
          {data.indexers ? <p>Indexers: {data.indexers.failingTotal ?? 'Unknown'} failing · {data.indexers.freshness} · {data.indexers.connection}</p> : null}
        </Widget>
        <Widget data-widget="network" title="Network" to="/network" freshness={data.tailscale?.freshness} observedAt={data.tailscale?.observedAt} error={data.tailscale?.errorCode}>
          <strong className="wallboard-value">{data.tailscale?.online ?? '—'} <small>peers online</small></strong>
          <p>{data.tailscale ? `${data.tailscale.backendState ?? 'Unknown state'} · ${data.tailscale.total ?? 'Unknown'} locally known peers` : 'Tailscale not configured'}</p>
          {data.tailscale?.inventoryComplete === false ? <p>Partial peer inventory</p> : null}
        </Widget>
      </OrderedWidgets>
    </>}
  </main>;
}
function Widget({ title, to, freshness, observedAt, error, children }: { 'data-widget': string; title: string; to: string; freshness?: string | undefined; observedAt?: string | null | undefined; error?: string | null | undefined; children: ReactNode }) {
  return <section className="panel wallboard-widget"><h2><Link to={to}>{title}</Link></h2><div className="wallboard-body">{children}</div>{freshness ? <footer>{error ? 'Refresh failed · ' : ''}{freshness === 'never' ? 'Waiting for data' : `${freshness} · observed ${relativeTime(observedAt ?? null)}`}</footer> : null}</section>;
}
function rate(value: number | null | undefined) { return value == null ? 'Unknown' : `${bytes(value)}/s`; }
