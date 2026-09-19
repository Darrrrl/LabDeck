import { overviewResponseSchema, sessionResponseSchema, settingsResponseSchema } from '@labdeck/contracts';

async function getJson(path: string): Promise<unknown> {
  const response = await fetch(path, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(response.status === 401 ? 'unauthorized' : 'request-failed');
  return response.json();
}
export async function getSession() { return sessionResponseSchema.parse(await getJson('/api/v1/session')); }
export async function getOverview() { return overviewResponseSchema.parse(await getJson('/api/v1/overview')); }
export async function getSettings() { return settingsResponseSchema.parse(await getJson('/api/v1/settings')); }
export async function createSession(password: string, csrfToken: string): Promise<void> {
  const response = await fetch('/api/v1/session', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ password, csrfToken }) });
  if (!response.ok) throw new Error(response.status === 429 ? 'rate-limited' : 'invalid-credentials');
}
export async function deleteSession(csrfToken: string): Promise<void> {
  const response = await fetch('/api/v1/session', { method: 'DELETE', credentials: 'same-origin', headers: { 'X-CSRF-Token': csrfToken } });
  if (!response.ok) throw new Error('logout-failed');
}
