import { problemsResponseSchema, problemDetailResponseSchema, containersResponseSchema, dockerActionResponseSchema, downloadsResponseSchema, eventsResponseSchema, fileOperationReplySchema, fileSharesResponseSchema, mediaResponseSchema, metricHistoryResponseSchema, networkResponseSchema, overviewResponseSchema, sessionResponseSchema, settingsResponseSchema, storageResponseSchema, systemResponseSchema, smartTestResponseSchema, type HistoryRange } from '@labdeck/contracts';

async function getJson(path: string): Promise<unknown> {
  const response = await fetch(path, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(response.status === 401 ? 'unauthorized' : 'request-failed');
  return response.json();
}
export async function getSession() { return sessionResponseSchema.parse(await getJson('/api/v1/session')); }
export async function getOverview() { return overviewResponseSchema.parse(await getJson('/api/v1/overview')); }
export async function getSettings() { return settingsResponseSchema.parse(await getJson('/api/v1/settings')); }
export async function getSystem(range: HistoryRange) { return systemResponseSchema.parse(await getJson(`/api/v1/system?range=${range}`)); }
export async function getStorage(range: HistoryRange) { return storageResponseSchema.parse(await getJson(`/api/v1/storage?range=${range}`)); }
export async function startSmartTest(diskId: string, type: 'short' | 'extended'): Promise<'started'> {
  const session = await getSession();
  if (!session.authenticated) throw new Error('Session expired. Sign in again.');
  const response = await fetch('/api/v1/storage/smart-tests', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrfToken, Accept: 'application/json' }, body: JSON.stringify({ diskId, type }) });
  if (!response.ok) {
    if (response.status === 429) throw new Error('A test was requested recently. Try again later.');
    if (response.status === 409) throw new Error('The drive is unavailable or refused the test. Check its current status.');
    throw new Error('The host could not start the test. Check the SMART control service.');
  }
  return smartTestResponseSchema.parse(await response.json()).status as 'started';
}
export async function getMetricHistory(name: 'library.movies' | 'library.series' | 'library.episodes' | 'filesystem.used' | 'filesystem.available', range: HistoryRange, entity?: string) { const query = new URLSearchParams({ name, range }); if (entity) query.set('entity', entity); return metricHistoryResponseSchema.parse(await getJson(`/api/v1/metrics?${query.toString()}`)); }
export async function getEvents() { return eventsResponseSchema.parse(await getJson('/api/v1/events?limit=50')); }
export async function getMedia() { return mediaResponseSchema.parse(await getJson('/api/v1/media')); }
export async function getDownloads() { return downloadsResponseSchema.parse(await getJson('/api/v1/downloads')); }
export async function getContainers() { return containersResponseSchema.parse(await getJson('/api/v1/containers')); }
export async function getDockerActions() { return getJson('/api/v1/containers/actions') as Promise<{ actions: { id: string; kind: string; targetId: string; action: string; requestedAt: string; completedAt: string | null; result: string }[] }>; }
export async function runDockerControl(kind: 'container' | 'project', id: string, action: 'start' | 'stop' | 'restart') {
  const session = await getSession();
  if (!session.authenticated) throw new Error('Session expired. Sign in again.');
  const response = await fetch('/api/v1/containers/actions', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrfToken, Accept: 'application/json' }, body: JSON.stringify({ kind, id, action }) });
  if (!response.ok) throw new Error(response.status === 409 ? 'The target changed or the host rejected the action.' : 'Docker control is unavailable.');
  return dockerActionResponseSchema.parse(await response.json());
}
export async function getNetwork() { return networkResponseSchema.parse(await getJson('/api/v1/network')); }
export async function getFileShares() { return fileSharesResponseSchema.parse(await getJson('/api/v1/files/shares')); }
export interface FileEntry { name: string; kind: 'file' | 'directory'; size: number | null; modifiedAt: number; }
export interface FileOperationReply { ok: true; entries?: FileEntry[]; nextCursor?: string | null; uploadId?: string; offset?: number; status?: string; }
export async function fileOperation(request: Record<string, unknown>): Promise<FileOperationReply> {
  const session = await getSession();
  if (!session.authenticated) throw new Error('Session expired. Sign in again.');
  const response = await fetch('/api/v1/files/operations', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrfToken, Accept: 'application/json' }, body: JSON.stringify(request) });
  const result = await response.json() as { ok?: boolean; error?: string };
  if (!response.ok || !result.ok) throw new Error(result.error === 'collision' ? 'A file or folder with that name already exists.' : result.error === 'share-unavailable' ? 'The share is offline or its status is stale.' : result.error ?? 'File operation failed.');
  return fileOperationReplySchema.parse(result) as FileOperationReply;
}
export async function getFileActions() { return getJson('/api/v1/files/actions') as Promise<{ actions: { id: string; action: string; requestedAt: string; completedAt: string | null; result: string }[] }>; }
export async function createSession(password: string, csrfToken: string): Promise<void> {
  const response = await fetch('/api/v1/session', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ password, csrfToken }) });
  if (!response.ok) throw new Error(response.status === 429 ? 'rate-limited' : 'invalid-credentials');
}
export async function deleteSession(csrfToken: string): Promise<void> {
  const response = await fetch('/api/v1/session', { method: 'DELETE', credentials: 'same-origin', headers: { 'X-CSRF-Token': csrfToken } });
  if (!response.ok) throw new Error('logout-failed');
}

export async function getProblems() { return problemsResponseSchema.parse(await getJson('/api/v1/problems')); }
export async function getProblem(id: string) {
  const response = await fetch(`/api/v1/problems/${encodeURIComponent(id)}`, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(response.status === 404 ? 'not-current' : 'request-failed');
  return problemDetailResponseSchema.parse(await response.json());
}
