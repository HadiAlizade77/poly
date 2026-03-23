/**
 * E2E: Error Handling
 *
 * Tests all error paths:
 *   - 400: missing required fields, wrong types, invalid enums
 *   - 400: invalid JSON body
 *   - 404: non-existent UUIDs and BigInt IDs
 *   - 409: duplicate unique constraints
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../integration/setup.js';
import { cleanDatabase, prisma } from '../integration/db/db-helpers.js';

const app = createTestApp();
const uid = () => Math.random().toString(36).slice(2, 9);
const FAKE_UUID = '00000000-0000-0000-0000-000000000000';
const FAKE_BIGINT = '999999999999';

let marketId: string;
let positionId: string;

beforeAll(async () => {
  await cleanDatabase();

  const market = await prisma.market.create({
    data: {
      polymarket_id: `e2e-err-${uid()}`,
      title: 'Error test market',
      category: 'crypto',
      outcomes: [{ name: 'Yes', token_id: `yes-${uid()}` }],
    },
  });
  marketId = market.id;

  const pos = await prisma.position.create({
    data: {
      market_id: marketId,
      outcome_token: `yes-${uid()}`,
      side: 'long',
      size: 100,
      avg_entry_price: 0.60,
    },
  });
  positionId = pos.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

// ─── 400 – Missing required fields ───────────────────────────────────────────

describe('400 – Missing required fields', () => {
  it('POST /api/markets without polymarket_id', async () => {
    const res = await request(app).post('/api/markets').send({
      title: 'No polymarket_id',
      category: 'crypto',
      outcomes: [],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('POST /api/markets without title', async () => {
    const res = await request(app).post('/api/markets').send({
      polymarket_id: `pm-${uid()}`,
      category: 'crypto',
      outcomes: [],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('POST /api/markets without category', async () => {
    const res = await request(app).post('/api/markets').send({
      polymarket_id: `pm-${uid()}`,
      title: 'No category',
      outcomes: [],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('POST /api/auth/login without password', async () => {
    const res = await request(app).post('/api/auth/login').send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('PUT /api/scorers without scorer_name', async () => {
    const res = await request(app).put('/api/scorers').send({
      category: 'crypto',
      parameters: {},
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('PUT /api/scorers without parameters', async () => {
    const res = await request(app).put('/api/scorers').send({
      category: 'crypto',
      scorer_name: 'test',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('PATCH /api/orders/:id/status without status', async () => {
    const order = await prisma.order.create({
      data: {
        market_id: marketId,
        side: 'buy',
        outcome_token: `yes-${uid()}`,
        order_type: 'limit',
        price: 0.5,
        size: 10,
      },
    });
    const res = await request(app)
      .patch(`/api/orders/${order.id}/status`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('PATCH /api/positions/:id/exit-strategy without exit_strategy', async () => {
    const res = await request(app)
      .patch(`/api/positions/${positionId}/exit-strategy`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('PUT /api/risk/config without scope', async () => {
    const res = await request(app).put('/api/risk/config').send({ parameters: {} });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

// ─── 400 – Invalid enum values ────────────────────────────────────────────────

describe('400 – Invalid enum values', () => {
  it('POST /api/markets with invalid category', async () => {
    const res = await request(app).post('/api/markets').send({
      polymarket_id: `pm-${uid()}`,
      title: 'Bad category market',
      category: 'invalid_category',
      outcomes: [],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('PATCH /api/markets/:id/status with invalid status', async () => {
    const res = await request(app)
      .patch(`/api/markets/${marketId}/status`)
      .send({ status: 'flying' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('PATCH /api/orders/:id/status with invalid status', async () => {
    const order = await prisma.order.create({
      data: {
        market_id: marketId,
        side: 'buy',
        outcome_token: `yes-${uid()}`,
        order_type: 'limit',
        price: 0.5,
        size: 10,
      },
    });
    const res = await request(app)
      .patch(`/api/orders/${order.id}/status`)
      .send({ status: 'completed_invalid' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('PATCH /api/positions/:id/exit-strategy with invalid strategy', async () => {
    const res = await request(app)
      .patch(`/api/positions/${positionId}/exit-strategy`)
      .send({ exit_strategy: 'immediately' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('PUT /api/risk/config with invalid scope', async () => {
    const res = await request(app).put('/api/risk/config').send({
      scope: 'universe',
      parameters: {},
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

// ─── 400 – Invalid JSON body ──────────────────────────────────────────────────

describe('400 – Invalid JSON body', () => {
  it('POST /api/markets with malformed JSON returns 400', async () => {
    const res = await request(app)
      .post('/api/markets')
      .set('Content-Type', 'application/json')
      .send('{bad json{{{');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('PUT /api/scorers with malformed JSON returns 400', async () => {
    const res = await request(app)
      .put('/api/scorers')
      .set('Content-Type', 'application/json')
      .send('not json at all');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('PATCH /api/bankroll with malformed JSON returns 400', async () => {
    const res = await request(app)
      .patch('/api/bankroll')
      .set('Content-Type', 'application/json')
      .send('}}}');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

// ─── 404 – Non-existent UUID IDs ─────────────────────────────────────────────

describe('404 – Non-existent UUID IDs', () => {
  it('GET /api/markets/:id with unknown UUID', async () => {
    const res = await request(app).get(`/api/markets/${FAKE_UUID}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('PUT /api/markets/:id with unknown UUID', async () => {
    const res = await request(app)
      .put(`/api/markets/${FAKE_UUID}`)
      .send({ title: 'Ghost' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('PATCH /api/markets/:id/status with unknown UUID', async () => {
    const res = await request(app)
      .patch(`/api/markets/${FAKE_UUID}/status`)
      .send({ status: 'active' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('GET /api/orders/:id with unknown UUID', async () => {
    const res = await request(app).get(`/api/orders/${FAKE_UUID}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('PATCH /api/orders/:id/status with unknown UUID', async () => {
    const res = await request(app)
      .patch(`/api/orders/${FAKE_UUID}/status`)
      .send({ status: 'cancelled' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('GET /api/positions/:id with unknown UUID', async () => {
    const res = await request(app).get(`/api/positions/${FAKE_UUID}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('PATCH /api/positions/:id/exit-strategy with unknown UUID', async () => {
    const res = await request(app)
      .patch(`/api/positions/${FAKE_UUID}/exit-strategy`)
      .send({ exit_strategy: 'manual' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('POST /api/positions/:id/close with unknown UUID', async () => {
    const res = await request(app)
      .post(`/api/positions/${FAKE_UUID}/close`)
      .send({ close_reason: 'manual' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('GET /api/scorers/:id with unknown UUID', async () => {
    const res = await request(app).get(`/api/scorers/${FAKE_UUID}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('PATCH /api/scorers/:id/toggle with unknown UUID', async () => {
    const res = await request(app).patch(`/api/scorers/${FAKE_UUID}/toggle`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

// ─── 404 – Non-existent BigInt IDs ───────────────────────────────────────────

describe('404 – Non-existent BigInt IDs', () => {
  it('GET /api/decisions/:id with unknown BigInt', async () => {
    const res = await request(app).get(`/api/decisions/${FAKE_BIGINT}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('PATCH /api/alerts/:id/read with unknown BigInt', async () => {
    const res = await request(app).patch(`/api/alerts/${FAKE_BIGINT}/read`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('PATCH /api/alerts/:id/dismiss with unknown BigInt', async () => {
    const res = await request(app).patch(`/api/alerts/${FAKE_BIGINT}/dismiss`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('GET /api/system-config/:key returns 404 for unknown key', async () => {
    const res = await request(app).get('/api/system-config/NONEXISTENT_KEY_XYZ');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('DELETE /api/system-config/:key returns 404 for unknown key', async () => {
    const res = await request(app).delete('/api/system-config/NONEXISTENT_KEY_XYZ');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

// ─── 409 – Duplicate unique constraints ──────────────────────────────────────

describe('409 – Duplicate unique constraints', () => {
  it('POST /api/markets with duplicate polymarket_id', async () => {
    const pmId = `e2e-dup-${uid()}`;
    await request(app).post('/api/markets').send({
      polymarket_id: pmId,
      title: 'First Market',
      category: 'crypto',
      outcomes: { Yes: true },
    });
    const res = await request(app).post('/api/markets').send({
      polymarket_id: pmId,
      title: 'Duplicate Market',
      category: 'politics',
      outcomes: { Yes: true },
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('creating two positions with same market_id + outcome_token returns conflict', async () => {
    const token = `dup-token-${uid()}`;
    // First position
    await prisma.position.create({
      data: { market_id: marketId, outcome_token: token, side: 'long', size: 10, avg_entry_price: 0.5 },
    });
    // Second position with same combination — unique constraint (market_id, outcome_token)
    await expect(
      prisma.position.create({
        data: { market_id: marketId, outcome_token: token, side: 'long', size: 10, avg_entry_price: 0.5 },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});

// ─── Response shape validation ────────────────────────────────────────────────

describe('Response shape', () => {
  it('all success responses have success:true', async () => {
    const res = await request(app).get('/api/health');
    expect(res.body.success).toBe(true);
    expect(res.body).toHaveProperty('data');
  });

  it('all error responses have success:false and error.code', async () => {
    const res = await request(app).get(`/api/markets/${FAKE_UUID}`);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toHaveProperty('code');
    expect(res.body.error).toHaveProperty('message');
  });

  it('paginated list responses have meta.total, meta.page, meta.pageSize', async () => {
    const res = await request(app).get('/api/markets');
    expect(res.body.meta).toMatchObject({
      total: expect.any(Number),
      page: expect.any(Number),
      pageSize: expect.any(Number),
      totalPages: expect.any(Number),
    });
  });
});
