import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app, prisma, uid, mkMarketInput, deleteTestMarkets, cleanDatabase } from './helpers.js';

const PREFIX = 'test-api-pos-';
let marketId: string;
let positionId: string;

beforeAll(async () => {
  await cleanDatabase();
  const m = await prisma.market.create({ data: mkMarketInput(`${PREFIX}${uid()}`) });
  marketId = m.id;

  // Create a position directly (no POST endpoint exists)
  const p = await prisma.position.create({
    data: {
      market_id: marketId,
      outcome_token: `yes-${uid()}`,
      side: 'long',
      size: 100,
      avg_entry_price: 0.65,
    },
  });
  positionId = p.id;
});

afterAll(async () => {
  await deleteTestMarkets(PREFIX);
  await prisma.$disconnect();
});

// ─── GET /api/positions ───────────────────────────────────────────────────────

describe('GET /api/positions', () => {
  it('returns 200 with list of open positions', async () => {
    const res = await request(app).get('/api/positions');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta.total).toBeGreaterThanOrEqual(1);
  });
});

// ─── GET /api/positions/:id ───────────────────────────────────────────────────

describe('GET /api/positions/:id', () => {
  it('returns position by id', async () => {
    const res = await request(app).get(`/api/positions/${positionId}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(positionId);
    expect(res.body.data.market_id).toBe(marketId);
  });

  it('returns 404 for unknown id', async () => {
    const res = await request(app).get('/api/positions/00000000-0000-0000-0000-000000000000');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

// ─── PATCH /api/positions/:id/exit-strategy ───────────────────────────────────

describe('PATCH /api/positions/:id/exit-strategy', () => {
  it('sets stop_loss exit strategy', async () => {
    const res = await request(app)
      .patch(`/api/positions/${positionId}/exit-strategy`)
      .send({ exit_strategy: 'stop_loss', stop_loss_price: '0.50' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.exit_strategy).toBe('stop_loss');
  });

  it('sets time_based exit strategy', async () => {
    const res = await request(app)
      .patch(`/api/positions/${positionId}/exit-strategy`)
      .send({
        exit_strategy: 'time_based',
        time_exit_at: '2026-12-31T23:59:59.000Z',
      });

    expect(res.status).toBe(200);
    expect(res.body.data.exit_strategy).toBe('time_based');
  });

  it('sets resolution_only strategy', async () => {
    const res = await request(app)
      .patch(`/api/positions/${positionId}/exit-strategy`)
      .send({ exit_strategy: 'resolution_only' });

    expect(res.status).toBe(200);
    expect(res.body.data.exit_strategy).toBe('resolution_only');
  });

  it('returns 400 when exit_strategy is missing', async () => {
    const res = await request(app)
      .patch(`/api/positions/${positionId}/exit-strategy`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for invalid exit_strategy value', async () => {
    const res = await request(app)
      .patch(`/api/positions/${positionId}/exit-strategy`)
      .send({ exit_strategy: 'invalid_strategy' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 for unknown position', async () => {
    const res = await request(app)
      .patch('/api/positions/00000000-0000-0000-0000-000000000000/exit-strategy')
      .send({ exit_strategy: 'manual' });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
