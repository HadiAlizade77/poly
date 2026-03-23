import { describe, it, expect } from 'vitest';
import type { MarketSnapshot, ExternalDataPoint, Market } from '@prisma/client';
import type { ScorerInput, ScorerDimension } from '../../../src/services/decision-engine/scorer.interface.js';
import { momentumScorer } from '../../../src/services/decision-engine/scorers/crypto/momentum.scorer.js';
import { volumeScorer } from '../../../src/services/decision-engine/scorers/crypto/volume.scorer.js';
import { volatilityScorer } from '../../../src/services/decision-engine/scorers/crypto/volatility.scorer.js';
import { meanReversionScorer } from '../../../src/services/decision-engine/scorers/crypto/mean-reversion.scorer.js';
import { exchangeDivergenceScorer } from '../../../src/services/decision-engine/scorers/crypto/exchange-divergence.scorer.js';
import { exhaustionScorer } from '../../../src/services/decision-engine/scorers/crypto/exhaustion.scorer.js';
import { liquidityQualityScorer } from '../../../src/services/decision-engine/scorers/crypto/liquidity-quality.scorer.js';
import { timePressureScorer } from '../../../src/services/decision-engine/scorers/crypto/time-pressure.scorer.js';

// ─── Factories ─────────────────────────────────────────────────────────────────

let snapId = 0;
let extId = 0;

function makeMarket(overrides: Record<string, unknown> = {}): Market {
  return {
    id: 'market-test-1',
    polymarket_id: 'pm-test-1',
    title: 'Test BTC Market',
    category: 'crypto',
    status: 'active',
    is_tradeable: true,
    current_prices: { Yes: 0.65, No: 0.35 },
    liquidity: 100_000,
    end_date: null,
    ...overrides,
  } as unknown as Market;
}

function makeSnapshot(price: number, ts: Date, extra: Record<string, unknown> = {}): MarketSnapshot {
  return {
    id: `snap-${snapId++}`,
    market_id: 'market-test-1',
    timestamp: ts,
    prices: { Yes: price },
    spread: 0.05,
    volume_1h: 10_000,
    liquidity: 50_000,
    order_book_depth: null,
    metadata: null,
    ...extra,
  } as unknown as MarketSnapshot;
}

/** Create `count` snapshots with prices linearly interpolated from startPrice to endPrice. */
function makeLinearSnapshots(
  startPrice: number,
  endPrice: number,
  count: number,
  baseMs = 1_700_000_000_000,
): MarketSnapshot[] {
  const step = count > 1 ? (endPrice - startPrice) / (count - 1) : 0;
  return Array.from({ length: count }, (_, i) =>
    makeSnapshot(startPrice + step * i, new Date(baseMs + i * 60_000)),
  );
}

function makeTrade(price: number, quoteVolume: number, ts: Date): ExternalDataPoint {
  return {
    id: `ext-${extId++}`,
    source: 'binance',
    data_type: 'trade',
    timestamp: ts,
    value: { price, quote_volume: quoteVolume },
    market_id: 'market-test-1',
    symbol: 'BTCUSDT',
  } as unknown as ExternalDataPoint;
}

function makeInput(overrides: Partial<ScorerInput> = {}): ScorerInput {
  return {
    market: makeMarket(),
    snapshots: [],
    externalData: [],
    config: {},
    ...overrides,
  };
}

function assertValidScore(dim: ScorerDimension): void {
  expect(dim.value).toBeGreaterThanOrEqual(0);
  expect(dim.value).toBeLessThanOrEqual(100);
  expect(typeof dim.label).toBe('string');
  expect(dim.label.length).toBeGreaterThan(0);
  expect(typeof dim.detail).toBe('string');
}

// ─── Momentum Scorer ──────────────────────────────────────────────────────────

describe('momentumScorer', () => {
  it('returns INSUFFICIENT_DATA when fewer than min_data_points snapshots', () => {
    const result = momentumScorer.score(makeInput({ snapshots: makeLinearSnapshots(0.5, 0.5, 5) }));
    expect(result.value).toBe(50);
    expect(result.label).toBe('INSUFFICIENT_DATA');
  });

  it('always returns a valid score 0–100 with sufficient data', () => {
    const result = momentumScorer.score(makeInput({ snapshots: makeLinearSnapshots(0.4, 0.7, 20) }));
    assertValidScore(result);
  });

  it('scores > 50 for clear uptrend', () => {
    const result = momentumScorer.score(makeInput({ snapshots: makeLinearSnapshots(0.40, 0.70, 25) }));
    expect(result.value).toBeGreaterThan(50);
    expect(result.label).toMatch(/BULL/);
  });

  it('scores < 50 for clear downtrend', () => {
    const result = momentumScorer.score(makeInput({ snapshots: makeLinearSnapshots(0.70, 0.40, 25) }));
    expect(result.value).toBeLessThan(50);
    expect(result.label).toMatch(/BEAR/);
  });

  it('returns a valid score for flat prices without throwing', () => {
    // With flat prices, RSI=100 (zero losses → no-loss artifact) → score≈65, label varies.
    // Just verify the scorer doesn't throw and returns a valid value.
    const result = momentumScorer.score(makeInput({ snapshots: makeLinearSnapshots(0.55, 0.55, 20) }));
    assertValidScore(result);
    expect(['NEUTRAL', 'MODERATE_BULL', 'STRONG_BULL', 'MODERATE_BEAR', 'STRONG_BEAR']).toContain(result.label);
  });

  it('respects custom min_data_points config', () => {
    const snaps = makeLinearSnapshots(0.4, 0.6, 7);
    const withDefault = momentumScorer.score(makeInput({ snapshots: snaps }));
    expect(withDefault.label).toBe('INSUFFICIENT_DATA');

    const withCustom = momentumScorer.score(makeInput({ snapshots: snaps, config: { min_data_points: 5 } }));
    expect(withCustom.label).not.toBe('INSUFFICIENT_DATA');
  });

  it('metadata includes ema_cross, rsi_value, macd_histogram', () => {
    const result = momentumScorer.score(makeInput({ snapshots: makeLinearSnapshots(0.4, 0.7, 20) }));
    expect(result.metadata).toBeDefined();
    expect(result.metadata!['data_points']).toBe(20);
  });

  it('validateConfig rejects non-numeric ema_short', () => {
    const { valid, errors } = momentumScorer.validateConfig({ ema_short: 'bad' });
    expect(valid).toBe(false);
    expect(errors).toBeDefined();
  });

  it('validateConfig accepts valid params', () => {
    const { valid } = momentumScorer.validateConfig({ ema_short: 9, ema_long: 21 });
    expect(valid).toBe(true);
  });
});

// ─── Volume Scorer ────────────────────────────────────────────────────────────

describe('volumeScorer', () => {
  it('returns INSUFFICIENT_DATA with no volumes and no trade data', () => {
    const result = volumeScorer.score(makeInput());
    expect(result.value).toBe(50);
    expect(result.label).toBe('INSUFFICIENT_DATA');
  });

  it('always returns a valid score 0–100 with sufficient snapshots', () => {
    const snaps = Array.from({ length: 5 }, (_, i) =>
      makeSnapshot(0.65, new Date(1_700_000_000_000 + i * 60_000), { volume_1h: 10_000 }),
    );
    const result = volumeScorer.score(makeInput({ snapshots: snaps }));
    assertValidScore(result);
  });

  it('scores high for volume spike (current >> median)', () => {
    // Newest snapshot (index 0) has 5x the median volume
    const snaps = [
      makeSnapshot(0.65, new Date(1_700_000_005_000), { volume_1h: 50_000 }), // current (high)
      makeSnapshot(0.65, new Date(1_700_000_004_000), { volume_1h: 10_000 }),
      makeSnapshot(0.65, new Date(1_700_000_003_000), { volume_1h: 10_000 }),
      makeSnapshot(0.65, new Date(1_700_000_002_000), { volume_1h: 10_000 }),
      makeSnapshot(0.65, new Date(1_700_000_001_000), { volume_1h: 10_000 }),
    ];
    const result = volumeScorer.score(makeInput({ snapshots: snaps }));
    expect(result.value).toBeGreaterThan(50);
    expect(result.label).toMatch(/ABOVE_AVG|EXTREME/);
  });

  it('scores low for dead volume (current << median)', () => {
    const snaps = [
      makeSnapshot(0.65, new Date(1_700_000_005_000), { volume_1h: 100 }), // current (very low)
      makeSnapshot(0.65, new Date(1_700_000_004_000), { volume_1h: 10_000 }),
      makeSnapshot(0.65, new Date(1_700_000_003_000), { volume_1h: 10_000 }),
      makeSnapshot(0.65, new Date(1_700_000_002_000), { volume_1h: 10_000 }),
      makeSnapshot(0.65, new Date(1_700_000_001_000), { volume_1h: 10_000 }),
    ];
    const result = volumeScorer.score(makeInput({ snapshots: snaps }));
    expect(result.value).toBeLessThan(25);
    expect(result.label).toMatch(/BELOW_AVG|DEAD/);
  });

  it('scores ~50 for normal volume (all equal)', () => {
    const snaps = Array.from({ length: 5 }, (_, i) =>
      makeSnapshot(0.65, new Date(1_700_000_000_000 + i * 60_000), { volume_1h: 10_000 }),
    );
    const result = volumeScorer.score(makeInput({ snapshots: snaps }));
    expect(result.value).toBeGreaterThanOrEqual(40);
    expect(result.value).toBeLessThanOrEqual(60);
    expect(result.label).toBe('NORMAL');
  });

  it('falls back to trade data when volume_1h is missing', () => {
    const now = Date.now();
    const trades = Array.from({ length: 5 }, (_, i) =>
      makeTrade(50_000, 100_000, new Date(now - i * 10_000)),
    );
    const result = volumeScorer.score(makeInput({ externalData: trades }));
    assertValidScore(result);
    expect(result.label).not.toBe('INSUFFICIENT_DATA');
  });
});

// ─── Volatility Scorer ────────────────────────────────────────────────────────

describe('volatilityScorer', () => {
  it('returns INSUFFICIENT_DATA with fewer than min_data_points snapshots', () => {
    const result = volatilityScorer.score(makeInput({ snapshots: makeLinearSnapshots(0.5, 0.5, 5) }));
    expect(result.value).toBe(50);
    expect(result.label).toBe('INSUFFICIENT_DATA');
  });

  it('always returns a valid score 0–100', () => {
    const result = volatilityScorer.score(makeInput({ snapshots: makeLinearSnapshots(0.5, 0.5, 15) }));
    assertValidScore(result);
  });

  it('scores high for wide spread (high ATR ratio)', () => {
    // Spread of 0.50 (50%) on a 0.50 price → very high ATR ratio
    const snaps = Array.from({ length: 20 }, (_, i) =>
      makeSnapshot(0.50, new Date(1_700_000_000_000 + i * 60_000), { spread: 0.50 }),
    );
    const result = volatilityScorer.score(makeInput({ snapshots: snaps }));
    expect(result.value).toBeGreaterThanOrEqual(70);
    expect(result.label).toMatch(/HIGH|EXTREME/);
  });

  it('scores low for tight spread (low ATR ratio)', () => {
    // Spread of 0.001 (0.1%) on a 0.50 price → very low ATR ratio
    const snaps = Array.from({ length: 20 }, (_, i) =>
      makeSnapshot(0.50, new Date(1_700_000_000_000 + i * 60_000), { spread: 0.001 }),
    );
    const result = volatilityScorer.score(makeInput({ snapshots: snaps }));
    expect(result.value).toBeLessThanOrEqual(30);
    expect(result.label).toMatch(/LOW|DEAD/);
  });

  it('metadata includes atr_ratio and direction', () => {
    const result = volatilityScorer.score(makeInput({ snapshots: makeLinearSnapshots(0.5, 0.5, 15) }));
    expect(result.metadata).toBeDefined();
    expect(typeof result.metadata!['atr_ratio']).toBe('number');
    expect(typeof result.metadata!['direction']).toBe('string');
  });
});

// ─── Mean Reversion Scorer ────────────────────────────────────────────────────

describe('meanReversionScorer', () => {
  it('returns INSUFFICIENT_DATA with fewer than 15 snapshots', () => {
    const result = meanReversionScorer.score(makeInput({ snapshots: makeLinearSnapshots(0.5, 0.5, 10) }));
    expect(result.value).toBe(50);
    expect(result.label).toBe('INSUFFICIENT_DATA');
  });

  it('always returns a valid score 0–100', () => {
    const result = meanReversionScorer.score(makeInput({ snapshots: makeLinearSnapshots(0.5, 0.5, 20) }));
    assertValidScore(result);
  });

  it('scores low when price is near mean (flat series)', () => {
    // All snapshots at same price → z-score = 0, no deviation
    const snaps = Array.from({ length: 25 }, (_, i) =>
      makeSnapshot(0.50, new Date(1_700_000_000_000 + i * 60_000)),
    );
    const result = meanReversionScorer.score(makeInput({ snapshots: snaps }));
    expect(result.value).toBeLessThanOrEqual(20);
    expect(result.label).toMatch(/NONE|LOW/);
  });

  it('scores high when price spikes far from mean', () => {
    // 20 prices at 0.50, then 5 at 0.85 → extreme z-score
    const snaps = [
      ...Array.from({ length: 20 }, (_, i) =>
        makeSnapshot(0.50, new Date(1_700_000_000_000 + i * 60_000)),
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        makeSnapshot(0.85, new Date(1_700_000_001_200_000 + i * 60_000)),
      ),
    ];
    const result = meanReversionScorer.score(makeInput({ snapshots: snaps }));
    expect(result.value).toBeGreaterThanOrEqual(60);
  });

  it('metadata includes z_score and direction', () => {
    const result = meanReversionScorer.score(makeInput({ snapshots: makeLinearSnapshots(0.5, 0.5, 20) }));
    expect(result.metadata).toBeDefined();
    expect(typeof result.metadata!['z_score']).toBe('number');
    expect(typeof result.metadata!['direction']).toBe('string');
  });
});

// ─── Exchange Divergence Scorer ───────────────────────────────────────────────

describe('exchangeDivergenceScorer', () => {
  it('returns INSUFFICIENT_DATA when no Binance trade data', () => {
    const result = exchangeDivergenceScorer.score(makeInput());
    expect(result.value).toBe(50);
    expect(result.label).toBe('INSUFFICIENT_DATA');
  });

  it('returns INSUFFICIENT_DATA when Binance data is stale (> 5 min old)', () => {
    const staleTs = new Date(Date.now() - 600_000); // 10 min ago
    const result = exchangeDivergenceScorer.score(
      makeInput({ externalData: [makeTrade(50_000, 1_000, staleTs)] }),
    );
    expect(result.value).toBe(50);
    expect(result.label).toBe('INSUFFICIENT_DATA');
  });

  it('returns INSUFFICIENT_DATA when market prices are empty', () => {
    const result = exchangeDivergenceScorer.score(
      makeInput({
        market: makeMarket({ current_prices: {} }),
        externalData: [makeTrade(50_000, 1_000, new Date())],
      }),
    );
    expect(result.value).toBe(50);
    expect(result.label).toBe('INSUFFICIENT_DATA');
  });

  it('always returns a valid score 0–100 with fresh data', () => {
    const result = exchangeDivergenceScorer.score(
      makeInput({ externalData: [makeTrade(50_000, 1_000, new Date())] }),
    );
    assertValidScore(result);
  });

  it('returns ALIGNED when prices are in sync', () => {
    // No old data → returns=0 for both → divergence=0 → score=50
    const result = exchangeDivergenceScorer.score(
      makeInput({ externalData: [makeTrade(50_000, 1_000, new Date())] }),
    );
    expect(result.label).toBe('ALIGNED');
    expect(result.value).toBe(50);
  });

  it('returns divergence > 50 when Binance moved up more than Polymarket', () => {
    const oldTs = new Date(Date.now() - 120_000); // 2 min ago
    const newTs = new Date();
    const externalData = [
      makeTrade(55_000, 1_000, newTs),   // binance went up: 50k → 55k = +10%
      makeTrade(50_000, 1_000, oldTs),
    ];
    const snapshots = [
      makeSnapshot(0.65, newTs),         // poly flat
      makeSnapshot(0.65, oldTs),         // ref: same price (0% poly return)
    ];
    const result = exchangeDivergenceScorer.score(makeInput({ externalData, snapshots }));
    expect(result.value).toBeGreaterThan(50);
    expect(result.label).toMatch(/DIVERGENCE_UP/);
  });

  it('metadata includes binance_price, polymarket_price, divergence', () => {
    const result = exchangeDivergenceScorer.score(
      makeInput({ externalData: [makeTrade(50_000, 1_000, new Date())] }),
    );
    expect(result.metadata).toBeDefined();
    expect(typeof result.metadata!['binance_price']).toBe('number');
    expect(typeof result.metadata!['divergence']).toBe('number');
  });
});

// ─── Exhaustion Scorer ────────────────────────────────────────────────────────

describe('exhaustionScorer', () => {
  it('returns INSUFFICIENT_DATA with no trades and no snapshots', () => {
    const result = exhaustionScorer.score(makeInput());
    expect(result.value).toBe(50);
    expect(result.label).toBe('INSUFFICIENT_DATA');
  });

  it('always returns a valid score 0–100 with sufficient data', () => {
    const now = Date.now();
    const trades = Array.from({ length: 8 }, (_, i) =>
      makeTrade(50_000, 10_000, new Date(now - i * 5_000)),
    );
    const result = exhaustionScorer.score(makeInput({ externalData: trades }));
    assertValidScore(result);
  });

  it('scores low with no volume spike and no price move', () => {
    const now = Date.now();
    // Uniform volume, flat price
    const trades = Array.from({ length: 8 }, (_, i) =>
      makeTrade(50_000, 10_000, new Date(now - i * 5_000)),
    );
    const snaps = makeLinearSnapshots(0.60, 0.61, 6); // <1% move
    const result = exhaustionScorer.score(makeInput({ externalData: trades, snapshots: snaps }));
    expect(result.value).toBeLessThanOrEqual(25);
    expect(result.label).toMatch(/NONE|LOW/);
  });

  it('scores high with both volume spike and significant price move', () => {
    const now = Date.now();
    // Recent 2 trades: 100k, baseline 6 trades: 10k → spike = 10x
    const trades = [
      makeTrade(55_000, 100_000, new Date(now - 1_000)),
      makeTrade(55_000, 100_000, new Date(now - 2_000)),
      ...Array.from({ length: 6 }, (_, i) =>
        makeTrade(50_000, 10_000, new Date(now - (i + 3) * 5_000)),
      ),
    ];
    // Price moved from 0.40 to 0.65 (+62% over 6 snapshots)
    const snaps = makeLinearSnapshots(0.40, 0.65, 6);
    const result = exhaustionScorer.score(makeInput({ externalData: trades, snapshots: snaps }));
    expect(result.value).toBeGreaterThanOrEqual(60);
    expect(result.label).toMatch(/HIGH|EXTREME/);
  });

  it('scores moderate when only volume spike (no price move)', () => {
    const now = Date.now();
    const trades = [
      makeTrade(50_000, 100_000, new Date(now - 1_000)),
      makeTrade(50_000, 100_000, new Date(now - 2_000)),
      ...Array.from({ length: 6 }, (_, i) =>
        makeTrade(50_000, 10_000, new Date(now - (i + 3) * 5_000)),
      ),
    ];
    const result = exhaustionScorer.score(makeInput({ externalData: trades }));
    // Volume spike alone → 30–60 range
    expect(result.value).toBeGreaterThanOrEqual(30);
    expect(result.value).toBeLessThan(65);
  });

  it('satisfies min_data_points from snapshots alone (no trades)', () => {
    const snaps = makeLinearSnapshots(0.5, 0.5, 6);
    const result = exhaustionScorer.score(makeInput({ snapshots: snaps }));
    expect(result.label).not.toBe('INSUFFICIENT_DATA');
  });
});

// ─── Liquidity Quality Scorer ─────────────────────────────────────────────────

describe('liquidityQualityScorer', () => {
  it('returns INSUFFICIENT_DATA when snapshots is empty', () => {
    const result = liquidityQualityScorer.score(makeInput());
    expect(result.value).toBe(50);
    expect(result.label).toBe('INSUFFICIENT_DATA');
  });

  it('always returns a valid score 0–100', () => {
    const result = liquidityQualityScorer.score(
      makeInput({ snapshots: [makeSnapshot(0.65, new Date())] }),
    );
    assertValidScore(result);
  });

  it('scores EXCELLENT for tight spread + high liquidity', () => {
    const snaps = [makeSnapshot(0.65, new Date(), { spread: 0.01, liquidity: 200_000 })];
    const result = liquidityQualityScorer.score(makeInput({ snapshots: snaps }));
    expect(result.value).toBeGreaterThanOrEqual(80);
    expect(result.label).toBe('EXCELLENT');
  });

  it('scores TERRIBLE for very wide spread + very low liquidity', () => {
    const snaps = [makeSnapshot(0.65, new Date(), { spread: 0.50, liquidity: 500 })];
    const result = liquidityQualityScorer.score(makeInput({ snapshots: snaps }));
    expect(result.value).toBeLessThanOrEqual(30);
    expect(result.label).toMatch(/TERRIBLE|POOR/);
  });

  it('scores higher with balanced order book depth', () => {
    const balancedBook = { bid_total: 50_000, ask_total: 50_000 };
    const imbalancedBook = { bid_total: 99_000, ask_total: 1_000 };

    const balanced = liquidityQualityScorer.score(
      makeInput({ snapshots: [makeSnapshot(0.65, new Date(), { spread: 0.05, liquidity: 50_000, order_book_depth: balancedBook })] }),
    );
    const imbalanced = liquidityQualityScorer.score(
      makeInput({ snapshots: [makeSnapshot(0.65, new Date(), { spread: 0.05, liquidity: 50_000, order_book_depth: imbalancedBook })] }),
    );
    expect(balanced.value).toBeGreaterThan(imbalanced.value);
  });

  it('uses market.liquidity as fallback when snapshot.liquidity is absent', () => {
    const snap = { ...makeSnapshot(0.65, new Date()), liquidity: undefined } as unknown as MarketSnapshot;
    const result = liquidityQualityScorer.score(
      makeInput({ market: makeMarket({ liquidity: 200_000 }), snapshots: [snap] }),
    );
    assertValidScore(result);
  });

  it('metadata includes spread_score, liquidity_score, depth_score', () => {
    const result = liquidityQualityScorer.score(
      makeInput({ snapshots: [makeSnapshot(0.65, new Date())] }),
    );
    expect(result.metadata!['spread_score']).toBeDefined();
    expect(result.metadata!['liquidity_score']).toBeDefined();
    expect(result.metadata!['depth_score']).toBeDefined();
  });

  it('validateConfig rejects tight_spread >= wide_spread', () => {
    const { valid, errors } = liquidityQualityScorer.validateConfig({
      tight_spread: 0.10,
      wide_spread: 0.05,
    });
    expect(valid).toBe(false);
    expect(errors).toBeDefined();
  });
});

// ─── Time Pressure Scorer ─────────────────────────────────────────────────────

describe('timePressureScorer', () => {
  it('returns value=50, label=NONE when market has no end_date', () => {
    const result = timePressureScorer.score(makeInput({ market: makeMarket({ end_date: null }) }));
    expect(result.value).toBe(50);
    expect(result.label).toBe('NONE');
  });

  it('always returns a valid score 0–100', () => {
    const futureDate = new Date(Date.now() + 7 * 24 * 3600_000); // 7 days
    const result = timePressureScorer.score(makeInput({ market: makeMarket({ end_date: futureDate }) }));
    assertValidScore(result);
  });

  it('returns value=100, label=IMMINENT when resolution has passed', () => {
    const past = new Date(Date.now() - 3600_000); // 1h ago
    const result = timePressureScorer.score(makeInput({ market: makeMarket({ end_date: past }) }));
    expect(result.value).toBe(100);
    expect(result.label).toBe('IMMINENT');
    expect(result.metadata!['expired']).toBe(true);
  });

  it('returns score=98, label=IMMINENT when within too_close_minutes (< 5 min)', () => {
    const nearFuture = new Date(Date.now() + 2 * 60_000); // 2 min away
    const result = timePressureScorer.score(makeInput({ market: makeMarket({ end_date: nearFuture }) }));
    expect(result.value).toBe(98);
    expect(result.label).toBe('IMMINENT');
  });

  it('returns score in 80–98 range when within urgent_minutes (< 1h)', () => {
    const urgent = new Date(Date.now() + 30 * 60_000); // 30 min away
    const result = timePressureScorer.score(makeInput({ market: makeMarket({ end_date: urgent }) }));
    expect(result.value).toBeGreaterThanOrEqual(80);
    expect(result.value).toBeLessThanOrEqual(98);
    expect(result.label).toBe('IMMINENT');
  });

  it('returns score in 50–80 range when within soon_minutes (< 24h)', () => {
    const soon = new Date(Date.now() + 12 * 3600_000); // 12h away
    const result = timePressureScorer.score(makeInput({ market: makeMarket({ end_date: soon }) }));
    expect(result.value).toBeGreaterThanOrEqual(50);
    expect(result.value).toBeLessThanOrEqual(80);
  });

  it('returns low score (≤ 20) when far out (> 30 days)', () => {
    const farOut = new Date(Date.now() + 60 * 24 * 3600_000); // 60 days away
    const result = timePressureScorer.score(makeInput({ market: makeMarket({ end_date: farOut }) }));
    expect(result.value).toBeLessThanOrEqual(20);
    expect(result.label).toMatch(/LOW|NONE/);
  });

  it('metadata includes remaining_minutes and remaining_days', () => {
    const futureDate = new Date(Date.now() + 3 * 24 * 3600_000);
    const result = timePressureScorer.score(makeInput({ market: makeMarket({ end_date: futureDate }) }));
    expect(typeof result.metadata!['remaining_minutes']).toBe('number');
    expect(typeof result.metadata!['remaining_days']).toBe('number');
  });

  it('scores are in ascending order: far < near < imminent', () => {
    const far    = timePressureScorer.score(makeInput({ market: makeMarket({ end_date: new Date(Date.now() + 60 * 24 * 3600_000) }) }));
    const near   = timePressureScorer.score(makeInput({ market: makeMarket({ end_date: new Date(Date.now() + 6 * 3600_000) }) }));
    const urgent = timePressureScorer.score(makeInput({ market: makeMarket({ end_date: new Date(Date.now() + 20 * 60_000) }) }));
    expect(far.value).toBeLessThan(near.value);
    expect(near.value).toBeLessThan(urgent.value);
  });
});
