import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Reuse authentication within this worker so UI cases do not exhaust the login limiter.
let cookies: Awaited<ReturnType<BrowserContext['cookies']>> | undefined;
async function signIn(page: Page) {
  if (cookies) await page.context().addCookies(cookies);
  await page.goto('/');
  if (!cookies) {
    await page.getByLabel('Owner password').fill('labdeck-test-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
    cookies = await page.context().cookies();
  }
}

for (const width of [1440, 390]) {
  test(`YouTube preview confirmation and retry at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const at = new Date().toISOString();
    const identity = 'a'.repeat(32);
    let jobs: Record<string, unknown>[] = [];
    const commands: Record<string, unknown>[] = [];
    await page.route('**/api/v1/youtube', async (route) => {
      if (route.request().method() === 'GET') return route.fulfill({ json: { configured: true, available: true, observedAt: at, jobs } });
      const command = route.request().postDataJSON() as Record<string, unknown>;
      commands.push(command);
      if (command.action === 'prepare') jobs = [{ id: identity, kind: 'music', name: 'Artist', state: 'ready', createdAt: at, updatedAt: at, error: null, items: [{ number: 1, title: 'Original', destination: 'Artist/Singles/01 - Original.mp3', state: 'pending', error: null }] }];
      else if (command.action === 'submit') jobs = [{ ...jobs[0], state: 'partially-completed', items: [{ number: 1, title: 'Edited', destination: 'Artist/Singles/01 - Edited.mp3', state: 'failed', error: 'media-process-failed' }] }];
      else if (command.action === 'retry') jobs = [{ ...jobs[0], state: 'queued' }];
      else if (command.action === 'cancel') jobs = [{ ...jobs[0], state: 'cancelled' }];
      await route.fulfill({ status: 202, json: { ok: true, id: identity } });
    });
    await signIn(page);
    await page.goto('/downloads');
    await page.getByRole('combobox', { name: 'Mode', exact: true }).selectOption('music');
    await page.getByLabel('YouTube video or playlist URL').fill('https://youtu.be/abcdefghijk');
    await page.getByLabel('Artist', { exact: true }).fill('Artist');
    await page.getByRole('button', { name: 'Prepare preview' }).click();
    await expect(page.getByText('Music/Artist/Singles/01 - Original.mp3', { exact: true })).toBeVisible();
    expect(commands).toHaveLength(1);
    expect(commands[0]).toEqual({ action: 'prepare', request: { kind: 'music', source: 'https://youtu.be/abcdefghijk', artist: 'Artist', album: 'Singles' } });
    await page.getByLabel('Track 1 title').fill('Edited');
    await expect(page.getByText('Music/Artist/Singles/01 - Edited.mp3', { exact: true })).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `/tmp/labdeck-youtube-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Confirm download' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Retry failed items' })).toBeVisible();
    expect(commands[1]).toEqual({ action: 'submit', id: identity, titles: ['Edited'] });
    await page.getByRole('button', { name: 'Retry failed items' }).click();
    await expect(page.getByRole('button', { name: 'Cancel Artist' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel Artist' }).click();
    await expect.poll(() => commands.map((command) => command.action)).toEqual(['prepare', 'submit', 'retry', 'cancel']);
  });
}

for (const kind of ['movie', 'tv'] as const) {
  test(`YouTube ${kind} shows an ordered preview before confirmation`, async ({ page }) => {
    const at = new Date().toISOString();
    const identity = 'b'.repeat(32);
    const destination = kind === 'movie' ? 'Film/Film.mp4' : 'Show/Season 01/Show - S01E03.mp4';
    const source = kind === 'movie' ? 'https://youtu.be/abcdefghijk' : 'https://www.youtube.com/playlist?list=PLabcdefghijk';
    const name = kind === 'movie' ? 'Film' : 'Show';
    let job: Record<string, unknown> | null = null;
    const commands: Record<string, unknown>[] = [];
    await page.route('**/api/v1/youtube', async (route) => {
      if (route.request().method() === 'GET') return route.fulfill({ json: { configured: true, available: true, observedAt: at, jobs: job ? [job] : [] } });
      const command = route.request().postDataJSON() as Record<string, unknown>;
      commands.push(command);
      if (command.action === 'prepare') job = { id: identity, kind, name, state: 'ready', createdAt: at, updatedAt: at, error: null, items: [{ number: kind === 'tv' ? 3 : 1, title: 'Extracted title', destination, state: 'pending', error: null }] };
      if (command.action === 'submit') job = { ...job, state: 'queued' };
      await route.fulfill({ status: 202, json: { ok: true, id: identity } });
    });
    await signIn(page);
    await page.goto('/downloads');
    await page.getByRole('combobox', { name: 'Mode', exact: true }).selectOption(kind);
    await page.getByLabel(kind === 'tv' ? 'YouTube playlist URL' : 'YouTube video or playlist URL').fill(source);
    await page.getByLabel(kind === 'tv' ? 'Show name' : 'Movie name').fill(name);
    if (kind === 'movie') await page.getByLabel('Year (optional)').fill('2020');
    await page.getByRole('button', { name: 'Prepare preview' }).click();
    await expect(page.getByText(`${kind === 'movie' ? 'Movies' : 'TV'}/${destination}`, { exact: true })).toBeVisible();
    expect(commands).toEqual([{ action: 'prepare', request: { kind, source, name, ...(kind === 'movie' ? { year: 2020 } : {}) } }]);
    await page.getByRole('button', { name: 'Confirm download' }).click();
    await expect.poll(() => commands.length).toBe(2);
    expect(commands[1]).toEqual({ action: 'submit', id: identity });
  });
}
