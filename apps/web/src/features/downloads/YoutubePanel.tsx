import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { youtubeReplySchema, youtubeStatusSchema, type YoutubeJob } from '@labdeck/contracts';
import { getSession } from '../../app/api';
import { relativeTime } from '../../components/format';

async function status() {
  const response = await fetch('/api/v1/youtube', { credentials: 'same-origin' });
  if (!response.ok) throw new Error('YouTube worker status unavailable');
  return youtubeStatusSchema.parse(await response.json());
}
async function command(body: Record<string, unknown>) {
  const session = await getSession();
  if (!session.authenticated) throw new Error('Sign in again.');
  const response = await fetch('/api/v1/youtube', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrfToken }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error('The worker rejected the request or is unavailable. Check names, queue limits and destination collisions.');
  return youtubeReplySchema.parse(await response.json());
}

export function YoutubePanel() {
  const query = useQuery({ queryKey: ['youtube'], queryFn: status, refetchInterval: 5000, refetchIntervalInBackground: false });
  const [kind, setKind] = useState('movie');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [visibleJobs, setVisibleJobs] = useState(20);
  async function send(body: Record<string, unknown>) {
    setBusy(true); setError('');
    try { const reply = await command(body); if (body.action === 'prepare' && reply.id) setSelected(reply.id); await query.refetch(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Request failed'); }
    finally { setBusy(false); }
  }
  function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const request: Record<string, unknown> = { kind, source: form.get('source') };
    if (kind === 'music') { request.artist = form.get('artist'); request.album = form.get('album') || 'Singles'; }
    else { request.name = form.get('name'); if (kind === 'movie' && form.get('year')) request.year = Number(form.get('year')); }
    void send({ action: 'prepare', request });
  }
  const jobs = query.data?.jobs ?? [];
  return <section className="panel youtube-panel" aria-labelledby="youtube-title">
    <h2 id="youtube-title">YouTube downloader</h2>
    <p>Save only public content you have permission to download. Jellyfin discovers completed files through its scheduled scans.</p>
    {query.isError ? <p role="alert">YouTube status could not be loaded.</p> : null}
    {query.data && !query.data.configured ? <p className="muted">Not configured. Install the optional restricted host worker to enable downloading.</p> : null}
    {query.data?.configured ? <>
      <p><time tabIndex={0} dateTime={query.data.observedAt ?? undefined} title={query.data.observedAt ?? undefined} aria-label={query.data.observedAt ? `Worker last observed ${query.data.observedAt}` : 'Worker never observed'}>Worker observed {relativeTime(query.data.observedAt)}</time>{!query.data.available ? ' · Unavailable; showing last cached state.' : ''}</p>
      <form onSubmit={prepare} className="youtube-form">
        <label>Mode<select value={kind} onChange={(event) => setKind(event.target.value)}><option value="movie">Movie</option><option value="tv">TV Show</option><option value="music">Music</option></select></label>
        <label>{kind === 'tv' ? 'YouTube playlist URL' : 'YouTube video or playlist URL'}<input name="source" type="url" required maxLength={512} placeholder="https://www.youtube.com/watch?v=…" /></label>
        {kind === 'music' ? <><label>Artist<input name="artist" required maxLength={120} /></label><label>Album<input name="album" maxLength={120} placeholder="Singles" /></label></> : <label>{kind === 'tv' ? 'Show name' : 'Movie name'}<input name="name" required maxLength={120} /></label>}
        {kind === 'movie' ? <label>Year (optional)<input name="year" type="number" min={1888} max={9999} /></label> : null}
        <button type="submit" disabled={busy || !query.data.available}>Prepare preview</button>
      </form>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {selected && !jobs.some((job) => job.id === selected) ? <p role="status">Preparation queued. The next cached refresh will show the manifest.</p> : null}
      <div aria-live="polite">{jobs.slice(0, visibleJobs).map((job) => <Job key={job.id} job={job} busy={busy || !query.data.available} send={send} />)}</div>
      {jobs.length > visibleJobs ? <button onClick={() => setVisibleJobs((count) => count + 20)}>Show older jobs</button> : null}
    </> : null}
  </section>;
}

function Job({ job, busy, send }: { job: YoutubeJob; busy: boolean; send: (body: Record<string, unknown>) => Promise<void> }) {
  const [titles, setTitles] = useState<string[] | null>(null);
  const [expanded, setExpanded] = useState(false);
  const ready = job.state === 'ready';
  const terminal = ['completed', 'partially-completed', 'failed', 'cancelled', 'interrupted'].includes(job.state);
  return <article className="youtube-job">
    <h3>{job.name} · {job.kind === 'tv' ? 'TV Show' : job.kind}</h3>
    <p>{job.state.replaceAll('-', ' ')} · Updated <time tabIndex={0} dateTime={job.updatedAt} title={job.updatedAt}>{relativeTime(job.updatedAt)}</time>{job.error ? ` · ${job.error}` : ''}</p>
    <p>{job.items.filter((item) => item.state === 'completed').length} of {job.items.length} items completed</p>
    {ready ? <p>Review the ordered destination preview before confirming.{job.kind === 'music' ? ' Edited titles update filenames at confirmation.' : ''}</p> : null}
    {!ready && job.items.length ? <button aria-expanded={expanded} aria-controls={`youtube-items-${job.id}`} onClick={() => setExpanded((value) => !value)}>{expanded ? 'Hide' : 'Show'} items for {job.name}</button> : null}
    <div id={`youtube-items-${job.id}`}>{ready || expanded ? <ol className="youtube-items">{job.items.map((item, index) => <li key={item.number} value={item.number}>
      {ready && job.kind === 'music' ? <label>Track {item.number} title<input required maxLength={120} value={titles?.[index] ?? item.title} onChange={(event) => { const edited = titles ? [...titles] : job.items.map((track) => track.title); edited[index] = event.target.value; setTitles(edited); }} /></label> : <strong>{item.title}</strong>}
      <span>{job.kind === 'movie' ? 'Movies' : job.kind === 'tv' ? 'TV' : 'Music'}/{ready && titles ? `${item.destination.slice(0, item.destination.lastIndexOf('/') + 1)}${String(item.number).padStart(2, '0')} - ${titles[index]?.trim().replace(/[<>:"|?*\u007f]/gu, '_').replace(/[. ]+$/u, '')}.mp3` : item.destination}</span>
      <small>{item.state}{item.error ? ` · ${item.error}` : ''}</small>
    </li>)}</ol> : null}</div>
    <div className="summary-action">
      {ready ? <button disabled={busy || !!titles?.some((title) => !title.trim())} onClick={() => { void send({ action: 'submit', id: job.id, ...(titles ? { titles } : {}) }); }}>Confirm download</button> : null}
      {!terminal ? <button disabled={busy} onClick={() => { void send({ action: 'cancel', id: job.id }); }}>Cancel {job.name}</button> : null}
      {terminal && job.state !== 'completed' ? <button disabled={busy} onClick={() => { void send({ action: 'retry', id: job.id }); }}>Retry failed items</button> : null}
    </div>
  </article>;
}
