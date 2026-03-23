import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as MarketService from '../../../src/services/market.service.js';
import { UniqueConstraintError, NotFoundError } from '../../../src/services/errors.js';
import { prisma, uid, mkMarketInput, deleteTestMarkets, cleanDatabase } from './helpers.js';

const PREFIX = 'test-mkt-svc-';

beforeAll(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await deleteTestMarkets(PREFIX);
  await prisma.$disconnect();
});

// ─── create ──────────────────────────────────────────────────────────────────

describe('MarketService.create', () => {
  it('creates a market and returns it', async () => {
    const pmId = `${PREFIX}${uid()}`;
    const market = await MarketService.create(mkMarketInput(pmId));

    expect(market.id).toBeTruthy();
    expect(market.polymarket_id).toBe(pmId);
    expect(market.status).toBe('active');
    expect(market.is_tradeable).toBe(true);
  });

  it('throws UniqueConstraintError on duplicate polymarket_id', async () => {
    const pmId = `${PREFIX}dupe-${uid()}`;
    await MarketService.create(mkMarketInput(pmId));

    await expect(MarketService.create(mkMarketInput(pmId))).rejects.toBeInstanceOf(
      UniqueConstraintError,
    );
  });
});

// ─── findById ─────────────────────────────────────────────────────────────────

describe('MarketService.findById', () => {
  it('returns market by uuid', async () => {
    const created = await MarketService.create(mkMarketInput(`${PREFIX}${uid()}`));
    const found = await MarketService.findById(created.id);

    expect(found.id).toBe(created.id);
    expect(found.polymarket_id).toBe(created.polymarket_id);
  });

  it('throws NotFoundError for unknown id', async () => {
    await expect(
      MarketService.findById('00000000-0000-0000-0000-000000000000'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

// ─── findByPolymarketId ───────────────────────────────────────────────────────

describe('MarketService.findByPolymarketId', () => {
  it('returns market for known polymarket_id', async () => {
    const pmId = `${PREFIX}${uid()}`;
    await MarketService.create(mkMarketInput(pmId));

    const found = await MarketService.findByPolymarketId(pmId);
    expect(found).not.toBeNull();
    expect(found!.polymarket_id).toBe(pmId);
  });

  it('returns null for unknown polymarket_id', async () => {
    const found = await MarketService.findByPolymarketId('pm-does-not-exist-xyz');
    expect(found).toBeNull();
  });
});

// ─── findMany (filters + pagination) ─────────────────────────────────────────

describe('MarketService.findMany', () => {
  it('returns paginated result shape', async () => {
    const result = await MarketService.findMany({}, { page: 1, pageSize: 5 });

    expect(result).toHaveProperty('items');
    expect(result).toHaveProperty('total');
    expect(result).toHaveProperty('page', 1);
    expect(result).toHaveProperty('pageSize', 5);
    expect(result).toHaveProperty('totalPages');
    expect(Array.isArray(result.items)).toBe(true);
    expect(result.items.length).toBeLessThanOrEqual(5);
  });

  it('filters by category', async () => {
    // Create one sports market (our test data)
    const pmId = `${PREFIX}sports-${uid()}`;
    await MarketService.create(mkMarketInput(pmId, { category: 'sports' }));

    const result = await MarketService.findMany({ category: 'sports' });
    expect(result.items.every((m) => m.category === 'sports')).toBe(true);
    expect(result.total).toBeGreaterThanOrEqual(1);
  });

  it('filters by status', async () => {
    const result = await MarketService.findMany({ status: 'active' });
    expect(result.items.every((m) => m.status === 'active')).toBe(true);
  });

  it('filters by search term (title contains)', async () => {
    const unique = `UniqueTitle_${uid()}`;
    await MarketService.create(
      mkMarketInput(`${PREFIX}search-${uid()}`, { title: `Test market ${unique}` }),
    );

    const result = await MarketService.findMany({ search: unique });
    expect(result.total).toBeGreaterThanOrEqual(1);
    expect(result.items.every((m) => m.title.toLowerCase().includes(unique.toLowerCase()))).toBe(
      true,
    );
  });

  it('paginates across pages', async () => {
    const page1 = await MarketService.findMany({}, { page: 1, pageSize: 3 });
    const page2 = await MarketService.findMany({}, { page: 2, pageSize: 3 });

    expect(page1.items.length).toBeLessThanOrEqual(3);
    // Pages shouldn't overlap
    const ids1 = new Set(page1.items.map((m) => m.id));
    page2.items.forEach((m) => expect(ids1.has(m.id)).toBe(false));
  });
});

// ─── findTradeable ────────────────────────────────────────────────────────────

describe('MarketService.findTradeable', () => {
  it('returns only active tradeable markets', async () => {
    // Create an untradeable market to confirm it's excluded
    await MarketService.create(
      mkMarketInput(`${PREFIX}excl-${uid()}`, {
        status: 'closed',
        is_tradeable: false,
      }),
    );

    const markets = await MarketService.findTradeable();
    expect(markets.every((m) => m.status === 'active' && m.is_tradeable)).toBe(true);
  });

  it('filters by category when provided', async () => {
    const markets = await MarketService.findTradeable('crypto');
    expect(markets.every((m) => m.category === 'crypto')).toBe(true);
  });
});

// ─── update ───────────────────────────────────────────────────────────────────

describe('MarketService.update', () => {
  it('updates market fields', async () => {
    const market = await MarketService.create(mkMarketInput(`${PREFIX}upd-${uid()}`));

    const updated = await MarketService.update(market.id, {
      volume_24h: 99000,
      current_prices: { Yes: 0.8, No: 0.2 },
    });

    expect(Number(updated.volume_24h)).toBeCloseTo(99000);
    expect(updated.current_prices).toEqual({ Yes: 0.8, No: 0.2 });
  });
});

// ─── setStatus ────────────────────────────────────────────────────────────────

describe('MarketService.setStatus', () => {
  it('sets market status and exclusion reason', async () => {
    const market = await MarketService.create(mkMarketInput(`${PREFIX}status-${uid()}`));

    const updated = await MarketService.setStatus(market.id, 'excluded', 'Low liquidity');

    expect(updated.status).toBe('excluded');
    expect(updated.exclusion_reason).toBe('Low liquidity');
    expect(updated.is_tradeable).toBe(true); // unchanged
  });

  it('resolves a market', async () => {
    const market = await MarketService.create(mkMarketInput(`${PREFIX}res-${uid()}`));

    const updated = await MarketService.setStatus(market.id, 'resolved');
    expect(updated.status).toBe('resolved');
  });
});

// ─── upsert ───────────────────────────────────────────────────────────────────

describe('MarketService.upsert', () => {
  it('creates on first call, updates on second', async () => {
    const pmId = `${PREFIX}ups-${uid()}`;

    const created = await MarketService.upsert(pmId, mkMarketInput(pmId), {
      volume_24h: 1000,
    });
    expect(created.polymarket_id).toBe(pmId);

    const updated = await MarketService.upsert(pmId, mkMarketInput(pmId), {
      volume_24h: 2000,
    });
    expect(Number(updated.volume_24h)).toBeCloseTo(2000);

    const count = await prisma.market.count({ where: { polymarket_id: pmId } });
    expect(count).toBe(1);
  });
});
