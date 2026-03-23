import { test, expect } from '@playwright/test';

test.describe('System Health', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/health');
    await expect(page.getByRole('heading', { name: 'System Health' })).toBeVisible({ timeout: 10000 });
  });

  test('shows page heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'System Health' })).toBeVisible();
  });

  test('shows overall system status text', async ({ page }) => {
    // Health page renders "All systems operational" / "System degraded" / "Critical — system errors detected"
    await expect(
      page.getByText(/systems operational|system degraded|critical.*errors/i).first()
    ).toBeVisible({ timeout: 10000 });
  });

  test('shows PostgreSQL Database card', async ({ page }) => {
    await expect(page.getByText('PostgreSQL')).toBeVisible({ timeout: 10000 });
  });

  test('shows Redis card', async ({ page }) => {
    await expect(page.getByText('Redis')).toBeVisible({ timeout: 10000 });
  });

  test('shows uptime display', async ({ page }) => {
    await expect(page.getByText(/uptime/i).first()).toBeVisible({ timeout: 10000 });
  });

  test('shows infrastructure service cards', async ({ page }) => {
    // InfraCards include PostgreSQL, Redis, WebSocket, API Server
    await expect(page.getByText('API Server')).toBeVisible({ timeout: 10000 });
  });
});
