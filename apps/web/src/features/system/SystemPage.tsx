import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getSystem } from '../../app/api.js';
import { bytes, duration, relativeTime } from '../../components/format.js';
import { Sparkline } from '../../components/Sparkline.js';
import { Status } from '../../components/Status.js';

export function SystemPage() {
  const [range, setRange] = useState<'1h' | '24h'>('1h');
  const query = useQuery({ queryKey: ['system', range], queryFn: () => getSystem(range), refetchInterval: 10_000 });
  return <main id="main-content" tabIndex={-1}><PageHeader title="System" eyebrow="HOST" />
    {query.data ? <><div className="detail-toolbar"><Status tone={query.data.freshness === 'fresh' ? 'healthy' : 'unknown'}>{query.data.freshness === 'fresh' ? 'Current' : 'Stale'}</Status><span>Observed {relativeTime(query.data.observedAt)}</span><Range value={range} onChange={setRange} /></div>
      {query.data.data ? <section className="detail-grid">
        <article className="panel detail-card"><span>Hostname</span><strong>{query.data.data.hostname}</strong><small>Uptime {duration(query.data.data.uptimeSeconds)}</small></article>
        <article className="panel detail-card"><span>Processor</span><strong>{query.data.data.cpu.utilizationPercent === null ? 'Collecting' : `${query.data.data.cpu.utilizationPercent.toFixed(1)}%`}</strong><small>{query.data.data.cpu.model} · {query.data.data.cpu.logicalProcessors} logical CPUs</small><Sparkline label="CPU utilization history" values={query.data.trends.cpu.map((point) => point.value)} /></article>
        <article className="panel detail-card"><span>Memory</span><strong>{bytes(query.data.data.memory.usedBytes)}</strong><small>{bytes(query.data.data.memory.availableBytes)} available of {bytes(query.data.data.memory.totalBytes)}</small><Sparkline label="Memory use history" values={query.data.trends.memory.map((point) => point.value)} /></article>
        <article className="panel detail-card"><span>Load average</span><strong>{query.data.data.load.one.toFixed(2)}</strong><small>{query.data.data.load.five.toFixed(2)} over 5m · {query.data.data.load.fifteen.toFixed(2)} over 15m</small></article>
        {query.data.interfaces.map((networkInterface) => <article className="panel detail-card" key={networkInterface.id}><span>Network · {networkInterface.name}</span><strong>↓ {rate(networkInterface.receiveBytesPerSecond)}</strong><small>↑ {rate(networkInterface.transmitBytesPerSecond)} transmitted</small></article>)}
        {query.data.blockIo.map((device) => <article className="panel detail-card" key={device.id}><span>Disk I/O · {device.name}</span><strong>Read {rate(device.readBytesPerSecond)}</strong><small>Write {rate(device.writeBytesPerSecond)}</small></article>)}
      </section> : <Empty message={query.data.configured ? 'Waiting for the first valid host observation.' : 'The host collector is not configured.'} />}</> : <Empty message={query.isError ? 'Cached system state is unavailable.' : 'Loading cached system state…'} />}
  </main>;
}
function PageHeader({ title, eyebrow }: { title: string; eyebrow: string }) { return <header className="page-header"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1></div></header>; }
function Range({ value, onChange }: { value: '1h' | '24h'; onChange: (value: '1h' | '24h') => void }) { return <div className="segmented" aria-label="History range">{(['1h', '24h'] as const).map((range) => <button key={range} className={value === range ? 'active' : ''} onClick={() => onChange(range)}>{range}</button>)}</div>; }
function Empty({ message }: { message: string }) { return <section className="notice"><Status tone="unknown">Monitoring incomplete</Status><h2>No current system observation</h2><p>{message}</p></section>; }
function rate(value: number | null): string { return value === null ? 'Collecting' : `${bytes(value)}/s`; }
