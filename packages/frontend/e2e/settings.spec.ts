import { test, expect } from '@playwright/test';

test.describe('Settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({ timeout: 10000 });
  });

  test('shows page heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  });

  test('shows Kill Switch section', async ({ page }) => {
    await expect(page.getByText(/Kill Switch/i).first()).toBeVisible({ timeout: 10000 });
  });

  test('shows Risk Configuration section', async ({ page }) => {
    await expect(page.getByText(/Risk Configuration|Risk Config/i).first()).toBeVisible({ timeout: 10000 });
  });

  test('shows System Configuration section', async ({ page }) => {
    await expect(page.getByText(/System Config/i).first()).toBeVisible({ timeout: 10000 });
  });

  test('system config table shows seeded config keys', async ({ page }) => {
    // Seed has 12 system configs
    await expect(page.getByText(/ai_model|trading_enabled|decision_cycle/i).first()).toBeVisible({ timeout: 10000 });
  });

  test('risk config form has editable numeric inputs', async ({ page }) => {
    const inputs = page.locator('input[type="number"]');
    await expect(inputs.first()).toBeVisible({ timeout: 10000 });
  });
});
