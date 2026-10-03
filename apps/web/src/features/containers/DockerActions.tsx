import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getDockerActions, runDockerControl } from '../../app/api.js';
import { relativeTime } from '../../components/format.js';

export function DockerActions({ kind, id, label, enabled }: { kind: 'container' | 'project'; id: string; label: string; enabled: boolean }) {
  const client = useQueryClient();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const run = async (action: 'start' | 'stop' | 'restart') => {
    if (!window.confirm(`${action[0]!.toUpperCase() + action.slice(1)} ${kind} ${label}?`)) return;
    setPending(true); setMessage('');
    try { await runDockerControl(kind, id, action); setMessage(`${action} completed on the host. Waiting for the next Docker observation.`); await client.invalidateQueries({ queryKey: ['docker-actions'] }); await client.invalidateQueries({ queryKey: ['containers'] }); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Action failed.'); }
    finally { setPending(false); }
  };
  return <div className="docker-actions" aria-label={`${label} actions`}>
    {(['start', 'stop', 'restart'] as const).map((action) => <button key={action} type="button" disabled={!enabled || pending} onClick={() => void run(action)}>{action}</button>)}
    {message ? <p role="status">{message}</p> : null}
  </div>;
}

export function DockerActionHistory() {
  const query = useQuery({ queryKey: ['docker-actions'], queryFn: getDockerActions, refetchInterval: 30_000 });
  if (!query.data?.actions.length) return null;
  return <section className="panel"><h2>Recent Docker actions</h2><ul>{query.data.actions.map((item) => <li key={item.id}>{item.action} {item.kind} {item.targetId.slice(0, 24)} · {item.result} · {relativeTime(item.requestedAt)}</li>)}</ul></section>;
}
