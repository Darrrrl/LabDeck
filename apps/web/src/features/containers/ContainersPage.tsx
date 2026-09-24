import { useQuery } from '@tanstack/react-query';
import { getContainers } from '../../app/api.js';
import { bytes, relativeTime } from '../../components/format.js';
import { Status, type StatusTone } from '../../components/Status.js';

export function ContainersPage() {
  const query = useQuery({ queryKey: ['containers'], queryFn: getContainers, refetchInterval: 15_000, refetchIntervalInBackground: false });
  const data = query.data;
  return <main id="main-content" tabIndex={-1}>
    <header className="page-header"><div><p className="eyebrow">CONTAINERS</p><h1>Docker observation</h1></div><p className="page-context">Read-only host snapshot</p></header>
    {query.isPending ? <div className="panel loading-panel"><span className="skeleton" /></div> : null}
    {query.isError ? <div className="notice" role="alert"><Status tone="critical">Unavailable</Status><h2>Cached container state could not be loaded</h2></div> : null}
    {data && !data.configured ? <section className="empty-state"><Status tone="unknown">Not configured</Status><h2>Docker observation is off</h2><p>Enable the optional collector module after reviewing its socket permissions. LabDeck itself never receives the Docker socket.</p></section> : null}
    {data?.configured ? <>
      <section className="panel"><div className="section-heading"><div><h2>Inventory</h2><p>{data.errorCode ? `Collection failed (${data.errorCode}); showing last-good data.` : data.inventoryComplete === false ? 'Partial inventory · missing containers are not treated as stopped.' : `Observed ${relativeTime(data.observedAt)}.`}</p></div><Status tone={data.freshness !== 'fresh' ? 'unknown' : (data.unhealthy ?? 0) > 0 || (data.expectedStopped ?? 0) > 0 ? 'warning' : 'healthy'}>{data.freshness === 'stale' ? 'Stale' : data.freshness === 'never' ? 'Waiting' : 'Current'}</Status></div>
        <div className="library-counts"><Metric label="Containers" value={data.total} /><Metric label="Running" value={data.running} /><Metric label="Unhealthy" value={data.unhealthy} /></div>
        <p className="fine-print">{data.expectedStopped ?? '—'} expected-running containers stopped. Optional stopped containers do not affect overall health. CPU is 100% per fully occupied logical CPU.</p>
      </section>
      <section className="container-list" aria-label="Container inventory">{data.containers.map((item) => <details className="panel container-row" key={item.id}><summary><span><strong>{item.name}</strong><small>{item.image}</small></span><Status tone={tone(item.state, item.health, item.expectedRunning)}>{item.health === 'unhealthy' ? 'Unhealthy' : item.state === 'running' && item.health === 'no-healthcheck' ? 'No healthcheck' : item.state}</Status></summary><div className="container-detail"><div><span>Identity</span><strong>{item.id.slice(0, 12)}</strong></div><div><span>Started</span><strong>{relativeTime(item.startedAt)}</strong></div><div><span>Restarts</span><strong>{item.restartCount ?? 'Unknown'}</strong></div><div><span>CPU</span><strong>{item.cpuPercent === null || item.state !== 'running' ? 'Unknown' : `${item.cpuPercent.toFixed(1)}%`}</strong></div><div><span>Memory</span><strong>{item.memoryBytes === null || item.state !== 'running' ? 'Unknown' : bytes(item.memoryBytes)}</strong><small>{item.memoryKind === 'working-set' ? 'Working set (cache excluded)' : item.memoryKind === 'raw' ? 'Raw cgroup usage' : 'Measurement unavailable'}{item.memoryLimitBytes ? ` · limit ${bytes(item.memoryLimitBytes)}` : ''}</small></div><div><span>Stats observed</span><strong>{relativeTime(item.statsObservedAt)}</strong></div></div></details>)}</section>
      {!data.containers.length ? <p className="muted">{data.freshness === 'never' ? 'Waiting for Docker inventory.' : 'No containers reported.'}</p> : null}
    </> : null}
  </main>;
}
function Metric({ label, value }: { label: string; value: number | null }) { return <div><span>{label}</span><strong>{value === null ? '—' : value.toLocaleString()}</strong></div>; }
function tone(state: string, health: string, expected: boolean): StatusTone { return health === 'unhealthy' || expected && state !== 'running' ? 'warning' : state === 'running' && health === 'healthy' ? 'healthy' : 'unknown'; }
