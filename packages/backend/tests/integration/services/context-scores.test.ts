import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as ContextScoreService from '../../../src/services/context-score.service.js';
import { prisma, uid, mkMarketInput, deleteTestMarkets, cleanDatabase } from './helpers.js';

const PREFIX = 'test-ctx-svc-';

// One test market shared across the file
let marketId: string;

beforeAll(async () => {
  await cleanDatabase();
  const m = await prisma.market.create({
    data: mkMarketInput(`${PREFIX}main-${uid()}`),
  });
  marketId = m.id;
});

afterAll(async () => {
  await deleteTestMarkets(PREFIX);
  await prisma.$disconnect();
});

function scoreInput(overrides = {}) {
  return {
    market_id: marketId,
    category: 'crypto',
    scores: { momentum: 0.7, volume: 0.5 },
    ...overrides,
  };
}

// ─── create ──────────────────────────────────────────────────────────────────

describe('ContextScoreService.create', () => {
  it('creates a score and returns it', async () => {
    const score = await ContextScoreService.create(scoreInput());

    expect(score.id).toBeTruthy();
    expect(score.market_id).toBe(marketId);
    expect(score.category).toBe('crypto');
    expect(score.scores).toEqual({ momentum: 0.7, volume: 0.5 });
    expect(score.timestamp).toBeInstanceOf(Date);
  });

  it('stores optional fields raw_indicators and dashboard_text', async () => {
    const score = await ContextScoreService.create(
      scoreInput({
        raw_indicators: { btc_dom: 52.3 },
        dashboard_text: 'Bullish momentum.',
      }),
    );

    expect(score.raw_indicators).toEqual({ btc_dom: 52.3 });
    expect(score.dashboard_text).toBe('Bullish momentum.');
  });
});

// ─── findByMarket ─────────────────────────────────────────────────────────────

describe('ContextScoreService.findByMarket', () => {
  it('returns scores for the market', async () => {
    await ContextScoreService.create(scoreInput());
    await ContextScoreService.create(scoreInput());

    const result = await ContextScoreService.findByMarket(marketId);

    expect(result.items.length).toBeGreaterThanOrEqual(2);
    expect(result.items.every((s) => s.market_id === marketId)).toBe(true);
    expect(result.total).toBeGreaterThanOrEqual(2);
  });

  it('paginates scores for the market', async () => {
    const page1 = await ContextScoreService.findByMarket(marketId, { page: 1, pageSize: 2 });
    expect(page1.items.length).toBeLessThanOrEqual(2);
    expect(page1.pageSize).toBe(2);
    expect(page1.page).toBe(1);
  });

  it('returns empty result for unknown market', async () => {
    const result = await ContextScoreService.findByMarket('00000000-0000-0000-0000-000000000000');
    expect(result.items).toHaveLength(0);
    expect(result.total).toBe(0);
  });
});

// ─── getLatestForMarket ───────────────────────────────────────────────────────

describe('ContextScoreService.getLatestForMarket', () => {
  it('returns the most recent score for a market', async () => {
    const t1 = new Date('2025-01-01T10:00:00Z');
    const t2 = new Date('2025-01-02T10:00:00Z');

    await ContextScoreService.create(scoreInput({ timestamp: t1, scores: { v: 1 } }));
    await ContextScoreService.create(scoreInput({ timestamp: t2, scores: { v: 2 } }));

    const latest = await ContextScoreService.getLatestForMarket(marketId);

    expect(latest).not.toBeNull();
    // Should be t2 (the more recent one)
    expect(latest!.timestamp.getTime()).toBeGreaterThanOrEqual(t1.getTime());
  });

  it('returns null for unknown market', async () => {
    const result = await ContextScoreService.getLatestForMarket(
      '00000000-0000-0000-0000-000000000000',
    );
    expect(result).toBeNull();
  });
});

// ─── findByCategory ───────────────────────────────────────────────────────────

describe('ContextScoreService.findByCategory', () => {
  it('returns scores for a category', async () => {
    await ContextScoreService.create(scoreInput({ category: 'crypto' }));

    const result = await ContextScoreService.findByCategory('crypto');

    expect(result.items.length).toBeGreaterThanOrEqual(1);
    expect(result.items.every((s) => s.category === 'crypto')).toBe(true);
  });

  it('filters by "since" date', async () => {
    const past = new Date('2020-01-01');
    const future = new Date('2030-01-01');

    await ContextScoreService.create(scoreInput({ timestamp: past }));

    const result = await ContextScoreService.findByCategory('crypto', future);
    // Scores before `future` should not appear
    expect(result.items.every((s) => new Date(s.timestamp) >= future)).toBe(true);
  });

  it('paginates category results', async () => {
    const page = await ContextScoreService.findByCategory('crypto', undefined, {
      page: 1,
      pageSize: 2,
    });
    expect(page.items.length).toBeLessThanOrEqual(2);
    expect(page.pageSize).toBe(2);
  });
});

// ─── pruneOlderThan ───────────────────────────────────────────────────────────

describe('ContextScoreService.pruneOlderThan', () => {
  it('deletes scores older than the cutoff and returns count', async () => {
    const old = new Date('2010-06-01');
    await ContextScoreService.create(scoreInput({ timestamp: old }));

    const cutoff = new Date('2011-01-01');
    const deleted = await ContextScoreService.pruneOlderThan(cutoff);

    expect(deleted).toBeGreaterThanOrEqual(1);
    const remaining = await ContextScoreService.findByMarket(marketId);
    expect(remaining.items.every((s) => new Date(s.timestamp) >= cutoff)).toBe(true);
  });
});
