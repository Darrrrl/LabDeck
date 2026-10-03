import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { getProblem, getProblems } from '../../app/api.js';
import { Status } from '../../components/Status.js';
import { bytes, relativeTime } from '../../components/format.js';
import type { ProblemDetailResponse } from '@labdeck/contracts';

export function ProblemList() {
  const query = useQuery({ queryKey: ['problems'], queryFn: getProblems, refetchInterval: 10_000 });
  if (query.isError) return <p role="alert">Current problems could not be refreshed.</p>;
  if (!query.data?.problems.length) return null;
  return <section className="panel problem-list"><h2>Current problems</h2><ul>{query.data.problems.map((problem) => <li key={problem.id}><Link to={`/problems/${problem.id}`}>{problem.title}</Link><Status tone={problem.severity}>{problem.severity}</Status><span>{problem.freshness} · observed {relativeTime(problem.observedAt)}</span></li>)}</ul></section>;
}
export function ProblemPage() {
  const { id = '' } = useParams();
  const query = useQuery({ queryKey: ['problem', id], queryFn: () => getProblem(id), refetchInterval: 10_000, retry: false });
  const detail = query.data;
  return <main id="main-content" tabIndex={-1}><header className="page-header"><div><p className="eyebrow">INVESTIGATE</p><h1>Problem details</h1></div><Link to="/">Overview</Link></header>
    {query.isPending ? <p>Loading cached evidence…</p> : null}
    {query.isError ? <p role="alert">{query.error.message === 'not-current' ? 'This problem is no longer current. Its earlier observations may remain in Events.' : 'Problem evidence could not be refreshed.'} <Link to="/events">View events</Link></p> : null}
    {detail ? <><section className="panel"><div className="section-heading"><h2>{detail.problem.title}</h2><Status tone={detail.problem.severity}>{detail.problem.severity}</Status></div><p>{detail.problem.freshness} · evidence observed <time dateTime={detail.problem.observedAt ?? undefined}>{detail.problem.observedAt ? new Date(detail.problem.observedAt).toLocaleString() : 'never'}</time></p><ul>{detail.problem.evidence.map((item, index) => <li key={index}>{item}</li>)}</ul><p><Link to={detail.problem.detailPath}>Open monitoring details</Link>{detail.problem.browserUrl ? <> · <a href={detail.problem.browserUrl} target="_blank" rel="noreferrer">Open service</a></> : null}</p></section>
      {detail.chart ? <EvidenceChart chart={detail.chart} /> : <p className="fine-print">No relevant metric history is collected for this problem. Open monitoring details for current evidence.</p>}
      <section className="panel media-section"><h2>Related observations</h2><p>Latest retained events for this entity, or this integration for an integration-wide problem. These observations do not establish a cause.</p>{detail.events.length ? <ul className="problem-events">{detail.events.map((event) => <li key={event.id}><strong>{event.kind.replaceAll('.', ' · ').replaceAll('-', ' ')}</strong><span>{event.severity} · {event.origin} · observed {new Date(event.observedAt).toLocaleString()}{event.occurredAt ? ` · occurred ${new Date(event.occurredAt).toLocaleString()}` : ''}</span></li>)}</ul> : <p>No related retained events. Polling does not capture every transition.</p>}</section>
    </> : null}
  </main>;
}
function EvidenceChart({ chart }: { chart: NonNullable<ProblemDetailResponse['chart']> }) {
  const points = chart.points;
  const start = Date.parse(points[0]?.at ?? ''), end = Date.parse(points.at(-1)?.at ?? '');
  const max = chart.unit === 'percent' ? 100 : Math.max(1, ...points.map((point) => point.value));
  const x = (at: string) => 5 + (Date.parse(at) - start) / (end - start || 1) * 590;
  const y = (value: number) => 115 - value / max * 110;
  const value = (v: number) => chart.unit === 'bytes' ? bytes(v) : `${v.toFixed(1)}%`;
  return <section className="panel media-section"><h2>{chart.label}</h2>{points.length ? <>
    <svg className="evidence-chart" viewBox="0 0 600 120" role="img" aria-label={`${chart.label}; range 0 to ${value(max)}; gaps indicate missing observations`}>
      {points.map((point, i) => { const previous = points[i - 1]; return <g key={point.at}>{previous && Date.parse(point.at) - Date.parse(previous.at) <= 15 * 60_000 && previous.coverage >= .7 && point.coverage >= .7 ? <line x1={x(previous.at)} y1={y(previous.value)} x2={x(point.at)} y2={y(point.value)} /> : null}<circle cx={x(point.at)} cy={y(point.value)} r="2"><title>{new Date(point.at).toLocaleString()} · {value(point.value)} · {Math.round(point.coverage * 100)}% coverage</title></circle></g>; })}
    </svg><p>{new Date(start).toLocaleString()} – {new Date(end).toLocaleString()} · 0 to {value(max)}</p>
    <details><summary>History values and coverage</summary><div className="history-table"><table><thead><tr><th>Observed bucket</th><th>Value</th><th>Coverage</th></tr></thead><tbody>{points.map((point) => <tr key={point.at}><td>{new Date(point.at).toLocaleString()}</td><td>{value(point.value)}</td><td>{Math.round(point.coverage * 100)}%</td></tr>)}</tbody></table></div></details>
    </> : <p>No metric history is available for this window.</p>}</section>;
}
