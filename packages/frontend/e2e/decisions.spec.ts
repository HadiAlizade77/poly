import { test, expect } from '@playwright/test';

test.describe('Decisions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/decisions');
    await expect(page.getByRole('heading', { name: 'AI Decisions' })).toBeVisible({ timeout: 10000 });
  });

  test('shows page heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'AI Decisions' })).toBeVisible();
  });

  test('shows stat cards', async ({ page }) => {
    await expect(page.getByText(/Total Decisions/i).first()).toBeVisible({ timeout: 10000 });
  });

  test('decision table loads with seeded data', async ({ page }) => {
    const rows = page.locator('tbody tr');
    await expect(rows.first()).toBeVisible({ timeout: 10000 });
    // Seed has 4 AI decisions
    expect(await rows.count()).toBeGreaterThanOrEqual(1);
  });

  test('shows action filter dropdown', async ({ page }) => {
    await expect(page.locator('select').first()).toBeVisible({ timeout: 10000 });
  });

  test('filtering by "trade" action shows results', async ({ page }) => {
    await page.locator('select').first().selectOption('trade');
    await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 10000 });
  });

  test('clicking a decision row opens detail drawer', async ({ page }) => {
    await page.locator('tbody tr').first().click();
    // Custom drawer renders "Decision Detail" in its header
    await expect(page.getByText('Decision Detail')).toBeVisible({ timeout: 5000 });
  });
});
