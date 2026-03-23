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

  it('response has total_trades field', async () => {
    const res = await request(app).get('/api/analytics/summary');

    expect(res.body.data).toHaveProperty('total_trades');
    expect(typeof res.body.data.total_trades).toBe('number');
  });

  it('response has winning_trades and losing_trades fields', async () => {
    const res = await request(app).get('/api/analytics/summary');

    expect(typeof res.body.data.winning_trades).toBe('number');
    expect(typeof res.body.data.losing_trades).toBe('number');
  });

  it('response has total_pnl and total_fees fields', async () => {
    const res = await request(app).get('/api/analytics/summary');

    expect(typeof res.body.data.total_pnl).toBe('number');
    expect(typeof res.body.data.total_fees).toBe('number');
  });

  it('response has by_category field', async () => {
    const res = await request(app).get('/api/analytics/summary');

    expect(res.body.data).toHaveProperty('by_category');
    expect(typeof res.body.data.by_category).toBe('object');
  });

  it('avg_pnl_per_trade, best_trade_pnl, worst_trade_pnl, avg_hold_time_hours are null when no trades', async () => {
    const res = await request(app).get('/api/analytics/summary');

    expect(res.body.data.avg_pnl_per_trade).toBeNull();
    expect(res.body.data.best_trade_pnl).toBeNull();
    expect(res.body.data.worst_trade_pnl).toBeNull();
    expect(res.body.data.avg_hold_time_hours).toBeNull();
  });

  it('win_rate is null when no closed positions', async () => {
    const res = await request(app).get('/api/analytics/summary');

    expect(res.body.data.total_trades).toBe(0);
    expect(res.body.data.win_rate).toBeNull();
  });

  it('total_trades is 0 in empty DB', async () => {
    const res = await request(app).get('/api/analytics/summary');

    expect(res.body.data.total_trades).toBe(0);
    expect(res.body.data.winning_trades).toBe(0);
    expect(res.body.data.losing_trades).toBe(0);
  });
});
