import { test, expect } from '@playwright/test';

test('app loads and shows sidebar navigation', async ({ page }) => {
  await page.goto('/');

  // Sidebar should be visible
  await expect(page.getByRole('navigation')).toBeVisible();

  // Dashboard link should be present
  await expect(page.getByRole('link', { name: /dashboard/i })).toBeVisible();
});

test('can navigate to markets page', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('link', { name: /markets/i }).click();
  await expect(page).toHaveURL('/markets');
});

test('can navigate to settings page', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('link', { name: /settings/i }).click();
  await expect(page).toHaveURL('/settings');
});
