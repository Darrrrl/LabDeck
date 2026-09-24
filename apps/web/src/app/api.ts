import { containersResponseSchema, downloadsResponseSchema, eventsResponseSchema, mediaResponseSchema, overviewResponseSchema, sessionResponseSchema, settingsResponseSchema, storageResponseSchema, systemResponseSchema } from '@labdeck/contracts';

async function getJson(path: string): Promise<unknown> {
  const response = await fetch(path, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(response.status === 401 ? 'unauthorized' : 'request-failed');
  return response.json();
}
export async function getSession() { return sessionResponseSchema.parse(await getJson('/api/v1/session')); }
export async function getOverview() { return overviewResponseSchema.parse(await getJson('/api/v1/overview')); }
export async function getSettings() { return settingsResponseSchema.parse(await getJson('/api/v1/settings')); }
export async function getSystem(range: '1h' | '24h') { return systemResponseSchema.parse(await getJson(`/api/v1/system?range=${range}`)); }
export async function getStorage(range: '1h' | '24h') { return storageResponseSchema.parse(await getJson(`/api/v1/storage?range=${range}`)); }
export async function getEvents() { return eventsResponseSchema.parse(await getJson('/api/v1/events?limit=50')); }
export async function getMedia() { return mediaResponseSchema.parse(await getJson('/api/v1/media')); }
export async function getDownloads() { return downloadsResponseSchema.parse(await getJson('/api/v1/downloads')); }
export async function getContainers() { return containersResponseSchema.parse(await getJson('/api/v1/containers')); }
export async function createSession(password: string, csrfToken: string): Promise<void> {
  const response = await fetch('/api/v1/session', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ password, csrfToken }) });
  if (!response.ok) throw new Error(response.status === 429 ? 'rate-limited' : 'invalid-credentials');
}
export async function deleteSession(csrfToken: string): Promise<void> {
  const response = await fetch('/api/v1/session', { method: 'DELETE', credentials: 'same-origin', headers: { 'X-CSRF-Token': csrfToken } });
  if (!response.ok) throw new Error('logout-failed');
}
