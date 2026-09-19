import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

async function files(path) {
  const entries = await readdir(path, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => entry.isDirectory() ? files(resolve(path, entry.name)) : [resolve(path, entry.name)]));
  return nested.flat();
}

const forbidden = ['LABDECK_SECRET_CANARY_7dcf3d', 'X-Api-Key', '/var/run/docker.sock'];
const targets = [...await files(resolve('apps/web/dist')), resolve('deploy/compose/compose.example.yml')];
const violations = [];
for (const target of targets) {
  const content = await readFile(target, 'utf8');
  for (const value of forbidden) if (content.includes(value)) violations.push(`${target}: contains ${value}`);
}
const compose = await readFile(resolve('deploy/compose/compose.example.yml'), 'utf8');
for (const required of ['127.0.0.1:${LABDECK_PORT:-7337}:7337', 'read_only: true', 'cap_drop:', 'no-new-privileges:true']) {
  if (!compose.includes(required)) violations.push(`compose: missing ${required}`);
}
for (const forbiddenCompose of ['privileged: true', '/var/run/docker.sock', '/dev/']) {
  if (compose.includes(forbiddenCompose)) violations.push(`compose: forbidden ${forbiddenCompose}`);
}
if (violations.length) { console.error(violations.join('\n')); process.exitCode = 1; }
else console.log('Security boundary checks passed.');
