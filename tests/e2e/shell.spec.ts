import { expect, test } from '@playwright/test';

test('shell authenticates and supports keyboard navigation', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Fixture demo mode')).toBeVisible();
  await page.getByLabel('Owner password').fill('labdeck-test-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'No integrations configured' })).toBeVisible();
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
