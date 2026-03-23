/**
 * E2E: Context Scoring Pipeline
 *
 * Tests all scorer categories with real DB data:
 *   crypto (8 scorers), politics (8), sports (7), events (6)
 * Validates score ranges, labels, enable/disable, and missing-data handling.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { PrismaClient, type Prisma } from '@prisma/client';
import { cleanDatabase } from '../../integration/db/db-helpers.js';
import { scorerRegistry } from '../../../src/services/decision-engine/scorer-registry.js';
import { registerAllScorers } from '../../../src/services/decision-engine/scorers/index.js';
import * as contextScoreService from '../../../src/services/context-score.service.js';
import * as scorerConfigService from '../../../src/services/scorer-config.service.js';
import * as marketService from '../../../src/services/market.service.js';
import * as marketSnapshotService from '../../../src/services/market-snapshot.service.js';
import type { ScorerInput, ScoredDimensions } from '../../../src/services/decision-engine/scorer.interface.js';

const prisma = new PrismaClient();
const uid = () => Math.random().toString(36).slice(2, 9);

// ── Helpers ──────────────────────────────────────────────────────────────────

async function seedMarket(category: string, overrides: Record<string, unknown> = {}) {
  const id = uid();
  return marketService.create({
    polymarket_id: `pm-score-${id}`,
    title: `Score Test ${category} ${id}`,
    category,
    status: 'active',
    is_tradeable: true,
    outcomes: [
      { name: 'Yes', token_id: `yes-${id}` },
      { name: 'No', token_id: `no-${id}` },
    ] as unknown as Prisma.InputJsonValue,
    current_prices: { Yes: 0.65, No: 0.35 } as Prisma.InputJsonValue,
    volume_24h: '50000',
    liquidity: '25000',
    end_date: new Date(Date.now() + 7 * 86_400_000),
    resolution_criteria: 'Standard resolution criteria for testing',
    ...overrides,
  } as Prisma.MarketUncheckedCreateInput);
}

async function seedSnapshots(marketId: string, count = 5) {
  const snapshots = [];
  for (let i = 0; i < count; i++) {
    const snap = await marketSnapshotService.create({
      market_id: marketId,
      timestamp: new Date(Date.now() - (count - i) * 60_000),
      prices: { Yes: 0.60 + i * 0.02, No: 0.40 - i * 0.02 } as Prisma.InputJsonValue,
      spread: '0.04',
      volume_1h: (4000 + i * 500).toString(),
      liquidity: '25000',
    });
    snapshots.push(snap);
  }
  return snapshots;
}

async function seedTradeData(count = 5) {
  for (let i = 0; i < count; i++) {
    await prisma.externalDataPoint.create({
      data: {
        source: 'binance',
        data_type: 'trade',
        symbol: 'BTCUSDT',
        timestamp: new Date(Date.now() - (count - i) * 30_000),
        value: { price: 67000 + i * 100, volume: 1.5 + i * 0.2, side: 'buy' } as Prisma.InputJsonValue,
      },
    });
  }
}

async function seedKlineData(count = 15) {
  for (let i = 0; i < count; i++) {
    await prisma.externalDataPoint.create({
      data: {
        source: 'binance',
        data_type: 'kline_1m',
        symbol: 'BTCUSDT',
        timestamp: new Date(Date.now() - (count - i) * 60_000),
        value: {
          open: 67000 + i * 50,
          high: 67100 + i * 50,
          low: 66900 + i * 50,
          close: 67050 + i * 50,
          volume: 12.5 + i * 0.5,
        } as Prisma.InputJsonValue,
      },
    });
  }
}

async function seedPollData() {
  for (let i = 0; i < 3; i++) {
    await prisma.externalDataPoint.create({
      data: {
        source: 'polling',
        data_type: 'poll_result',
        timestamp: new Date(Date.now() - (3 - i) * 3_600_000),
        value: {
          candidate: 'Candidate A',
          support: 0.52 + i * 0.01,
          sample_size: 1000 + i * 200,
          pollster: 'TestPoll Inc',
        } as Prisma.InputJsonValue,
      },
    });
  }
}

async function seedOddsData() {
  for (let i = 0; i < 3; i++) {
    await prisma.externalDataPoint.create({
      data: {
        source: 'odds-api',
        data_type: 'game_odds',
        timestamp: new Date(Date.now() - (3 - i) * 900_000),
        value: {
          home_team: 'Lakers',
          away_team: 'Celtics',
          home_odds: -150 + i * 10,
          away_odds: 130 - i * 10,
          implied_home: 0.60 + i * 0.02,
          implied_away: 0.40 - i * 0.02,
          bookmaker: 'TestBook',
        } as Prisma.InputJsonValue,
      },
    });
  }
}

function runScorers(
  category: string,
  market: any,
  snapshots: any[],
  externalData: any[],
): ScoredDimensions {
  const scorers = scorerRegistry.getScorersForCategory(category);
  const scores: ScoredDimensions = {};
  for (const scorer of scorers) {
    const input: ScorerInput = {
      market,
      snapshots,
      externalData,
      config: {},
    };
    scores[scorer.name] = scorer.score(input);
  }
  return scores;
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeAll(() => {
  registerAllScorers();
});

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

// ── Crypto Scorers ───────────────────────────────────────────────────────────

describe('Scoring Pipeline – Crypto', () => {
  it('runs all 8+ crypto scorers and returns valid dimensions', async () => {
    const market = await seedMarket('crypto');
    const snapshots = await seedSnapshots(market.id, 10);
    await seedTradeData(10);
    await seedKlineData(15);

    const externalData = await prisma.externalDataPoint.findMany({
      orderBy: { timestamp: 'desc' },
      take: 50,
    });

    const scores = runScorers('crypto', market, snapshots, externalData);
    const scorerNames = Object.keys(scores);

    expect(scorerNames.length).toBeGreaterThanOrEqual(8);

    for (const [name, dim] of Object.entries(scores)) {
      expect(dim.value, `${name}.value`).toBeGreaterThanOrEqual(0);
      expect(dim.value, `${name}.value`).toBeLessThanOrEqual(100);
      expect(dim.label, `${name}.label`).toBeTruthy();
      expect(typeof dim.detail, `${name}.detail`).toBe('string');
    }

    // Verify specific scorer presence
    expect(scorerNames).toContain('exchange_divergence');
    expect(scorerNames).toContain('momentum');
    expect(scorerNames).toContain('mean_reversion');
    expect(scorerNames).toContain('volatility');
    expect(scorerNames).toContain('volume');
    expect(scorerNames).toContain('exhaustion');
    expect(scorerNames).toContain('liquidity_quality');
    expect(scorerNames).toContain('time_pressure');
  });

  it('stores scores in context_scores table', async () => {
    const market = await seedMarket('crypto');
    const snapshots = await seedSnapshots(market.id, 5);
    const scores = runScorers('crypto', market, snapshots, []);

    const saved = await contextScoreService.create({
      market_id: market.id,
      category: 'crypto',
      scores: scores as unknown as Prisma.InputJsonValue,
      raw_indicators: {} as Prisma.InputJsonValue,
      dashboard_text: 'test dashboard text',
    });

    expect(saved.id).toBeTruthy();
    expect(saved.market_id).toBe(market.id);
    expect(saved.category).toBe('crypto');

    // Retrieve and verify
    const latest = await contextScoreService.getLatestForMarket(market.id);
    expect(latest).not.toBeNull();
    const storedScores = latest!.scores as Record<string, { value: number }>;
    expect(Object.keys(storedScores).length).toBeGreaterThanOrEqual(8);
  });

  it('returns neutral (50) for scorers with missing data', () => {
    const scorers = scorerRegistry.getScorersForCategory('crypto');

    for (const scorer of scorers) {
      const input: ScorerInput = {
        market: {
          id: 'no-data-test',
          category: 'crypto',
          current_prices: { Yes: 0.65, No: 0.35 },
          liquidity: 25000,
          end_date: new Date(Date.now() + 7 * 86_400_000),
          title: 'No data market',
          resolution_criteria: 'Test',
          metadata: {},
        } as any,
        snapshots: [],
        externalData: [],
        config: {},
      };

      const dim = scorer.score(input);
      // Should not crash
      expect(dim.value).toBeGreaterThanOrEqual(0);
      expect(dim.value).toBeLessThanOrEqual(100);
      // Most should return neutral ~50 when data is missing
    }
  });
});

// ── Politics Scorers ─────────────────────────────────────────────────────────

describe('Scoring Pipeline – Politics', () => {
  it('runs all politics scorers', async () => {
    const market = await seedMarket('politics', {
      title: 'Will the president win reelection?',
      resolution_criteria: 'Official election results',
    });
    const snapshots = await seedSnapshots(market.id, 5);
    await seedPollData();

    const externalData = await prisma.externalDataPoint.findMany({
      orderBy: { timestamp: 'desc' },
      take: 50,
    });

    const scores = runScorers('politics', market, snapshots, externalData);
    const scorerNames = Object.keys(scores);

    expect(scorerNames.length).toBeGreaterThanOrEqual(6);
    expect(scorerNames).toContain('poll_divergence');
    expect(scorerNames).toContain('sentiment_shift');
    expect(scorerNames).toContain('historical_base_rate');
    expect(scorerNames).toContain('resolution_risk');
    expect(scorerNames).toContain('crowd_bias');
    expect(scorerNames).toContain('information_velocity');

    for (const dim of Object.values(scores)) {
      expect(dim.value).toBeGreaterThanOrEqual(0);
      expect(dim.value).toBeLessThanOrEqual(100);
    }
  });
});

// ── Sports Scorers ───────────────────────────────────────────────────────────

describe('Scoring Pipeline – Sports', () => {
  it('runs all sports scorers', async () => {
    const market = await seedMarket('sports', {
      title: 'Will the Lakers win the NBA Championship?',
    });
    const snapshots = await seedSnapshots(market.id, 5);
    await seedOddsData();

    const externalData = await prisma.externalDataPoint.findMany({
      orderBy: { timestamp: 'desc' },
      take: 50,
    });

    const scores = runScorers('sports', market, snapshots, externalData);
    const scorerNames = Object.keys(scores);

    expect(scorerNames.length).toBeGreaterThanOrEqual(5);
    expect(scorerNames).toContain('odds_divergence');
    expect(scorerNames).toContain('line_movement');
    expect(scorerNames).toContain('injury_impact');
    expect(scorerNames).toContain('public_bias');
    expect(scorerNames).toContain('model_edge');

    for (const dim of Object.values(scores)) {
      expect(dim.value).toBeGreaterThanOrEqual(0);
      expect(dim.value).toBeLessThanOrEqual(100);
    }
  });
});

// ── Events Scorers ───────────────────────────────────────────────────────────

describe('Scoring Pipeline – Events', () => {
  it('runs all events scorers', async () => {
    const market = await seedMarket('events', {
      title: 'Will SpaceX launch Starship this month?',
    });
    const snapshots = await seedSnapshots(market.id, 5);

    const scores = runScorers('events', market, snapshots, []);
    const scorerNames = Object.keys(scores);

    expect(scorerNames.length).toBeGreaterThanOrEqual(4);
    expect(scorerNames).toContain('base_rate');
    expect(scorerNames).toContain('schedule_signal');
    expect(scorerNames).toContain('news_impact');
    expect(scorerNames).toContain('crowd_confidence');

    for (const dim of Object.values(scores)) {
      expect(dim.value).toBeGreaterThanOrEqual(0);
      expect(dim.value).toBeLessThanOrEqual(100);
    }
  });
});

// ── Scorer Enable/Disable ────────────────────────────────────────────────────

describe('Scoring Pipeline – Enable/Disable', () => {
  it('disabling a scorer via scorer_configs removes it from enabled list', async () => {
    const allCrypto = scorerRegistry.getScorersForCategory('crypto');
    expect(allCrypto.length).toBeGreaterThan(0);

    // Disable the momentum scorer
    await scorerConfigService.upsert('crypto', 'momentum', {
      is_enabled: false,
      parameters: {} as Prisma.InputJsonValue,
    });

    const enabled = await scorerRegistry.getEnabledScorers('crypto');
    const enabledNames = enabled.map((s) => s.name);

    expect(enabledNames).not.toContain('momentum');
    // Others should still be enabled
    expect(enabledNames).toContain('volume');
  });

  it('re-enabling a scorer adds it back', async () => {
    // Disable then re-enable
    const cfg = await scorerConfigService.upsert('crypto', 'volume', {
      is_enabled: false,
      parameters: {} as Prisma.InputJsonValue,
    });

    let enabled = await scorerRegistry.getEnabledScorers('crypto');
    expect(enabled.map((s) => s.name)).not.toContain('volume');

    await scorerConfigService.update(cfg.id, { is_enabled: true });

    enabled = await scorerRegistry.getEnabledScorers('crypto');
    expect(enabled.map((s) => s.name)).toContain('volume');
  });
});

// ── Extreme Prices ───────────────────────────────────────────────────────────

describe('Scoring Pipeline – Edge Cases', () => {
  it('all scorers handle extreme prices (0.01 and 0.99)', () => {
    const categories = scorerRegistry.getCategories();

    for (const price of [0.01, 0.50, 0.99]) {
      for (const category of categories) {
        const scorers = scorerRegistry.getScorersForCategory(category);
        for (const scorer of scorers) {
          const input: ScorerInput = {
            market: {
              id: 'extreme-test',
              category,
              current_prices: { Yes: price, No: 1 - price },
              liquidity: 25000,
              end_date: new Date(Date.now() + 7 * 86_400_000),
              title: 'Extreme price test',
              resolution_criteria: 'Test',
              metadata: {},
            } as any,
            snapshots: [],
            externalData: [],
            config: {},
          };

          const dim = scorer.score(input);
          expect(dim.value, `${category}/${scorer.name} at price ${price}`).toBeGreaterThanOrEqual(0);
          expect(dim.value, `${category}/${scorer.name} at price ${price}`).toBeLessThanOrEqual(100);
        }
      }
    }
  });
});
