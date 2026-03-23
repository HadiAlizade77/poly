import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { prisma, cleanDatabase, marketInput } from './db-helpers.js';

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function seedMarket() {
  return prisma.market.create({ data: marketInput({ category: 'crypto' }) });
}

// ─── CREATE ──────────────────────────────────────────────────────────────────

describe('ContextScore CREATE', () => {
  it('creates a context score linked to a market', async () => {
    const market = await seedMarket();

    const score = await prisma.contextScore.create({
      data: {
        market_id: market.id,
        category: 'crypto',
        scores: { momentum: 0.7, volume: 0.5, sentiment: 0.6 },
      },
    });

    expect(score.id).toBeTruthy();
    expect(score.market_id).toBe(market.id);
    expect(score.category).toBe('crypto');
    expect(score.scores).toEqual({ momentum: 0.7, volume: 0.5, sentiment: 0.6 });
    expect(score.timestamp).toBeInstanceOf(Date);
  });

  it('stores raw_indicators and dashboard_text when provided', async () => {
    const market = await seedMarket();

    const score = await prisma.contextScore.create({
      data: {
        market_id: market.id,
        category: 'crypto',
        scores: { total: 0.75 },
        raw_indicators: { btc_dominance: 52.3, fear_greed_index: 65 },
        dashboard_text: 'Strong crypto momentum with positive sentiment.',
      },
    });

    expect(score.raw_indicators).toEqual({ btc_dominance: 52.3, fear_greed_index: 65 });
    expect(score.dashboard_text).toBe('Strong crypto momentum with positive sentiment.');
  });

  it('rejects score with non-existent market_id (FK violation)', async () => {
    await expect(
      prisma.contextScore.create({
        data: {
          market_id: '00000000-0000-0000-0000-000000000000',
          category: 'crypto',
          scores: { total: 0.5 },
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });
});

// ─── READ ────────────────────────────────────────────────────────────────────

describe('ContextScore READ', () => {
  it('finds scores by market_id', async () => {
    const market = await seedMarket();
    const market2 = await prisma.market.create({ data: marketInput() });

    await prisma.contextScore.create({ data: { market_id: market.id, category: 'crypto', scores: { x: 1 } } });
    await prisma.contextScore.create({ data: { market_id: market.id, category: 'crypto', scores: { x: 2 } } });
    await prisma.contextScore.create({ data: { market_id: market2.id, category: 'crypto', scores: { x: 3 } } });

    const scores = await prisma.contextScore.findMany({ where: { market_id: market.id } });
    expect(scores.length).toBe(2);
    expect(scores.every((s) => s.market_id === market.id)).toBe(true);
  });

  it('filters scores by category', async () => {
    const market = await seedMarket();

    await prisma.contextScore.createMany({
      data: [
        { market_id: market.id, category: 'crypto', scores: {} },
        { market_id: market.id, category: 'politics', scores: {} },
        { market_id: market.id, category: 'crypto', scores: {} },
      ],
    });

    const cryptoScores = await prisma.contextScore.findMany({
      where: { category: 'crypto' },
    });
    expect(cryptoScores.length).toBe(2);
  });

  it('orders scores by timestamp descending', async () => {
    const market = await seedMarket();

    await prisma.contextScore.createMany({
      data: [
        { market_id: market.id, category: 'crypto', scores: { v: 1 }, timestamp: new Date('2024-01-01') },
        { market_id: market.id, category: 'crypto', scores: { v: 2 }, timestamp: new Date('2024-01-03') },
        { market_id: market.id, category: 'crypto', scores: { v: 3 }, timestamp: new Date('2024-01-02') },
      ],
    });

    const scores = await prisma.contextScore.findMany({
      orderBy: { timestamp: 'desc' },
    });
    expect(scores[0].timestamp.toISOString().startsWith('2024-01-03')).toBe(true);
  });

  it('paginates scores', async () => {
    const market = await seedMarket();

    await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        prisma.contextScore.create({
          data: { market_id: market.id, category: 'crypto', scores: { i } },
        }),
      ),
    );

    const page1 = await prisma.contextScore.findMany({ take: 3, skip: 0 });
    const page2 = await prisma.contextScore.findMany({ take: 3, skip: 3 });
    const total = await prisma.contextScore.count();

    expect(page1.length).toBe(3);
    expect(page2.length).toBe(3);
    expect(total).toBe(6);
  });
});

// ─── DELETE ──────────────────────────────────────────────────────────────────

describe('ContextScore DELETE', () => {
  it('deletes a single score', async () => {
    const market = await seedMarket();
    const score = await prisma.contextScore.create({
      data: { market_id: market.id, category: 'crypto', scores: {} },
    });

    await prisma.contextScore.delete({ where: { id: score.id } });

    const found = await prisma.contextScore.findUnique({ where: { id: score.id } });
    expect(found).toBeNull();
  });

  it('cascade-deletes scores when market is deleted', async () => {
    const market = await seedMarket();
    await prisma.contextScore.createMany({
      data: [
        { market_id: market.id, category: 'crypto', scores: {} },
        { market_id: market.id, category: 'crypto', scores: {} },
      ],
    });

    await prisma.contextScore.deleteMany({ where: { market_id: market.id } });
    await prisma.market.delete({ where: { id: market.id } });

    expect(await prisma.contextScore.count()).toBe(0);
  });
});
