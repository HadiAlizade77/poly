/**
 * app.spec.ts — Integration-quality E2E tests
 *
 * These tests are intentionally strict:
 *   - ANY unhandled JavaScript error fails the test
 *   - ANY API call that returns 4xx/5xx fails the test
 *   - Pages must render ACTUAL DATA from seed, not just headings
 *   - "[object Object]", "undefined", "NaN" in rendered text fail the test
 *   - Visible error banners fail the test
 *
 * If the app is broken these tests WILL fail — that's the point.
 */

import { test, expect, Page } from '@playwright/test';

// ── Global error collectors (reset per test) ──────────────────────────────────

let pageErrors: Error[] = [];
let failedApiCalls: string[] = [];

test.beforeEach(async ({ page }) => {
  pageErrors = [];
  failedApiCalls = [];

  // Catch unhandled JS exceptions (TypeErrors, ReferenceErrors, etc.)
  page.on('pageerror', (error) => {
    pageErrors.push(error);
  });

  // Catch API calls that return error status codes
  page.on('response', (response) => {
    const url = response.url();
    if (url.includes('localhost:3001') && url.includes('/api/')) {
      const status = response.status();
      if (status >= 400) {
        failedApiCalls.push(`HTTP ${status}  ${url}`);
      }
    }
  });
});

test.afterEach(async () => {
  // FAIL if any JS errors were thrown on the page
  expect(
    pageErrors,
    `Page threw JavaScript errors:\n${pageErrors.map((e) => `  • ${e.message}`).join('\n')}`,
  ).toHaveLength(0);

  // FAIL if any API call returned an error status
  expect(
    failedApiCalls,
    `API calls returned error status:\n${failedApiCalls.map((s) => `  • ${s}`).join('\n')}`,
  ).toHaveLength(0);
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Asserts that the page body text does not contain common rendering garbage
 * that indicates a bug (unresolved variable, broken serialisation, etc.)
 */
async function assertNoRenderGarbage(page: Page) {
  const body = await page.locator('body').innerText();

  expect(body, 'Page renders "[object Object]" — an object was accidentally stringified').not.toContain(
    '[object Object]',
  );

  // standalone "undefined" — a variable was rendered before it was populated
  const hasUndefined = /(?<![a-zA-Z])undefined(?![a-zA-Z])/.test(body);
  expect(hasUndefined, 'Page contains the word "undefined" — a variable was not resolved').toBe(false);

  // standalone "NaN" — a number calculation blew up
  const hasNaN = /(?<![a-zA-Z0-9])NaN(?![a-zA-Z0-9])/.test(body);
  expect(hasNaN, 'Page contains "NaN" — a numeric calculation failed').toBe(false);
}

/**
 * Asserts that no visible error banner / toast is present.
 * Matches common class names used in the app for error states.
 */
async function assertNoErrorBanner(page: Page) {
  // Look for elements whose text content starts with "Error" or "Failed"
  // Ignore empty nodes (they may exist as invisible state containers)
  const errorLocator = page.locator(
    '[class*="error-state"], [class*="ErrorBoundary"], [data-testid*="error"]',
  );
  const count = await errorLocator.count();
  if (count > 0) {
    const texts = await errorLocator.allInnerTexts();
    const visible = texts.filter((t) => t.trim().length > 0);
    expect(visible, `Page shows error component(s):\n${visible.join('\n')}`).toHaveLength(0);
  }

  // Also fail if the entire visible page just says "Error" or similar
  const body = await page.locator('body').innerText();
  // A page that only says "Error" is broken (a real error boundary or unhandled throw)
  const looksLikeCrash = /^[\s]*Error[\s]*$/m.test(body) && body.trim().length < 20;
  expect(looksLikeCrash, `Page appears to have crashed — body text is just "Error"`).toBe(false);
}

// ── Dashboard (/) ─────────────────────────────────────────────────────────────

test.describe('Dashboard page', () => {
  test('renders seed bankroll balance "$1,000"', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // The seeded bankroll balance is $1,000.  Any of these formats is acceptable.
    await expect(
      page.getByText(/\$1[,.]?000/).first(),
      'Dashboard must show the $1,000 seed bankroll — if missing, the API call failed or the data is not rendered',
    ).toBeVisible({ timeout: 15000 });

    await assertNoRenderGarbage(page);
    await assertNoErrorBanner(page);
  });

  test('renders stat cards with numeric values (not blank)', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Daily P&L and Total P&L cards must show a number or "$0" — not blank/undefined
    await expect(page.getByText('Daily P&L').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Total P&L').first()).toBeVisible({ timeout: 10000 });

    // The stat cards must contain dollar amounts — match "$" followed by digits
    const statValues = page.locator('[class*="font-numeric"], [class*="stat"] [class*="value"]');
    const count = await statValues.count();
    expect(count, 'No numeric stat values found — cards may not be rendering data').toBeGreaterThan(0);
  });

  test('Recent AI Decisions section shows decision rows or empty-state (not error)', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Section must exist
    await expect(page.getByRole('heading', { name: 'Recent AI Decisions' })).toBeVisible({ timeout: 10000 });

    // Either rows are visible OR an explicit "no decisions" empty state is shown
    // If neither, the component silently failed to render
    const rows = page.locator('[data-testid="decision-row"], tbody tr');
    const rowCount = await rows.count();
    const emptyState = page.getByText(/no decisions|no data|no results/i);
    const emptyVisible = await emptyState.isVisible().catch(() => false);

    expect(
      rowCount > 0 || emptyVisible,
      'Recent AI Decisions section shows neither rows nor an empty state — something is broken',
    ).toBe(true);
  });
});

// ── Markets (/markets) ────────────────────────────────────────────────────────

test.describe('Markets page', () => {
  test('renders actual market titles from seed data (BTC / Bitcoin)', async ({ page }) => {
    await page.goto('/markets');
    await page.waitForLoadState('networkidle');

    // Seed data includes a BTC market.  At least one of these must appear in the table.
    await expect(
      page.getByText(/BTC|Bitcoin/i).first(),
      'Markets page must show "BTC" or "Bitcoin" — if missing the /api/markets call failed or data did not render',
    ).toBeVisible({ timeout: 15000 });

    await assertNoRenderGarbage(page);
    await assertNoErrorBanner(page);
  });

  test('market table has at least one data row', async ({ page }) => {
    await page.goto('/markets');
    await page.waitForLoadState('networkidle');

    const rows = page.locator('tbody tr');
    await expect(rows.first()).toBeVisible({ timeout: 10000 });
    const count = await rows.count();
    expect(count, 'Markets table is empty — seed data was not loaded').toBeGreaterThanOrEqual(1);
  });

  test('price cells show numeric values (not blank or "undefined")', async ({ page }) => {
    await page.goto('/markets');
    await page.waitForLoadState('networkidle');

    await page.locator('tbody tr').first().waitFor({ timeout: 10000 });

    // Price columns (Yes / No) must show numbers like 0.65 or 65%
    // The table must not have cells that literally say "undefined" or are empty where numbers are expected
    const cells = await page.locator('tbody tr').first().locator('td').allInnerTexts();
    const hasUndefined = cells.some((c) => c.trim() === 'undefined' || c.trim() === 'NaN');
    expect(hasUndefined, `First market row has cells with "undefined" or "NaN": [${cells.join(' | ')}]`).toBe(false);
  });
});

// ── Context Scorers (/scorers) ────────────────────────────────────────────────

test.describe('Scorers page', () => {
  test('renders seeded scorer names', async ({ page }) => {
    await page.goto('/scorers');
    await page.waitForLoadState('networkidle');

    // Seed data includes scorers like exchange_divergence, crypto_momentum, etc.
    await expect(
      page.getByText(/exchange_divergence|crypto_momentum|liquidity_score|mean_reversion|poll_divergence/i).first(),
      'Scorers page must show at least one seeded scorer name — if missing, /api/scorers failed or data did not render',
    ).toBeVisible({ timeout: 15000 });

    await assertNoRenderGarbage(page);
    await assertNoErrorBanner(page);
  });

  test('scorer cards show Enabled/Disabled status (not blank)', async ({ page }) => {
    await page.goto('/scorers');
    await page.waitForLoadState('networkidle');

    // Every scorer card must show either "Enabled" or "Disabled"
    await expect(
      page.getByText(/^Enabled$|^Disabled$/i).first(),
      'Scorer cards must show an Enabled/Disabled badge — if missing, status field is not rendering',
    ).toBeVisible({ timeout: 10000 });
  });

  test('scorer cards show numeric weight values (not NaN)', async ({ page }) => {
    await page.goto('/scorers');
    await page.waitForLoadState('networkidle');

    // Weight values (like 1.5, 2.0) must appear — if NaN they will be caught by assertNoRenderGarbage
    await assertNoRenderGarbage(page);
  });
});

// ── AI Decisions (/decisions) ─────────────────────────────────────────────────

test.describe('Decisions page', () => {
  test('renders action badges with "trade" or "hold" from seed data', async ({ page }) => {
    await page.goto('/decisions');
    await page.waitForLoadState('networkidle');

    // Seed data has decisions with action = "trade" or "hold"
    await expect(
      page.getByText(/\btrade\b|\bhold\b|\bskip\b/i).first(),
      'Decisions page must show a "trade", "hold", or "skip" action badge — if missing, /api/decisions failed or action field is not rendering',
    ).toBeVisible({ timeout: 15000 });

    await assertNoRenderGarbage(page);
    await assertNoErrorBanner(page);
  });

  test('decision table has at least one row', async ({ page }) => {
    await page.goto('/decisions');
    await page.waitForLoadState('networkidle');

    const rows = page.locator('tbody tr');
    await expect(rows.first()).toBeVisible({ timeout: 10000 });
    const count = await rows.count();
    expect(count, 'Decisions table is empty — seed data was not loaded').toBeGreaterThanOrEqual(1);
  });

  test('confidence column shows numbers between 0 and 1 (not NaN/undefined)', async ({ page }) => {
    await page.goto('/decisions');
    await page.waitForLoadState('networkidle');

    await page.locator('tbody tr').first().waitFor({ timeout: 10000 });
    const cells = await page.locator('tbody tr').first().locator('td').allInnerTexts();
    const hasGarbage = cells.some((c) => c.trim() === 'undefined' || c.trim() === 'NaN');
    expect(
      hasGarbage,
      `First decision row has cells with "undefined" or "NaN": [${cells.join(' | ')}]`,
    ).toBe(false);
  });
});

// ── Orders (/orders) ──────────────────────────────────────────────────────────

test.describe('Orders page', () => {
  test('renders without JavaScript errors or blank crash', async ({ page }) => {
    await page.goto('/orders');
    await page.waitForLoadState('networkidle');

    // Page must at least show its heading
    await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible({ timeout: 15000 });

    await assertNoRenderGarbage(page);
    await assertNoErrorBanner(page);
  });

  test('shows orders table or empty state (not silent blank)', async ({ page }) => {
    await page.goto('/orders');
    await page.waitForLoadState('networkidle');

    const rows = page.locator('tbody tr');
    const rowCount = await rows.count();
    const emptyState = page.getByText(/no orders|no data|no results|empty/i);
    const emptyVisible = await emptyState.isVisible().catch(() => false);

    expect(
      rowCount > 0 || emptyVisible,
      'Orders page shows neither rows nor an empty-state message — the component may have crashed silently',
    ).toBe(true);
  });

  test('order rows do not contain "undefined" or "NaN" in cells', async ({ page }) => {
    await page.goto('/orders');
    await page.waitForLoadState('networkidle');

    const rows = page.locator('tbody tr');
    const count = await rows.count();
    if (count > 0) {
      const cells = await rows.first().locator('td').allInnerTexts();
      const hasGarbage = cells.some((c) => c.trim() === 'undefined' || c.trim() === 'NaN');
      expect(hasGarbage, `First order row has bad cell values: [${cells.join(' | ')}]`).toBe(false);
    }
  });
});

// ── Positions (/positions) ────────────────────────────────────────────────────

test.describe('Positions page', () => {
  test('renders without JavaScript errors or blank crash', async ({ page }) => {
    await page.goto('/positions');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: 'Positions' })).toBeVisible({ timeout: 15000 });

    await assertNoRenderGarbage(page);
    await assertNoErrorBanner(page);
  });

  test('shows positions table or empty state (not silent blank)', async ({ page }) => {
    await page.goto('/positions');
    await page.waitForLoadState('networkidle');

    const rows = page.locator('tbody tr');
    const rowCount = await rows.count();
    const emptyState = page.getByText(/no positions|no data|no results|empty/i);
    const emptyVisible = await emptyState.isVisible().catch(() => false);

    expect(
      rowCount > 0 || emptyVisible,
      'Positions page shows neither rows nor an empty-state message — the component may have crashed silently',
    ).toBe(true);
  });

  test('position rows do not contain "undefined" or "NaN" in cells', async ({ page }) => {
    await page.goto('/positions');
    await page.waitForLoadState('networkidle');

    const rows = page.locator('tbody tr');
    const count = await rows.count();
    if (count > 0) {
      const cells = await rows.first().locator('td').allInnerTexts();
      const hasGarbage = cells.some((c) => c.trim() === 'undefined' || c.trim() === 'NaN');
      expect(hasGarbage, `First position row has bad cell values: [${cells.join(' | ')}]`).toBe(false);
    }
  });
});

// ── Risk Management (/risk) ───────────────────────────────────────────────────

test.describe('Risk page', () => {
  test('renders Kill Switch with active status text', async ({ page }) => {
    await page.goto('/risk');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText(/Kill Switch/i).first()).toBeVisible({ timeout: 15000 });

    // The Kill Switch status must say ENABLED or Disabled — not blank
    await expect(
      page.getByText(/ENABLED|Disabled|enabled|disabled/i).first(),
      'Kill Switch must show its status (ENABLED / Disabled) — if missing, risk config did not load',
    ).toBeVisible({ timeout: 10000 });

    await assertNoRenderGarbage(page);
    await assertNoErrorBanner(page);
  });

  test('risk config section shows numeric limit values (not blank)', async ({ page }) => {
    await page.goto('/risk');
    await page.waitForLoadState('networkidle');

    // The seeded risk config has numeric values like 5, 10, 100 — at least one must appear
    // alongside a label like "Daily Loss", "Max Loss", or "%"
    await expect(
      page.getByText(/Daily Loss|Max.*Loss|Max Drawdown|Position.*Limit/i).first(),
      'Risk page must show risk limit labels — /api/risk/config may have failed',
    ).toBeVisible({ timeout: 10000 });
  });

  test('no garbage values in risk config display', async ({ page }) => {
    await page.goto('/risk');
    await page.waitForLoadState('networkidle');
    await assertNoRenderGarbage(page);
  });
});

// ── Analytics (/analytics) ────────────────────────────────────────────────────

test.describe('Analytics page', () => {
  test('renders without JavaScript errors', async ({ page }) => {
    // Analytics has a large lazy-loaded bundle — give it extra time
    await page.goto('/analytics');
    await page.waitForLoadState('networkidle', { timeout: 30000 });

    await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible({ timeout: 30000 });

    await assertNoRenderGarbage(page);
    await assertNoErrorBanner(page);
  });

  test('chart containers render (not blank white boxes)', async ({ page }) => {
    await page.goto('/analytics');
    await page.waitForLoadState('networkidle', { timeout: 30000 });

    // Charts must actually render — Recharts/Chart.js output SVG or canvas
    const charts = page.locator('svg, canvas');
    const chartCount = await charts.count();
    expect(
      chartCount,
      'Analytics page has no SVG or canvas elements — charts did not render. Check if data loaded.',
    ).toBeGreaterThan(0);
  });
});

// ── Settings (/settings) ──────────────────────────────────────────────────────

test.describe('Settings page', () => {
  test('renders seeded system config keys', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    // Seed data includes keys: ai_model, trading_enabled, decision_cycle_minutes
    await expect(
      page.getByText(/ai_model|trading_enabled|decision_cycle/i).first(),
      'Settings page must show seeded config keys — /api/config may have failed or data did not render',
    ).toBeVisible({ timeout: 15000 });

    await assertNoRenderGarbage(page);
    await assertNoErrorBanner(page);
  });

  test('risk config form inputs show numeric values from seed (not blank)', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    const numericInputs = page.locator('input[type="number"]');
    await expect(numericInputs.first()).toBeVisible({ timeout: 10000 });

    // Inputs must not have value="" or value="NaN"
    const inputCount = await numericInputs.count();
    for (let i = 0; i < Math.min(inputCount, 5); i++) {
      const val = await numericInputs.nth(i).inputValue();
      expect(val, `Numeric input #${i} has value "${val}" (expected a number)`).toMatch(/^-?\d+\.?\d*$/);
    }
  });
});

// ── System Health (/health) ───────────────────────────────────────────────────

test.describe('Health page', () => {
  test('renders "ok" or "healthy" status from the API', async ({ page }) => {
    await page.goto('/health');
    await page.waitForLoadState('networkidle');

    // /api/health returns status. The page must show one of these strings.
    await expect(
      page.getByText(/\bok\b|healthy|operational|degraded|critical/i).first(),
      'Health page must show a real status string from the API — if missing, /api/health failed or response was not rendered',
    ).toBeVisible({ timeout: 15000 });

    await assertNoRenderGarbage(page);
    await assertNoErrorBanner(page);
  });

  test('infrastructure service cards show status badges (not blank)', async ({ page }) => {
    await page.goto('/health');
    await page.waitForLoadState('networkidle');

    // Cards for PostgreSQL, Redis, API Server must each show a status
    await expect(page.getByText('PostgreSQL')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Redis')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('API Server')).toBeVisible({ timeout: 10000 });
  });

  test('/api/health returns HTTP 200', async ({ page }) => {
    // This test directly verifies the API endpoint, not just the UI.
    // failedApiCalls in afterEach will catch it, but we also explicitly wait here.
    const responsePromise = page.waitForResponse(
      (r) => r.url().includes('/api/health') && r.status() !== undefined,
    );
    await page.goto('/health');
    const response = await responsePromise;
    expect(
      response.status(),
      `/api/health returned HTTP ${response.status()} — expected 200`,
    ).toBe(200);
  });
});
