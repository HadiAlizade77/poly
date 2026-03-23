import { test, expect } from '@playwright/test';

test.describe('Markets', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/markets');
    await expect(page.getByRole('heading', { name: 'Markets' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('table')).toBeVisible({ timeout: 10000 });
  });

  test('shows page heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Markets' })).toBeVisible();
  });

  test('market table loads with seeded data', async ({ page }) => {
    const rows = page.locator('tbody tr');
    await expect(rows.first()).toBeVisible({ timeout: 10000 });
    expect(await rows.count()).toBeGreaterThanOrEqual(1);
  });

  test('search box is visible', async ({ page }) => {
    await expect(page.getByPlaceholder(/search/i)).toBeVisible();
  });

  test('searching for "BTC" filters market rows', async ({ page }) => {
    await page.getByPlaceholder(/search/i).fill('BTC');
    await expect(page.getByText(/BTC/i).first()).toBeVisible({ timeout: 10000 });
    const count = await page.locator('tbody tr').count();
    expect(count).toBeLessThan(11);
  });

  test('clearing search restores all markets', async ({ page }) => {
    await page.getByPlaceholder(/search/i).fill('BTC');
    await page.getByPlaceholder(/search/i).clear();
    const rows = page.locator('tbody tr');
    await expect(rows.nth(3)).toBeVisible({ timeout: 10000 });
  });

  test('category filter tabs render', async ({ page }) => {
    // Tabs are <button> elements (not role=tab)
    await expect(page.getByRole('button', { name: /^All$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Crypto$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Politics$/i })).toBeVisible();
  });

  test('clicking Crypto tab shows only crypto markets', async ({ page }) => {
    // Seed has 4 crypto markets
    await page.getByRole('button', { name: /^Crypto$/i }).click();
    const rows = page.locator('tbody tr');
    await expect(rows.first()).toBeVisible({ timeout: 10000 });
    expect(await rows.count()).toBeLessThanOrEqual(8);
  });

  test('clicking a market row opens detail drawer', async ({ page }) => {
    await page.locator('tbody tr').first().click();
    // Custom drawer renders "Market Detail" in its header
    await expect(page.getByText('Market Detail')).toBeVisible({ timeout: 5000 });
  });
});
