import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

async function files(path) {
  const entries = await readdir(path, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => entry.isDirectory() ? files(resolve(path, entry.name)) : [resolve(path, entry.name)]));
  return nested.flat();
}

const forbidden = ['LABDECK_SECRET_CANARY_7dcf3d', 'TS_SECRET_CANARY', 'X-Api-Key', '/var/run/docker.sock', 'tailscaled.sock'];
const targets = [...await files(resolve('apps/web/dist')), resolve('deploy/compose/compose.example.yml'), resolve('deploy/compose/compose.host.yml'), resolve('deploy/compose/compose.smart.yml'), resolve('deploy/compose/compose.jellyfin.yml'), resolve('deploy/compose/compose.sonarr.yml'), resolve('deploy/compose/compose.radarr.yml'), resolve('deploy/compose/compose.prowlarr.yml')];
const violations = [];
for (const target of targets) {
  const content = await readFile(target, 'utf8');
  for (const value of forbidden) if (content.includes(value)) violations.push(`${target}: contains ${value}`);
}
const compose = await readFile(resolve('deploy/compose/compose.example.yml'), 'utf8');
const hostCompose = await readFile(resolve('deploy/compose/compose.host.yml'), 'utf8');
const smartCompose = await readFile(resolve('deploy/compose/compose.smart.yml'), 'utf8');
const jellyfinCompose = await readFile(resolve('deploy/compose/compose.jellyfin.yml'), 'utf8');
for (const required of ['127.0.0.1:${LABDECK_PORT:-7337}:7337', 'read_only: true', 'cap_drop:', 'no-new-privileges:true']) {
  if (!compose.includes(required)) violations.push(`compose: missing ${required}`);
}
for (const forbiddenCompose of ['privileged: true', '/var/run/docker.sock', '/dev/']) {
  if (`${compose}\n${hostCompose}\n${smartCompose}`.includes(forbiddenCompose)) violations.push(`compose: forbidden ${forbiddenCompose}`);
}
if (!smartCompose.includes('LABDECK_SMART_SNAPSHOT_PATH: /run/labdeck-host/smart/snapshot.json')) violations.push('smart compose: missing sanitized snapshot path');
for (const required of ['LABDECK_HOST_SNAPSHOT_PATH: /run/labdeck-host/system/snapshot.json', 'target: /run/labdeck-host', 'read_only: true']) {
  if (!hostCompose.includes(required)) violations.push(`host compose: missing ${required}`);
}
for (const required of ['LABDECK_JELLYFIN_API_KEY_FILE: /run/secrets/jellyfin_api_key', 'target: /run/secrets/jellyfin_api_key', 'read_only: true']) {
  if (!jellyfinCompose.includes(required)) violations.push(`jellyfin compose: missing ${required}`);
}
if (jellyfinCompose.includes('LABDECK_JELLYFIN_API_KEY:')) violations.push('jellyfin compose: raw API key environment variable is forbidden');
for (const provider of ['sonarr', 'radarr', 'prowlarr']) {
  const content = await readFile(resolve(`deploy/compose/compose.${provider}.yml`), 'utf8');
  for (const required of [`LABDECK_${provider.toUpperCase()}_API_KEY_FILE: /run/secrets/${provider}_api_key`, `target: /run/secrets/${provider}_api_key`, 'read_only: true']) if (!content.includes(required)) violations.push(`${provider} compose: missing ${required}`);
  if (content.includes(`LABDECK_${provider.toUpperCase()}_API_KEY:`)) violations.push(`${provider} compose: raw API key environment variable is forbidden`);
}
if (violations.length) { console.error(violations.join('\n')); process.exitCode = 1; }
else console.log('Security boundary checks passed.');
