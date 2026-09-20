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

test('media shows mixed playback and library state without page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/v1/media', async (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({
    configured: true, name: 'Jellyfin', browserUrl: 'https://media.example.test/jellyfin', connection: 'reachable',
    playback: { freshness: 'fresh', observedAt: new Date().toISOString(), lastSuccessfulRefreshAt: new Date().toISOString(), errorCode: null, sessions: [
      { id: 's1', userName: 'Mira', title: 'Example Station', subtitle: 'Fresh Signals', mediaId: 'm1', paused: false, positionSeconds: 900, durationSeconds: 3600, progressRatio: .25, playbackMode: 'direct-play', bitrateBitsPerSecond: 8000000, bitrateSource: 'media-source' },
      { id: 's2', userName: 'Noah', title: 'Local Orbit', subtitle: null, mediaId: 'm2', paused: true, positionSeconds: null, durationSeconds: null, progressRatio: null, playbackMode: 'transcode', bitrateBitsPerSecond: null, bitrateSource: null }
    ] },
    library: { freshness: 'stale', observedAt: '2026-09-19T10:00:00.000Z', lastSuccessfulRefreshAt: '2026-09-19T10:00:00.000Z', errorCode: 'timeout', counts: { movies: 42, series: 7, episodes: 128 }, recent: [{ id: 'new', name: 'A Quiet Packet', type: 'episode', seriesName: 'Example Station', addedAt: '2026-09-19T18:30:00.000Z' }] }
  }) }));
  await page.goto('/'); await page.getByLabel('Owner password').fill('labdeck-test-password'); await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('link', { name: 'Media' }).click();
  await expect(page.getByRole('heading', { name: 'Jellyfin' })).toBeVisible();
  await expect(page.getByText('Mira · Playing · Direct play')).toBeVisible();
  await expect(page.getByText('Noah · Paused · Transcoding')).toBeVisible();
  await expect(page.getByText(/Refresh failed \(timeout\)/)).toBeVisible();
  for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }
});
