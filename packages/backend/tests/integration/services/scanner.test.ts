/**
 * Integration tests for the market scanner pipeline.
 *
 * Tests the core logic the MarketScanner uses:
 *   classifyMarket → marketService.upsert → marketSnapshotService.create
 *
 * Runs against a real PostgreSQL database; cleanDatabase() is called in
 * beforeAll so every test starts with a known-clean state.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { classifyMarket } from '../../../src/services/market-scanner/classifier.js';
import * as marketService from '../../../src/services/market.service.js';
import * as marketSnapshotService from '../../../src/services/market-snapshot.service.js';
import type { PolymarketMarket } from '../../../src/integrations/polymarket/types.js';
import { PrismaClient, type Prisma } from '@prisma/client';
import { cleanDatabase } from '../db/db-helpers.js';

const prisma = new PrismaClient();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makePmMarket(overrides: Partial<PolymarketMarket> = {}): PolymarketMarket {
  const id = `test-scanner-${Math.random().toString(36).slice(2, 9)}`;
  return {
    condition_id: id,
    question: 'Will Bitcoin close above $100k?',
    description: 'BTC price prediction market.',
    market_slug: `${id}-slug`,
    end_date_iso: '2025-12-31T00:00:00Z',
    tokens: [
      { token_id: `${id}-yes`, outcome: 'Yes', price: 0.65 },
      { token_id: `${id}-no`, outcome: 'No', price: 0.35 },
    ],
    tags: [{ id: 1, label: 'Bitcoin', slug: 'bitcoin' }],
    active: true,
    closed: false,
    archived: false,
    volume: '1000000.00',
    volume_24hr: '50000.00',
    liquidity: '200000.00',
    ...overrides,
  };
}

function buildUpsertPayload(pm: PolymarketMarket, category: string) {
  const prices = Object.fromEntries(pm.tokens.map((t) => [t.outcome, t.price]));
  const outcomes = pm.tokens.map((t) => ({ tokenId: t.token_id, outcome: t.outcome }));

  const shared = {
    slug: pm.market_slug ?? null,
    title: pm.question,
    description: pm.description ?? null,
    status: (pm.closed ? 'closed' : pm.archived ? 'excluded' : 'active') as 'active' | 'closed' | 'excluded',
    outcomes: outcomes as Prisma.InputJsonValue,
    current_prices: prices as Prisma.InputJsonValue,
    volume_24h: pm.volume_24hr ?? null,
    liquidity: pm.liquidity ?? null,
    end_date: pm.end_date_iso ? new Date(pm.end_date_iso) : null,
    tags: (pm.tags ?? []).map((t) =>
      typeof t === 'string' ? t : (t as { label?: string }).label ?? '',
    ),
    is_tradeable: pm.active && !pm.closed && !pm.archived,
  };

  return {
    create: { ...shared, category, polymarket_id: pm.condition_id } as Prisma.MarketUncheckedCreateInput,
    update: shared as Prisma.MarketUncheckedUpdateInput,
  };
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

// ─── Classification ───────────────────────────────────────────────────────────

describe('Scanner pipeline – classification', () => {
  it('classifies a crypto market correctly', () => {
    const pm = makePmMarket({ question: 'Will Bitcoin hit $100k?' });
    expect(classifyMarket(pm.question, pm.description)).toBe('crypto');
  });

  it('classifies a politics market correctly', () => {
    const pm = makePmMarket({
      question: 'Will the Fed cut rates in Q1 2025?',
      description: 'Federal Reserve rate decision.',
      tags: [],
    });
    expect(classifyMarket(pm.question, pm.description)).toBe('politics');
  });

  it('classifies a sports market correctly', () => {
    const pm = makePmMarket({
      question: 'Will the Lakers win the NBA Championship?',
      tags: [],
    });
    expect(classifyMarket(pm.question)).toBe('sports');
  });

  it('classifies via tags when title alone is ambiguous', () => {
    const pm = makePmMarket({
      question: 'Price prediction for 2025',
      tags: [{ id: 1, label: 'Ethereum', slug: 'ethereum' }],
    });
    const category = classifyMarket(pm.question, pm.description, pm.tags as Array<string | { label?: string; slug?: string }>);
    expect(category).toBe('crypto');
  });
});

// ─── Upsert behaviour ─────────────────────────────────────────────────────────

describe('Scanner pipeline – market upsert', () => {
  it('creates a new market on first upsert', async () => {
    const pm = makePmMarket({ question: 'Will Solana flip ETH?' });
    const category = classifyMarket(pm.question, pm.description);
    const { create, update } = buildUpsertPayload(pm, category);

    const market = await marketService.upsert(pm.condition_id, create, update);

    expect(market.id).toBeTruthy();
    expect(market.polymarket_id).toBe(pm.condition_id);
    expect(market.category).toBe('crypto');
    expect(market.title).toBe('Will Solana flip ETH?');
    expect(market.status).toBe('active');
    expect(market.is_tradeable).toBe(true);
  });

  it('updates existing market on second upsert (no duplicate)', async () => {
    const pm = makePmMarket({ question: 'Will BTC reach $200k?' });
    const category = classifyMarket(pm.question, pm.description);
    const { create, update } = buildUpsertPayload(pm, category);

    // First upsert – creates
    await marketService.upsert(pm.condition_id, create, update);

    // Second upsert – should update, not create
    const updatedPayload = buildUpsertPayload(
      { ...pm, volume_24hr: '99999.00' },
      category,
    );
    const updated = await marketService.upsert(pm.condition_id, updatedPayload.create, updatedPayload.update);

    const count = await prisma.market.count({ where: { polymarket_id: pm.condition_id } });
    expect(count).toBe(1); // still just 1 record
    expect(Number(updated.volume_24h)).toBeCloseTo(99999);
  });

  it('stores extracted prices as current_prices JSON', async () => {
    const pm = makePmMarket({
      tokens: [
        { token_id: 'tok-yes', outcome: 'Yes', price: 0.72 },
        { token_id: 'tok-no', outcome: 'No', price: 0.28 },
      ],
    });
    const category = classifyMarket(pm.question, pm.description);
    const { create, update } = buildUpsertPayload(pm, category);

    const market = await marketService.upsert(pm.condition_id, create, update);
    const prices = market.current_prices as Record<string, number>;

    expect(prices['Yes']).toBeCloseTo(0.72);
    expect(prices['No']).toBeCloseTo(0.28);
  });

  it('marks closed market as closed status', async () => {
    const pm = makePmMarket({
      question: 'Closed market',
      active: false,
      closed: true,
    });
    const category = classifyMarket(pm.question);
    const { create, update } = buildUpsertPayload(pm, category);

    const market = await marketService.upsert(pm.condition_id, create, update);

    expect(market.status).toBe('closed');
    expect(market.is_tradeable).toBe(false);
  });

  it('marks archived market as excluded status', async () => {
    const pm = makePmMarket({
      question: 'Archived market',
      active: false,
      closed: false,
      archived: true,
    });
    const category = classifyMarket(pm.question);
    const { create, update } = buildUpsertPayload(pm, category);

    const market = await marketService.upsert(pm.condition_id, create, update);

    expect(market.status).toBe('excluded');
    expect(market.is_tradeable).toBe(false);
  });

  it('upserts multiple distinct markets without conflict', async () => {
    const markets = Array.from({ length: 5 }, (_, i) =>
      makePmMarket({ question: `Crypto market ${i}` }),
    );

    for (const pm of markets) {
      const category = classifyMarket(pm.question, pm.description);
      const { create, update } = buildUpsertPayload(pm, category);
      await marketService.upsert(pm.condition_id, create, update);
    }

    // All 5 markets should be in the DB
    const ids = markets.map((m) => m.condition_id);
    const count = await prisma.market.count({
      where: { polymarket_id: { in: ids } },
    });
    expect(count).toBe(5);
  });
});

// ─── Snapshot creation ────────────────────────────────────────────────────────

describe('Scanner pipeline – snapshot creation', () => {
  it('creates a snapshot after upserting a market', async () => {
    const pm = makePmMarket({ question: 'Snapshot test market – BTC' });
    const category = classifyMarket(pm.question, pm.description);
    const { create, update } = buildUpsertPayload(pm, category);

    const market = await marketService.upsert(pm.condition_id, create, update);

    const prices = Object.fromEntries(pm.tokens.map((t) => [t.outcome, t.price]));
    const snapshot = await marketSnapshotService.create({
      market_id: market.id,
      timestamp: new Date(),
      prices: prices as Prisma.InputJsonValue,
      spread: '0.30',
      liquidity: pm.liquidity ?? null,
      metadata: { source: 'test' } as Prisma.InputJsonValue,
    });

    expect(snapshot.id).toBeTruthy();
    expect(snapshot.market_id).toBe(market.id);
    const snapshotPrices = snapshot.prices as Record<string, number>;
    expect(snapshotPrices['Yes']).toBeCloseTo(0.65);
  });

  it('creates multiple snapshots for the same market', async () => {
    const pm = makePmMarket({ question: 'Multi-snapshot BTC market' });
    const category = classifyMarket(pm.question, pm.description);
    const { create, update } = buildUpsertPayload(pm, category);
    const market = await marketService.upsert(pm.condition_id, create, update);

    const t0 = new Date('2025-01-01T12:00:00Z');
    const t1 = new Date('2025-01-01T12:01:00Z');

    await marketSnapshotService.create({
      market_id: market.id,
      timestamp: t0,
      prices: { Yes: 0.65, No: 0.35 } as Prisma.InputJsonValue,
      metadata: { source: 'test' } as Prisma.InputJsonValue,
    });

    await marketSnapshotService.create({
      market_id: market.id,
      timestamp: t1,
      prices: { Yes: 0.70, No: 0.30 } as Prisma.InputJsonValue,
      metadata: { source: 'test' } as Prisma.InputJsonValue,
    });

    const snapshots = await prisma.marketSnapshot.findMany({
      where: { market_id: market.id },
      orderBy: { timestamp: 'asc' },
    });

    expect(snapshots).toHaveLength(2);
    expect((snapshots[0].prices as Record<string, number>)['Yes']).toBeCloseTo(0.65);
    expect((snapshots[1].prices as Record<string, number>)['Yes']).toBeCloseTo(0.70);
  });

  it('snapshot spread is stored correctly', async () => {
    const pm = makePmMarket({ question: 'Spread test – ETH market' });
    const { create, update } = buildUpsertPayload(pm, 'crypto');
    const market = await marketService.upsert(pm.condition_id, create, update);

    // Yes=0.65, No=0.35 → spread = 0.65 - 0.35 = 0.30
    const spread = (pm.tokens[0].price - pm.tokens[1].price).toFixed(6);

    const snapshot = await marketSnapshotService.create({
      market_id: market.id,
      timestamp: new Date(),
      prices: { Yes: 0.65, No: 0.35 } as Prisma.InputJsonValue,
      spread,
      metadata: { source: 'test' } as Prisma.InputJsonValue,
    });

    expect(Number(snapshot.spread)).toBeCloseTo(0.3);
  });
});

// ─── Full pipeline simulation ──────────────────────────────────────────────────

describe('Scanner pipeline – end-to-end simulation', () => {
  it('simulates a full scan cycle: classify → upsert → snapshot', async () => {
    const demoMarkets: PolymarketMarket[] = [
      makePmMarket({ question: 'Will ETH hit $5k?' }),
      makePmMarket({ question: 'Will the Federal Reserve cut rates?', description: 'Interest rate decision.', tags: [] }),
      makePmMarket({ question: 'Will the Lakers win the NBA title?', description: 'Championship prediction.', tags: [] }),
    ];

    const results: { category: string; id: string }[] = [];

    for (const pm of demoMarkets) {
      const category = classifyMarket(
        pm.question,
        pm.description,
        pm.tags as Array<string | { label?: string; slug?: string }>,
      );
      const { create, update } = buildUpsertPayload(pm, category);

      const market = await marketService.upsert(pm.condition_id, create, update);

      const prices = Object.fromEntries(pm.tokens.map((t) => [t.outcome, t.price]));
      await marketSnapshotService.create({
        market_id: market.id,
        timestamp: new Date(),
        prices: prices as Prisma.InputJsonValue,
        metadata: { source: 'scan-test' } as Prisma.InputJsonValue,
      });

      results.push({ category, id: market.id });
    }

    expect(results[0].category).toBe('crypto');
    expect(results[1].category).toBe('politics');
    expect(results[2].category).toBe('sports');

    // All 3 markets upserted
    expect(results.every((r) => r.id)).toBe(true);

    // All 3 snapshots created
    for (const { id } of results) {
      const count = await prisma.marketSnapshot.count({ where: { market_id: id } });
      expect(count).toBe(1);
    }
  });

  it('re-scanning the same markets only updates, no duplicates', async () => {
    const pm = makePmMarket({ question: 'BTC/ETH ratio in 2025?' });
    const category = classifyMarket(pm.question, pm.description);

    // First scan
    const { create: c1, update: u1 } = buildUpsertPayload(pm, category);
    await marketService.upsert(pm.condition_id, c1, u1);

    // Second scan with updated prices
    const { create: c2, update: u2 } = buildUpsertPayload(
      { ...pm, tokens: [{ token_id: `${pm.condition_id}-yes`, outcome: 'Yes', price: 0.80 }, { token_id: `${pm.condition_id}-no`, outcome: 'No', price: 0.20 }] },
      category,
    );
    await marketService.upsert(pm.condition_id, c2, u2);

    const count = await prisma.market.count({ where: { polymarket_id: pm.condition_id } });
    expect(count).toBe(1); // No duplicates

    const market = await prisma.market.findUnique({ where: { polymarket_id: pm.condition_id } });
    const prices = market!.current_prices as Record<string, number>;
    expect(prices['Yes']).toBeCloseTo(0.80); // Updated price
  });
});
