import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app, prisma, uid, mkMarketInput, deleteTestMarkets, cleanDatabase } from './helpers.js';

const PREFIX = 'test-api-mkt-';

let createdMarketId: string;
let createdPolymarketId: string;

beforeAll(async () => {
  await cleanDatabase();
  // Create one market to use in GET /:id and update tests
  createdPolymarketId = `${PREFIX}${uid()}`;
  const market = await prisma.market.create({ data: mkMarketInput(createdPolymarketId) });
  createdMarketId = market.id;
});

afterAll(async () => {
  await deleteTestMarkets(PREFIX);
  await prisma.$disconnect();
});

// ─── GET /api/markets ─────────────────────────────────────────────────────────

describe('GET /api/markets', () => {
  it('returns 200 with paginated list shape', async () => {
    const res = await request(app).get('/api/markets');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta).toMatchObject({
      page: 1,
      total: expect.any(Number),
      totalPages: expect.any(Number),
    });
  });

  it('filters by category', async () => {
    const res = await request(app).get('/api/markets?category=crypto');

    expect(res.status).toBe(200);
    expect(res.body.data.every((m: { category: string }) => m.category === 'crypto')).toBe(true);
  });

  it('filters by status', async () => {
    const res = await request(app).get('/api/markets?status=active');

    expect(res.status).toBe(200);
    expect(res.body.data.every((m: { status: string }) => m.status === 'active')).toBe(true);
  });

  it('filters by search term', async () => {
    const res = await request(app).get(`/api/markets?search=${createdPolymarketId}`);

    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBeGreaterThanOrEqual(1);
  });

  it('paginates results', async () => {
    const res = await request(app).get('/api/markets?page=1&pageSize=3');

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeLessThanOrEqual(3);
    expect(res.body.meta.page).toBe(1);
    expect(res.body.meta.pageSize).toBe(3);
  });
});

// ─── GET /api/markets/:id ─────────────────────────────────────────────────────

describe('GET /api/markets/:id', () => {
  it('returns the market for a valid id', async () => {
    const res = await request(app).get(`/api/markets/${createdMarketId}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(createdMarketId);
    expect(res.body.data.polymarket_id).toBe(createdPolymarketId);
  });

  it('returns 404 for unknown id', async () => {
    const res = await request(app).get('/api/markets/00000000-0000-0000-0000-000000000000');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

// ─── POST /api/markets ────────────────────────────────────────────────────────

describe('POST /api/markets', () => {
  it('creates and returns a market with 201', async () => {
    const pmId = `${PREFIX}create-${uid()}`;
    const res = await request(app)
      .post('/api/markets')
      .send(mkMarketInput(pmId));

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.polymarket_id).toBe(pmId);
    expect(res.body.data.category).toBe('crypto');
  });

  it('returns 409 on duplicate polymarket_id', async () => {
    const pmId = `${PREFIX}dup-${uid()}`;
    await request(app).post('/api/markets').send(mkMarketInput(pmId));
    const res = await request(app).post('/api/markets').send(mkMarketInput(pmId));

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await request(app).post('/api/markets').send({ title: 'No polymarket_id' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for invalid category enum', async () => {
    const res = await request(app)
      .post('/api/markets')
      .send({ ...mkMarketInput(`${PREFIX}bad-${uid()}`), category: 'invalid_category' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

// ─── PUT /api/markets/:id ─────────────────────────────────────────────────────

describe('PUT /api/markets/:id', () => {
  it('updates market fields', async () => {
    const res = await request(app)
      .put(`/api/markets/${createdMarketId}`)
      .send({ volume_24h: '99000', current_prices: { Yes: 0.8, No: 0.2 } });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(createdMarketId);
  });

  it('returns 404 for unknown market', async () => {
    const res = await request(app)
      .put('/api/markets/00000000-0000-0000-0000-000000000000')
      .send({ title: 'Updated' });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

// ─── PATCH /api/markets/:id/status ────────────────────────────────────────────

describe('PATCH /api/markets/:id/status', () => {
  it('sets market status', async () => {
    const res = await request(app)
      .patch(`/api/markets/${createdMarketId}/status`)
      .send({ status: 'paused' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('paused');
  });

  it('sets status with exclusion reason', async () => {
    const res = await request(app)
      .patch(`/api/markets/${createdMarketId}/status`)
      .send({ status: 'excluded', exclusion_reason: 'Low liquidity' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('excluded');
    expect(res.body.data.exclusion_reason).toBe('Low liquidity');
  });

  it('returns 400 for invalid status', async () => {
    const res = await request(app)
      .patch(`/api/markets/${createdMarketId}/status`)
      .send({ status: 'invalid_status' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when status is missing', async () => {
    const res = await request(app)
      .patch(`/api/markets/${createdMarketId}/status`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
