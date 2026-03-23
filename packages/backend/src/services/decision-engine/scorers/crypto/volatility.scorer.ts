// ─── Volatility Scorer ──────────────────────────────────────────────────────
// ATR-based volatility. 0 = dead calm, 100 = extreme vol.

import { ATR } from 'technicalindicators';
import type { ContextScorer, ScorerInput, ScorerDimension } from '../../scorer.interface.js';

const PARAM_DEFAULTS = {
  atr_period: 14,
  high_vol_threshold: 0.05,
  low_vol_threshold: 0.01,
  min_data_points: 10,
};

function cfg(config: Record<string, unknown>) {
  return {
    atr_period: typeof config.atr_period === 'number' ? config.atr_period : PARAM_DEFAULTS.atr_period,
    high_vol_threshold: typeof config.high_vol_threshold === 'number' ? config.high_vol_threshold : PARAM_DEFAULTS.high_vol_threshold,
    low_vol_threshold: typeof config.low_vol_threshold === 'number' ? config.low_vol_threshold : PARAM_DEFAULTS.low_vol_threshold,
    min_data_points: typeof config.min_data_points === 'number' ? config.min_data_points : PARAM_DEFAULTS.min_data_points,
  };
}

function buildOHLC(snapshots: ScorerInput['snapshots']): { high: number[]; low: number[]; close: number[] } {
  const sorted = [...snapshots].sort(
    (a, b) => (a.timestamp as Date).getTime() - (b.timestamp as Date).getTime(),
  );
  const high: number[] = [];
  const low: number[] = [];
  const close: number[] = [];

  for (const s of sorted) {
    const price = (s.prices as Record<string, number> | null)
      ? (Object.values(s.prices as Record<string, number>)[0] ?? 0.5)
      : 0.5;
    const spread = typeof s.spread === 'number' ? Number(s.spread) : 0.01;
    const half = spread / 2;
    high.push(price + half);
    low.push(price - half);
    close.push(price);
  }

  return { high, low, close };
}

export const volatilityScorer: ContextScorer = {
  name: 'volatility',
  category: 'crypto',

  score(context: ScorerInput): ScorerDimension {
    const params = cfg(context.config);
    const ohlc = buildOHLC(context.snapshots);

    if (ohlc.close.length < params.min_data_points) {
      return {
        value: 50,
        label: 'INSUFFICIENT_DATA',
        detail: `Need ${params.min_data_points} snapshots, have ${ohlc.close.length}`,
        metadata: { reason: 'insufficient_data', count: ohlc.close.length },
      };
    }

    const atrValues = ATR.calculate({
      period: params.atr_period,
      high: ohlc.high,
      low: ohlc.low,
      close: ohlc.close,
    });

    if (atrValues.length === 0) {
      return {
        value: 50,
        label: 'INSUFFICIENT_DATA',
        detail: 'Cannot compute ATR with available data',
        metadata: { reason: 'atr_failed', data_points: ohlc.close.length },
      };
    }

    const currentATR = atrValues[atrValues.length - 1];
    const currentPrice = ohlc.close[ohlc.close.length - 1];
    const atrRatio = currentPrice > 0 ? currentATR / currentPrice : 0;

    // Vol trend: expanding or contracting
    let volTrend = 0;
    if (atrValues.length >= 3) {
      const recent = atrValues.slice(-3).reduce((a, b) => a + b, 0) / 3;
      const older = atrValues.slice(0, Math.min(5, atrValues.length)).reduce((a, b) => a + b, 0) / Math.min(5, atrValues.length);
      volTrend = older > 0 ? (recent - older) / older : 0;
    }

    // Map atrRatio to 0-100: low_vol → ~20, high_vol → ~80
    let score: number;
    if (atrRatio <= params.low_vol_threshold) {
      const ratio = atrRatio / params.low_vol_threshold;
      score = Math.round(ratio * 20); // 0–20
    } else if (atrRatio >= params.high_vol_threshold) {
      const excess = Math.min(2, (atrRatio - params.high_vol_threshold) / params.high_vol_threshold);
      score = Math.round(80 + excess * 10); // 80–100
    } else {
      const range = params.high_vol_threshold - params.low_vol_threshold;
      const pos = (atrRatio - params.low_vol_threshold) / range;
      score = Math.round(20 + pos * 60); // 20–80
    }

    score = Math.max(0, Math.min(100, score));

    let label: string;
    if (score >= 90) label = 'EXTREME';
    else if (score >= 70) label = 'HIGH';
    else if (score >= 30) label = 'NORMAL';
    else if (score >= 10) label = 'LOW';
    else label = 'DEAD';

    const direction = volTrend > 0.1 ? 'expanding' : volTrend < -0.1 ? 'contracting' : 'stable';

    return {
      value: score,
      label,
      detail: `ATR ratio ${(atrRatio * 100).toFixed(2)}% · Vol ${direction} (${(volTrend * 100).toFixed(1)}%)`,
      metadata: {
        atr: currentATR,
        atr_ratio: atrRatio,
        vol_trend: volTrend,
        direction,
        data_points: ohlc.close.length,
      },
    };
  },

  getRequiredData(): string[] {
    return ['trade', 'kline_1m'];
  },

  validateConfig(params: Record<string, unknown>): { valid: boolean; errors?: string[] } {
    const errors: string[] = [];
    if (params.atr_period !== undefined && (typeof params.atr_period !== 'number' || params.atr_period < 2))
      errors.push('atr_period must be >= 2');
    if (params.high_vol_threshold !== undefined && (typeof params.high_vol_threshold !== 'number' || params.high_vol_threshold <= 0))
      errors.push('high_vol_threshold must be > 0');
    if (params.low_vol_threshold !== undefined && (typeof params.low_vol_threshold !== 'number' || params.low_vol_threshold <= 0))
      errors.push('low_vol_threshold must be > 0');
    return { valid: errors.length === 0, errors: errors.length > 0 ? errors : undefined };
  },
};
