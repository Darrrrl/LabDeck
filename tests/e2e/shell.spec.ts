import { overviewResponseSchema } from '@labdeck/contracts';
import { expect, test } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

let authenticatedCookies: Awaited<ReturnType<BrowserContext['cookies']>> | undefined;
async function expectAccessible(page: Page) {
  const audit = await new AxeBuilder({ page }).analyze();
  expect(audit.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`)).toEqual([]);
}
async function signIn(page: Page) {
  if (authenticatedCookies) await page.context().addCookies(authenticatedCookies);
  await page.goto('/');
  if (authenticatedCookies) return;
  await page.getByLabel('Owner password').fill('labdeck-test-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
  authenticatedCookies = await page.context().cookies();
}

test('shell authenticates and supports keyboard navigation', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Fixture demo mode')).toBeVisible();
  await page.getByLabel('Owner password').fill('labdeck-test-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Your homelab' })).toBeVisible();
  authenticatedCookies = await page.context().cookies();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.getByRole('link', { name: 'Settings' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Configuration' })).toBeVisible();
  await expect(page.locator('#main-content')).toBeFocused();
});

test('history controls expose selection and events failure is distinct from an empty feed', async ({ page }) => {
  await signIn(page);
  await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'System' }).click();
  const ranges = page.getByRole('group', { name: 'History range' });
  await expect(ranges.getByRole('button', { name: '1h' })).toHaveAttribute('aria-pressed', 'true');
  await ranges.getByRole('button', { name: '24h' }).click();
  await expect(ranges.getByRole('button', { name: '24h' })).toHaveAttribute('aria-pressed', 'true');
  await page.route('**/api/v1/events?**', async (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
  await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'Events' }).click();
  await expect(page.getByRole('alert')).toHaveText('Cached events are unavailable.');
  await expect(page.getByText('No noteworthy transitions yet.')).toHaveCount(0);
});

test('cached detail failures do not remain in loading or empty states', async ({ page }) => {
  await page.route('**/api/v1/system?**', async (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
  await page.route('**/api/v1/storage?**', async (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
  await page.route('**/api/v1/network', async (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
  await signIn(page);
  for (const [path, message] of [
    ['/system', 'Cached system state is unavailable.'],
    ['/storage', 'Cached storage state is unavailable'],
    ['/network', 'Network data unavailable']
  ]) {
    await page.goto(path);
    await expect(page.getByRole('alert')).toContainText(message);
  }
});

test('core pages have no automated accessibility violations', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await expectAccessible(page);
  await signIn(page);
  for (const path of ['/', '/system', '/storage', '/media', '/downloads', '/containers', '/network', '/events', '/settings']) {
    await page.goto(path);
    await expect(page.getByRole('main')).toBeVisible();
    await expectAccessible(page);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/media');
  await expect(page.getByRole('heading', { name: 'Jellyfin', exact: true })).toBeVisible();
  await expectAccessible(page);
  const motion = await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'Media' }).evaluate((element) => getComputedStyle(element).transitionDuration);
  expect(parseFloat(motion)).toBeLessThanOrEqual(0.001);
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
  test(`login fits ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport); await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
}

test('host storage and stale state remain legible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await expect(page.getByText('Host data is stale')).toBeVisible();
  await page.getByRole('link', { name: 'System' }).click();
  await expect(page.getByRole('heading', { name: 'System' })).toBeVisible();
  await expect(page.getByText('Synthetic 4-Core CPU')).toBeVisible();
  await page.getByRole('link', { name: 'Storage' }).click();
  await expect(page.getByRole('heading', { name: 'Storage' })).toBeVisible();
  await expect(page.getByText('390 GB available')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('storage selects a filesystem and separates stale disk evidence on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const observedAt = new Date().toISOString();
  const earlier = new Date(Date.now() - 60 * 60_000).toISOString();
  const filesystem = (id: string, path: string) => ({ id, path, source: '/dev/synthetic', fsType: 'ext4', totalBytes: 1_000_000_000_000, usedBytes: 600_000_000_000, availableBytes: 390_000_000_000, reservedBytes: 10_000_000_000, usedRatio: .6 });
  await page.route('**/api/v1/storage**', async (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ configured: true, freshness: 'fresh', observedAt, filesystems: [filesystem('root', '/'), filesystem('media', '/srv/media')], history: { root: [], media: [] }, smart: { configured: true, freshness: 'fresh', observedAt, errorCode: null, failed: 0, warning: 0, unavailable: 1, disks: [{ id: 'array-a', label: 'Array disk A', state: 'asleep', observedAt, evidenceAt: earlier, temperatureWarning: false, identity: 'abc', serialSuffix: '1234', protocol: 'ATA', model: 'Example HDD', capacityBytes: 2_000_000_000_000, temperatureCelsius: 34, health: 'passed', powerOnHours: 1000, selfTest: { state: 'running', remainingPercent: 80, shortMinutes: 2, extendedMinutes: 600, history: [{ type: 'extended', result: 'failed', lifetimeHours: 900 }] }, ata: { reallocated: '0', pending: '0', uncorrectable: '0' }, nvme: null, scsi: null }] } }) }));
  await signIn(page);
  await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'Storage' }).click();
  await expect(page.getByRole('heading', { name: 'Storage' })).toBeVisible();
  await page.getByLabel('Selected filesystem').selectOption('media');
  await expect(page.getByText('/srv/media · /dev/synthetic')).toBeVisible();
  await expect(page.getByText('Array disk A')).toBeVisible();
  await expect(page.getByText('asleep')).toBeVisible();
  await expect(page.getByText(/Status observed .*health evidence/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await expect(page.getByText('Test in progress', { exact: true })).toBeVisible();
  await expect(page.getByText('extended · failed', { exact: true })).toBeVisible();
  await expectAccessible(page);
});

test('overview and media answer first-release questions across mixed states', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const observedAt = new Date().toISOString();
  const sessions = [
    { id: 's1', userName: 'Mira', title: 'Example Station', subtitle: 'Fresh Signals', mediaId: 'm1', paused: false, positionSeconds: 900, durationSeconds: 3600, progressRatio: .25, playbackMode: 'direct-play', bitrateBitsPerSecond: null, bitrateSource: null },
    { id: 's2', userName: 'Noah', title: 'Local Orbit', subtitle: null, mediaId: 'm2', paused: true, positionSeconds: null, durationSeconds: null, progressRatio: null, playbackMode: 'transcode', bitrateBitsPerSecond: 2400000, bitrateSource: 'transcode-estimate' }
  ];
  let mediaResponse = {
    configured: true, name: 'Jellyfin', browserUrl: 'https://media.example.test/jellyfin', connection: 'reachable',
    playback: { freshness: 'fresh', observedAt, lastSuccessfulRefreshAt: observedAt, errorCode: null as string | null, sessions },
    library: { freshness: 'stale', observedAt: '2026-09-19T10:00:00.000Z', lastSuccessfulRefreshAt: '2026-09-19T10:00:00.000Z', errorCode: 'timeout', counts: { movies: 42, series: 7, episodes: 128 }, recent: [{ id: 'new', name: 'A Quiet Packet', type: 'episode', seriesName: 'Example Station', addedAt: '2026-09-19T18:30:00.000Z' }] }
  };
  await page.route('**/api/v1/media', async (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(mediaResponse) }));
  await page.route('**/api/v1/overview', async (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({
    configured: true, overall: 'healthy', title: 'All observed systems healthy', message: 'Host metrics are current.', freshness: 'fresh', observedAt, lastAttemptAt: observedAt, errorCode: null,
    host: { hostname: 'synthetic-server', uptimeSeconds: 86400, cpu: { model: 'Synthetic 4-Core CPU', logicalProcessors: 4, utilizationPercent: 18.5 }, load: { one: .4, five: .3, fifteen: .2 }, memory: { totalBytes: 16_000_000_000, usedBytes: 8_000_000_000, availableBytes: 8_000_000_000 }, swap: { totalBytes: 2_000_000_000, usedBytes: 0, freeBytes: 2_000_000_000 } },
    storage: { id: 'data', path: '/srv/data', source: '/dev/synthetic', fsType: 'ext4', totalBytes: 1_000_000_000_000, usedBytes: 600_000_000_000, availableBytes: 390_000_000_000, reservedBytes: 10_000_000_000, usedRatio: .6 }, network: null, diskIo: null,
    media: { id: 'jellyfin', name: 'Jellyfin', browserUrl: mediaResponse.browserUrl, connection: 'reachable', freshness: 'fresh', observedAt, lastSuccessfulRefreshAt: observedAt, errorCode: null, sessions }, downloads: [], indexers: null, containers: null, disks: null, tailscale: null, events: []
  }) }));
  await signIn(page);
  await expect(page.getByText('All observed systems healthy')).toBeVisible();
  await expect(page.getByText('390 GB available').first()).toBeVisible();
  await expect(page.getByText('Mira · Playing · Direct play')).toBeVisible();
  expect(await page.locator('.metric-grid').evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(2);
  await expectAccessible(page);
  await page.screenshot({ path: 'test-results/m9-overview-390.png', fullPage: true });
  await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'Media' }).click();
  await expect(page.getByRole('heading', { name: 'Jellyfin' })).toBeVisible();
  await expect(page.getByText('Mira · Playing · Direct play')).toBeVisible();
  await expect(page.getByText('Noah · Paused · Transcoding')).toBeVisible();
  await expect(page.getByText(/Refresh failed \(timeout\)/)).toBeVisible();
  await expectAccessible(page);
  for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    if (viewport.width === 768) expect(await page.locator('.sidebar').evaluate((element) => getComputedStyle(element).position)).toBe('fixed');
    await page.screenshot({ path: `test-results/m9-media-${viewport.width}.png`, fullPage: true });
  }
  mediaResponse = { ...mediaResponse, connection: 'auth-error', playback: { ...mediaResponse.playback, errorCode: 'auth' } };
  await page.reload();
  await expect(page.getByText('Credentials rejected')).toBeVisible();
  await expect(page.getByText('Playback refresh failed (auth); last-good sessions are retained.')).toBeVisible();
  await expect(page.getByText('Mira · Playing · Direct play')).toBeVisible();
  await expectAccessible(page);
});

test('downloads keeps Sonarr and Radarr queue identities and failures separate', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const observedAt = new Date().toISOString(); const service = (id: 'sonarr' | 'radarr', connection: 'reachable' | 'unreachable') => ({ id, name: id === 'sonarr' ? 'Sonarr' : 'Radarr', browserUrl: `https://${id}.example.test`, connection, freshness: 'fresh', observedAt, errorCode: connection === 'unreachable' ? 'timeout' : null, healthWarnings: id === 'sonarr' ? ['Service reports a warning'] : [], queue: [{ source: id, id: '7', title: id === 'sonarr' ? 'Example Station S01E02' : 'Local Orbit', sizeBytes: 1000, remainingBytes: id === 'sonarr' ? 250 : null, progressRatio: id === 'sonarr' ? .75 : null, eta: null, stage: id === 'sonarr' ? 'downloading' : 'unknown', warnings: [] }], queueTotal: 1, queueTruncated: false, catalog: { monitored: id === 'sonarr' ? 1 : 2, missing: id === 'sonarr' ? 3 : 1, upcoming: [], upcomingTruncated: false }, recentImports: [] });
  await page.route('**/api/v1/downloads', async (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ configured: true, services: [service('sonarr', 'reachable'), service('radarr', 'unreachable')], indexers: null }) }));
  await signIn(page); await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'Downloads' }).click();
  await expect(page.getByRole('heading', { name: 'Managed downloads' })).toBeVisible(); await expect(page.getByRole('heading', { name: 'Sonarr' })).toBeVisible(); await expect(page.getByRole('heading', { name: 'Radarr' })).toBeVisible(); await expect(page.getByText('Example Station S01E02')).toBeVisible(); await expect(page.getByText('Local Orbit')).toBeVisible(); await expect(page.getByText('Queue refresh failed (timeout); showing last-good data.')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await expectAccessible(page);
});

test('indexers show fresh failure evidence, disabled state and unknown application connectivity', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const observedAt = new Date().toISOString();
  const indexers = { configured: true, name: 'Prowlarr', browserUrl: 'https://prowlarr.example.test', connection: 'reachable', freshness: 'fresh', observedAt, errorCode: null, failingTotal: 1, disabledTotal: 1, warnings: [{ severity: 'warning', text: 'Prowlarr reports a warning' }], indexers: [{ id: '1', name: 'Example One', state: 'failing', lastFailureAt: observedAt, disabledUntil: observedAt }, { id: '2', name: 'Disabled Example', state: 'disabled', lastFailureAt: null, disabledUntil: null }], applications: { connectivity: 'unknown' } };
  await page.route('**/api/v1/downloads', async (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ configured: true, services: [], indexers }) }));
  await signIn(page); await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'Downloads' }).click();
  await expect(page.getByRole('heading', { name: 'Prowlarr indexers' })).toBeVisible();
  await expect(page.getByText('Example One')).toBeVisible(); await expect(page.getByText('Disabled by configuration')).toBeVisible();
  await expect(page.getByText(/Application connectivity: unknown/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await expectAccessible(page);
});

test('containers show a 50-item mixed inventory and read-only detail without phone overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const observedAt = new Date().toISOString();
  const containers = Array.from({ length: 50 }, (_, index) => ({ id: index.toString(16).padStart(64, '0'), name: `service-${index}`, image: 'example:1', createdAt: observedAt, startedAt: index % 5 === 0 ? null : observedAt, state: index % 5 === 0 ? 'exited' : 'running', health: index === 1 ? 'unhealthy' : 'no-healthcheck', restartCount: 0, cpuPercent: index % 5 === 0 ? null : 12.5, memoryBytes: index % 5 === 0 ? null : 100_000_000, memoryLimitBytes: 500_000_000, memoryKind: 'working-set', statsObservedAt: index % 5 === 0 ? null : observedAt, expectedRunning: index === 0 }));
  await page.route('**/api/v1/containers', async (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ configured: true, freshness: 'fresh', observedAt, errorCode: null, inventoryComplete: true, total: 50, running: 40, unhealthy: 1, expectedStopped: 1, containers }) }));
  await signIn(page); await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'Containers' }).click();
  await expect(page.getByRole('heading', { name: 'Docker observation' })).toBeVisible();
  await expect(page.getByText('service-49')).toBeVisible();
  await page.getByText('service-1', { exact: true }).click();
  await expect(page.locator('details[open]').getByText('Working set (cache excluded)')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await expectAccessible(page);
  await page.getByLabel('Show', { exact: true }).selectOption('attention');
  await expect(page.locator('.container-row')).toHaveCount(2);
  await page.getByLabel('Search containers').fill('service-0');
  await expect(page.locator('.container-row')).toHaveCount(1);
  await page.getByLabel('Search containers').fill('no-such-container');
  await expect(page.getByText('No containers match these filters.')).toBeVisible();
});

test('network shows local peers, unknown last-seen and stale evidence on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const observedAt = new Date(Date.now() - 3 * 60_000).toISOString();
  await page.route('**/api/v1/network', async (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ configured: true, freshness: 'stale', observedAt, errorCode: 'permission-denied', backendState: 'Running', inventoryComplete: true, total: 2, online: 1, version: '1.90-synthetic', selfName: 'lab-server', selfIPs: ['100.101.102.103'], peers: [
    { id: 'n-a', name: 'laptop', ips: ['100.101.102.104'], online: true, lastSeen: null },
    { id: 'n-b', name: 'tablet', ips: ['100.101.102.105'], online: false, lastSeen: null }
  ] }) }));
  await signIn(page); await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'Network' }).click();
  await expect(page.getByRole('heading', { name: 'Network' })).toBeVisible();
  await expect(page.getByText('1 online / 2 known')).toBeVisible();
  await expect(page.getByText('Last seen unknown')).toBeVisible();
  await expect(page.getByText(/Local status read failed \(permission-denied\)/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await expectAccessible(page);
});

test('wallboard fits a server screen and preserves stale evidence', async ({ page }) => {
  await page.route('**/api/v1/overview', async (route) => {
    const response = await route.fetch(); const data = overviewResponseSchema.parse(await response.json());
    if (!data.configured) throw new Error('Expected configured overview fixture');
    const observedAt = new Date().toISOString();
    data.media = { id: 'jellyfin', name: 'Jellyfin', browserUrl: 'https://example.test', connection: 'reachable', freshness: 'fresh', observedAt, lastSuccessfulRefreshAt: observedAt, errorCode: null, sessions: Array.from({ length: 5 }, (_, index) => ({ id: String(index), userName: 'Viewer', title: 'A long movie title on the server screen', subtitle: null, mediaId: String(index), paused: false, positionSeconds: 100, durationSeconds: 600, progressRatio: .16, playbackMode: 'direct-play', bitrateBitsPerSecond: null, bitrateSource: null })) };
    data.downloads = (['sonarr', 'radarr'] as const).map((id) => ({ id, name: id, browserUrl: 'https://example.test', connection: 'reachable', freshness: 'stale', observedAt, errorCode: 'timeout', healthWarnings: [], queue: [], queueTotal: 4, queueTruncated: false, catalog: null, recentImports: [] }));
    data.containers = { configured: true, freshness: 'fresh', observedAt, errorCode: null, inventoryComplete: false, total: 50, running: 40, unhealthy: 1, expectedStopped: 2 };
    data.disks = { configured: true, freshness: 'stale', observedAt, errorCode: null, failed: 1, warning: 2, unavailable: 1 };
    data.tailscale = { configured: true, freshness: 'fresh', observedAt, errorCode: null, backendState: 'Running', inventoryComplete: false, total: 10, online: 8 };
    await route.fulfill({ json: data });
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  await signIn(page);
  await page.getByRole('link', { name: 'Wallboard', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Docker', exact: true })).toBeVisible();
  await expect(page.getByText(/Host data is stale/)).toBeVisible();
  await expect(page.locator('.wallboard-widget')).toHaveCount(6);
  await expect(page.getByText('+3 more in Media')).toBeVisible();
  expect(await page.locator('.wallboard-widget').evaluateAll((widgets) => widgets.every((widget) => widget.scrollHeight <= widget.clientHeight))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expectAccessible(page);
  await page.screenshot({ path: 'test-results/addons-wallboard.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('SMART schedule preview changes without issuing actions', async ({ page }) => {
  await signIn(page); await page.goto('/storage');
  await page.getByText('Plan SMART tests', { exact: true }).click();
  await page.getByLabel('Extended test day').selectOption('6');
  await page.getByLabel('Start hour').selectOption('04');
  await expect(page.locator('.schedule-config')).toContainText('L/../../6/04');
  await expect(page.getByText(/Configuration preview · not installed or active/)).toBeVisible();
});
