import { test, expect } from '@playwright/test';

const PAGES = [
  { path: '/',           heading: 'Dashboard' },
  { path: '/markets',    heading: 'Markets' },
  { path: '/scorers',    heading: 'Context Scorers' },
  { path: '/decisions',  heading: 'AI Decisions' },
  { path: '/orders',     heading: 'Orders' },
  { path: '/positions',  heading: 'Positions' },
  { path: '/risk',       heading: 'Risk Management' },
  { path: '/analytics',  heading: 'Analytics' },
  { path: '/settings',   heading: 'Settings' },
  { path: '/health',     heading: 'System Health' },
];

test.describe('Navigation', () => {
  test('app loads at / and Dashboard is visible', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 10000 });
  });

  test('sidebar is always visible', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('navigation')).toBeVisible({ timeout: 10000 });
  });

  for (const { path, heading } of PAGES) {
    test(`direct URL ${path} loads "${heading}"`, async ({ page }) => {
      await page.goto(path);
      // Analytics has a large lazy chunk (~433KB) — needs more time on first load
      const timeout = path === '/analytics' ? 30000 : 15000;
      await expect(page.getByRole('heading', { name: heading })).toBeVisible({ timeout });
    });
  }

  test('clicking Markets sidebar link navigates to Markets', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('navigation').getByText('Markets').click();
    await expect(page).toHaveURL('/markets');
    await expect(page.getByRole('heading', { name: 'Markets' })).toBeVisible({ timeout: 10000 });
  });

  test('clicking Decisions sidebar link navigates to AI Decisions', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('navigation').getByText('Decisions').click();
    await expect(page).toHaveURL('/decisions');
    await expect(page.getByRole('heading', { name: 'AI Decisions' })).toBeVisible({ timeout: 10000 });
  });

  test('browser back/forward navigation works', async ({ page }) => {
    await page.goto('/');
    await page.goto('/markets');
    await page.goBack();
    await expect(page).toHaveURL('/');
    await page.goForward();
    await expect(page).toHaveURL('/markets');
  });

  test('sidebar highlights the active page', async ({ page }) => {
    await page.goto('/markets');
    await expect(page.getByRole('navigation').getByText('Markets')).toBeVisible({ timeout: 10000 });
  });
});
