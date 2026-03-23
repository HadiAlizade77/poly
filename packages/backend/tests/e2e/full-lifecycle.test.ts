/**
 * E2E: Full Entity Lifecycle
 *
 * Tests the complete happy path:
 *   POST market → GET verify → PUT update → snapshot → contextScore → aiDecision
 *   → order → PATCH order filled → trade → position → PATCH exit-strategy
 *   → POST close → verify position_history → PATCH bankroll → GET bankroll
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../integration/setup.js';
import { cleanDatabase, prisma } from '../integration/db/db-helpers.js';

const app = createTestApp();
const uid = () => Math.random().toString(36).slice(2, 9);

// Shared state across the lifecycle chain
let marketId: string;
let orderId: string;
let positionId: string;
let decisionId: string; // string (BigInt serialized)

beforeAll(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

// ─── Step 1: Create Market ───────────────────────────────────────────────────

describe('Lifecycle Step 1 – Create market', () => {
  it('POST /api/markets creates market and returns 201', async () => {
    const pmId = `e2e-lc-${uid()}`;
    const res = await request(app)
      .post('/api/markets')
      .send({
        polymarket_id: pmId,
        title: 'Will BTC hit $150k by end of 2025?',
        category: 'crypto',
        outcomes: { Yes: 0.60, No: 0.40 },
        current_prices: { Yes: 0.60, No: 0.40 },
        liquidity: '500000',
        volume_24h: '80000',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBeTruthy();
    expect(res.body.data.polymarket_id).toBe(pmId);
    expect(res.body.data.category).toBe('crypto');
    expect(res.body.data.status).toBe('active');
    marketId = res.body.data.id;
  });
});

// ─── Step 2: Verify market in DB ─────────────────────────────────────────────

describe('Lifecycle Step 2 – Verify market', () => {
  it('GET /api/markets/:id returns the created market', async () => {
    const res = await request(app).get(`/api/markets/${marketId}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(marketId);
    expect(res.body.data.category).toBe('crypto');
  });

  it('market appears in GET /api/markets list', async () => {
    const res = await request(app).get('/api/markets?category=crypto');

    expect(res.status).toBe(200);
    const found = res.body.data.find((m: { id: string }) => m.id === marketId);
    expect(found).toBeTruthy();
  });
});

// ─── Step 3: Update market prices ────────────────────────────────────────────

describe('Lifecycle Step 3 – Update market', () => {
  it('PUT /api/markets/:id updates prices', async () => {
    const res = await request(app)
      .put(`/api/markets/${marketId}`)
      .send({
        current_prices: { Yes: 0.72, No: 0.28 },
        volume_24h: '120000',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const prices = res.body.data.current_prices as Record<string, number>;
    expect(prices['Yes']).toBeCloseTo(0.72);
  });
});

// ─── Step 4: Create snapshot, context score, AI decision ─────────────────────

describe('Lifecycle Step 4 – Snapshot & Decision', () => {
  it('creates snapshot for market', async () => {
    const snapshot = await prisma.marketSnapshot.create({
      data: {
        market_id: marketId,
        timestamp: new Date(),
        prices: { Yes: 0.72, No: 0.28 },
        spread: '0.44',
        liquidity: '500000',
      },
    });
    expect(snapshot.id).toBeTruthy();
    expect(snapshot.market_id).toBe(marketId);
  });

  it('creates context score for market', async () => {
    const ctxScore = await prisma.contextScore.create({
      data: {
        market_id: marketId,
        category: 'crypto',
        scores: { momentum: 82, volume: 78, spread: 70 },
      },
    });
    expect(ctxScore.id).toBeTruthy();
  });

  it('creates AI decision (trade) for market', async () => {
    const decision = await prisma.aiDecision.create({
      data: {
        market_id: marketId,
        category: 'crypto',
        action: 'trade',
        direction: 'buy',
        outcome_token: 'YES',
        confidence: 0.72,
        size_hint: 0.10,
        estimated_edge: 0.07,
        reasoning: 'Strong momentum with high volume — buy YES.',
        regime_assessment: 'bullish',
        dashboard_text: 'BTC lifecycle E2E test decision',
        account_state: { balance: 10000 },
      },
    });
    expect(decision.id).toBeTruthy();
    decisionId = decision.id.toString();
  });

  it('decision appears in GET /api/decisions', async () => {
    const res = await request(app).get(`/api/decisions?marketId=${marketId}`);

    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBeGreaterThanOrEqual(1);
    const found = res.body.data.find((d: { id: string }) => d.id === decisionId);
    expect(found).toBeTruthy();
  });
});

// ─── Step 5: Create order ─────────────────────────────────────────────────────

describe('Lifecycle Step 5 – Create & Fill Order', () => {
  it('creates a buy order in DB', async () => {
    const order = await prisma.order.create({
      data: {
        market_id: marketId,
        decision_id: BigInt(decisionId),
        side: 'buy',
        outcome_token: `yes-${uid()}`,
        order_type: 'limit',
        price: 0.72,
        size: 100,
      },
    });
    expect(order.id).toBeTruthy();
    orderId = order.id;
  });

  it('order appears in GET /api/orders', async () => {
    const res = await request(app).get(`/api/orders?marketId=${marketId}`);

    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBeGreaterThanOrEqual(1);
    const found = res.body.data.find((o: { id: string }) => o.id === orderId);
    expect(found).toBeTruthy();
  });

  it('PATCH /api/orders/:id/status fills the order', async () => {
    const res = await request(app)
      .patch(`/api/orders/${orderId}/status`)
      .send({
        status: 'filled',
        filled_size: '100',
        avg_fill_price: '0.72',
        filled_at: new Date().toISOString(),
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('filled');
    expect(res.body.data.id).toBe(orderId);
  });
});

// ─── Step 6: Create trade & position ─────────────────────────────────────────

describe('Lifecycle Step 6 – Trade & Position', () => {
  it('creates a trade linked to order and market', async () => {
    const trade = await prisma.trade.create({
      data: {
        order_id: orderId,
        market_id: marketId,
        side: 'buy',
        outcome_token: `yes-${uid()}`,
        size: 100,
        entry_price: 0.72,
        fees: 0.5,
        net_cost: 72.5,
        confidence_at_entry: 0.72,
        edge_at_entry: 0.07,
      },
    });
    expect(trade.id).toBeTruthy();
    expect(trade.order_id).toBe(orderId);
  });

  it('creates a position', async () => {
    const pos = await prisma.position.create({
      data: {
        market_id: marketId,
        decision_id: BigInt(decisionId),
        outcome_token: `yes-${uid()}`,
        side: 'long',
        size: 100,
        avg_entry_price: 0.72,
      },
    });
    expect(pos.id).toBeTruthy();
    positionId = pos.id;
  });

  it('position appears in GET /api/positions', async () => {
    const res = await request(app).get('/api/positions');

    expect(res.status).toBe(200);
    const found = res.body.data.find((p: { id: string }) => p.id === positionId);
    expect(found).toBeTruthy();
  });
});

// ─── Step 7: Update exit strategy ────────────────────────────────────────────

describe('Lifecycle Step 7 – Update Exit Strategy', () => {
  it('PATCH /api/positions/:id/exit-strategy sets stop_loss', async () => {
    const res = await request(app)
      .patch(`/api/positions/${positionId}/exit-strategy`)
      .send({
        exit_strategy: 'stop_loss',
        stop_loss_price: '0.55',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.exit_strategy).toBe('stop_loss');
  });
});

// ─── Step 8: Close position ───────────────────────────────────────────────────

describe('Lifecycle Step 8 – Close Position', () => {
  it('POST /api/positions/:id/close returns 204', async () => {
    const res = await request(app)
      .post(`/api/positions/${positionId}/close`)
      .send({ close_reason: 'stop_loss' });

    expect(res.status).toBe(204);
  });

  it('position no longer exists after close', async () => {
    const res = await request(app).get(`/api/positions/${positionId}`);
    expect(res.status).toBe(404);
  });

  it('position_history record was created', async () => {
    const history = await prisma.positionHistory.findFirst({
      where: { market_id: marketId },
    });
    expect(history).not.toBeNull();
    expect(history!.close_reason).toBe('stop_loss');
    expect(history!.side).toBe('long');
  });
});

// ─── Step 9: Bankroll ─────────────────────────────────────────────────────────

describe('Lifecycle Step 9 – Bankroll', () => {
  it('PATCH /api/bankroll creates/updates bankroll', async () => {
    const res = await request(app).patch('/api/bankroll').send({
      total_balance: 10000,
      previous_balance: 9950,
      reserved_balance: 500,
      active_balance: 9000,
      deployed_balance: 720,
      unrealized_pnl: 50,
      balance_delta_today: 50,
      balance_delta_total: 50,
      initial_deposit: 10000,
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('total_balance');
  });

  it('GET /api/bankroll returns the bankroll', async () => {
    const res = await request(app).get('/api/bankroll');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).not.toBeNull();
    expect(res.body.data.total_balance).toBeTruthy();
  });

  it('GET /api/bankroll/history returns history list', async () => {
    const res = await request(app).get('/api/bankroll/history');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ─── Step 10: Analytics summary reflects chain ───────────────────────────────

describe('Lifecycle Step 10 – Analytics after lifecycle', () => {
  it('GET /api/analytics/summary reflects non-zero state', async () => {
    const res = await request(app).get('/api/analytics/summary');

    expect(res.status).toBe(200);
    // After closing a position, total_trades should be at least 1
    expect(res.body.data.total_trades).toBeGreaterThanOrEqual(1);
  });
});
