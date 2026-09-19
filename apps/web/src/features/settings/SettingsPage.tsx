import { useQuery } from '@tanstack/react-query';
import { getSettings } from '../../app/api.js';
import { Status } from '../../components/Status.js';

export function SettingsPage() {
  const settings = useQuery({ queryKey: ['settings'], queryFn: getSettings });
  return <main id="main-content" tabIndex={-1}>
    <header className="page-header"><div><p className="eyebrow">SETTINGS</p><h1>Configuration</h1></div></header>
    <section className="panel" aria-labelledby="connections-title"><div className="section-heading"><div><h2 id="connections-title">Connections</h2><p>Integrations are configured on the server and credentials never reach this browser.</p></div><Status tone="unknown">Not configured</Status></div>
      {settings.isPending ? <p className="muted">Loading configuration…</p> : null}{settings.isError ? <p role="alert" className="form-error">Configuration status is unavailable.</p> : null}{settings.data ? <div className="empty-row"><span>No integrations configured</span><span>LabDeck {settings.data.version}</span></div> : null}
    </section>
  </main>;
}
