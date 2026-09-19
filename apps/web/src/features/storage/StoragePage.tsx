import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getStorage } from '../../app/api.js';
import { bytes, relativeTime } from '../../components/format.js';
import { Sparkline } from '../../components/Sparkline.js';
import { Status } from '../../components/Status.js';

export function StoragePage() {
  const [range, setRange] = useState<'1h' | '24h'>('1h');
  const query = useQuery({ queryKey: ['storage', range], queryFn: () => getStorage(range), refetchInterval: 15_000 });
  return <main id="main-content" tabIndex={-1}><header className="page-header"><div><p className="eyebrow">CAPACITY</p><h1>Storage</h1></div></header>
    {query.data ? <><div className="detail-toolbar"><Status tone={query.data.freshness === 'fresh' ? 'healthy' : 'unknown'}>{query.data.freshness === 'fresh' ? 'Current' : 'Stale'}</Status><span>Observed {relativeTime(query.data.observedAt)}</span><div className="segmented" aria-label="History range">{(['1h', '24h'] as const).map((item) => <button key={item} className={range === item ? 'active' : ''} onClick={() => setRange(item)}>{item}</button>)}</div></div>
      <section className="volume-list">{query.data.filesystems.map((filesystem) => <article className="panel volume-card" key={filesystem.id}><div className="section-heading"><div><h2>{filesystem.id}</h2><p>{filesystem.path} · {filesystem.source}</p></div><strong>{Math.round(filesystem.usedRatio * 100)}% used</strong></div><div className="capacity-track"><span style={{ width: `${Math.min(100, filesystem.usedRatio * 100)}%` }} /></div><div className="capacity-labels"><span>{bytes(filesystem.usedBytes)} used</span><span>{bytes(filesystem.availableBytes)} available</span><span>{bytes(filesystem.reservedBytes)} reserved</span><span>{bytes(filesystem.totalBytes)} total</span></div><Sparkline label={`${filesystem.id} used capacity history`} values={(query.data.history[filesystem.id] ?? []).map((point) => point.value)} /><p className="fine-print">Available is space allocatable by the unprivileged collector. Reserved space is shown separately.</p></article>)}</section>
      {!query.data.filesystems.length ? <section className="notice"><Status tone="unknown">Monitoring incomplete</Status><h2>No selected volumes</h2><p>Configure at least one explicit filesystem in the host collector.</p></section> : null}</> : <section className="notice"><h2>Loading storage…</h2></section>}
  </main>;
}
