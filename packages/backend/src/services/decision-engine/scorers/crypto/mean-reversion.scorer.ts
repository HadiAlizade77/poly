// ─── Mean Reversion Scorer ───────────────────────────────────────────────────
// Measures deviation from SMA/Bollinger Bands.
// High value = high reversion probability (stretched price).

import { SMA, BollingerBands } from 'technicalindicators';
import type { ContextScorer, ScorerInput, ScorerDimension } from '../../scorer.interface.js';

const PARAM_DEFAULTS = {
  sma_period: 20,
  bb_period: 20,
  bb_stddev: 2,
  extreme_z: 2.0,
  min_data_points: 15,
};

function cfg(config: Record<string, unknown>) {
  return {
    sma_period: typeof config.sma_period === 'number' ? config.sma_period : PARAM_DEFAULTS.sma_period,
    bb_period: typeof config.bb_period === 'number' ? config.bb_period : PARAM_DEFAULTS.bb_period,
    bb_stddev: typeof config.bb_stddev === 'number' ? config.bb_stddev : PARAM_DEFAULTS.bb_stddev,
    extreme_z: typeof config.extreme_z === 'number' ? config.extreme_z : PARAM_DEFAULTS.extreme_z,
    min_data_points: typeof config.min_data_points === 'number' ? config.min_data_points : PARAM_DEFAULTS.min_data_points,
  };
}

function extractPrices(snapshots: ScorerInput['snapshots']): number[] {
  return [...snapshots]
    .sort((a, b) => (a.timestamp as Date).getTime() - (b.timestamp as Date).getTime())
    .map((s) => {
      const p = s.prices as Record<string, number> | null;
      return p ? (Object.values(p)[0] ?? 0.5) : 0.5;
    });
}

export const meanReversionScorer: ContextScorer = {
  name: 'mean_reversion',
  category: 'crypto',

  score(context: ScorerInput): ScorerDimension {
    const params = cfg(context.config);
    const prices = extractPrices(context.snapshots);

    if (prices.length < params.min_data_points) {
      return {
        value: 50,
        label: 'INSUFFICIENT_DATA',
        detail: `Need ${params.min_data_points} snapshots, have ${prices.length}`,
        metadata: { reason: 'insufficient_data', count: prices.length },
      };
    }

    const current = prices[prices.length - 1];

    // ── Z-Score ───────────────────────────────────────────────────────────
    const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
    const variance = prices.reduce((sum, p) => sum + (p - mean) ** 2, 0) / prices.length;
    const stddev = Math.sqrt(variance);
    const zScore = stddev > 0 ? (current - mean) / stddev : 0;
    const absZ = Math.abs(zScore);

    // ── Bollinger Band Position ───────────────────────────────────────────
    const bbValues = BollingerBands.calculate({
      period: params.bb_period,
      stdDev: params.bb_stddev,
      values: prices,
    });

    let bbPosition = 0; // 0 = at lower, 0.5 = middle, 1 = at upper
    if (bbValues.length > 0) {
      const latest = bbValues[bbValues.length - 1];
      const width = latest.upper - latest.lower;
      bbPosition = width > 0 ? (current - latest.lower) / width : 0.5;
    }
    // Distance from center of band (0 = at center, 1 = at edge)
    const bbDeviation = Math.abs(bbPosition - 0.5) * 2;

    // ── SMA Deviation ─────────────────────────────────────────────────────
    const smaValues = SMA.calculate({ period: params.sma_period, values: prices });
    let smaDeviation = 0;
    if (smaValues.length > 0) {
      const sma = smaValues[smaValues.length - 1];
      smaDeviation = sma !== 0 ? Math.abs(current - sma) / sma : 0;
    }

    // ── Composite: 0 (no reversion signal) to 100 (extreme) ─────────────
    // All components measure "how far from normal" — higher = more stretched
    const zComponent = Math.min(1, absZ / params.extreme_z);          // 0–1
    const bbComponent = bbDeviation;                                    // 0–1
    const smaComponent = Math.min(1, smaDeviation * 20);              // 0–1

    const composite = zComponent * 0.5 + bbComponent * 0.3 + smaComponent * 0.2;
    const score = Math.max(0, Math.min(100, Math.round(composite * 100)));

    let label: string;
    if (score >= 80) label = 'EXTREME';
    else if (score >= 60) label = 'HIGH';
    else if (score >= 40) label = 'MODERATE';
    else if (score >= 20) label = 'LOW';
    else label = 'NONE';

    const direction = zScore > 0 ? 'above' : zScore < 0 ? 'below' : 'at';

    return {
      value: score,
      label,
      detail: `Price ${direction} mean · Z-score ${zScore >= 0 ? '+' : ''}${zScore.toFixed(2)} · BB ${(bbPosition * 100).toFixed(0)}% · SMA dev ${(smaDeviation * 100).toFixed(2)}%`,
      metadata: {
        z_score: zScore,
        bb_position: bbPosition,
        bb_deviation: bbDeviation,
        sma_deviation: smaDeviation,
        current_price: current,
        direction,
        data_points: prices.length,
      },
    };
  },

  getRequiredData(): string[] {
    return ['trade', 'kline_1m'];
  },

  validateConfig(params: Record<string, unknown>): { valid: boolean; errors?: string[] } {
    const errors: string[] = [];
    if (params.sma_period !== undefined && (typeof params.sma_period !== 'number' || params.sma_period < 2))
      errors.push('sma_period must be >= 2');
    if (params.bb_stddev !== undefined && (typeof params.bb_stddev !== 'number' || params.bb_stddev <= 0))
      errors.push('bb_stddev must be > 0');
    if (params.extreme_z !== undefined && (typeof params.extreme_z !== 'number' || params.extreme_z <= 0))
      errors.push('extreme_z must be > 0');
    return { valid: errors.length === 0, errors: errors.length > 0 ? errors : undefined };
  },
};
