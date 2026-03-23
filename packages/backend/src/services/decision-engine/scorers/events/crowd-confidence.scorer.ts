// ─── Crowd Confidence Scorer ─────────────────────────────────────────────────
// How confident the crowd is: volume + price stability.
// 0 = low confidence/uncertainty, 100 = extreme confidence.

import type { ContextScorer, ScorerInput, ScorerDimension } from '../../scorer.interface.js';

const PARAM_DEFAULTS = {
  min_snapshots: 3,
  high_confidence_price: 0.85,
  low_confidence_price: 0.55,
};

function cfg(config: Record<string, unknown>) {
  return {
    min_snapshots: typeof config.min_snapshots === 'number' ? config.min_snapshots : PARAM_DEFAULTS.min_snapshots,
    high_confidence_price: typeof config.high_confidence_price === 'number' ? config.high_confidence_price : PARAM_DEFAULTS.high_confidence_price,
    low_confidence_price: typeof config.low_confidence_price === 'number' ? config.low_confidence_price : PARAM_DEFAULTS.low_confidence_price,
  };
}

export const crowdConfidenceScorer: ContextScorer = {
  name: 'crowd_confidence',
  category: 'events',

  score(context: ScorerInput): ScorerDimension {
    const params = cfg(context.config);

    const prices = context.market.current_prices as Record<string, number> | null;
    const yesPrice = prices ? (Object.values(prices)[0] ?? 0.5) : 0.5;

    // ── Price Extremity (40%) ───────────────────────────────────────────
    // Prices near 0 or 1 show crowd confidence in outcome
    const extremity = Math.abs(yesPrice - 0.5) * 2; // 0 at 0.50, 1 at 0.0/1.0
    const priceScore = extremity;

    // ── Price Stability (30%) ───────────────────────────────────────────
    let stabilityScore = 0.5; // default neutral
    if (context.snapshots.length >= params.min_snapshots) {
      const priceSeries = [...context.snapshots]
        .sort((a, b) => (a.timestamp as Date).getTime() - (b.timestamp as Date).getTime())
        .map((s) => {
          const p = s.prices as Record<string, number> | null;
          return p ? (Object.values(p)[0] ?? 0.5) : 0.5;
        });

      const returns: number[] = [];
      for (let i = 1; i < priceSeries.length; i++) {
        if (priceSeries[i - 1] > 0) {
          returns.push(Math.abs((priceSeries[i] - priceSeries[i - 1]) / priceSeries[i - 1]));
        }
      }

      if (returns.length > 0) {
        const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
        // Low volatility = high stability = high confidence
        stabilityScore = Math.max(0, 1 - avgReturn * 50); // 2% avg move → 0 stability
      }
    }

    // ── Volume Level (30%) ──────────────────────────────────────────────
    let volumeScore = 0.5;
    const volumes = context.snapshots
      .map((s) => (typeof s.volume_1h === 'number' ? Number(s.volume_1h) : null))
      .filter((v): v is number => v !== null);

    if (volumes.length > 0) {
      const avgVol = volumes.reduce((a, b) => a + b, 0) / volumes.length;
      const liquidity = typeof context.market.liquidity === 'number' ? Number(context.market.liquidity) : 10_000;
      // Volume relative to liquidity: high trading relative to available liquidity = conviction
      const volRatio = liquidity > 0 ? avgVol / liquidity : 0;
      volumeScore = Math.min(1, volRatio * 10); // 10% hourly turnover → max
    }

    // ── Composite ─────────────────────────────────────────────────────────
    const composite = priceScore * 0.40 + stabilityScore * 0.30 + volumeScore * 0.30;
    const score = Math.max(0, Math.min(100, Math.round(composite * 100)));

    let label: string;
    if (score >= 80) label = 'VERY_HIGH';
    else if (score >= 60) label = 'HIGH';
    else if (score >= 40) label = 'MODERATE';
    else if (score >= 20) label = 'LOW';
    else label = 'VERY_LOW';

    const direction = yesPrice > 0.5 ? 'YES' : yesPrice < 0.5 ? 'NO' : 'split';

    return {
      value: score,
      label,
      detail: `Crowd ${(composite * 100).toFixed(0)}% confident in ${direction} · Price ${(yesPrice * 100).toFixed(1)}% · Stability ${(stabilityScore * 100).toFixed(0)}% · Volume ${(volumeScore * 100).toFixed(0)}%`,
      metadata: {
        price_score: priceScore,
        stability_score: stabilityScore,
        volume_score: volumeScore,
        yes_price: yesPrice,
        direction,
        snapshot_count: context.snapshots.length,
      },
    };
  },

  getRequiredData(): string[] {
    return [];
  },

  validateConfig(params: Record<string, unknown>): { valid: boolean; errors?: string[] } {
    const errors: string[] = [];
    if (params.high_confidence_price !== undefined && (typeof params.high_confidence_price !== 'number' || params.high_confidence_price <= 0.5 || params.high_confidence_price > 1))
      errors.push('high_confidence_price must be between 0.5 and 1');
    return { valid: errors.length === 0, errors: errors.length > 0 ? errors : undefined };
  },
};
