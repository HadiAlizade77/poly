import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app, prisma, uid, mkMarketInput, deleteTestMarkets, cleanDatabase } from './helpers.js';

const PREFIX = 'test-api-trade-';

let marketId: string;
let orderId: string;
let tradeId: string;

async function seedTrade(mId: string, overrides: Record<string, unknown> = {}) {
  const o = await prisma.order.create({
    data: {
      market_id: mId,
      side: 'buy',
      outcome_token: `yes-${uid()}`,
      order_type: 'limit',
      price: 0.65,
      size: 100,
    },
  });
  const t = await prisma.trade.create({
    data: {
      order_id: o.id,
      market_id: mId,
      side: 'buy',
      outcome_token: o.outcome_token,
      size: 100,
      entry_price: 0.651,
      fees: 0.5,
      net_cost: 65.6,
      ...overrides,
    },
  });
  return { order: o, trade: t };
}

beforeAll(async () => {
  await cleanDatabase();

  const m = await prisma.market.create({ data: mkMarketInput(`${PREFIX}${uid()}`) });
  marketId = m.id;

  const { order, trade } = await seedTrade(marketId);
  orderId = order.id;
  tradeId = trade.id;
});

afterAll(async () => {
  // cleanDatabase used here because deleteTestMarkets doesn't remove trades (FK on orders)
  await cleanDatabase();
  await prisma.$disconnect();
});

// ─── GET /api/trades ──────────────────────────────────────────────────────────

describe('GET /api/trades', () => {
  it('returns 200 with paginated list shape', async () => {
    const res = await request(app).get('/api/trades');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta).toMatchObject({
      page: 1,
      total: expect.any(Number),
      totalPages: expect.any(Number),
    });
  });

  it('contains at least the seeded trade', async () => {
    const res = await request(app).get('/api/trades');

    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBeGreaterThanOrEqual(1);
  });

  it('filters by marketId', async () => {
    const res = await request(app).get(`/api/trades?marketId=${marketId}`);

    expect(res.status).toBe(200);
    expect(res.body.data.every((t: { market_id: string }) => t.market_id === marketId)).toBe(true);
    expect(res.body.meta.total).toBeGreaterThanOrEqual(1);
  });

  it('filters by orderId', async () => {
    const res = await request(app).get(`/api/trades?orderId=${orderId}`);

    expect(res.status).toBe(200);
    expect(res.body.data.every((t: { order_id: string }) => t.order_id === orderId)).toBe(true);
  });

  it('filters by side=buy', async () => {
    const res = await request(app).get('/api/trades?side=buy');

    expect(res.status).toBe(200);
    expect(res.body.data.every((t: { side: string }) => t.side === 'buy')).toBe(true);
  });

  it('returns empty list for non-existent marketId', async () => {
    const res = await request(app).get('/api/trades?marketId=00000000-0000-0000-0000-000000000000');

    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(0);
    expect(res.body.data).toHaveLength(0);
  });

  it('filters by since (future date returns empty)', async () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const res = await request(app).get(`/api/trades?since=${future}`);

    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(0);
  });

  it('filters by since (past date returns trades)', async () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const res = await request(app).get(`/api/trades?since=${past}`);

    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBeGreaterThanOrEqual(1);
  });

  it('paginates with pageSize', async () => {
    const res = await request(app).get('/api/trades?page=1&pageSize=1');

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeLessThanOrEqual(1);
    expect(res.body.meta.pageSize).toBe(1);
  });
});

// ─── GET /api/trades/stats ────────────────────────────────────────────────────

describe('GET /api/trades/stats', () => {
  it('returns 200 with recentTrades array', async () => {
    const res = await request(app).get('/api/trades/stats');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.recentTrades)).toBe(true);
  });

  it('recentTrades contains at least the seeded trade', async () => {
    const res = await request(app).get('/api/trades/stats');

    expect(res.body.data.recentTrades.length).toBeGreaterThanOrEqual(1);
  });

  it('respects limit query param', async () => {
    const res = await request(app).get('/api/trades/stats?limit=1');

    expect(res.status).toBe(200);
    expect(res.body.data.recentTrades.length).toBeLessThanOrEqual(1);
  });

  it('accepts optional since param without error', async () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const res = await request(app).get(`/api/trades/stats?since=${past}`);

    expect(res.status).toBe(200);
    expect(res.body.data.since).toBeTruthy();
  });
});

// ─── GET /api/trades/:id ──────────────────────────────────────────────────────

describe('GET /api/trades/:id', () => {
  it('returns trade by id', async () => {
    const res = await request(app).get(`/api/trades/${tradeId}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(tradeId);
    expect(res.body.data.market_id).toBe(marketId);
    expect(res.body.data.order_id).toBe(orderId);
  });

  it('returns 404 for unknown id', async () => {
    const res = await request(app).get('/api/trades/00000000-0000-0000-0000-000000000000');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
