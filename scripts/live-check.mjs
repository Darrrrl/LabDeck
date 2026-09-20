import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { hostname, platform } from 'node:os';
import { resolve } from 'node:path';

const provider = process.argv.find((argument) => argument.startsWith('--provider='))?.slice('--provider='.length);
if (!['host', 'jellyfin'].includes(provider)) {
  console.error('Usage: npm run test:live -- --provider=host|jellyfin');
  process.exitCode = 1;
} else if (provider === 'jellyfin') {
  await checkJellyfin();
} else if (process.env.LABDECK_LIVE_TEST !== 'true') {
  console.log('SKIP host live validation: set LABDECK_LIVE_TEST=true after reviewing the collector setup.');
} else if (platform() !== 'linux') {
  console.log('SKIP host live validation: an Ubuntu/Linux host is required.');
} else {
  const configuredPath = process.env.LABDECK_HOST_SNAPSHOT_PATH;
  if (!configuredPath) throw new Error('LABDECK_HOST_SNAPSHOT_PATH is required');
  const snapshotPath = resolve(configuredPath);
  const stat = lstatSync(snapshotPath);
  assert(stat.isFile() && !stat.isSymbolicLink(), 'snapshot must be a regular non-symlink file');
  assert(stat.size <= 2 * 1024 * 1024, 'snapshot exceeds 2MiB');
  const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
  assert(snapshot.schemaVersion === '1', 'unsupported snapshot schema');
  assert(snapshot.capabilities?.summary?.status === 'ok', 'host summary is unavailable');
  assert(snapshot.capabilities?.filesystems?.status === 'ok', 'filesystem observations are unavailable');
  const generatedAt = Date.parse(snapshot.generatedAt);
  assert(Number.isFinite(generatedAt) && Math.abs(Date.now() - generatedAt) <= 30_000, 'snapshot is older than 30 seconds or future-dated');

  const summary = snapshot.capabilities.summary.data;
  assert(summary.hostname === hostname(), 'hostname differs from the host');
  const currentUptime = Number.parseFloat(readFileSync('/proc/uptime', 'utf8').split(/\s+/)[0]);
  const predictedUptime = summary.uptimeSeconds + ((Date.now() - generatedAt) / 1_000);
  near(currentUptime, predictedUptime, 5, 'uptime');

  const free = execFileSync('free', ['-b', '--wide'], { encoding: 'utf8', timeout: 5_000, maxBuffer: 1024 * 1024 });
  const memoryLine = free.split('\n').find((line) => line.trimStart().startsWith('Mem:'))?.trim().split(/\s+/);
  assert(memoryLine && memoryLine.length >= 7, 'unable to parse free -b output');
  near(Number(memoryLine[1]), summary.memory.totalBytes, 4_096, 'memory total');
  near(Number(memoryLine[6]), summary.memory.availableBytes, 256 * 1024 * 1024, 'memory available');
  near(summary.memory.totalBytes - summary.memory.availableBytes, summary.memory.usedBytes, 1, 'LabDeck memory formula');

  for (const filesystem of snapshot.capabilities.filesystems.data) {
    const output = execFileSync('df', ['-B1', '--output=size,used,avail,target', filesystem.path], { encoding: 'utf8', timeout: 5_000, maxBuffer: 1024 * 1024 });
    const fields = output.trim().split('\n').at(-1)?.trim().split(/\s+/);
    assert(fields && fields.length >= 3, 'unable to parse df -B1 output');
    near(Number(fields[0]), filesystem.totalBytes, 1024 * 1024, 'filesystem total');
    near(Number(fields[1]), filesystem.usedBytes, 256 * 1024 * 1024, 'filesystem used');
    near(Number(fields[2]), filesystem.availableBytes, 256 * 1024 * 1024, 'filesystem available');
    assert(filesystem.usedBytes === filesystem.totalBytes - filesystem.freeBytes, 'filesystem used formula differs');
    assert(filesystem.reservedBytes === filesystem.freeBytes - filesystem.availableBytes, 'filesystem reserved formula differs');
  }

  assertSelectedNames('/proc/net/dev', snapshot.capabilities.interfaces, 'name', 'configured interface');
  assertSelectedNames('/proc/diskstats', snapshot.capabilities.blockIo, 'name', 'configured block device');
  console.log('PASS host live validation: hostname, freshness, uptime, free -b, df -B1, and selected counter sources agree.');
  console.log('NOTE rate values require the documented two-snapshot interval comparison; this command does not fabricate precise alignment.');
}

async function checkJellyfin() {
  if (process.env.LABDECK_LIVE_TEST !== 'true') { console.log('SKIP Jellyfin live validation: set LABDECK_LIVE_TEST=true after reviewing read paths and privacy content.'); return; }
  const base = process.env.LABDECK_JELLYFIN_BASE_URL; const keyFile = process.env.LABDECK_JELLYFIN_API_KEY_FILE;
  if (!base || !keyFile) throw new Error('LABDECK_JELLYFIN_BASE_URL and LABDECK_JELLYFIN_API_KEY_FILE are required');
  const baseUrl = new URL(base); assert(['http:', 'https:'].includes(baseUrl.protocol) && !baseUrl.username && !baseUrl.password && !baseUrl.search && !baseUrl.hash, 'invalid Jellyfin base URL');
  const keyPath = resolve(keyFile); const keyStat = lstatSync(keyPath); assert(keyStat.isFile() && !keyStat.isSymbolicLink() && (keyStat.mode & 0o007) === 0, 'Jellyfin key must be a restricted regular non-symlink file');
  const key = readFileSync(keyPath, 'utf8').trim(); assert(key.length > 0 && key.length <= 512 && !/[\r\n]/.test(key), 'invalid Jellyfin API key file');
  const system = await jellyfinGet('/System/Info', {}, baseUrl, key); assert(typeof system?.Version === 'string', 'system version is missing');
  const sessions = await jellyfinGet('/Sessions', {}, baseUrl, key); assert(Array.isArray(sessions), 'sessions response is not an array');
  const counts = await jellyfinGet('/Items/Counts', {}, baseUrl, key); for (const field of ['MovieCount', 'SeriesCount', 'EpisodeCount']) assert(Number.isSafeInteger(counts?.[field]) && counts[field] >= 0, `${field} is invalid`);
  const recent = await jellyfinGet('/Items', { Limit: '12', Recursive: 'true', SortBy: 'DateCreated', SortOrder: 'Descending', IncludeItemTypes: 'Movie,Series,Episode', Fields: 'DateCreated', EnableImages: 'false', EnableTotalRecordCount: 'false' }, baseUrl, key); assert(Array.isArray(recent?.Items) && recent.Items.length <= 12, 'recent-items response is invalid or unbounded');
  console.log(`PASS Jellyfin live validation: version ${system.Version}; fixed read paths, header authentication, path prefix, sessions, counts, and bounded recent additions succeeded.`);
  console.log('NOTE response content, user names, media titles, origins, and credentials are intentionally omitted.');
}

async function jellyfinGet(path, query, baseUrl, key) {
  const url = new URL(`${baseUrl.toString().replace(/\/$/, '')}/${path.slice(1)}`); for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(url, { method: 'GET', redirect: 'error', signal: controller.signal, headers: { Accept: 'application/json', Authorization: `MediaBrowser Token="${key}"` } });
    assert(response.ok, response.status === 401 || response.status === 403 ? 'Jellyfin credentials rejected' : `Jellyfin read failed with status ${response.status}`);
    const length = Number(response.headers.get('content-length')); assert(!Number.isFinite(length) || length <= 2 * 1024 * 1024, 'Jellyfin body exceeds 2MiB');
    const body = await response.text(); assert(Buffer.byteLength(body) <= 2 * 1024 * 1024, 'Jellyfin body exceeds 2MiB'); return JSON.parse(body);
  } finally { clearTimeout(timer); }
}

function assert(condition, message) { if (!condition) throw new Error(message); }
function near(actual, expected, tolerance, label) {
  assert(Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) <= tolerance, `${label} differs beyond tolerance`);
}
function assertSelectedNames(path, capability, key, label) {
  if (capability?.status !== 'ok') return;
  const source = readFileSync(path, 'utf8');
  for (const item of capability.data) assert(source.includes(String(item[key])), `${label} is absent from ${path}`);
}
