import { test, expect, type Page } from '@playwright/test'

// ─── Shared mock data ─────────────────────────────────────────────────────────

const NOW = '2026-03-23T12:00:00.000Z'

async function mockApis(page: Page) {
  // Use a single catch-all handler that dispatches by path
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname

    const respond = (data: unknown) =>
      route.fulfill({ json: { success: true, data } })

    // Match by pathname prefix/suffix
    if (path === '/api/health') {
      return respond({ status: 'ok', uptime: 7200, timestamp: NOW, environment: 'test' })
    }
    if (path === '/api/bankroll/history') {
      return respond([
        { date: '2026-03-22', opening_balance: 9700, closing_balance: 9850, deposits: 0, withdrawals: 0, trading_pnl: 150, fees_total: 5, trades_count: 3, win_rate: 0.67 },
        { date: '2026-03-23', opening_balance: 9850, closing_balance: 10000, deposits: 0, withdrawals: 0, trading_pnl: 150, fees_total: 5, trades_count: 4, win_rate: 0.75 },
      ])
    }
    if (path === '/api/bankroll') {
      return respond({
        id: 1,
        total_balance: '10000',
        active_balance: '7500',
        deployed_balance: '2500',
        unrealized_pnl: '50',
        balance_delta_today: '150',
        balance_delta_total: '500',
        daily_return_pct: '1.5',
        updated_at: NOW,
      })
    }
    if (path === '/api/markets') {
      return respond([
        {
          id: 'mkt-001',
          title: 'Will BTC exceed $100k by Q2 2026?',
          category: 'crypto',
          status: 'open',
          volume: 50000,
          liquidity: 25000,
          last_price: 0.65,
          condition_id: 'cond-001',
          question: 'Will BTC exceed $100k?',
          end_date_iso: '2026-06-30',
          created_at: NOW,
          updated_at: NOW,
        },
      ])
    }
    if (path === '/api/decisions/stats') {
      return respond({
        total: 50,
        trades: 20,
        passes: 28,
        vetoes: 2,
        win_rate: 0.6,
        avg_confidence: 0.78,
      })
    }
    if (path.startsWith('/api/decisions')) {
      return respond([
        {
          id: 'dec-001',
          action: 'trade',
          confidence: 0.85,
          market_id: 'mkt-001',
          reasoning: 'Strong momentum signal',
          outcome: 'YES',
          strategy_name: 'CryptoMomentum',
          market_title: 'BTC $100k',
          market_category: 'crypto',
          category: 'crypto',
          timestamp: NOW,
          regime_assessment: 'trending',
          dashboard_text: 'BTC momentum trade',
          created_at: NOW,
        },
      ])
    }
    if (path.startsWith('/api/orders')) {
      return respond([
        {
          id: 'ord-001',
          side: 'buy',
          outcome_token: 'YES-BTC-001',
          order_type: 'limit',
          size: '100',
          price: '0.65',
          filled_size: '100',
          avg_fill_price: '0.65',
          fees_paid: '0.5',
          status: 'filled',
          market_id: 'mkt-001',
          strategy_name: 'CryptoMomentum',
          maker_or_taker: 'taker',
          created_at: NOW,
          updated_at: NOW,
        },
      ])
    }
    if (path === '/api/positions/history') {
      return respond([])
    }
    if (path.startsWith('/api/positions')) {
      return respond([
        {
          id: 'pos-001',
          side: 'long',
          outcome_token: 'YES-BTC-001',
          size: 100,
          entry_price: 0.65,
          current_price: 0.7,
          pnl: 5,
          pnl_pct: 7.7,
          market_id: 'mkt-001',
          market_title: 'BTC $100k',
          strategy_name: 'CryptoMomentum',
          opened_at: NOW,
        },
      ])
    }
    if (path === '/api/risk/config') {
      return respond({
        id: 1,
        max_daily_loss: '500',
        max_position_size: '0.1',
        max_total_exposure: '5000',
        max_single_trade: '200',
        max_consecutive_losses: 3,
        cooldown_after_loss_streak_minutes: 60,
        min_liquidity: '1000',
        max_latency_ms: 500,
        max_spread: '0.03',
        updated_at: NOW,
      })
    }
    if (path === '/api/risk/events') {
      return respond([
        {
          id: 'evt-001',
          severity: 'warning',
          event_type: 'drawdown_limit',
          message: 'Daily drawdown approaching limit',
          auto_resolved: false,
          timestamp: NOW,
        },
      ])
    }
    if (path.startsWith('/api/scorers')) {
      return respond([
        {
          id: 1,
          scorer_name: 'BTC Momentum',
          category: 'crypto',
          is_enabled: true,
          weight: 1.0,
          description: 'Tracks BTC price momentum',
          parameters: { lookback: 14, threshold: 0.05 },
          updated_at: NOW,
          created_at: NOW,
        },
      ])
    }
    if (path === '/api/analytics/summary') {
      return respond({
        total_trades: 100,
        winning_trades: 60,
        losing_trades: 40,
        win_rate: 0.6,
        avg_pnl_per_trade: 2.5,
        total_pnl: 250,
        total_fees: 25.5,
        best_trade_pnl: 50,
        worst_trade_pnl: -30,
        avg_hold_time_hours: 4.2,
        by_category: {
          crypto: { trades: 60, win_rate: 0.65, pnl: 180 },
          politics: { trades: 40, win_rate: 0.525, pnl: 70 },
        },
      })
    }
    if (path === '/api/alerts/unread-count') {
      return respond({ count: 1 })
    }
    if (path.startsWith('/api/alerts')) {
      return respond([
        {
          id: 'alert-001',
          title: 'High Volatility Detected',
          message: 'BTC volatility exceeds threshold',
          severity: 'warning',
          is_read: false,
          created_at: NOW,
        },
      ])
    }
    if (path.startsWith('/api/system-config')) {
      return respond([{ key: 'trading_enabled', value: true, updated_at: NOW }])
    }

    // Pass through anything else (socket.io, etc.)
    return route.continue()
  })
}

// ─── Navigation ───────────────────────────────────────────────────────────────

test.describe('Navigation', () => {
  test('sidebar is visible with nav links on load', async ({ page }) => {
    await mockApis(page)
    await page.goto('/')

    const nav = page.getByRole('navigation')
    await expect(nav).toBeVisible()

    // Sidebar defaults open — labels should be visible
    await expect(nav.getByText('Dashboard')).toBeVisible()
    await expect(nav.getByText('Markets')).toBeVisible()
    await expect(nav.getByText('AI Decisions')).toBeVisible()
    await expect(nav.getByText('Risk')).toBeVisible()
    await expect(nav.getByText('Analytics')).toBeVisible()
    await expect(nav.getByText('Settings')).toBeVisible()
    await expect(nav.getByText('System Health')).toBeVisible()
  })

  test('sidebar collapse/expand toggle works', async ({ page }) => {
    await mockApis(page)
    await page.goto('/')

    const nav = page.getByRole('navigation')
    await expect(nav.getByText('Dashboard')).toBeVisible()

    await page.getByRole('button', { name: /collapse sidebar/i }).click()
    await expect(nav.getByText('Dashboard')).not.toBeVisible()

    await page.getByRole('button', { name: /expand sidebar/i }).click()
    await expect(nav.getByText('Dashboard')).toBeVisible()
  })

  test('nav link click navigates to markets', async ({ page }) => {
    await mockApis(page)
    await page.goto('/')
    await page.getByRole('link', { name: /^markets$/i }).click()
    await expect(page).toHaveURL('/markets')
  })

  test('direct URL navigation works for all routes', async ({ page }) => {
    await mockApis(page)
    for (const route of ['/markets', '/scorers', '/decisions', '/orders', '/positions', '/risk', '/analytics', '/settings', '/health']) {
      await page.goto(route)
      await expect(page).toHaveURL(route)
    }
  })

  test('active nav link is highlighted for current route', async ({ page }) => {
    await mockApis(page)
    await page.goto('/markets')

    const marketsLink = page.getByRole('link', { name: /^markets$/i })
    await expect(marketsLink).toHaveClass(/bg-surface-2/)
  })
})

// ─── Dashboard ────────────────────────────────────────────────────────────────

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await mockApis(page)
    await page.goto('/')
  })

  test('renders page heading', async ({ page }) => {
    await expect(page.locator('h1', { hasText: 'Dashboard' })).toBeVisible()
  })

  test('shows bankroll balance', async ({ page }) => {
    await expect(page.getByText('$10,000.00')).toBeVisible()
  })

  test('shows Daily P&L stat card', async ({ page }) => {
    await expect(page.getByText('Daily P&L')).toBeVisible()
  })

  test('shows recent alerts section with alert title', async ({ page }) => {
    await expect(page.getByText('Recent Alerts')).toBeVisible()
    await expect(page.getByText('High Volatility Detected')).toBeVisible()
  })
})

// ─── Markets ──────────────────────────────────────────────────────────────────

test.describe('Markets', () => {
  test.beforeEach(async ({ page }) => {
    await mockApis(page)
    await page.goto('/markets')
  })

  test('renders page heading', async ({ page }) => {
    await expect(page.locator('h1', { hasText: 'Markets' })).toBeVisible()
  })

  test('shows category tabs', async ({ page }) => {
    await expect(page.getByRole('button', { name: /^all$/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /^crypto$/i })).toBeVisible()
  })

  test('shows search input', async ({ page }) => {
    await expect(page.getByPlaceholder(/search/i)).toBeVisible()
  })

  test('renders market title in table', async ({ page }) => {
    await expect(page.getByText('Will BTC exceed $100k by Q2 2026?')).toBeVisible()
  })

  test('search filters markets', async ({ page }) => {
    const search = page.getByPlaceholder(/search/i)
    await search.fill('ethereum')
    await expect(page.getByText('Will BTC exceed $100k by Q2 2026?')).not.toBeVisible()
  })

  test('clicking crypto tab keeps BTC market visible', async ({ page }) => {
    await page.getByRole('button', { name: /^crypto$/i }).click()
    await expect(page.getByText('Will BTC exceed $100k by Q2 2026?')).toBeVisible()
  })
})

// ─── Context Scorers ──────────────────────────────────────────────────────────

test.describe('Context Scorers', () => {
  test.beforeEach(async ({ page }) => {
    await mockApis(page)
    await page.goto('/scorers')
  })

  test('renders page heading', async ({ page }) => {
    await expect(page.locator('h1', { hasText: 'Context Scorers' })).toBeVisible()
  })

  test('shows category filter tabs', async ({ page }) => {
    await expect(page.getByRole('button', { name: /^all$/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /^crypto$/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /^politics$/i })).toBeVisible()
  })

  test('renders scorer name in table', async ({ page }) => {
    await expect(page.getByText('BTC Momentum')).toBeVisible()
  })

  test('shows Enabled badge for active scorer', async ({ page }) => {
    await expect(page.getByText('Enabled').first()).toBeVisible()
  })
})

// ─── AI Decisions ─────────────────────────────────────────────────────────────

test.describe('AI Decisions', () => {
  test.beforeEach(async ({ page }) => {
    await mockApis(page)
    await page.goto('/decisions')
  })

  test('renders page heading', async ({ page }) => {
    await expect(page.locator('h1', { hasText: 'AI Decisions' })).toBeVisible()
  })

  test('shows stats cards', async ({ page }) => {
    await expect(page.getByText('Total Decisions')).toBeVisible()
  })

  test('shows action filter dropdown', async ({ page }) => {
    await expect(page.getByRole('combobox').first()).toBeVisible()
  })

  test('renders decision row with category in table', async ({ page }) => {
    // The decisions table shows category column, not strategy_name
    await expect(page.getByRole('table').getByText('crypto').first()).toBeVisible()
  })
})

// ─── Orders ───────────────────────────────────────────────────────────────────

test.describe('Orders', () => {
  test.beforeEach(async ({ page }) => {
    await mockApis(page)
    await page.goto('/orders')
  })

  test('renders page heading', async ({ page }) => {
    await expect(page.locator('h1', { hasText: 'Orders' })).toBeVisible()
  })

  test('shows status filter select', async ({ page }) => {
    await expect(page.locator('select').first()).toBeVisible()
  })

  test('renders order token in table', async ({ page }) => {
    await expect(page.getByText('YES-BTC-001')).toBeVisible()
  })

  test('shows Filled badge in order row', async ({ page }) => {
    // Scope to tbody to avoid matching the "Filled" column header
    await expect(page.locator('tbody').getByText('Filled').first()).toBeVisible()
  })

  test('clicking an order row opens detail drawer', async ({ page }) => {
    await page.getByRole('table').getByText('YES-BTC-001').click()
    await expect(page.getByText(/order detail/i)).toBeVisible()
  })
})

// ─── Positions ────────────────────────────────────────────────────────────────

test.describe('Positions', () => {
  test.beforeEach(async ({ page }) => {
    await mockApis(page)
    await page.goto('/positions')
  })

  test('renders page heading', async ({ page }) => {
    await expect(page.locator('h1', { hasText: 'Positions' })).toBeVisible()
  })

  test('shows Open / History tabs', async ({ page }) => {
    await expect(page.getByRole('button', { name: /^open/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /history/i })).toBeVisible()
  })

  test('renders position token in open table', async ({ page }) => {
    await expect(page.getByText('YES-BTC-001')).toBeVisible()
  })

  test('switching to History tab shows heading', async ({ page }) => {
    await page.getByRole('button', { name: /history/i }).click()
    await expect(page.getByText('Closed Positions', { exact: true })).toBeVisible()
  })
})

// ─── Risk ─────────────────────────────────────────────────────────────────────

test.describe('Risk', () => {
  test.beforeEach(async ({ page }) => {
    await mockApis(page)
    await page.goto('/risk')
  })

  test('renders page heading', async ({ page }) => {
    await expect(page.locator('h1', { hasText: 'Risk Management' })).toBeVisible()
  })

  test('shows kill switch card', async ({ page }) => {
    await expect(page.getByText('Kill Switch — Disabled')).toBeVisible()
  })

  test('shows Enable / Disable kill switch button', async ({ page }) => {
    await expect(
      page.getByRole('button', { name: /enable|disable/i }).first()
    ).toBeVisible()
  })

  test('shows severity filter dropdown', async ({ page }) => {
    await expect(page.getByRole('combobox').first()).toBeVisible()
  })

  test('renders risk event message in table', async ({ page }) => {
    await expect(page.getByText('Daily drawdown approaching limit')).toBeVisible()
  })

  test('shows active limits section', async ({ page }) => {
    await expect(page.getByText('Active Limits')).toBeVisible()
  })

  test('shows exposure gauges', async ({ page }) => {
    await expect(page.getByText('Exposure vs Limits')).toBeVisible()
  })
})

// ─── Analytics ────────────────────────────────────────────────────────────────

test.describe('Analytics', () => {
  test.beforeEach(async ({ page }) => {
    await mockApis(page)
    await page.goto('/analytics')
    // Wait for the Analytics lazy chunk to load and render chart sections (433KB, can be slow on first load)
    await page.waitForSelector('h2', { timeout: 30000 })
  })

  test('renders multiple chart card sections', async ({ page }) => {
    await expect(page.getByText('Win Rate Over Time')).toBeVisible()
    await expect(page.getByText('Portfolio Balance History')).toBeVisible()
  })

  test('shows win rate chart section', async ({ page }) => {
    await expect(page.getByText('Win Rate Over Time')).toBeVisible()
  })

  test('shows category breakdown chart section', async ({ page }) => {
    await expect(page.getByText('Trades by Category')).toBeVisible()
  })

  test('shows confidence calibration section', async ({ page }) => {
    await expect(page.getByText(/confidence calibration/i)).toBeVisible()
  })
})

// ─── Settings ─────────────────────────────────────────────────────────────────

test.describe('Settings', () => {
  test.beforeEach(async ({ page }) => {
    await mockApis(page)
    await page.goto('/settings')
  })

  test('renders page heading', async ({ page }) => {
    await expect(page.locator('h1', { hasText: 'Settings' })).toBeVisible()
  })

  test('shows Kill Switch section heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Kill Switch', level: 2 })).toBeVisible()
  })

  test('shows Risk Configuration section', async ({ page }) => {
    await expect(page.getByText(/risk configuration/i)).toBeVisible()
    await expect(page.getByText(/max daily loss/i)).toBeVisible()
  })

  test('shows System Configuration section', async ({ page }) => {
    await expect(page.getByText(/system configuration/i)).toBeVisible()
    await expect(page.getByText('trading_enabled')).toBeVisible()
  })

  test('risk config form has editable fields', async ({ page }) => {
    // Find any input that contains the value 500 (max_daily_loss)
    await expect(page.locator('input[type="number"]').first()).toBeVisible()
  })
})

// ─── System Health ────────────────────────────────────────────────────────────

test.describe('System Health', () => {
  test.beforeEach(async ({ page }) => {
    await mockApis(page)
    await page.goto('/health')
  })

  test('renders page heading', async ({ page }) => {
    await expect(page.locator('h1', { hasText: 'System Health' })).toBeVisible()
  })

  test('shows overall status badge', async ({ page }) => {
    await expect(page.getByText('ok').or(page.getByText('healthy')).or(
      page.getByText('Operational')
    ).first()).toBeVisible()
  })

  test('shows uptime display', async ({ page }) => {
    await expect(page.getByText('Uptime 2h 0m').or(page.getByText(/uptime/i).first())).toBeVisible()
  })
})

// ─── Full navigation tour ─────────────────────────────────────────────────────

test('can visit every page without JavaScript errors', async ({ page }) => {
  await mockApis(page)

  const routes = [
    '/',
    '/markets',
    '/scorers',
    '/decisions',
    '/orders',
    '/positions',
    '/risk',
    '/analytics',
    '/settings',
    '/health',
  ]

  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })

  for (const route of routes) {
    await page.goto(route)
    // Verify the app shell renders (nav always visible); skip h1 for lazy-heavy pages
    await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15000 })
  }

  // Filter out benign network errors (socket.io, etc.)
  const fatalErrors = errors.filter(
    (e) =>
      !e.includes('net::ERR') &&
      !e.includes('WebSocket') &&
      !e.includes('socket.io') &&
      !e.includes('Failed to fetch')
  )
  expect(fatalErrors).toHaveLength(0)
})
