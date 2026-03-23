// ─── Exhaustion Scorer ──────────────────────────────────────────────────────
// Detects potential trend exhaustion via volume climax + extended price moves.
// 0 = no exhaustion, 100 = extreme exhaustion.

import type { ContextScorer, ScorerInput, ScorerDimension } from '../../scorer.interface.js';

const PARAM_DEFAULTS = {
  price_move_threshold: 0.03,
  volume_spike_multiplier: 3.0,
  min_data_points: 5,
};

function cfg(config: Record<string, unknown>) {
  return {
    price_move_threshold: typeof config.price_move_threshold === 'number' ? config.price_move_threshold : PARAM_DEFAULTS.price_move_threshold,
    volume_spike_multiplier: typeof config.volume_spike_multiplier === 'number' ? config.volume_spike_multiplier : PARAM_DEFAULTS.volume_spike_multiplier,
    min_data_points: typeof config.min_data_points === 'number' ? config.min_data_points : PARAM_DEFAULTS.min_data_points,
  };
}

export const exhaustionScorer: ContextScorer = {
  name: 'exhaustion',
  category: 'crypto',

  score(context: ScorerInput): ScorerDimension {
    const params = cfg(context.config);

    // Get trade data
    const trades = context.externalData.filter(
      (d) => (d.source as string) === 'binance' && (d.data_type as string) === 'trade',
    );

    if (trades.length < params.min_data_points && context.snapshots.length < params.min_data_points) {
      return {
        value: 50,
        label: 'INSUFFICIENT_DATA',
        detail: `Need ${params.min_data_points} data points, have ${trades.length} trades and ${context.snapshots.length} snapshots`,
        metadata: { reason: 'insufficient_data' },
      };
    }

    // Split trades into recent (top 1/4) and baseline (rest)
    const splitIdx = Math.max(1, Math.floor(trades.length / 4));
    const recentTrades = trades.slice(0, splitIdx);
    const baselineTrades = trades.slice(splitIdx);

    // Volume comparison
    const toQuoteVol = (d: typeof trades[number]) => {
      const v = (d.value as Record<string, unknown>).quote_volume;
      return typeof v === 'number' ? v : 0;
    };

    const recentAvg = recentTrades.length > 0
      ? recentTrades.reduce((sum, t) => sum + toQuoteVol(t), 0) / recentTrades.length
      : 0;
    const baselineAvg = baselineTrades.length > 0
      ? baselineTrades.reduce((sum, t) => sum + toQuoteVol(t), 0) / baselineTrades.length
      : 0;

    const volumeSpike = baselineAvg > 0 ? recentAvg / baselineAvg : 1.0;

    // Price move from snapshots
    const prices = [...context.snapshots]
      .sort((a, b) => (a.timestamp as Date).getTime() - (b.timestamp as Date).getTime())
      .map((s) => {
        const p = s.prices as Record<string, number> | null;
        return p ? (Object.values(p)[0] ?? 0.5) : 0.5;
      });

    let priceMove = 0;
    if (prices.length >= 2) {
      const latest = prices[prices.length - 1];
      const ref = prices[Math.max(0, prices.length - Math.ceil(prices.length / 3))];
      priceMove = ref > 0 ? Math.abs(latest - ref) / ref : 0;
    }

    const hasVolumeSpike = volumeSpike >= params.volume_spike_multiplier;
    const hasSignificantMove = priceMove >= params.price_move_threshold;

    // Composite: both volume spike AND price move → exhaustion
    let score: number;
    if (hasVolumeSpike && hasSignificantMove) {
      const volComponent = Math.min(1, volumeSpike / (params.volume_spike_multiplier * 2));
      const priceComponent = Math.min(1, priceMove / (params.price_move_threshold * 3));
      score = Math.round(60 + (volComponent + priceComponent) * 20); // 60–100
    } else if (hasVolumeSpike) {
      score = Math.round(30 + Math.min(30, (volumeSpike / params.volume_spike_multiplier) * 15)); // 30–60
    } else if (hasSignificantMove) {
      score = Math.round(20 + Math.min(20, (priceMove / params.price_move_threshold) * 10)); // 20–40
    } else {
      const mild = Math.max(volumeSpike - 1, 0) * 10 + priceMove * 100;
      score = Math.round(Math.min(20, mild)); // 0–20
    }

    score = Math.max(0, Math.min(100, score));

    let label: string;
    if (score >= 80) label = 'EXTREME';
    else if (score >= 60) label = 'HIGH';
    else if (score >= 40) label = 'MODERATE';
    else if (score >= 20) label = 'LOW';
    else label = 'NONE';

    return {
      value: score,
      label,
      detail: `Vol spike ${volumeSpike.toFixed(1)}x · Price move ${(priceMove * 100).toFixed(2)}% · ${recentTrades.length} recent / ${baselineTrades.length} baseline`,
      metadata: {
        volume_spike: volumeSpike,
        price_move: priceMove,
        has_volume_spike: hasVolumeSpike,
        has_significant_move: hasSignificantMove,
        recent_trades: recentTrades.length,
        baseline_trades: baselineTrades.length,
      },
    };
  },

  getRequiredData(): string[] {
    return ['trade'];
  },

  validateConfig(params: Record<string, unknown>): { valid: boolean; errors?: string[] } {
    const errors: string[] = [];
    if (params.price_move_threshold !== undefined && (typeof params.price_move_threshold !== 'number' || params.price_move_threshold <= 0))
      errors.push('price_move_threshold must be > 0');
    if (params.volume_spike_multiplier !== undefined && (typeof params.volume_spike_multiplier !== 'number' || params.volume_spike_multiplier <= 1))
      errors.push('volume_spike_multiplier must be > 1');
    return { valid: errors.length === 0, errors: errors.length > 0 ? errors : undefined };
  },
};
