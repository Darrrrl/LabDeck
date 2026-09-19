import { useQuery } from '@tanstack/react-query';
import { overviewResponseSchema } from '@labdeck/contracts';

async function loadOverview() {
  const response = await fetch('/api/v1/overview');
  if (!response.ok) throw new Error('Unable to load LabDeck');
  return overviewResponseSchema.parse(await response.json());
}

export function App() {
  const overview = useQuery({ queryKey: ['overview'], queryFn: loadOverview });

  return (
    <main>
      <p className="eyebrow">LABDECK</p>
      <h1>Homelab mission control</h1>
      {overview.isPending ? <p>Loading…</p> : null}
      {overview.isError ? <p role="alert">LabDeck is unavailable.</p> : null}
      {overview.data ? (
        <section aria-labelledby="empty-title">
          <span className="status">Monitoring incomplete</span>
          <h2 id="empty-title">{overview.data.title}</h2>
          <p>{overview.data.message}</p>
        </section>
      ) : null}
    </main>
  );
}
