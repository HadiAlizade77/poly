import { test, expect } from '@playwright/test';

test.describe('Scorers', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/scorers');
    await expect(page.getByRole('heading', { name: 'Context Scorers' })).toBeVisible({ timeout: 10000 });
  });

  test('shows page heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Context Scorers' })).toBeVisible();
  });

  test('category filter tabs render', async ({ page }) => {
    await expect(page.getByText(/all/i).first()).toBeVisible();
    await expect(page.getByText(/crypto/i).first()).toBeVisible();
    await expect(page.getByText(/politics/i).first()).toBeVisible();
  });

  test('scorer cards load with seeded data', async ({ page }) => {
    // Each scorer card has the scorer name as text
    await expect(page.getByText(/momentum|divergence|liquidity|mean_reversion/i).first()).toBeVisible({ timeout: 10000 });
  });

  test('shows crypto scorers when crypto tab clicked', async ({ page }) => {
    await page.getByText('crypto').first().click();
    await expect(page.getByText(/momentum|divergence|liquidity/i).first()).toBeVisible({ timeout: 10000 });
  });

  test('scorer cards show Enabled/Disabled badge', async ({ page }) => {
    await expect(page.getByText(/^Enabled$|^Disabled$/i).first()).toBeVisible({ timeout: 10000 });
  });

  test('scorer card shows toggle button', async ({ page }) => {
    const toggle = page.locator('button[aria-label*="scorer"], button[aria-label*="able"]').first();
    await expect(toggle).toBeVisible({ timeout: 10000 });
  });

  test('expanding a scorer card reveals Parameters section', async ({ page }) => {
    // The expand button is the first button inside each scorer card (the chevron toggle)
    const firstCard = page.locator('[class*="rounded-lg"][class*="border"]').first();
    await firstCard.locator('button').first().click();
    // "Parameters" heading renders inside the expanded section
    await expect(page.getByText('Parameters').first()).toBeVisible({ timeout: 5000 });
  });
});
