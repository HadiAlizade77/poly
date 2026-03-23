import { test, expect } from '@playwright/test';

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 10000 });
  });

  test('shows page heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });

  test('shows Total Balance stat card with bankroll value', async ({ page }) => {
    // Seed data: bankroll $1,000 — label renders in a <p> with uppercase CSS
    await expect(page.getByText('Total Balance').first()).toBeVisible({ timeout: 10000 });
    // Balance value rendered in a font-numeric span
    await expect(page.locator('[class*="font-numeric"]').filter({ hasText: /\$1[,.]?0{3}/ }).first()).toBeVisible({ timeout: 10000 });
  });

  test('shows Daily P&L stat card', async ({ page }) => {
    await expect(page.getByText('Daily P&L').first()).toBeVisible({ timeout: 10000 });
  });

  test('shows Total P&L stat card', async ({ page }) => {
    await expect(page.getByText('Total P&L').first()).toBeVisible({ timeout: 10000 });
  });

  test('shows Open Positions stat card', async ({ page }) => {
    await expect(page.getByText('Open Positions').first()).toBeVisible({ timeout: 10000 });
  });

  test('shows Recent AI Decisions section heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Recent AI Decisions' })).toBeVisible({ timeout: 10000 });
  });

  test('shows Recent Alerts section heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Recent Alerts' })).toBeVisible({ timeout: 10000 });
  });

  test('shows System Health status', async ({ page }) => {
    await expect(page.getByText(/System Health|systems operational|status/i).first()).toBeVisible({ timeout: 10000 });
  });
});
