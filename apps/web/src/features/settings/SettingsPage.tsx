import { useQuery } from '@tanstack/react-query';
import { getSettings } from '../../app/api.js';
import { Status } from '../../components/Status.js';
import { Preferences } from './Preferences.js';
import { bytes, relativeTime } from '../../components/format.js';

export function SettingsPage() {
  const settings = useQuery({ queryKey: ['settings'], queryFn: getSettings, refetchInterval: 30_000 });
  return <main id="main-content" tabIndex={-1}>
    <header className="page-header"><div><p className="eyebrow">SETTINGS</p><h1>Configuration</h1></div></header>
    <section className="panel" aria-labelledby="connections-title"><div className="section-heading"><div><h2 id="connections-title">Connections</h2><p>Integrations are configured on the server and credentials never reach this browser.</p></div><Status tone={settings.data?.hostCollector.configured ? 'healthy' : 'unknown'}>{settings.data?.hostCollector.configured ? 'Host configured' : 'Not configured'}</Status></div>
      {settings.isPending ? <p className="muted">Loading configuration…</p> : null}{settings.isError ? <p role="alert" className="form-error">Configuration status is unavailable.</p> : null}{settings.data ? <><div className="empty-row"><span>{settings.data.hostCollector.message}</span><span>LabDeck {settings.data.version}</span></div>{settings.data.integrations.map((integration) => <div className="integration-row" key={integration.id}><div><strong>{integration.name}</strong><span>{integration.freshness} · {integration.connection}</span></div><Status tone={integration.connection === 'reachable' ? 'healthy' : integration.connection === 'unknown' ? 'unknown' : 'warning'}>{integration.connection}</Status></div>)}</> : null}
    </section>
    {settings.data ? <section className="panel media-section"><div className="section-heading"><div><h2>Local history</h2><p>SQLite and write-ahead log on the app’s local volume.</p></div><Status tone={settings.data.persistence.pressure === 'normal' ? 'healthy' : 'warning'}>{settings.data.persistence.pressure}</Status></div><p>{bytes(settings.data.persistence.databaseBytes + settings.data.persistence.walBytes)} database + WAL · {settings.data.persistence.seriesCount}/400 series · {settings.data.persistence.eventCount.toLocaleString()} events</p><p className="fine-print">{settings.data.persistence.freeBytes === null ? 'Free space unavailable' : `${bytes(settings.data.persistence.freeBytes)} filesystem free`} · history {settings.data.hostCollector.historyAvailable ? 'available' : 'degraded'}. At pressure limits, oldest telemetry is trimmed or new telemetry writes pause; current cached state remains separate.</p></section> : null}
    <section className="panel media-section"><h2>Backup status</h2>
      <p>{settings.isPending ? 'Loading backup status…' : settings.isError || !settings.data?.backup ? 'Backup status is unavailable.' : settings.data.backup.lastSuccessfulAt ? `Last successful backup ${relativeTime(settings.data.backup.lastSuccessfulAt)}.` : 'No successful backup recorded.'}</p>
      {settings.data?.backup?.integrityVerifiedAt ? <p>SQLite integrity verified <time dateTime={settings.data.backup.integrityVerifiedAt}>{new Date(settings.data.backup.integrityVerifiedAt).toLocaleString()}</time>.</p> : null}
      <p className="fine-print">This records verification when the backup was created; it does not check whether that file still exists.</p>
      <details><summary>Backup and restore guidance</summary><p>Run the documented db:maintenance backup command on the host. Save configuration and secrets separately. To restore, stop LabDeck, use db:maintenance restore to create a new verified copy, then replace the active database with that copy and start a compatible version. Restored sessions and backup status are cleared. Keep a pre-upgrade backup; migrations have no automatic downgrade.</p></details>
    </section>
    <Preferences />
  </main>;
}
