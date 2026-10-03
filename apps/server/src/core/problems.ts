import { createHash } from 'node:crypto';
import type { Problem } from '@labdeck/contracts';
import type { HostQueries } from './queries.js';

export function currentProblems(queries: HostQueries): Problem[] {
  const problems: Problem[] = [];
  function add(code: string, data: Omit<Problem, 'id'>) {
    problems.push({ id: createHash('sha256').update(JSON.stringify([data.instanceId, data.entityId, code])).digest('hex').slice(0, 24), ...data, title: data.title.slice(0, 200), evidence: data.evidence.slice(0, 8).map((text) => text.slice(0, 500)) });
  }
  for (const item of queries.settings(false).integrations) {
    if (item.connection === 'reachable' && item.freshness === 'fresh') continue;
    const detailPath = ({ host: '/system', jellyfin: '/media', sonarr: '/downloads', radarr: '/downloads', prowlarr: '/downloads', smart: '/storage', tailscale: '/network' } as const)[item.id as 'host' | 'jellyfin' | 'sonarr' | 'radarr' | 'prowlarr' | 'smart' | 'tailscale'] ?? '/settings';
    const browserUrl = item.id === 'jellyfin' ? queries.media().browserUrl : queries.downloads().services.find((service) => service.id === item.id)?.browserUrl ?? (item.id === 'prowlarr' ? queries.indexers()?.browserUrl : null) ?? null;
    const observedAt = item.id === 'host' ? queries.system('1h').observedAt : item.id === 'smart' ? queries.smart().observedAt : item.id === 'tailscale' ? queries.network().observedAt : item.id === 'jellyfin' ? queries.media().playback.observedAt : item.id === 'prowlarr' ? queries.indexers()?.observedAt ?? null : queries.downloads().services.find((service) => service.id === item.id)?.observedAt ?? null;
    add('connection', { title: `${item.name}: ${item.connection === 'auth-error' ? 'credentials rejected' : item.connection === 'unreachable' ? 'connection failed' : 'monitoring incomplete'}`, severity: 'warning', instanceId: item.id === 'tailscale' ? 'host' : item.id, entityId: null, freshness: item.freshness, observedAt, evidence: [`Connection: ${item.connection}.`, `Evidence: ${item.freshness}.`, ...(item.safeErrorCode ? [`Last error: ${item.safeErrorCode}.`] : [])], detailPath, browserUrl });
  }
  const storage = queries.storage('24h', false);
  for (const fs of storage.filesystems) if (fs.usedRatio >= .9 || fs.availableBytes <= fs.totalBytes * .1) {
    add('capacity', { title: `${fs.id}: ${storage.freshness === 'fresh' ? 'low available storage' : 'last observed low storage'}`, severity: storage.freshness === 'fresh' && fs.usedRatio >= .95 ? 'critical' : 'warning', instanceId: 'host', entityId: `filesystem:${fs.id}`, freshness: storage.freshness, observedAt: storage.observedAt, evidence: [`${Math.round(fs.usedRatio * 100)}% used.`, `${fs.availableBytes} bytes available to an unprivileged writer.`, `Filesystem: ${fs.path}.`], detailPath: '/storage', browserUrl: null });
  }
  for (const disk of storage.smart.disks) if (disk.health === 'failed' || disk.health === 'warning' || disk.temperatureWarning || disk.state !== 'ok') {
    add('disk', { title: `${disk.label}: ${storage.smart.freshness === 'fresh' ? '' : 'last observed '}${disk.state === 'ok' ? disk.temperatureWarning ? 'high temperature' : `SMART ${disk.health}` : disk.state}`, severity: storage.smart.freshness === 'fresh' && disk.state === 'ok' && disk.health === 'failed' ? 'critical' : 'warning', instanceId: 'smart', entityId: `disk:${disk.id}`, freshness: storage.smart.freshness, observedAt: disk.evidenceAt, evidence: [`Current read state: ${disk.state}.`, `Last health evidence: ${disk.health}.`, `Temperature: ${disk.temperatureCelsius ?? 'unknown'} °C.`, 'SMART evidence does not predict a disk failure date.'], detailPath: '/storage', browserUrl: null });
  }
  const docker = queries.containers();
  if (docker.configured && (docker.errorCode || docker.freshness !== 'fresh' || docker.inventoryComplete === false)) add('docker-evidence', { title: 'Docker: observation incomplete', severity: 'warning', instanceId: 'host', entityId: null, freshness: docker.freshness, observedAt: docker.observedAt, evidence: [docker.errorCode ? `Read failed: ${docker.errorCode}.` : 'Inventory is partial, missing, or stale.'], detailPath: '/containers', browserUrl: null });
  for (const item of docker.containers) if (item.health === 'unhealthy' || item.expectedRunning && item.state !== 'running') {
    add('container', { title: `${item.name}: ${docker.freshness === 'fresh' ? 'needs attention' : 'last observed issue'}`, severity: 'warning', instanceId: 'host', entityId: `container:${item.id}`, freshness: docker.freshness, observedAt: docker.observedAt, evidence: [`State: ${item.state}.`, `Healthcheck: ${item.health}.`, item.expectedRunning ? 'Expected to stay running.' : 'Stopping is allowed for this container.', `Restarts reported: ${item.restartCount ?? 'unknown'}.`], detailPath: '/containers', browserUrl: null });
  }
  for (const service of queries.downloads().services) {
    const warnings = [...service.healthWarnings, ...service.queue.flatMap((entry) => entry.warnings)];
    if (warnings.length) add('download-health', { title: `${service.name}: reported warnings`, severity: 'warning', instanceId: service.id, entityId: null, freshness: service.freshness, observedAt: service.observedAt, evidence: warnings, detailPath: '/downloads', browserUrl: service.browserUrl });
  }
  const indexers = queries.indexers();
  if (indexers && ((indexers.failingTotal ?? 0) > 0 || indexers.warnings.length)) add('indexers', { title: 'Prowlarr: reported health issues', severity: 'warning', instanceId: 'prowlarr', entityId: null, freshness: indexers.freshness, observedAt: indexers.observedAt, evidence: [`${indexers.failingTotal ?? 'Unknown'} failing indexers.`, ...indexers.warnings.map((item) => item.text)], detailPath: '/downloads', browserUrl: indexers.browserUrl });
  const network = queries.network();
  if (network.configured && network.backendState !== null && network.backendState !== 'Running') add('network', { title: 'Tailscale: client is not running', severity: 'warning', instanceId: 'host', entityId: null, freshness: network.freshness, observedAt: network.observedAt, evidence: [`Reported backend state: ${network.backendState}.`, 'Known peer status is not a service reachability test.'], detailPath: '/network', browserUrl: null });
  return problems.sort((a, b) => Number(b.severity === 'critical') - Number(a.severity === 'critical')).slice(0, 200);
}
