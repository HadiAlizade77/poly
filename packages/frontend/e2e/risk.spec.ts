import { test, expect } from '@playwright/test';

test.describe('Risk', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/risk');
    await expect(page.getByRole('heading', { name: 'Risk Management' })).toBeVisible({ timeout: 10000 });
  });

  test('shows page heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Risk Management' })).toBeVisible();
  });

  test('shows Kill Switch card with status text', async ({ page }) => {
    // Kill Switch renders "Kill Switch — ENABLED" or "Kill Switch — Disabled" in a <p>
    await expect(page.getByText(/Kill Switch/i).first()).toBeVisible({ timeout: 10000 });
  });

  test('Kill Switch shows Enable or Disable button', async ({ page }) => {
    // Button text is "Enable" or "Disable" (short form, not "Enable Kill Switch")
    await expect(
      page.getByRole('button', { name: /^Enable$|^Disable$/ })
    ).toBeVisible({ timeout: 10000 });
  });

  test('shows risk config values from seed data', async ({ page }) => {
    await expect(page.getByText(/Daily Loss|max.*loss|exposure|Active Limits/i).first()).toBeVisible({ timeout: 10000 });
  });

  test('shows exposure section', async ({ page }) => {
    await expect(page.getByText(/Exposure|exposure/i).first()).toBeVisible({ timeout: 10000 });
  });

  test('shows severity filter for risk events', async ({ page }) => {
    await expect(page.locator('select').first()).toBeVisible({ timeout: 10000 });
  });
});
