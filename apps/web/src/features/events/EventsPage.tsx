import { useQuery } from '@tanstack/react-query';
import { getEvents } from '../../app/api.js';
import { relativeTime } from '../../components/format.js';

const titles: Record<string, string> = { 'integration.outage': 'Host collector connection lost', 'integration.recovered': 'Host collector connection recovered', 'storage.threshold': 'Storage crossed a capacity threshold', 'storage.recovered': 'Storage returned below its warning threshold' };
export function EventsPage() {
  const query = useQuery({ queryKey: ['events'], queryFn: getEvents, refetchInterval: 10_000 });
  return <main id="main-content" tabIndex={-1}><header className="page-header"><div><p className="eyebrow">ACTIVITY</p><h1>Events</h1></div></header>
    <section className="panel"><div className="section-heading"><div><h2>Observed transitions</h2><p>Deduplicated state changes from configured integrations.</p></div></div>{query.data?.events.length ? <ul className="event-list event-list--large">{query.data.events.map((event) => <li key={event.id}><span className={`event-dot event-dot--${event.severity}`} /><span><strong>{titles[event.kind] ?? 'Host status changed'}</strong><small>{event.entityId ?? 'Host'}</small></span><time dateTime={event.observedAt}>{relativeTime(event.observedAt)}</time></li>)}</ul> : <p className="muted">{query.isPending ? 'Loading events…' : 'No noteworthy transitions yet.'}</p>}</section>
  </main>;
}
