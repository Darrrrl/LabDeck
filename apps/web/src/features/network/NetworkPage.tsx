import { useQuery } from '@tanstack/react-query';
import { getNetwork } from '../../app/api.js';
import { relativeTime } from '../../components/format.js';
import { Status } from '../../components/Status.js';

export function NetworkPage() {
  const query = useQuery({ queryKey: ['network'], queryFn: getNetwork, refetchInterval: 30_000 });
  const data = query.data;
  return <main id="main-content" tabIndex={-1}><header className="page-header"><div><p className="eyebrow">LOCAL TAILNET VIEW</p><h1>Network</h1><p>Peers known to this server’s Tailscale client—not a complete tailnet inventory or a service reachability test.</p></div></header>
    {!data ? <section className="notice"><h2>{query.isError ? 'Network data unavailable' : 'Loading network…'}</h2></section> : !data.configured ? <section className="notice"><Status tone="unknown">Not configured</Status><h2>Tailscale observation is off</h2><p>Enable the optional host collector module after reviewing local status permissions.</p></section> : <>
      <section className="detail-toolbar"><Status tone={data.freshness === 'fresh' && data.backendState === 'Running' ? 'healthy' : 'unknown'}>{data.backendState ?? 'Unknown state'}</Status><span>Observed {relativeTime(data.observedAt)}</span><span>{data.inventoryComplete === false ? 'Partial local list' : data.total === null ? 'Count unknown' : `${data.online ?? 0} online / ${data.total} known`}</span></section>
      {data.errorCode ? <p className="form-error">Local status read failed ({data.errorCode}); showing last-good peers with their original timestamp.</p> : null}
      {data.freshness !== 'fresh' ? <p className="form-error">Peer evidence is stale or missing.</p> : null}
      <section className="panel"><h2>This server</h2><p>{data.selfName || 'Hostname unknown'} · {data.selfIPs.length ? data.selfIPs.join(' · ') : 'Tailscale IP unknown'}</p><p className="fine-print">Client version {data.version ?? 'unknown'}</p></section>
      <section className="panel"><h2>Locally known peers</h2>{data.peers.length ? <div className="peer-list">{data.peers.map((peer) => <article className="peer-row" key={peer.id}><div><h3>{peer.name || peer.id}</h3><p>{peer.ips.length ? peer.ips.join(' · ') : 'IP unknown'}</p></div><div><Status tone={peer.online ? 'healthy' : 'unknown'}>{peer.online ? 'Reported online' : 'Reported offline'}</Status><p className="fine-print">{peer.online ? 'Last seen not applicable' : peer.lastSeen ? `Last seen ${relativeTime(peer.lastSeen)}` : 'Last seen unknown'}</p></div></article>)}</div> : <p className="muted">No peers in this client’s local status.</p>}</section>
    </>}
  </main>;
}
