import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app, prisma, uid, mkMarketInput, deleteTestMarkets, cleanDatabase } from './helpers.js';

const PREFIX = 'test-api-ord-';
let marketId: string;
let orderId: string;

beforeAll(async () => {
  await cleanDatabase();
  const m = await prisma.market.create({ data: mkMarketInput(`${PREFIX}${uid()}`) });
  marketId = m.id;

  // Create an order directly (no POST endpoint exists)
  const o = await prisma.order.create({
    data: {
      market_id: marketId,
      side: 'buy',
      outcome_token: 'yes-token',
      order_type: 'limit',
      price: 0.65,
      size: 100,
    },
  });
  orderId = o.id;
});

afterAll(async () => {
  await deleteTestMarkets(PREFIX);
  await prisma.$disconnect();
});

// ─── GET /api/orders ──────────────────────────────────────────────────────────

describe('GET /api/orders', () => {
  it('returns 200 with paginated orders', async () => {
    const res = await request(app).get('/api/orders');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta).toHaveProperty('total');
  });

  it('filters by status', async () => {
    const res = await request(app).get('/api/orders?status=pending');

    expect(res.status).toBe(200);
    expect(res.body.data.every((o: { status: string }) => o.status === 'pending')).toBe(true);
  });

  it('filters by marketId', async () => {
    const res = await request(app).get(`/api/orders?marketId=${marketId}`);

    expect(res.status).toBe(200);
    expect(res.body.data.every((o: { market_id: string }) => o.market_id === marketId)).toBe(true);
    expect(res.body.meta.total).toBeGreaterThanOrEqual(1);
  });

  it('filters by side', async () => {
    const res = await request(app).get('/api/orders?side=buy');

    expect(res.status).toBe(200);
    expect(res.body.data.every((o: { side: string }) => o.side === 'buy')).toBe(true);
  });

  it('paginates results', async () => {
    const res = await request(app).get('/api/orders?page=1&pageSize=5');

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeLessThanOrEqual(5);
    expect(res.body.meta.page).toBe(1);
    expect(res.body.meta.pageSize).toBe(5);
  });
});

// ─── GET /api/orders/:id ──────────────────────────────────────────────────────

describe('GET /api/orders/:id', () => {
  it('returns order by uuid', async () => {
    const res = await request(app).get(`/api/orders/${orderId}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(orderId);
    expect(res.body.data.market_id).toBe(marketId);
  });

  it('returns 404 for unknown id', async () => {
    const res = await request(app).get('/api/orders/00000000-0000-0000-0000-000000000000');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

// ─── PATCH /api/orders/:id/status ────────────────────────────────────────────

describe('PATCH /api/orders/:id/status', () => {
  it('transitions order to open status', async () => {
    const res = await request(app)
      .patch(`/api/orders/${orderId}/status`)
      .send({ status: 'open' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('open');
  });

  it('transitions order to filled with extra fields', async () => {
    // Create a fresh order to fill
    const o = await prisma.order.create({
      data: { market_id: marketId, side: 'buy', outcome_token: 'no-token', order_type: 'limit', price: 0.35, size: 50 },
    });

    const res = await request(app)
      .patch(`/api/orders/${o.id}/status`)
      .send({
        status: 'filled',
        polymarket_order_id: 'pm-test-123',
        filled_size: '50',
        avg_fill_price: '0.351',
        filled_at: new Date().toISOString(),
      });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('filled');
    expect(res.body.data.polymarket_order_id).toBe('pm-test-123');
  });

  it('transitions order to cancelled', async () => {
    const o = await prisma.order.create({
      data: { market_id: marketId, side: 'sell', outcome_token: 'yes-token-2', order_type: 'limit', price: 0.7, size: 100 },
    });

    const res = await request(app)
      .patch(`/api/orders/${o.id}/status`)
      .send({ status: 'cancelled', cancelled_at: new Date().toISOString() });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('cancelled');
  });

  it('returns 400 for missing status field', async () => {
    const res = await request(app)
      .patch(`/api/orders/${orderId}/status`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for invalid status value', async () => {
    const res = await request(app)
      .patch(`/api/orders/${orderId}/status`)
      .send({ status: 'invalid_status' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 for unknown order', async () => {
    const res = await request(app)
      .patch('/api/orders/00000000-0000-0000-0000-000000000000/status')
      .send({ status: 'cancelled' });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
