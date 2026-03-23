// ─── Public Bias Scorer ─────────────────────────────────────────────────────
// Detects public betting bias — favorites are systematically over-bet.
// 0 = no public bias, 100 = extreme public bias detected.

import type { ContextScorer, ScorerInput, ScorerDimension } from '../../scorer.interface.js';

const PARAM_DEFAULTS = {
  favorite_threshold: 0.60,
  heavy_favorite_threshold: 0.75,
  min_snapshots: 3,
};

function cfg(config: Record<string, unknown>) {
  return {
    favorite_threshold: typeof config.favorite_threshold === 'number' ? config.favorite_threshold : PARAM_DEFAULTS.favorite_threshold,
    heavy_favorite_threshold: typeof config.heavy_favorite_threshold === 'number' ? config.heavy_favorite_threshold : PARAM_DEFAULTS.heavy_favorite_threshold,
    min_snapshots: typeof config.min_snapshots === 'number' ? config.min_snapshots : PARAM_DEFAULTS.min_snapshots,
  };
}

export const publicBiasScorer: ContextScorer = {
  name: 'public_bias',
  category: 'sports',

  score(context: ScorerInput): ScorerDimension {
    const params = cfg(context.config);

    const prices = context.market.current_prices as Record<string, number> | null;
    if (!prices || Object.keys(prices).length === 0) {
      return {
        value: 50,
        label: 'INSUFFICIENT_DATA',
        detail: 'No market prices available',
        metadata: { reason: 'no_prices' },
      };
    }

    const yesPrice = Object.values(prices)[0] ?? 0.5;

    // ── Favorite Bias ─────────────────────────────────────────────────────
    // Heavy favorites are often over-priced by public money
    let favoriteBias = 0;
    if (yesPrice > params.heavy_favorite_threshold) {
      favoriteBias = Math.min(1, (yesPrice - params.heavy_favorite_threshold) / (1 - params.heavy_favorite_threshold));
    } else if (yesPrice > params.favorite_threshold) {
      favoriteBias = (yesPrice - params.favorite_threshold) / (params.heavy_favorite_threshold - params.favorite_threshold) * 0.5;
    }

    // ── Volume Asymmetry ────────────────────────────────────────────────
    // High volume at extreme prices suggests public piling in
    let volumeBias = 0;
    const volumes = context.snapshots
      .map((s) => (typeof s.volume_1h === 'number' ? Number(s.volume_1h) : null))
      .filter((v): v is number => v !== null);

    if (volumes.length >= params.min_snapshots) {
      const avgVol = volumes.reduce((a, b) => a + b, 0) / volumes.length;
      const recentVol = volumes[0] ?? 0;
      const volRatio = avgVol > 0 ? recentVol / avgVol : 1;

      // High volume + extreme price = public bias
      const extremeness = Math.abs(yesPrice - 0.5) * 2; // 0-1
      volumeBias = Math.min(1, (volRatio - 1) * extremeness);
      volumeBias = Math.max(0, volumeBias);
    }

    // ── Price Stickiness at Round Numbers ────────────────────────────────
    // Public tends to cluster at round numbers (0.50, 0.60, 0.70, etc.)
    const distToRound = Math.min(
      (yesPrice * 100) % 10 / 10,
      1 - ((yesPrice * 100) % 10) / 10,
    );
    const roundNumberBias = distToRound < 0.15 ? (0.15 - distToRound) / 0.15 : 0;

    // ── Odds comparison (if available) ──────────────────────────────────
    let oddsGapBias = 0;
    const oddsData = context.externalData.filter(
      (d) => (d.data_type as string) === 'game_odds',
    );
    if (oddsData.length > 0) {
      const latest = oddsData[0];
      const consensus = (latest.value as Record<string, unknown>).consensus as Record<string, { implied_prob?: number }> | undefined;
      if (consensus) {
        const bookProb = Object.values(consensus)[0]?.implied_prob;
        if (bookProb !== undefined) {
          // If market price is HIGHER than book → public overbetting YES
          const gap = yesPrice - bookProb;
          oddsGapBias = gap > 0 ? Math.min(1, gap / 0.1) : 0;
        }
      }
    }

    // ── Composite ─────────────────────────────────────────────────────────
    const composite = favoriteBias * 0.35 + volumeBias * 0.25 + roundNumberBias * 0.15 + oddsGapBias * 0.25;
    const score = Math.max(0, Math.min(100, Math.round(composite * 100)));

    let label: string;
    if (score >= 75) label = 'STRONG_PUBLIC_BIAS';
    else if (score >= 50) label = 'MODERATE_PUBLIC_BIAS';
    else if (score >= 25) label = 'MILD_PUBLIC_BIAS';
    else label = 'MINIMAL_BIAS';

    return {
      value: score,
      label,
      detail: `Favorite ${(favoriteBias * 100).toFixed(0)}% · Volume ${(volumeBias * 100).toFixed(0)}% · Round# ${(roundNumberBias * 100).toFixed(0)}% · Odds gap ${(oddsGapBias * 100).toFixed(0)}%`,
      metadata: {
        favorite_bias: favoriteBias,
        volume_bias: volumeBias,
        round_number_bias: roundNumberBias,
        odds_gap_bias: oddsGapBias,
        yes_price: yesPrice,
        data_points: context.snapshots.length,
      },
    };
  },

  getRequiredData(): string[] {
    return ['game_odds'];
  },

  validateConfig(params: Record<string, unknown>): { valid: boolean; errors?: string[] } {
    const errors: string[] = [];
    if (params.favorite_threshold !== undefined && (typeof params.favorite_threshold !== 'number' || params.favorite_threshold <= 0.5 || params.favorite_threshold >= 1))
      errors.push('favorite_threshold must be between 0.5 and 1');
    return { valid: errors.length === 0, errors: errors.length > 0 ? errors : undefined };
  },
};
