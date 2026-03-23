// ─── Crowd Bias Scorer ──────────────────────────────────────────────────────
// Detects recency bias, anchoring, and availability bias in market pricing.
// 0 = no detected bias, 100 = extreme bias detected.

import type { ContextScorer, ScorerInput, ScorerDimension } from '../../scorer.interface.js';

const PARAM_DEFAULTS = {
  /** Minimum snapshots for trend analysis */
  min_snapshots: 5,
  /** How much price stickiness (low movement) indicates anchoring */
  anchoring_threshold: 0.005,
  /** Recency weight: price reacts too fast to recent events */
  recency_lookback: 5,
};

function cfg(config: Record<string, unknown>) {
  return {
    min_snapshots: typeof config.min_snapshots === 'number' ? config.min_snapshots : PARAM_DEFAULTS.min_snapshots,
    anchoring_threshold: typeof config.anchoring_threshold === 'number' ? config.anchoring_threshold : PARAM_DEFAULTS.anchoring_threshold,
    recency_lookback: typeof config.recency_lookback === 'number' ? config.recency_lookback : PARAM_DEFAULTS.recency_lookback,
  };
}

export const crowdBiasScorer: ContextScorer = {
  name: 'crowd_bias',
  category: 'politics',

  score(context: ScorerInput): ScorerDimension {
    const params = cfg(context.config);

    const prices = [...context.snapshots]
      .sort((a, b) => (a.timestamp as Date).getTime() - (b.timestamp as Date).getTime())
      .map((s) => {
        const p = s.prices as Record<string, number> | null;
        return p ? (Object.values(p)[0] ?? 0.5) : 0.5;
      });

    if (prices.length < params.min_snapshots) {
      return {
        value: 50,
        label: 'INSUFFICIENT_DATA',
        detail: `Need ${params.min_snapshots} snapshots, have ${prices.length}`,
        metadata: { reason: 'insufficient_data', count: prices.length },
      };
    }

    // ── Anchoring Detection ─────────────────────────────────────────────
    // Price that barely moves despite new information = anchoring
    const returns = [];
    for (let i = 1; i < prices.length; i++) {
      if (prices[i - 1] > 0) returns.push(Math.abs((prices[i] - prices[i - 1]) / prices[i - 1]));
    }
    const avgAbsReturn = returns.length > 0
      ? returns.reduce((a, b) => a + b, 0) / returns.length
      : 0;
    // Low movement = possible anchoring (0-1 scale)
    const anchoringSignal = avgAbsReturn < params.anchoring_threshold
      ? 1 - (avgAbsReturn / params.anchoring_threshold)
      : 0;

    // ── Recency Bias Detection ──────────────────────────────────────────
    // Recent price moves are disproportionately large compared to history
    const recentReturns = returns.slice(-params.recency_lookback);
    const olderReturns = returns.slice(0, -params.recency_lookback);

    let recencySignal = 0;
    if (recentReturns.length > 0 && olderReturns.length > 0) {
      const recentAvg = recentReturns.reduce((a, b) => a + b, 0) / recentReturns.length;
      const olderAvg = olderReturns.reduce((a, b) => a + b, 0) / olderReturns.length;
      if (olderAvg > 0) {
        const ratio = recentAvg / olderAvg;
        recencySignal = ratio > 2 ? Math.min(1, (ratio - 2) / 3) : 0;
      }
    }

    // ── Extreme Price Bias ──────────────────────────────────────────────
    // Prices very near 0 or 1 often reflect overconfidence (availability bias)
    const currentPrice = prices[prices.length - 1];
    const extremeDistance = Math.min(currentPrice, 1 - currentPrice);
    const extremeSignal = extremeDistance < 0.1
      ? (0.1 - extremeDistance) / 0.1
      : 0;

    // ── Composite ─────────────────────────────────────────────────────────
    const composite = anchoringSignal * 0.35 + recencySignal * 0.35 + extremeSignal * 0.30;
    const score = Math.max(0, Math.min(100, Math.round(composite * 100)));

    let label: string;
    if (score >= 75) label = 'STRONG_BIAS';
    else if (score >= 50) label = 'MODERATE_BIAS';
    else if (score >= 25) label = 'MILD_BIAS';
    else label = 'MINIMAL_BIAS';

    const biases: string[] = [];
    if (anchoringSignal > 0.3) biases.push('anchoring');
    if (recencySignal > 0.3) biases.push('recency');
    if (extremeSignal > 0.3) biases.push('overconfidence');

    return {
      value: score,
      label,
      detail: `${biases.length > 0 ? 'Detected: ' + biases.join(', ') : 'No strong biases'} · Anchoring ${(anchoringSignal * 100).toFixed(0)}% · Recency ${(recencySignal * 100).toFixed(0)}% · Extreme ${(extremeSignal * 100).toFixed(0)}%`,
      metadata: {
        anchoring_signal: anchoringSignal,
        recency_signal: recencySignal,
        extreme_signal: extremeSignal,
        detected_biases: biases,
        avg_abs_return: avgAbsReturn,
        current_price: currentPrice,
        data_points: prices.length,
      },
    };
  },

  getRequiredData(): string[] {
    return [];
  },

  validateConfig(params: Record<string, unknown>): { valid: boolean; errors?: string[] } {
    const errors: string[] = [];
    if (params.min_snapshots !== undefined && (typeof params.min_snapshots !== 'number' || params.min_snapshots < 2))
      errors.push('min_snapshots must be >= 2');
    if (params.anchoring_threshold !== undefined && (typeof params.anchoring_threshold !== 'number' || params.anchoring_threshold <= 0))
      errors.push('anchoring_threshold must be > 0');
    return { valid: errors.length === 0, errors: errors.length > 0 ? errors : undefined };
  },
};
