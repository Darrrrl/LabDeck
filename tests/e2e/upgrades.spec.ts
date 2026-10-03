import { overviewResponseSchema, storageResponseSchema, settingsResponseSchema } from '@labdeck/contracts';
import { expect, test, type Page, type BrowserContext } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

let cookies: Awaited<ReturnType<BrowserContext['cookies']>> | undefined;
async function login(page: Page) {
  if (cookies) await page.context().addCookies(cookies);
  await page.goto('/');
  if (cookies) return;
  await page.getByLabel('Owner password').fill('labdeck-test-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Your homelab' })).toBeVisible();
  cookies = await page.context().cookies();
}
async function accessible(page: Page) { expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]); }

test('Compose projects retain full attention counts while saved filters narrow expandable services', async ({ page }) => {
  const at = new Date().toISOString();
  const containers = [
    { name: 'player-1', composeProject: 'media', composeService: 'player', state: 'running', health: 'unhealthy', expectedRunning: true },
    { name: 'player-2', composeProject: 'media', composeService: 'player', state: 'running', health: 'healthy', expectedRunning: true },
    { name: 'optional-job', composeProject: 'media', composeService: 'maintenance', state: 'exited', health: 'no-healthcheck', expectedRunning: false },
    { name: 'standalone', state: 'running', health: 'no-healthcheck', expectedRunning: false }
  ].map((item, i) => ({ id: i.toString(16).padStart(64, '0'), image: 'example:1', createdAt: at, startedAt: at, restartCount: 0, cpuPercent: null, memoryBytes: null, memoryLimitBytes: null, memoryKind: 'unknown', statsObservedAt: null, ...item }));
  await page.route('**/api/v1/containers', (route) => route.fulfill({ json: { configured: true, freshness: 'stale', observedAt: at, errorCode: null, inventoryComplete: false, total: null, running: 3, unhealthy: 1, expectedStopped: 0, containers } }));
  await login(page); await page.goto('/containers');
  await expect(page.getByText('Project · media', { exact: true })).toBeVisible();
  await expect(page.getByText('1 need attention · 3 of 3 shown')).toBeVisible();
  await expect(page.getByText('Ungrouped containers', { exact: true })).toBeVisible();
  await page.getByLabel('Show', { exact: true }).selectOption('attention');
  await expect(page.getByText('1 need attention · 1 of 3 shown')).toBeVisible();
  await expect(page.getByText('optional-job', { exact: true })).toHaveCount(0);
  await page.getByLabel('Search containers').fill('media');
  await page.reload();
  await expect(page.getByLabel('Search containers')).toHaveValue('media');
  await expect(page.getByLabel('Show', { exact: true })).toHaveValue('attention');
  const project = page.locator('.compose-project > summary');
  await project.focus(); await page.keyboard.press('Enter');
  await expect(page.getByText('player-1', { exact: true })).toBeHidden();
  await page.keyboard.press('Enter');
  await expect(page.getByText('player-1', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await accessible(page);
  await page.screenshot({ path: 'test-results/upgrades-compose-390.png', fullPage: true });
});

test('storage preferences persist across pages and forecast uncertainty remains visible', async ({ page }) => {
  await login(page);
  const storage = storageResponseSchema.parse(await (await page.request.get('/api/v1/storage')).json());
  storage.filesystems.push({ ...storage.filesystems[0]!, id: 'archive', path: '/srv/archive' });
  storage.freshness = 'fresh'; storage.observedAt = new Date().toISOString();
  storage.forecasts = { archive: { status: 'estimated', observedAt: new Date().toISOString(), windowStart: '2026-08-28T00:00:00Z', windowEnd: '2026-09-27T00:00:00Z', validDays: 25, coverage: 25 / 30, thresholdBytes: 100_000_000_000, growthBytesPerDay: 5_000_000_000, estimatedAt: '2026-11-27T00:00:00Z', earliestAt: '2026-11-17T00:00:00Z', latestAt: '2026-12-07T00:00:00Z' } };
  await page.route('**/api/v1/storage**', (route) => route.fulfill({ json: storage }));
  await page.goto('/storage');
  await page.getByLabel('Selected filesystem').selectOption('archive');
  await page.getByRole('button', { name: '30d', exact: true }).click();
  await page.reload();
  await expect(page.getByLabel('Selected filesystem')).toHaveValue('archive');
  await expect(page.getByRole('button', { name: '30d', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText(/Estimated low space around/)).toBeVisible();
  await expect(page.getByText(/not a statistical confidence interval/)).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 }); await accessible(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/upgrades-forecast-390.png', fullPage: true });
  await page.goto('/system');
  await expect(page.getByRole('button', { name: '30d', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.goto('/'); await expect(page.getByRole('heading', { name: 'archive', exact: true })).toBeVisible();
});

test('widget ordering and wallboard privacy persist without retaining playback data', async ({ page }) => {
  await login(page);
  const overview = overviewResponseSchema.parse(await (await page.request.get('/api/v1/overview')).json());
  if (!overview.configured) throw new Error('host fixture missing');
  overview.media = { id: 'jellyfin', name: 'Jellyfin', browserUrl: 'https://media.example.test', connection: 'reachable', freshness: 'fresh', observedAt: new Date().toISOString(), lastSuccessfulRefreshAt: null, errorCode: null, sessions: [{ id: 'one', userName: 'Synthetic owner', title: 'PRIVATE_PLAYBACK_TITLE', subtitle: null, mediaId: 'one', paused: false, positionSeconds: null, durationSeconds: null, progressRatio: null, playbackMode: 'unknown', bitrateBitsPerSecond: null, bitrateSource: null }] };
  await page.route('**/api/v1/overview', (route) => route.fulfill({ json: overview }));
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Move storage up' }).click();
  await page.getByLabel('Hide watching titles on the wallboard').check();
  await page.goto('/wallboard');
  await expect(page.locator('.wallboard-widget h2').first()).toHaveText('Storage');
  await expect(page.getByText('Watching titles hidden', { exact: true })).toBeVisible();
  await expect(page.getByText('PRIVATE_PLAYBACK_TITLE', { exact: true })).toHaveCount(0);
  await expect(page.locator('[title="PRIVATE_PLAYBACK_TITLE"]')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Hide watching titles' })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => localStorage.getItem('labdeck.preferences.v1'))).not.toContain('PRIVATE_PLAYBACK_TITLE');
  await page.setViewportSize({ width: 1280, height: 720 });
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
  await accessible(page);
  await page.screenshot({ path: 'test-results/upgrades-wallboard-1280.png', fullPage: true });
  await page.goto('/'); await expect(page.locator('.overview-widgets > section').first()).toHaveClass(/storage-summary/);
});

test('problem warnings open evidence with related events and gapped history', async ({ page }) => {
  await login(page);
  const problem = { id: 'a'.repeat(24), title: 'media: low available storage', severity: 'warning', instanceId: 'host', entityId: 'filesystem:media', freshness: 'stale', observedAt: '2026-09-27T10:00:00Z', evidence: ['96% used.', 'Evidence is retained from the last observation.'], detailPath: '/storage', browserUrl: null };
  await page.route('**/api/v1/problems', (route) => route.fulfill({ json: { problems: [problem] } }));
  await page.route('**/api/v1/problems/*', (route) => route.fulfill({ json: { problem, events: [{ id: 1, kind: 'storage.threshold', severity: 'warning', observedAt: problem.observedAt, occurredAt: null, origin: 'threshold', instanceId: 'host', entityId: problem.entityId, payload: {} }], chart: { label: 'Used capacity · past 24 hours', unit: 'bytes', points: [{ at: '2026-09-27T09:00:00Z', value: 90000, coverage: 1 }, { at: '2026-09-27T10:00:00Z', value: 96000, coverage: 1 }] } } }));
  await page.goto('/'); await page.getByRole('link', { name: problem.title }).click();
  await expect(page.getByRole('heading', { name: 'Problem details' })).toBeVisible();
  await expect(page.getByText('96% used.', { exact: true })).toBeVisible();
  await expect(page.getByText(/observations do not establish a cause/)).toBeVisible();
  await expect(page.locator('.evidence-chart line')).toHaveCount(0);
  await page.getByText('History values and coverage', { exact: true }).click();
  await expect(page.getByRole('table')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 }); await accessible(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'test-results/upgrades-problem-390.png', fullPage: true });
  await page.route('**/api/v1/problems/*', (route) => route.fulfill({ status: 404, json: { error: 'not-current' } }));
  await page.reload(); await expect(page.getByRole('alert')).toContainText('no longer current');
});

test('backup status distinguishes no record from verified creation and explains restore', async ({ page }) => {
  await login(page); const settings = settingsResponseSchema.parse(await (await page.request.get('/api/v1/settings')).json());
  settings.backup = { lastSuccessfulAt: null, integrityVerifiedAt: null };
  await page.route('**/api/v1/settings', (route) => route.fulfill({ json: settings }));
  await page.goto('/settings'); await expect(page.getByText('No successful backup recorded.')).toBeVisible();
  settings.backup = { lastSuccessfulAt: '2026-09-27T10:00:00Z', integrityVerifiedAt: '2026-09-27T10:00:00Z' };
  await page.reload(); await expect(page.getByText(/SQLite integrity verified/)).toBeVisible();
  await page.getByText('Backup and restore guidance', { exact: true }).click();
  await expect(page.getByText(/Restored sessions and backup status are cleared/)).toBeVisible();
  await accessible(page);
});

test('malformed or unavailable browser storage falls back to usable preferences', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('labdeck.preferences.v1', '{invalid'));
  await login(page); await page.goto('/settings');
  await expect(page.getByLabel('Hide watching titles on the wallboard')).not.toBeChecked();
  await page.addInitScript(() => { Storage.prototype.setItem = () => { throw new Error('storage denied'); }; });
  await page.reload(); await page.getByLabel('Hide watching titles on the wallboard').check();
  await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'Wallboard' }).click();
  await expect(page.getByRole('button', { name: 'Hide watching titles' })).toHaveAttribute('aria-pressed', 'true');
});
