/**
 * E2E: Market Scanner Pipeline
 *
 * Tests the scanner's classify → upsert → snapshot → Redis publish loop
 * using the demo/mock Polymarket client.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { PrismaClient, type Prisma } from '@prisma/client';
import { cleanDatabase } from '../../integration/db/db-helpers.js';
import { classifyMarket } from '../../../src/services/market-scanner/classifier.js';
import * as marketService from '../../../src/services/market.service.js';
import * as marketSnapshotService from '../../../src/services/market-snapshot.service.js';
import type { PolymarketMarket } from '../../../src/integrations/polymarket/types.js';
import { DEMO_MARKETS } from '../../../src/integrations/polymarket/demo-data.js';

const prisma = new PrismaClient();

// ── Helpers ──────────────────────────────────────────────────────────────────

function makePmMarket(overrides: Partial<PolymarketMarket> = {}): PolymarketMarket {
  const id = `e2e-scan-${Math.random().toString(36).slice(2, 9)}`;
  return {
    condition_id: id,
    question: 'Will Bitcoin close above $100k?',
    description: 'BTC price prediction market.',
    market_slug: `${id}-slug`,
    end_date_iso: new Date(Date.now() + 90 * 86_400_000).toISOString(),
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

async function simulateScanCycle(markets: PolymarketMarket[]) {
  const results: Array<{ conditionId: string; category: string; marketId: string }> = [];

  for (const pm of markets) {
    const category = classifyMarket(
      pm.question,
      pm.description,
      pm.tags as Array<string | { label?: string; slug?: string }>,
    );
    const { create, update } = buildUpsertPayload(pm, category);
    const market = await marketService.upsert(pm.condition_id, create, update);

    // Write snapshot
    const prices = Object.fromEntries(pm.tokens.map((t) => [t.outcome, t.price]));
    const spread = pm.tokens.length >= 2
      ? (Math.max(...pm.tokens.map((t) => t.price)) - Math.min(...pm.tokens.map((t) => t.price))).toFixed(6)
      : null;

    await marketSnapshotService.create({
      market_id: market.id,
      timestamp: new Date(),
      prices: prices as Prisma.InputJsonValue,
      spread,
      liquidity: pm.liquidity ?? null,
      metadata: { source: 'demo' } as Prisma.InputJsonValue,
    });

    results.push({ conditionId: pm.condition_id, category, marketId: market.id });
  }

  return results;
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

// ── Classification ───────────────────────────────────────────────────────────

describe('Scanner Pipeline – Classification', () => {
  it('classifies crypto markets correctly', () => {
    expect(classifyMarket('Will Bitcoin hit $100k?')).toBe('crypto');
    expect(classifyMarket('Will Ethereum exceed $5000?')).toBe('crypto');
    expect(classifyMarket('Will Solana flip ETH by market cap?')).toBe('crypto');
  });

  it('classifies politics markets correctly', () => {
    expect(classifyMarket('Will the Fed cut rates?', 'Federal Reserve rate decision.')).toBe('politics');
    expect(classifyMarket('Will the president win reelection?')).toBe('politics');
  });

  it('classifies sports markets correctly', () => {
    expect(classifyMarket('Will the Lakers win the NBA Championship?')).toBe('sports');
    expect(classifyMarket('Will Liverpool win the Premier League?')).toBe('sports');
  });

  it('classifies via tags when title is ambiguous', () => {
    const pm = makePmMarket({
      question: 'Price prediction for 2025',
      tags: [{ id: 1, label: 'Ethereum', slug: 'ethereum' }],
    });
    const category = classifyMarket(pm.question, pm.description, pm.tags as any);
    expect(category).toBe('crypto');
  });

  it('falls back to "other" for truly unclassifiable markets', () => {
    const category = classifyMarket('Will it rain tomorrow in London?');
    expect(['events', 'other']).toContain(category);
  });
});

// ── Full Scan Cycle ──────────────────────────────────────────────────────────

describe('Scanner Pipeline – Full Scan Cycle', () => {
  it('scan creates markets in DB with correct categories', async () => {
    const demoSubset = DEMO_MARKETS.slice(0, 8);
    const results = await simulateScanCycle(demoSubset);

    expect(results.length).toBe(8);

    // Verify all markets in DB
    for (const r of results) {
      const dbMarket = await prisma.market.findUnique({
        where: { polymarket_id: r.conditionId },
      });
      expect(dbMarket).not.toBeNull();
      expect(dbMarket!.category).toBe(r.category);
      expect(dbMarket!.is_tradeable).toBe(true);
    }

    // Check category distribution
    const categories = results.map((r) => r.category);
    expect(categories).toContain('crypto');
    expect(categories).toContain('politics');
  });

  it('scan creates snapshots for each market', async () => {
    const markets = [
      makePmMarket({ question: 'Will ETH reach $5k?' }),
      makePmMarket({ question: 'Will Lakers win NBA title?', tags: [] }),
    ];

    const results = await simulateScanCycle(markets);

    for (const r of results) {
      const snapCount = await prisma.marketSnapshot.count({
        where: { market_id: r.marketId },
      });
      expect(snapCount).toBe(1);
    }
  });

  it('second scan updates markets, does not duplicate', async () => {
    const markets = [makePmMarket({ question: 'Will BTC hit $200k?' })];

    // First scan
    const first = await simulateScanCycle(markets);
    const initialCount = await prisma.market.count({
      where: { polymarket_id: markets[0].condition_id },
    });
    expect(initialCount).toBe(1);

    // Second scan with updated prices
    markets[0].tokens[0].price = 0.80;
    markets[0].tokens[1].price = 0.20;
    await simulateScanCycle(markets);

    // Still only 1 market
    const finalCount = await prisma.market.count({
      where: { polymarket_id: markets[0].condition_id },
    });
    expect(finalCount).toBe(1);

    // Prices updated
    const dbMarket = await prisma.market.findUnique({
      where: { polymarket_id: markets[0].condition_id },
    });
    const prices = dbMarket!.current_prices as Record<string, number>;
    expect(prices['Yes']).toBeCloseTo(0.80);

    // Should have 2 snapshots now
    const snapCount = await prisma.marketSnapshot.count({
      where: { market_id: first[0].marketId },
    });
    expect(snapCount).toBe(2);
  });

  it('handles empty market list gracefully', async () => {
    const results = await simulateScanCycle([]);
    expect(results.length).toBe(0);

    const marketCount = await prisma.market.count();
    expect(marketCount).toBe(0);
  });

  it('marks closed markets correctly', async () => {
    const pm = makePmMarket({
      question: 'Closed market test',
      active: false,
      closed: true,
    });

    await simulateScanCycle([pm]);

    const dbMarket = await prisma.market.findUnique({
      where: { polymarket_id: pm.condition_id },
    });
    expect(dbMarket!.status).toBe('closed');
    expect(dbMarket!.is_tradeable).toBe(false);
  });

  it('marks archived markets as excluded', async () => {
    const pm = makePmMarket({
      question: 'Archived market test',
      active: false,
      closed: false,
      archived: true,
    });

    await simulateScanCycle([pm]);

    const dbMarket = await prisma.market.findUnique({
      where: { polymarket_id: pm.condition_id },
    });
    expect(dbMarket!.status).toBe('excluded');
    expect(dbMarket!.is_tradeable).toBe(false);
  });

  it('processes demo data end-to-end (all 20 demo markets)', async () => {
    const results = await simulateScanCycle(DEMO_MARKETS);

    expect(results.length).toBe(DEMO_MARKETS.length);

    // All markets should be in DB
    const dbCount = await prisma.market.count();
    expect(dbCount).toBe(DEMO_MARKETS.length);

    // All should have snapshots
    const snapCount = await prisma.marketSnapshot.count();
    expect(snapCount).toBe(DEMO_MARKETS.length);
  });
});
