/**
 * E2E: Comprehensive API Coverage
 *
 * Hits every single API endpoint, verifying:
 *   - Response shape { success, data, meta? }
 *   - Status codes
 *   - Basic field presence
 *
 * Each describe block covers one endpoint family.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../integration/setup.js';
import { cleanDatabase, prisma } from '../integration/db/db-helpers.js';

const app = createTestApp();
const uid = () => Math.random().toString(36).slice(2, 9);

// Seeded state available across all describe blocks
let marketId: string;
let orderId: string;
let positionId: string;
let alertId: string;
let scorerConfigId: string;
let decisionId: string; // stringified BigInt
let riskEventId: string; // stringified BigInt

beforeAll(async () => {
  await cleanDatabase();

  // ── Market ──────────────────────────────────────────────────────────────────
  const market = await prisma.market.create({
    data: {
      polymarket_id: `e2e-comp-${uid()}`,
      title: 'Will ETH hit $5k in 2025?',
      category: 'crypto',
      outcomes: [{ name: 'Yes', token_id: `yes-${uid()}` }, { name: 'No', token_id: `no-${uid()}` }],
      current_prices: { Yes: 0.55, No: 0.45 },
      liquidity: '200000',
    },
  });
  marketId = market.id;

  // ── AI Decision ─────────────────────────────────────────────────────────────
  const decision = await prisma.aiDecision.create({
    data: {
      market_id: marketId,
      category: 'crypto',
      action: 'trade',
      direction: 'buy',
      outcome_token: 'YES',
      confidence: 0.65,
      reasoning: 'ETH bullish signal.',
      dashboard_text: 'E2E comprehensive test decision',
      account_state: {},
    },
  });
  decisionId = decision.id.toString();

  // ── Order ───────────────────────────────────────────────────────────────────
  const order = await prisma.order.create({
    data: {
      market_id: marketId,
      decision_id: decision.id,
      side: 'buy',
      outcome_token: `yes-${uid()}`,
      order_type: 'limit',
      price: 0.55,
      size: 50,
    },
  });
  orderId = order.id;

  // ── Position ─────────────────────────────────────────────────────────────────
  const position = await prisma.position.create({
    data: {
      market_id: marketId,
      decision_id: decision.id,
      outcome_token: order.outcome_token,
      side: 'long',
      size: 50,
      avg_entry_price: 0.55,
    },
  });
  positionId = position.id;

  // ── Alert ───────────────────────────────────────────────────────────────────
  const alert = await prisma.alert.create({
    data: {
      alert_type: 'system',
      severity: 'info',
      title: 'E2E Comprehensive Alert',
      message: 'Test alert for comprehensive E2E tests',
    },
  });
  alertId = alert.id.toString();

  // ── Scorer Config ────────────────────────────────────────────────────────────
  const scorer = await prisma.scorerConfig.create({
    data: {
      category: 'crypto',
      scorer_name: 'e2e-test-scorer',
      parameters: { window: 20 },
      is_enabled: true,
    },
  });
  scorerConfigId = scorer.id;

  // ── Risk Event ───────────────────────────────────────────────────────────────
  const riskEvent = await prisma.riskEvent.create({
    data: {
      event_type: 'drawdown_limit',
      severity: 'warning',
      market_id: marketId,
      details: { drawdown: -5.2 },
      message: 'Daily drawdown limit approached',
    },
  });
  riskEventId = riskEvent.id.toString();
});

afterAll(async () => {
  await prisma.$disconnect();
});

// ─── Auth ─────────────────────────────────────────────────────────────────────

describe('POST /api/auth/login', () => {
  it('returns 200 with JWT token for valid password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ password: 'changeme' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.token).toBeTruthy();
    expect(res.body.data.expiresIn).toBe('24h');
  });

  it('returns 401 for invalid password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ password: 'wrongpassword' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 400 when password is missing', async () => {
    const res = await request(app).post('/api/auth/login').send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

// ─── Markets ──────────────────────────────────────────────────────────────────

describe('GET /api/markets', () => {
  it('returns 200 with paginated list', async () => {
    const res = await request(app).get('/api/markets');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta.total).toBeGreaterThanOrEqual(1);
  });

  it('filters by category=crypto', async () => {
    const res = await request(app).get('/api/markets?category=crypto');
    expect(res.status).toBe(200);
    expect(res.body.data.every((m: { category: string }) => m.category === 'crypto')).toBe(true);
  });

  it('filters by status=active', async () => {
    const res = await request(app).get('/api/markets?status=active');
    expect(res.status).toBe(200);
    expect(res.body.data.every((m: { status: string }) => m.status === 'active')).toBe(true);
  });

  it('respects pageSize', async () => {
    const res = await request(app).get('/api/markets?pageSize=1');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeLessThanOrEqual(1);
  });

  it('searches by title keyword', async () => {
    const res = await request(app).get('/api/markets?search=ETH');
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBeGreaterThanOrEqual(1);
  });
});

describe('GET /api/markets/:id', () => {
  it('returns market by id', async () => {
    const res = await request(app).get(`/api/markets/${marketId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(marketId);
  });

  it('returns 404 for unknown id', async () => {
    const res = await request(app).get('/api/markets/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('POST /api/markets', () => {
  it('creates market with 201', async () => {
    const pmId = `e2e-comp-post-${uid()}`;
    const res = await request(app).post('/api/markets').send({
      polymarket_id: pmId,
      title: 'New E2E Market',
      category: 'politics',
      outcomes: { Yes: true, No: true },
    });
    expect(res.status).toBe(201);
    expect(res.body.data.polymarket_id).toBe(pmId);
  });

  it('returns 409 on duplicate polymarket_id', async () => {
    const pmId = `e2e-dup-${uid()}`;
    await request(app).post('/api/markets').send({
      polymarket_id: pmId,
      title: 'Dup Market',
      category: 'crypto',
      outcomes: { Yes: true },
    });
    const res = await request(app).post('/api/markets').send({
      polymarket_id: pmId,
      title: 'Dup Market',
      category: 'crypto',
      outcomes: { Yes: true },
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });
});

describe('PUT /api/markets/:id', () => {
  it('updates market fields', async () => {
    const res = await request(app)
      .put(`/api/markets/${marketId}`)
      .send({ volume_24h: '200000', current_prices: { Yes: 0.60, No: 0.40 } });
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(marketId);
  });
});

describe('PATCH /api/markets/:id/status', () => {
  it('updates market status', async () => {
    const res = await request(app)
      .patch(`/api/markets/${marketId}/status`)
      .send({ status: 'paused' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('paused');
  });

  it('restores active status', async () => {
    const res = await request(app)
      .patch(`/api/markets/${marketId}/status`)
      .send({ status: 'active' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('active');
  });
});

// ─── Scorers ──────────────────────────────────────────────────────────────────

describe('GET /api/scorers', () => {
  it('returns 200 with scorer list', async () => {
    const res = await request(app).get('/api/scorers');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta.total).toBeGreaterThanOrEqual(1);
  });

  it('filters by category=crypto', async () => {
    const res = await request(app).get('/api/scorers?category=crypto');
    expect(res.status).toBe(200);
    expect(res.body.data.every((s: { category: string }) => s.category === 'crypto')).toBe(true);
  });

  it('filters by enabled=true', async () => {
    const res = await request(app).get('/api/scorers?enabled=true');
    expect(res.status).toBe(200);
    expect(res.body.data.every((s: { is_enabled: boolean }) => s.is_enabled === true)).toBe(true);
  });
});

describe('GET /api/scorers/:id', () => {
  it('returns scorer by id', async () => {
    const res = await request(app).get(`/api/scorers/${scorerConfigId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(scorerConfigId);
    expect(res.body.data.scorer_name).toBe('e2e-test-scorer');
  });

  it('returns 404 for unknown id', async () => {
    const res = await request(app).get('/api/scorers/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('PUT /api/scorers', () => {
  it('upserts a scorer config', async () => {
    const res = await request(app).put('/api/scorers').send({
      category: 'crypto',
      scorer_name: 'e2e-upsert-scorer',
      parameters: { window: 14, threshold: 0.5 },
      description: 'E2E upsert test scorer',
      is_enabled: true,
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.scorer_name).toBe('e2e-upsert-scorer');
  });

  it('returns 400 when required fields missing', async () => {
    const res = await request(app).put('/api/scorers').send({ category: 'crypto' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('PATCH /api/scorers/:id/toggle', () => {
  it('toggles scorer enabled state', async () => {
    const before = (await request(app).get(`/api/scorers/${scorerConfigId}`)).body.data.is_enabled;
    const res = await request(app).patch(`/api/scorers/${scorerConfigId}/toggle`);
    expect(res.status).toBe(200);
    expect(res.body.data.is_enabled).toBe(!before);
    // Restore
    await request(app).patch(`/api/scorers/${scorerConfigId}/toggle`);
  });
});

// ─── Decisions ────────────────────────────────────────────────────────────────

describe('GET /api/decisions', () => {
  it('returns 200 with paginated decisions', async () => {
    const res = await request(app).get('/api/decisions');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta.total).toBeGreaterThanOrEqual(1);
  });

  it('filters by marketId', async () => {
    const res = await request(app).get(`/api/decisions?marketId=${marketId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.every((d: { market_id: string }) => d.market_id === marketId)).toBe(true);
  });

  it('filters by category=crypto', async () => {
    const res = await request(app).get('/api/decisions?category=crypto');
    expect(res.status).toBe(200);
    expect(res.body.data.every((d: { category: string }) => d.category === 'crypto')).toBe(true);
  });

  it('filters by action=trade', async () => {
    const res = await request(app).get('/api/decisions?action=trade');
    expect(res.status).toBe(200);
    expect(res.body.data.every((d: { action: string }) => d.action === 'trade')).toBe(true);
  });

  it('filters by wasExecuted=false', async () => {
    const res = await request(app).get('/api/decisions?wasExecuted=false');
    expect(res.status).toBe(200);
    expect(res.body.data.every((d: { was_executed: boolean }) => d.was_executed === false)).toBe(true);
  });
});

describe('GET /api/decisions/stats', () => {
  it('returns stats object', async () => {
    const res = await request(app).get('/api/decisions/stats');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('total');
  });
});

describe('GET /api/decisions/:id', () => {
  it('returns decision by BigInt id', async () => {
    const res = await request(app).get(`/api/decisions/${decisionId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(decisionId);
  });

  it('returns 404 for unknown id', async () => {
    const res = await request(app).get('/api/decisions/999999999999');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

// ─── Orders ───────────────────────────────────────────────────────────────────

describe('GET /api/orders', () => {
  it('returns 200 with paginated orders', async () => {
    const res = await request(app).get('/api/orders');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta.total).toBeGreaterThanOrEqual(1);
  });

  it('filters by marketId', async () => {
    const res = await request(app).get(`/api/orders?marketId=${marketId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.every((o: { market_id: string }) => o.market_id === marketId)).toBe(true);
  });

  it('filters by status=pending', async () => {
    const res = await request(app).get('/api/orders?status=pending');
    expect(res.status).toBe(200);
    expect(res.body.data.every((o: { status: string }) => o.status === 'pending')).toBe(true);
  });

  it('filters by side=buy', async () => {
    const res = await request(app).get('/api/orders?side=buy');
    expect(res.status).toBe(200);
    expect(res.body.data.every((o: { side: string }) => o.side === 'buy')).toBe(true);
  });
});

describe('GET /api/orders/:id', () => {
  it('returns order by id', async () => {
    const res = await request(app).get(`/api/orders/${orderId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(orderId);
  });

  it('returns 404 for unknown id', async () => {
    const res = await request(app).get('/api/orders/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/orders/:id/status', () => {
  it('updates order status to open', async () => {
    const res = await request(app)
      .patch(`/api/orders/${orderId}/status`)
      .send({ status: 'open', polymarket_order_id: `pm-${uid()}` });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('open');
  });

  it('updates order status to filled with fill details', async () => {
    const res = await request(app)
      .patch(`/api/orders/${orderId}/status`)
      .send({
        status: 'filled',
        filled_size: '50',
        avg_fill_price: '0.55',
        filled_at: new Date().toISOString(),
      });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('filled');
  });

  it('returns 400 for invalid status', async () => {
    const res = await request(app)
      .patch(`/api/orders/${orderId}/status`)
      .send({ status: 'invalid_status' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

// ─── Positions ────────────────────────────────────────────────────────────────

describe('GET /api/positions', () => {
  it('returns 200 with position list', async () => {
    const res = await request(app).get('/api/positions');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta.total).toBeGreaterThanOrEqual(1);
  });
});

describe('GET /api/positions/:id', () => {
  it('returns position by id', async () => {
    const res = await request(app).get(`/api/positions/${positionId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(positionId);
  });
});

describe('PATCH /api/positions/:id/exit-strategy', () => {
  it('sets time_based exit strategy', async () => {
    const res = await request(app)
      .patch(`/api/positions/${positionId}/exit-strategy`)
      .send({ exit_strategy: 'time_based', time_exit_at: '2026-12-31T23:59:00.000Z' });
    expect(res.status).toBe(200);
    expect(res.body.data.exit_strategy).toBe('time_based');
  });
});

// ─── Risk ─────────────────────────────────────────────────────────────────────

describe('GET /api/risk/events', () => {
  it('returns 200 with risk events', async () => {
    const res = await request(app).get('/api/risk/events');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta.total).toBeGreaterThanOrEqual(1);
  });

  it('filters by eventType', async () => {
    const res = await request(app).get('/api/risk/events?eventType=drawdown_limit');
    expect(res.status).toBe(200);
    expect(res.body.data.every((e: { event_type: string }) => e.event_type === 'drawdown_limit')).toBe(true);
  });

  it('filters by severity=warning', async () => {
    const res = await request(app).get('/api/risk/events?severity=warning');
    expect(res.status).toBe(200);
    expect(res.body.data.every((e: { severity: string }) => e.severity === 'warning')).toBe(true);
  });

  it('filters by marketId', async () => {
    const res = await request(app).get(`/api/risk/events?marketId=${marketId}`);
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBeGreaterThanOrEqual(1);
  });

  it('filters by resolved=false', async () => {
    const res = await request(app).get('/api/risk/events?resolved=false');
    expect(res.status).toBe(200);
    expect(res.body.data.every((e: { auto_resolved: boolean }) => e.auto_resolved === false)).toBe(true);
  });
});

describe('GET /api/risk/config', () => {
  it('returns all risk configs', async () => {
    const res = await request(app).get('/api/risk/config');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('PUT /api/risk/config', () => {
  it('creates/updates risk config', async () => {
    const res = await request(app).put('/api/risk/config').send({
      scope: 'global',
      parameters: { max_daily_drawdown_pct: 5.0, max_position_size_pct: 10.0 },
      updated_by: 'e2e-test',
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('creates category-scoped risk config', async () => {
    const res = await request(app).put('/api/risk/config').send({
      scope: 'category',
      scope_value: 'crypto',
      parameters: { max_exposure_pct: 30.0 },
    });
    expect(res.status).toBe(200);
  });

  it('returns 400 for invalid scope', async () => {
    const res = await request(app).put('/api/risk/config').send({
      scope: 'invalid_scope',
      parameters: {},
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /api/risk/kill-switch', () => {
  it('returns kill switch status', async () => {
    const res = await request(app).get('/api/risk/kill-switch');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.data.kill_switch_enabled).toBe('boolean');
  });
});

describe('PATCH /api/risk/kill-switch', () => {
  it('toggles kill switch and restores', async () => {
    const before = (await request(app).get('/api/risk/kill-switch')).body.data.kill_switch_enabled;
    const res = await request(app).patch('/api/risk/kill-switch');
    expect(res.status).toBe(200);
    expect(res.body.data.kill_switch_enabled).toBe(!before);
    // Restore original state
    await request(app).patch('/api/risk/kill-switch');
  });
});

// ─── Bankroll ─────────────────────────────────────────────────────────────────

describe('GET /api/bankroll', () => {
  it('returns bankroll (null if none exists)', async () => {
    const res = await request(app).get('/api/bankroll');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // May be null before any PATCH
  });
});

describe('PATCH /api/bankroll', () => {
  it('creates/updates the bankroll singleton', async () => {
    const res = await request(app).patch('/api/bankroll').send({
      total_balance: 25000,
      previous_balance: 24000,
      reserved_balance: 1000,
      active_balance: 22000,
      deployed_balance: 1000,
      unrealized_pnl: 200,
      balance_delta_today: 1000,
      balance_delta_total: 1000,
      initial_deposit: 25000,
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('total_balance');
  });
});

describe('GET /api/bankroll/history', () => {
  it('returns paginated history', async () => {
    const res = await request(app).get('/api/bankroll/history');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('accepts from+to date range', async () => {
    const from = new Date(Date.now() - 7 * 86400000).toISOString();
    const to = new Date().toISOString();
    const res = await request(app).get(`/api/bankroll/history?from=${from}&to=${to}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

// ─── Alerts ───────────────────────────────────────────────────────────────────

describe('GET /api/alerts', () => {
  it('returns 200 with paginated alerts', async () => {
    const res = await request(app).get('/api/alerts');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta.total).toBeGreaterThanOrEqual(1);
  });

  it('filters by alertType=system', async () => {
    const res = await request(app).get('/api/alerts?alertType=system');
    expect(res.status).toBe(200);
    expect(res.body.data.every((a: { alert_type: string }) => a.alert_type === 'system')).toBe(true);
  });

  it('filters by severity=info', async () => {
    const res = await request(app).get('/api/alerts?severity=info');
    expect(res.status).toBe(200);
    expect(res.body.data.every((a: { severity: string }) => a.severity === 'info')).toBe(true);
  });

  it('filters by isRead=false', async () => {
    const res = await request(app).get('/api/alerts?isRead=false');
    expect(res.status).toBe(200);
    expect(res.body.data.every((a: { is_read: boolean }) => a.is_read === false)).toBe(true);
  });

  it('filters unread with ?unread=true', async () => {
    const res = await request(app).get('/api/alerts?unread=true');
    expect(res.status).toBe(200);
  });
});

describe('GET /api/alerts/unread-count', () => {
  it('returns numeric unread count', async () => {
    const res = await request(app).get('/api/alerts/unread-count');
    expect(res.status).toBe(200);
    expect(typeof res.body.data.count).toBe('number');
    expect(res.body.data.count).toBeGreaterThanOrEqual(1);
  });
});

describe('PATCH /api/alerts/:id/read', () => {
  it('marks alert as read', async () => {
    const res = await request(app).patch(`/api/alerts/${alertId}/read`);
    expect(res.status).toBe(200);
    expect(res.body.data.is_read).toBe(true);
  });

  it('returns 404 for non-existent BigInt id', async () => {
    const res = await request(app).patch('/api/alerts/999999999999/read');
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/alerts/:id/dismiss', () => {
  it('marks alert as dismissed', async () => {
    const res = await request(app).patch(`/api/alerts/${alertId}/dismiss`);
    expect(res.status).toBe(200);
    expect(res.body.data.is_dismissed).toBe(true);
  });
});

describe('PATCH /api/alerts/mark-all-read', () => {
  it('marks all alerts read and returns count', async () => {
    // Seed a fresh unread alert
    await prisma.alert.create({
      data: { alert_type: 'trade', severity: 'warning', title: 'Mark All Test', message: 'test' },
    });
    const res = await request(app).patch('/api/alerts/mark-all-read');
    expect(res.status).toBe(200);
    expect(typeof res.body.data.marked).toBe('number');
  });
});

// ─── Analytics ────────────────────────────────────────────────────────────────

describe('GET /api/analytics/summary', () => {
  it('returns summary with all expected fields', async () => {
    const res = await request(app).get('/api/analytics/summary');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('positions');
    expect(res.body.data).toHaveProperty('orders');
    expect(res.body.data).toHaveProperty('alerts');
    expect(res.body.data).toHaveProperty('trades');
    expect(res.body.data).toHaveProperty('performance30d');
  });
});

// ─── Audit Log ────────────────────────────────────────────────────────────────

describe('GET /api/audit-log', () => {
  it('returns 200 with paginated list', async () => {
    const res = await request(app).get('/api/audit-log');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

// ─── System ───────────────────────────────────────────────────────────────────

describe('GET /api/health', () => {
  it('returns ok status', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('ok');
    expect(res.body.data.uptime).toBeGreaterThanOrEqual(0);
    expect(res.body.data.timestamp).toBeTruthy();
  });
});

describe('GET /api/config', () => {
  it('returns server configuration', async () => {
    const res = await request(app).get('/api/config');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('environment');
    expect(res.body.data).toHaveProperty('port');
    expect(res.body.data).toHaveProperty('logLevel');
  });
});

describe('System config CRUD', () => {
  const configKey = `E2E_TEST_KEY_${uid()}`;

  it('PUT /api/system-config/:key sets a value', async () => {
    const res = await request(app)
      .put(`/api/system-config/${configKey}`)
      .send({ value: { nested: true }, description: 'E2E test config' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('GET /api/system-config/:key retrieves the value', async () => {
    const res = await request(app).get(`/api/system-config/${configKey}`);
    expect(res.status).toBe(200);
    expect(res.body.data.key).toBe(configKey);
  });

  it('GET /api/system-config returns all configs', async () => {
    const res = await request(app).get('/api/system-config');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('DELETE /api/system-config/:key removes the key', async () => {
    const res = await request(app).delete(`/api/system-config/${configKey}`);
    expect(res.status).toBe(204);
  });

  it('GET /api/system-config/:key returns 404 after delete', async () => {
    const res = await request(app).get(`/api/system-config/${configKey}`);
    expect(res.status).toBe(404);
  });
});

// ─── Trades ───────────────────────────────────────────────────────────────────

describe('GET /api/trades', () => {
  it('returns 200 with paginated trades', async () => {
    const res = await request(app).get('/api/trades');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

describe('GET /api/trades/stats', () => {
  it('returns recentTrades array', async () => {
    const res = await request(app).get('/api/trades/stats');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.recentTrades)).toBe(true);
  });
});
