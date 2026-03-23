import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app, prisma, cleanDatabase } from './helpers.js';

beforeAll(async () => {
  await cleanDatabase();
  // Ensure singleton bankroll exists (create via Prisma to avoid service ID bug)
  const count = await prisma.bankroll.count();
  if (count === 0) {
    await prisma.bankroll.create({
      data: {
        total_balance: 1000,
        previous_balance: 1000,
        reserved_balance: 0,
        active_balance: 1000,
        deployed_balance: 0,
        unrealized_pnl: 0,
        balance_delta_today: 0,
        balance_delta_total: 0,
        initial_deposit: 1000,
      },
    });
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

// ─── GET /api/bankroll ────────────────────────────────────────────────────────

describe('GET /api/bankroll', () => {
  it('returns 200 with bankroll data', async () => {
    const res = await request(app).get('/api/bankroll');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // Bankroll may be null or an object
    if (res.body.data !== null) {
      expect(res.body.data).toHaveProperty('total_balance');
      expect(res.body.data).toHaveProperty('updated_at');
    }
  });
});

// ─── GET /api/bankroll/history ────────────────────────────────────────────────

describe('GET /api/bankroll/history', () => {
  it('returns 200 with paginated history', async () => {
    const res = await request(app).get('/api/bankroll/history');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta).toHaveProperty('total');
  });

  it('accepts page/pageSize params', async () => {
    const res = await request(app).get('/api/bankroll/history?page=1&pageSize=5');

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeLessThanOrEqual(5);
    expect(res.body.meta.pageSize).toBe(5);
  });

  it('returns history for date range', async () => {
    const from = '2020-01-01';
    const to = '2030-01-01';
    const res = await request(app).get(`/api/bankroll/history?from=${from}&to=${to}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta).toHaveProperty('total');
  });
});
