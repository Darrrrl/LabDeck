import { useQuery } from '@tanstack/react-query';
import { ArrowRight, ServerCog } from 'lucide-react';
import { Link } from 'react-router-dom';
import { getOverview } from '../../app/api.js';
import { Status } from '../../components/Status.js';

export function OverviewPage() {
  const overview = useQuery({ queryKey: ['overview'], queryFn: getOverview, refetchInterval: 5_000, refetchIntervalInBackground: false });
  return <main id="main-content" tabIndex={-1}>
    <header className="page-header"><div><p className="eyebrow">OVERVIEW</p><h1>Your homelab</h1></div><p className="page-context">Local monitoring</p></header>
    {overview.isPending ? <div className="panel loading-panel" aria-label="Loading overview"><span className="skeleton" /></div> : null}
    {overview.isError ? <div className="notice" role="alert"><Status tone="critical">Unavailable</Status><h2>LabDeck could not load its cached state</h2><p>Check the application status and try again.</p></div> : null}
    {overview.data ? <section className="empty-state" aria-labelledby="empty-title"><div className="empty-icon" aria-hidden="true"><ServerCog size={24} /></div><Status tone="unknown">Monitoring incomplete</Status><h2 id="empty-title">{overview.data.title}</h2><p>{overview.data.message}</p><Link className="text-link" to="/settings">Review setup <ArrowRight aria-hidden="true" size={15} /></Link></section> : null}
  </main>;
}
