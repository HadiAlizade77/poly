import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app, prisma, cleanDatabase } from './helpers.js';

beforeAll(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

// ─── GET /api/analytics/summary ───────────────────────────────────────────────

describe('GET /api/analytics/summary', () => {
  it('returns 200 with success=true', async () => {
    const res = await request(app).get('/api/analytics/summary');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('response has bankroll field (null when empty)', async () => {
    const res = await request(app).get('/api/analytics/summary');

    expect(res.body.data).toHaveProperty('bankroll');
    // no bankroll seeded — should be null
    expect(res.body.data.bankroll).toBeNull();
  });

  it('response has positions.open field', async () => {
    const res = await request(app).get('/api/analytics/summary');

    expect(res.body.data.positions).toMatchObject({
      open: expect.any(Number),
    });
    expect(res.body.data.positions.open).toBe(0);
  });

  it('response has orders.open field', async () => {
    const res = await request(app).get('/api/analytics/summary');

    expect(res.body.data.orders).toMatchObject({
      open: expect.any(Number),
    });
  });

  it('response has alerts.unread field', async () => {
    const res = await request(app).get('/api/analytics/summary');

    expect(res.body.data.alerts).toMatchObject({
      unread: expect.any(Number),
    });
  });

  it('response has trades counts (24h, 7d, 30d)', async () => {
    const res = await request(app).get('/api/analytics/summary');

    expect(res.body.data.trades).toMatchObject({
      count24h: expect.any(Number),
      count7d: expect.any(Number),
      count30d: expect.any(Number),
    });
  });

  it('response has performance30d with expected keys', async () => {
    const res = await request(app).get('/api/analytics/summary');

    expect(res.body.data.performance30d).toMatchObject({
      closedPositions: expect.any(Number),
      winCount: expect.any(Number),
      lossCount: expect.any(Number),
      decisions: expect.any(Number),
      decisionsExecuted: expect.any(Number),
    });
  });

  it('winRate is null when no closed positions', async () => {
    const res = await request(app).get('/api/analytics/summary');

    // No position_history seeded
    expect(res.body.data.performance30d.closedPositions).toBe(0);
    expect(res.body.data.performance30d.winRate).toBeNull();
  });

  it('trade counts are 0 in empty DB', async () => {
    const res = await request(app).get('/api/analytics/summary');

    expect(res.body.data.trades.count24h).toBe(0);
    expect(res.body.data.trades.count7d).toBe(0);
    expect(res.body.data.trades.count30d).toBe(0);
  });
});
