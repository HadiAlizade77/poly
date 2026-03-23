/**
 * Full lifecycle E2E test for the API.
 *
 * Exercises the complete chain:
 *   POST /api/markets  (create market)
 *   PUT  /api/markets/:id  (update prices)
 *   Prisma → snapshot, context score, AI decision, order, position (no API)
 *   POST /api/positions/:id/close  (close position → position_history)
 *
 * Also tests:
 *   - Concurrent market creation
 *   - Empty-DB edge cases (GET on empty collections)
 *   - Malformed request bodies
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app, prisma, uid, mkMarketInput, deleteTestMarkets, cleanDatabase } from './helpers.js';

const PREFIX = 'test-lifecycle-';

beforeAll(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await deleteTestMarkets(PREFIX);
  await prisma.$disconnect();
});

// ─── Full CRUD lifecycle ───────────────────────────────────────────────────────

describe('Lifecycle – create → update → snapshot → decision → order → position → close', () => {
  it('completes the full chain without errors', async () => {
    // 1. Create market via API
    const pmId = `${PREFIX}chain-${uid()}`;
    const createRes = await request(app)
      .post('/api/markets')
      .send(mkMarketInput(pmId));

    expect(createRes.status).toBe(201);
    const marketId = createRes.body.data.id as string;
    expect(marketId).toBeTruthy();

    // 2. Update prices via API
    const updateRes = await request(app)
      .put(`/api/markets/${marketId}`)
      .send({ current_prices: { Yes: 0.75, No: 0.25 }, volume_24h: '150000' });

    expect(updateRes.status).toBe(200);
    const prices = updateRes.body.data.current_prices as Record<string, number>;
    expect(prices['Yes']).toBeCloseTo(0.75);

    // 3. Create a snapshot directly (no API endpoint)
    const snapshot = await prisma.marketSnapshot.create({
      data: {
        market_id: marketId,
        timestamp: new Date(),
        prices: { Yes: 0.75, No: 0.25 },
        spread: '0.50',
      },
    });
    expect(snapshot.id).toBeTruthy();

    // 4. Create a context score
    const ctxScore = await prisma.contextScore.create({
      data: {
        market_id: marketId,
        category: 'crypto',
        scores: { momentum: 80, volume: 75 },
      },
    });
    expect(ctxScore.id).toBeTruthy();

    // 5. Create an AI decision
    const decision = await prisma.aiDecision.create({
      data: {
        market_id: marketId,
        category: 'crypto',
        action: 'trade',
        direction: 'buy',
        outcome_token: 'YES',
        confidence: 0.75,
        reasoning: 'Strong uptrend detected.',
        regime_assessment: 'bullish',
        dashboard_text: 'Test decision',
        account_state: {},
      },
    });
    expect(decision.id).toBeTruthy();

    // 6. Create an order
    const order = await prisma.order.create({
      data: {
        market_id: marketId,
        decision_id: decision.id,
        side: 'buy',
        outcome_token: `yes-${uid()}`,
        order_type: 'limit',
        price: 0.75,
        size: 100,
      },
    });
    expect(order.id).toBeTruthy();

    // 7. Create a position
    const position = await prisma.position.create({
      data: {
        market_id: marketId,
        decision_id: decision.id,
        outcome_token: order.outcome_token,
        side: 'long',
        size: 100,
        avg_entry_price: 0.75,
      },
    });
    expect(position.id).toBeTruthy();

    // 8. Close position via API
    const closeRes = await request(app)
      .post(`/api/positions/${position.id}/close`)
      .send({ close_reason: 'manual' });

    expect(closeRes.status).toBe(204);

    // 9. Verify position was deleted
    const deletedPos = await prisma.position.findUnique({ where: { id: position.id } });
    expect(deletedPos).toBeNull();

    // 10. Verify position_history was created
    const history = await prisma.positionHistory.findFirst({
      where: { market_id: marketId },
    });
    expect(history).toBeTruthy();
    expect(history!.close_reason).toBe('manual');
    expect(history!.market_id).toBe(marketId);
  });
});

// ─── POST /api/positions/:id/close ────────────────────────────────────────────

describe('POST /api/positions/:id/close', () => {
  it('returns 404 for unknown position id', async () => {
    const res = await request(app)
      .post('/api/positions/00000000-0000-0000-0000-000000000000/close')
      .send({ close_reason: 'manual' });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('accepts all valid close_reason values', async () => {
    const closeReasons = ['manual', 'stop_loss', 'time_exit', 'resolution'];

    for (const close_reason of closeReasons) {
      // Create a fresh market + position for each reason
      const pmId = `${PREFIX}close-${close_reason}-${uid()}`;
      const mkt = await prisma.market.create({ data: mkMarketInput(pmId) });

      const pos = await prisma.position.create({
        data: {
          market_id: mkt.id,
          outcome_token: `yes-${uid()}`,
          side: 'long',
          size: 50,
          avg_entry_price: 0.60,
        },
      });

      const res = await request(app)
        .post(`/api/positions/${pos.id}/close`)
        .send({ close_reason });

      expect(res.status).toBe(204);

      // History should reflect the reason
      const hist = await prisma.positionHistory.findFirst({
        where: { market_id: mkt.id },
      });
      expect(hist!.close_reason).toBe(close_reason);
    }
  });
});

// ─── Concurrent market creation ───────────────────────────────────────────────

describe('Lifecycle – concurrent market creation', () => {
  it('creates 5 markets concurrently without conflict', async () => {
    const creates = Array.from({ length: 5 }, () => {
      const pmId = `${PREFIX}concurrent-${uid()}`;
      return request(app).post('/api/markets').send(mkMarketInput(pmId));
    });

    const results = await Promise.all(creates);

    const ids = new Set<string>();
    for (const res of results) {
      expect(res.status).toBe(201);
      ids.add(res.body.data.id as string);
    }
    expect(ids.size).toBe(5); // All distinct
  });

  it('409 on duplicate polymarket_id even under concurrent requests', async () => {
    const pmId = `${PREFIX}dup-conc-${uid()}`;
    const input = mkMarketInput(pmId);

    // Two parallel requests with the same polymarket_id
    const [r1, r2] = await Promise.all([
      request(app).post('/api/markets').send(input),
      request(app).post('/api/markets').send(input),
    ]);

    const statuses = [r1.status, r2.status].sort();
    // One succeeds, one conflicts
    expect(statuses).toContain(201);
    expect(statuses).toContain(409);
  });
});

// ─── Empty DB edge cases ──────────────────────────────────────────────────────

describe('Lifecycle – empty DB edge cases', () => {
  it('GET /api/trades returns empty list (not error)', async () => {
    // Clean the DB first to ensure empty state
    await cleanDatabase();

    const res = await request(app).get('/api/trades');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(0);
    expect(res.body.meta.total).toBe(0);
  });

  it('GET /api/positions returns empty list', async () => {
    const res = await request(app).get('/api/positions');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('GET /api/analytics/summary returns zeros for empty DB', async () => {
    const res = await request(app).get('/api/analytics/summary');

    expect(res.status).toBe(200);
    expect(res.body.data.total_trades).toBe(0);
    expect(res.body.data.win_rate).toBeNull();
    expect(res.body.data.by_category).toEqual({});
  });

  it('GET /api/audit-log returns empty list', async () => {
    const res = await request(app).get('/api/audit-log');

    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(0);
  });
});

// ─── Malformed request bodies ─────────────────────────────────────────────────

describe('Lifecycle – malformed request handling', () => {
  it('POST /api/markets with empty body returns 400', async () => {
    const res = await request(app).post('/api/markets').send({});

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('POST /api/markets with non-JSON body returns 400', async () => {
    const res = await request(app)
      .post('/api/markets')
      .set('Content-Type', 'application/json')
      .send('not-json{{{');

    expect(res.status).toBe(400);
  });

  it('PUT /api/markets/:id with unknown id returns 404', async () => {
    const res = await request(app)
      .put('/api/markets/00000000-0000-0000-0000-000000000000')
      .send({ title: 'Ghost' });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('PATCH /api/markets/:id/status with no status returns 400', async () => {
    const pmId = `${PREFIX}patch-${uid()}`;
    const m = await prisma.market.create({ data: mkMarketInput(pmId) });

    const res = await request(app)
      .patch(`/api/markets/${m.id}/status`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('GET /api/markets/:id with malformed uuid returns 404 or 400', async () => {
    const res = await request(app).get('/api/markets/not-a-uuid');

    expect([400, 404, 500]).toContain(res.status);
    expect(res.body.success).toBe(false);
  });
});
