import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app, prisma, uid, mkMarketInput, deleteTestMarkets, cleanDatabase } from './helpers.js';

const PREFIX = 'test-api-dec-';
let marketId: string;
let decisionId: string; // BigInt serialized as string

beforeAll(async () => {
  await cleanDatabase();
  const m = await prisma.market.create({ data: mkMarketInput(`${PREFIX}${uid()}`) });
  marketId = m.id;

  // Create a decision to use in GET /:id
  const d = await prisma.aiDecision.create({
    data: {
      market_id: marketId,
      category: 'crypto',
      dashboard_text: 'Test decision',
      account_state: { balance: 10000 },
      action: 'trade',
      direction: 'Yes',
      outcome_token: 'yes-token',
      confidence: 0.72,
      reasoning: 'Edge detected.',
    },
  });
  decisionId = String(d.id);
});

afterAll(async () => {
  await deleteTestMarkets(PREFIX);
  await prisma.$disconnect();
});

// ─── GET /api/decisions ───────────────────────────────────────────────────────

describe('GET /api/decisions', () => {
  it('returns 200 with paginated list', async () => {
    const res = await request(app).get('/api/decisions');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta).toHaveProperty('total');
    expect(res.body.meta.total).toBeGreaterThanOrEqual(1);
  });

  it('filters by action=trade', async () => {
    const res = await request(app).get('/api/decisions?action=trade');

    expect(res.status).toBe(200);
    expect(res.body.data.every((d: { action: string }) => d.action === 'trade')).toBe(true);
  });

  it('filters by action=hold', async () => {
    const res = await request(app).get('/api/decisions?action=hold');

    expect(res.status).toBe(200);
    expect(res.body.data.every((d: { action: string }) => d.action === 'hold')).toBe(true);
  });

  it('filters by marketId', async () => {
    const res = await request(app).get(`/api/decisions?marketId=${marketId}`);

    expect(res.status).toBe(200);
    expect(res.body.data.every((d: { market_id: string }) => d.market_id === marketId)).toBe(true);
    expect(res.body.meta.total).toBeGreaterThanOrEqual(1);
  });

  it('paginates results', async () => {
    const res = await request(app).get('/api/decisions?page=1&pageSize=2');

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeLessThanOrEqual(2);
    expect(res.body.meta.page).toBe(1);
    expect(res.body.meta.pageSize).toBe(2);
  });
});

// ─── GET /api/decisions/stats ─────────────────────────────────────────────────

describe('GET /api/decisions/stats', () => {
  it('returns aggregate stats', async () => {
    const res = await request(app).get('/api/decisions/stats');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.data.total).toBe('number');
    expect(typeof res.body.data.tradeCount).toBe('number');
    expect(typeof res.body.data.holdCount).toBe('number');
    expect(typeof res.body.data.executedCount).toBe('number');
    expect(res.body.data.tradeCount + res.body.data.holdCount).toBe(res.body.data.total);
  });
});

// ─── GET /api/decisions/:id ───────────────────────────────────────────────────

describe('GET /api/decisions/:id', () => {
  it('returns a decision by id', async () => {
    const res = await request(app).get(`/api/decisions/${decisionId}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(String(res.body.data.id)).toBe(decisionId);
  });

  it('returns 404 for unknown id', async () => {
    const res = await request(app).get('/api/decisions/999999999999');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
