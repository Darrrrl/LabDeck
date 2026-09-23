import { expect, test } from '@playwright/test';

test('shell authenticates and supports keyboard navigation', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Fixture demo mode')).toBeVisible();
  await page.getByLabel('Owner password').fill('labdeck-test-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Your homelab' })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.getByRole('link', { name: 'Settings' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Configuration' })).toBeVisible();
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
  await page.goto('/');
  await page.getByLabel('Owner password').fill('labdeck-test-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Host data is stale')).toBeVisible();
  await page.getByRole('link', { name: 'System' }).click();
  await expect(page.getByRole('heading', { name: 'System' })).toBeVisible();
  await expect(page.getByText('Synthetic 4-Core CPU')).toBeVisible();
  await page.getByRole('link', { name: 'Storage' }).click();
  await expect(page.getByRole('heading', { name: 'Storage' })).toBeVisible();
  await expect(page.getByText('390 GB available')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
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
    media: { id: 'jellyfin', name: 'Jellyfin', browserUrl: mediaResponse.browserUrl, connection: 'reachable', freshness: 'fresh', observedAt, lastSuccessfulRefreshAt: observedAt, errorCode: null, sessions }, downloads: [], events: []
  }) }));
  await page.goto('/'); await page.getByLabel('Owner password').fill('labdeck-test-password'); await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('All observed systems healthy')).toBeVisible();
  await expect(page.getByText('390 GB available').first()).toBeVisible();
  await expect(page.getByText('Mira · Playing · Direct play')).toBeVisible();
  await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'Media' }).click();
  await expect(page.getByRole('heading', { name: 'Jellyfin' })).toBeVisible();
  await expect(page.getByText('Mira · Playing · Direct play')).toBeVisible();
  await expect(page.getByText('Noah · Paused · Transcoding')).toBeVisible();
  await expect(page.getByText(/Refresh failed \(timeout\)/)).toBeVisible();
  for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }
  mediaResponse = { ...mediaResponse, connection: 'auth-error', playback: { ...mediaResponse.playback, errorCode: 'auth' } };
  await page.reload();
  await expect(page.getByText('Credentials rejected')).toBeVisible();
  await expect(page.getByText('Playback refresh failed (auth); last-good sessions are retained.')).toBeVisible();
  await expect(page.getByText('Mira · Playing · Direct play')).toBeVisible();
});

test('downloads keeps Sonarr and Radarr queue identities and failures separate', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const observedAt = new Date().toISOString(); const service = (id: 'sonarr' | 'radarr', connection: 'reachable' | 'unreachable') => ({ id, name: id === 'sonarr' ? 'Sonarr' : 'Radarr', browserUrl: `https://${id}.example.test`, connection, freshness: 'fresh', observedAt, errorCode: connection === 'unreachable' ? 'timeout' : null, healthWarnings: id === 'sonarr' ? ['Service reports a warning'] : [], queue: [{ source: id, id: '7', title: id === 'sonarr' ? 'Example Station S01E02' : 'Local Orbit', sizeBytes: 1000, remainingBytes: id === 'sonarr' ? 250 : null, progressRatio: id === 'sonarr' ? .75 : null, eta: null, stage: id === 'sonarr' ? 'downloading' : 'unknown', warnings: [] }], queueTotal: 1, queueTruncated: false, catalog: { monitored: id === 'sonarr' ? 1 : 2, missing: id === 'sonarr' ? 3 : 1, upcoming: [], upcomingTruncated: false }, recentImports: [] });
  await page.route('**/api/v1/downloads', async (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ configured: true, services: [service('sonarr', 'reachable'), service('radarr', 'unreachable')] }) }));
  await page.goto('/'); await page.getByLabel('Owner password').fill('labdeck-test-password'); await page.getByRole('button', { name: 'Sign in' }).click(); await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'Downloads' }).click();
  await expect(page.getByRole('heading', { name: 'Managed downloads' })).toBeVisible(); await expect(page.getByRole('heading', { name: 'Sonarr' })).toBeVisible(); await expect(page.getByRole('heading', { name: 'Radarr' })).toBeVisible(); await expect(page.getByText('Example Station S01E02')).toBeVisible(); await expect(page.getByText('Local Orbit')).toBeVisible(); await expect(page.getByText('Queue refresh failed (timeout); showing last-good data.')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
