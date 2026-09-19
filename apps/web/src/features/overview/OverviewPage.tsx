import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Cpu, HardDrive, MemoryStick, ServerCog } from 'lucide-react';
import { Link } from 'react-router-dom';
import { getOverview } from '../../app/api.js';
import { bytes, duration, relativeTime } from '../../components/format.js';
import { Status, type StatusTone } from '../../components/Status.js';

export function OverviewPage() {
  const overview = useQuery({ queryKey: ['overview'], queryFn: getOverview, refetchInterval: 5_000, refetchIntervalInBackground: false });
  return <main id="main-content" tabIndex={-1}>
    <header className="page-header"><div><p className="eyebrow">OVERVIEW</p><h1>Your homelab</h1></div><p className="page-context">Local monitoring</p></header>
    {overview.isPending ? <div className="panel loading-panel" aria-label="Loading overview"><span className="skeleton" /></div> : null}
    {overview.isError ? <div className="notice" role="alert"><Status tone="critical">Unavailable</Status><h2>LabDeck could not load its cached state</h2><p>Check the application status and try again.</p></div> : null}
    {overview.data && !overview.data.configured ? <section className="empty-state" aria-labelledby="empty-title"><div className="empty-icon" aria-hidden="true"><ServerCog size={24} /></div><Status tone="unknown">Monitoring incomplete</Status><h2 id="empty-title">{overview.data.title}</h2><p>{overview.data.message}</p><Link className="text-link" to="/settings">Review setup <ArrowRight aria-hidden="true" size={15} /></Link></section> : null}
    {overview.data?.configured ? <>
      <section className="health-strip panel"><div><Status tone={tone(overview.data.overall)}>{overview.data.title}</Status><p>{overview.data.message}</p></div><span className="refresh-age">Observed {relativeTime(overview.data.observedAt)}</span></section>
      <section className="metric-grid" aria-label="Host health">
        <Metric icon={<Cpu size={17} />} label="CPU" value={overview.data.host?.cpu.utilizationPercent === null || !overview.data.host ? 'Collecting' : `${overview.data.host.cpu.utilizationPercent.toFixed(1)}%`} detail={overview.data.host ? `Load ${overview.data.host.load.one.toFixed(2)}` : 'No observation'} />
        <Metric icon={<MemoryStick size={17} />} label="Memory" value={overview.data.host ? `${Math.round((overview.data.host.memory.usedBytes / overview.data.host.memory.totalBytes) * 100)}%` : '—'} detail={overview.data.host ? `${bytes(overview.data.host.memory.availableBytes)} available` : 'No observation'} />
        <Metric icon={<HardDrive size={17} />} label="Storage" value={overview.data.storage ? `${Math.round(overview.data.storage.usedRatio * 100)}%` : '—'} detail={overview.data.storage ? `${bytes(overview.data.storage.availableBytes)} available` : 'No selected volume'} />
        <Metric icon={<ServerCog size={17} />} label="Uptime" value={overview.data.host ? duration(overview.data.host.uptimeSeconds) : '—'} detail={overview.data.host?.hostname ?? 'Waiting for host'} />
      </section>
      {overview.data.storage ? <section className="panel storage-summary"><div className="section-heading"><div><h2>{overview.data.storage.id}</h2><p>{overview.data.storage.path} · {overview.data.storage.fsType}</p></div><strong>{bytes(overview.data.storage.availableBytes)} available</strong></div><div className="capacity-track"><span style={{ width: `${Math.min(100, overview.data.storage.usedRatio * 100)}%` }} /></div><div className="capacity-labels"><span>{bytes(overview.data.storage.usedBytes)} used</span><span>{bytes(overview.data.storage.totalBytes)} total</span></div></section> : null}
      <section className="panel recent-events"><div className="section-heading"><div><h2>Recent activity</h2><p>Transitions observed by LabDeck.</p></div><Link className="text-link" to="/events">All events <ArrowRight size={14} /></Link></div>{overview.data.events.length ? <ul className="event-list">{overview.data.events.map((event) => <li key={event.id}><span className={`event-dot event-dot--${event.severity}`} /><span>{eventTitle(event.kind)}</span><time>{relativeTime(event.observedAt)}</time></li>)}</ul> : <p className="muted">No noteworthy transitions yet.</p>}</section>
    </> : null}
  </main>;
}

function Metric({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string; detail: string }) { return <article className="metric-card"><div className="metric-label">{icon}{label}</div><strong>{value}</strong><span>{detail}</span></article>; }
function tone(status: 'healthy' | 'warning' | 'critical' | 'monitoring-incomplete'): StatusTone { return status === 'monitoring-incomplete' ? 'unknown' : status; }
function eventTitle(kind: string): string { return ({ 'integration.outage': 'Host collector connection lost', 'integration.recovered': 'Host collector connection recovered', 'storage.threshold': 'Storage crossed a capacity threshold', 'storage.recovered': 'Storage returned below its warning threshold' } as Record<string, string>)[kind] ?? 'Host status changed'; }
