import { usePreferences } from '../../app/preferences.js';
import type { ContainersResponse } from '@labdeck/contracts';
import { useQuery } from '@tanstack/react-query';
import { getContainers } from '../../app/api.js';
import { bytes, relativeTime } from '../../components/format.js';
import { Status, type StatusTone } from '../../components/Status.js';
import { DockerActions, DockerActionHistory } from './DockerActions.js';

export function ContainersPage() {
  const query = useQuery({ queryKey: ['containers'], queryFn: getContainers, refetchInterval: 15_000, refetchIntervalInBackground: false });
  const data = query.data;
  const [preferences, updatePreferences] = usePreferences();
  const search = preferences.containerSearch, filter = preferences.containerFilter;
  const setSearch = (containerSearch: string) => updatePreferences({ containerSearch: containerSearch.slice(0, 128) });
  const setFilter = (containerFilter: typeof filter) => updatePreferences({ containerFilter });
  const visible = (data?.containers ?? []).filter((item) =>
    `${item.name} ${item.image} ${item.composeProject ?? ''} ${item.composeService ?? ''}`.toLowerCase().includes(search.toLowerCase().trim()) &&
    (filter === 'all' || filter === 'attention' && (item.health === 'unhealthy' || item.expectedRunning && item.state !== 'running') || filter === 'running' && item.state === 'running' || filter === 'stopped' && item.state !== 'running')
  );
  return <main id="main-content" tabIndex={-1}>
    <header className="page-header"><div><p className="eyebrow">CONTAINERS</p><h1>Docker observation</h1></div><p className="page-context">Read-only host snapshot</p></header>
    {query.isPending ? <div className="panel loading-panel"><span className="skeleton" /></div> : null}
    {query.isError ? <div className="notice" role="alert"><Status tone="critical">Unavailable</Status><h2>Cached container state could not be loaded</h2></div> : null}
    {data && !data.configured ? <section className="empty-state"><Status tone="unknown">Not configured</Status><h2>Docker observation is off</h2><p>Enable the optional collector module after reviewing its socket permissions. LabDeck itself never receives the Docker socket.</p></section> : null}
    {data?.configured ? <>
      <section className="panel"><div className="section-heading"><div><h2>Inventory</h2><p>{data.errorCode ? `Collection failed (${data.errorCode}); showing last-good data observed ${relativeTime(data.observedAt)}.` : data.inventoryComplete === false ? 'Partial inventory · missing containers are not treated as stopped.' : `Observed ${relativeTime(data.observedAt)}.`}</p></div><Status tone={data.freshness !== 'fresh' ? 'unknown' : (data.unhealthy ?? 0) > 0 || (data.expectedStopped ?? 0) > 0 ? 'warning' : 'healthy'}>{data.freshness === 'stale' ? 'Stale' : data.freshness === 'never' ? 'Waiting' : 'Current'}</Status></div>
        <div className="library-counts"><Metric label="Containers" value={data.total} /><Metric label="Running" value={data.running} /><Metric label="Unhealthy" value={data.unhealthy} /></div>
        <p className="fine-print">{data.expectedStopped ?? '—'} expected-running containers stopped. Optional stopped containers do not affect overall health. CPU is 100% per fully occupied logical CPU.</p>
      </section>
      <div className="container-controls"><label>Search containers<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, image, project or service" /></label><label htmlFor="container-filter">Show<select id="container-filter" aria-label="Show" value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}><option value="all">All containers</option><option value="attention">Needs attention</option><option value="running">Running</option><option value="stopped">Not running</option></select></label><p role="status">{visible.length} of {data.containers.length} shown</p></div>
      {data.containers.length > 0 && !visible.length ? <p className="muted">No containers match these filters.</p> : null}
      <section className="container-list" aria-label="Container inventory">{groupContainers(data.containers).map((project) => {
        const shown = project.items.filter((item) => visible.includes(item));
        if (!shown.length) return null;
        return <details className="panel compose-project" key={project.name ?? '__ungrouped'} open><summary><strong>{project.name === null ? 'Ungrouped containers' : `Project · ${project.name}`}</strong><span>{project.items.filter(needsAttention).length} need attention · {shown.length} of {project.items.length} shown</span></summary>
          {project.name && data.controls?.available && data.controls.projects.includes(project.name) ? <DockerActions kind="project" id={project.name} label={project.name} enabled={data.freshness === 'fresh' && data.inventoryComplete === true && !data.errorCode} /> : null}
          {groupServices(shown).map((service) => <details className="compose-service" key={service.name ?? '__unknown'} open><summary>{service.name ?? 'Service not reported'} · {service.items.length} containers</summary>{service.items.map((item) => <ContainerRow key={item.id} item={item} controlAvailable={Boolean(data.controls?.available && data.controls.containers.includes(item.name))} actionEnabled={data.freshness === 'fresh' && data.inventoryComplete === true && !data.errorCode} />)}</details>)}
        </details>;
      })}</section>
      {data.controls?.available ? <DockerActionHistory /> : null}
      {!data.containers.length ? <p className="muted">{data.freshness === 'never' ? 'Waiting for Docker inventory.' : 'No containers reported.'}</p> : null}
    </> : null}
  </main>;
}
function Metric({ label, value }: { label: string; value: number | null }) { return <div><span>{label}</span><strong>{value === null ? '—' : value.toLocaleString()}</strong></div>; }
function tone(state: string, health: string, expected: boolean): StatusTone { return health === 'unhealthy' || expected && state !== 'running' ? 'warning' : state === 'running' && health === 'healthy' ? 'healthy' : 'unknown'; }

function ContainerRow({ item, controlAvailable, actionEnabled }: { item: ContainersResponse['containers'][number]; controlAvailable: boolean; actionEnabled: boolean }) { return <details className="panel container-row"><summary><span><strong>{item.name}</strong><small>{item.image}</small></span><Status tone={tone(item.state, item.health, item.expectedRunning)}>{item.state}</Status><Status tone={tone(item.state, item.health, item.expectedRunning)}>{item.health === 'no-healthcheck' ? 'No healthcheck' : item.health}</Status></summary><div className="container-detail"><div><span>Expectation</span><strong>{item.expectedRunning ? 'Expected to stay running' : 'Optional · stopping is allowed'}</strong>{item.expectedRunning && item.state !== 'running' ? <small>Needs attention: expected running</small> : null}</div><div><span>Identity</span><strong>{item.id.slice(0, 12)}</strong></div><div><span>Started</span><strong>{relativeTime(item.startedAt)}</strong></div><div><span>Restarts</span><strong>{item.restartCount ?? 'Unknown'}</strong></div><div><span>CPU</span><strong>{item.cpuPercent === null || item.state !== 'running' ? 'Unknown' : `${item.cpuPercent.toFixed(1)}%`}</strong></div><div><span>Memory</span><strong>{item.memoryBytes === null || item.state !== 'running' ? 'Unknown' : bytes(item.memoryBytes)}</strong><small>{item.memoryKind === 'working-set' ? 'Working set (cache excluded)' : item.memoryKind === 'raw' ? 'Raw cgroup usage' : 'Measurement unavailable'}{item.memoryLimitBytes ? ` · limit ${bytes(item.memoryLimitBytes)}` : ''}</small></div><div><span>Stats observed</span><strong>{relativeTime(item.statsObservedAt)}</strong></div></div>{controlAvailable ? <DockerActions kind="container" id={item.id} label={item.name} enabled={actionEnabled} /> : null}</details>; }

type Container = ContainersResponse['containers'][number];
const needsAttention = (item: Container) => item.health === 'unhealthy' || item.expectedRunning && item.state !== 'running';
function groupBy(items: Container[], name: (item: Container) => string | null) {
  const groups = new Map<string | null, Container[]>();
  for (const item of items) { const key = name(item); groups.set(key, [...(groups.get(key) ?? []), item]); }
  return [...groups].sort(([a], [b]) => a === null ? 1 : b === null ? -1 : a.localeCompare(b)).map(([name, items]) => ({ name, items }));
}
const groupContainers = (items: Container[]) => groupBy(items, (item) => item.composeProject ?? null);
const groupServices = (items: Container[]) => groupBy(items, (item) => item.composeService ?? null);
