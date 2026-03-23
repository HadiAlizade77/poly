// ─── Line Movement Scorer ───────────────────────────────────────────────────
// Tracks odds/line movement over time. Detects sharp money.
// 0-100: 50 = no movement, >50 = favorable movement, <50 = unfavorable.

import type { ContextScorer, ScorerInput, ScorerDimension } from '../../scorer.interface.js';

const PARAM_DEFAULTS = {
  significant_move: 0.03,
  min_data_points: 2,
};

function cfg(config: Record<string, unknown>) {
  return {
    significant_move: typeof config.significant_move === 'number' ? config.significant_move : PARAM_DEFAULTS.significant_move,
    min_data_points: typeof config.min_data_points === 'number' ? config.min_data_points : PARAM_DEFAULTS.min_data_points,
  };
}

export const lineMovementScorer: ContextScorer = {
  name: 'line_movement',
  category: 'sports',

  score(context: ScorerInput): ScorerDimension {
    const params = cfg(context.config);

    // Track price movement in snapshots
    const sorted = [...context.snapshots]
      .sort((a, b) => (a.timestamp as Date).getTime() - (b.timestamp as Date).getTime());

    if (sorted.length < params.min_data_points) {
      return {
        value: 50,
        label: 'INSUFFICIENT_DATA',
        detail: `Need ${params.min_data_points} snapshots, have ${sorted.length}`,
        metadata: { reason: 'insufficient_data', count: sorted.length },
      };
    }

    const prices = sorted.map((s) => {
      const p = s.prices as Record<string, number> | null;
      return p ? (Object.values(p)[0] ?? 0.5) : 0.5;
    });

    const firstPrice = prices[0];
    const lastPrice = prices[prices.length - 1];
    const totalMove = lastPrice - firstPrice;

    // Check if movement is against volume (sharp money signal)
    // Sharp money: price moves opposite to public expectation
    const volumes = sorted
      .map((s) => (typeof s.volume_1h === 'number' ? Number(s.volume_1h) : null))
      .filter((v): v is number => v !== null);

    let volumeWeightedMove = totalMove;
    if (volumes.length >= 2) {
      const recentVol = volumes[volumes.length - 1];
      const avgVol = volumes.reduce((a, b) => a + b, 0) / volumes.length;
      // High volume + line move = more significant (sharp money)
      const volMultiplier = avgVol > 0 ? Math.min(2, recentVol / avgVol) : 1;
      volumeWeightedMove = totalMove * volMultiplier;
    }

    // Consistency: is the line moving steadily or whipsawing?
    let consistentDirection = 0;
    for (let i = 1; i < prices.length; i++) {
      const diff = prices[i] - prices[i - 1];
      if ((totalMove > 0 && diff > 0) || (totalMove < 0 && diff < 0)) {
        consistentDirection++;
      }
    }
    const consistency = prices.length > 1 ? consistentDirection / (prices.length - 1) : 0;

    // Score: positive line move → >50, negative → <50
    const moveNorm = volumeWeightedMove / params.significant_move;
    const consistencyBoost = consistency > 0.7 ? 1.2 : consistency > 0.5 ? 1.0 : 0.8;
    const score = Math.max(0, Math.min(100, Math.round(50 + moveNorm * 25 * consistencyBoost)));

    let label: string;
    const absMoveNorm = Math.abs(moveNorm);
    if (absMoveNorm > 2) {
      label = totalMove > 0 ? 'SHARP_MOVE_UP' : 'SHARP_MOVE_DOWN';
    } else if (absMoveNorm > 1) {
      label = totalMove > 0 ? 'MODERATE_MOVE_UP' : 'MODERATE_MOVE_DOWN';
    } else if (absMoveNorm > 0.5) {
      label = 'SLIGHT_MOVEMENT';
    } else {
      label = 'STABLE';
    }

    const isSharpMoney = absMoveNorm > 1 && consistency > 0.6;

    return {
      value: score,
      label,
      detail: `Line ${totalMove >= 0 ? '+' : ''}${(totalMove * 100).toFixed(1)}pp · Consistency ${(consistency * 100).toFixed(0)}% · ${isSharpMoney ? 'Sharp money detected' : 'Normal movement'}`,
      metadata: {
        total_move: totalMove,
        volume_weighted_move: volumeWeightedMove,
        consistency,
        is_sharp_money: isSharpMoney,
        first_price: firstPrice,
        last_price: lastPrice,
        data_points: prices.length,
      },
    };
  },

  getRequiredData(): string[] {
    return ['game_odds'];
  },

  validateConfig(params: Record<string, unknown>): { valid: boolean; errors?: string[] } {
    const errors: string[] = [];
    if (params.significant_move !== undefined && (typeof params.significant_move !== 'number' || params.significant_move <= 0))
      errors.push('significant_move must be > 0');
    return { valid: errors.length === 0, errors: errors.length > 0 ? errors : undefined };
  },
};
