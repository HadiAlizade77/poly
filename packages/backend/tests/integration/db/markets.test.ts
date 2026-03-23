import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { prisma, cleanDatabase, marketInput, expectUniqueViolation } from './db-helpers.js';

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

// ─── CREATE ──────────────────────────────────────────────────────────────────

describe('Market CREATE', () => {
  it('creates a market with required fields only', async () => {
    const market = await prisma.market.create({ data: marketInput() });

    expect(market.id).toBeTruthy();
    expect(market.category).toBe('crypto');
    expect(market.status).toBe('active');        // default
    expect(market.is_tradeable).toBe(true);      // default
    expect(market.tags).toEqual([]);             // default
    expect(market.first_seen_at).toBeInstanceOf(Date);
  });

  it('creates a market with optional fields populated', async () => {
    const input = marketInput({
      description: 'Will BTC exceed $100k?',
      subcategory: 'bitcoin',
      tags: ['crypto', 'bitcoin'],
      current_prices: { Yes: 0.65, No: 0.35 },
      volume_24h: 125000,
      liquidity: 50000,
    });
    const market = await prisma.market.create({ data: input });

    expect(market.description).toBe('Will BTC exceed $100k?');
    expect(market.tags).toEqual(['crypto', 'bitcoin']);
    expect(market.volume_24h?.toNumber()).toBeCloseTo(125000);
  });

  it('rejects duplicate polymarket_id (unique constraint)', async () => {
    await prisma.market.create({ data: marketInput({ polymarket_id: 'pm-dupe' }) });

    await expectUniqueViolation(() =>
      prisma.market.create({ data: marketInput({ polymarket_id: 'pm-dupe' }) }),
    );
  });
});

// ─── READ ────────────────────────────────────────────────────────────────────

describe('Market READ', () => {
  it('finds a market by id', async () => {
    const created = await prisma.market.create({ data: marketInput() });
    const found = await prisma.market.findUnique({ where: { id: created.id } });

    expect(found).not.toBeNull();
    expect(found!.id).toBe(created.id);
    expect(found!.polymarket_id).toBe(created.polymarket_id);
  });

  it('returns null for unknown id', async () => {
    const found = await prisma.market.findUnique({
      where: { id: '00000000-0000-0000-0000-000000000000' },
    });
    expect(found).toBeNull();
  });

  it('filters markets by category', async () => {
    await prisma.market.create({ data: marketInput({ category: 'crypto' }) });
    await prisma.market.create({ data: marketInput({ category: 'politics' }) });
    await prisma.market.create({ data: marketInput({ category: 'crypto' }) });

    const cryptoMarkets = await prisma.market.findMany({
      where: { category: 'crypto' },
    });
    expect(cryptoMarkets.length).toBe(2);
    expect(cryptoMarkets.every((m) => m.category === 'crypto')).toBe(true);
  });

  it('filters markets by status', async () => {
    await prisma.market.create({ data: marketInput({ status: 'active' }) });
    await prisma.market.create({ data: marketInput({ status: 'closed' }) });

    const active = await prisma.market.findMany({ where: { status: 'active' } });
    expect(active.length).toBe(1);
    expect(active[0].status).toBe('active');
  });

  it('paginates with skip and take', async () => {
    await Promise.all(Array.from({ length: 5 }, () => prisma.market.create({ data: marketInput() })));

    const page1 = await prisma.market.findMany({ take: 2, skip: 0, orderBy: { first_seen_at: 'asc' } });
    const page2 = await prisma.market.findMany({ take: 2, skip: 2, orderBy: { first_seen_at: 'asc' } });

    expect(page1.length).toBe(2);
    expect(page2.length).toBe(2);
    expect(page1[0].id).not.toBe(page2[0].id);
  });

  it('counts markets matching a filter', async () => {
    await Promise.all([
      prisma.market.create({ data: marketInput({ category: 'sports' }) }),
      prisma.market.create({ data: marketInput({ category: 'sports' }) }),
      prisma.market.create({ data: marketInput({ category: 'crypto' }) }),
    ]);

    const count = await prisma.market.count({ where: { category: 'sports' } });
    expect(count).toBe(2);
  });
});

// ─── UPDATE ──────────────────────────────────────────────────────────────────

describe('Market UPDATE', () => {
  it('updates market status and resolved_outcome', async () => {
    const market = await prisma.market.create({ data: marketInput() });

    const updated = await prisma.market.update({
      where: { id: market.id },
      data: { status: 'resolved', resolved_outcome: 'Yes', is_tradeable: false },
    });

    expect(updated.status).toBe('resolved');
    expect(updated.resolved_outcome).toBe('Yes');
    expect(updated.is_tradeable).toBe(false);
    expect(updated.updated_at.getTime()).toBeGreaterThanOrEqual(market.updated_at.getTime());
  });

  it('updates current_prices JSON field', async () => {
    const market = await prisma.market.create({ data: marketInput() });

    const updated = await prisma.market.update({
      where: { id: market.id },
      data: { current_prices: { Yes: 0.80, No: 0.20 } },
    });

    expect(updated.current_prices).toEqual({ Yes: 0.80, No: 0.20 });
  });
});

// ─── DELETE ──────────────────────────────────────────────────────────────────

describe('Market DELETE', () => {
  it('deletes a market by id', async () => {
    const market = await prisma.market.create({ data: marketInput() });

    await prisma.market.delete({ where: { id: market.id } });

    const found = await prisma.market.findUnique({ where: { id: market.id } });
    expect(found).toBeNull();
  });

  it('deletes many markets matching a filter', async () => {
    await Promise.all([
      prisma.market.create({ data: marketInput({ status: 'closed' }) }),
      prisma.market.create({ data: marketInput({ status: 'closed' }) }),
      prisma.market.create({ data: marketInput({ status: 'active' }) }),
    ]);

    const result = await prisma.market.deleteMany({ where: { status: 'closed' } });

    expect(result.count).toBe(2);
    expect(await prisma.market.count()).toBe(1);
  });
});
