import { useState, type FormEvent } from 'react';
import { LockKeyhole } from 'lucide-react';
import { createSession } from './api.js';

export function Login({ csrfToken, onSuccess }: { csrfToken: string; onSuccess: () => Promise<void> }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setPending(true); setError(undefined);
    try { await createSession(password, csrfToken); await onSuccess(); }
    catch (caught) { setError(caught instanceof Error && caught.message === 'rate-limited' ? 'Too many attempts. Try again in a minute.' : 'The password was not accepted.'); }
    finally { setPending(false); }
  }
  return (
    <main className="login-shell">
      <section className="login-panel" aria-labelledby="login-title">
        <div className="brand-mark" aria-hidden="true"><LockKeyhole size={20} /></div>
        <p className="eyebrow">LABDECK</p><h1 id="login-title">Welcome back</h1><p className="muted">Sign in to view your homelab.</p>
        <form onSubmit={(event) => { void submit(event); }}>
          <label htmlFor="password">Owner password</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required autoFocus value={password} onChange={(event) => { setPassword(event.target.value); }} />
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <button type="submit" disabled={pending}>{pending ? 'Signing in…' : 'Sign in'}</button>
        </form>
      </section>
    </main>
  );
}
