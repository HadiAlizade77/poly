// ─── Odds Divergence Scorer ──────────────────────────────────────────────────
// Compares sportsbook consensus odds vs Polymarket price.
// 0-100: 50 = aligned, >50 = books more bullish, <50 = books more bearish.

import type { ContextScorer, ScorerInput, ScorerDimension } from '../../scorer.interface.js';

const PARAM_DEFAULTS = {
  significant_divergence: 0.05,
  max_data_age_ms: 3_600_000,
};

function cfg(config: Record<string, unknown>) {
  return {
    significant_divergence: typeof config.significant_divergence === 'number' ? config.significant_divergence : PARAM_DEFAULTS.significant_divergence,
    max_data_age_ms: typeof config.max_data_age_ms === 'number' ? config.max_data_age_ms : PARAM_DEFAULTS.max_data_age_ms,
  };
}

export const oddsDivergenceScorer: ContextScorer = {
  name: 'odds_divergence',
  category: 'sports',

  score(context: ScorerInput): ScorerDimension {
    const params = cfg(context.config);
    const now = Date.now();

    const oddsData = context.externalData.filter((d) => {
      const src = d.source as string;
      const dt = d.data_type as string;
      return (src === 'odds-api' || src === 'odds') && dt === 'game_odds' &&
        now - (d.timestamp as Date).getTime() < params.max_data_age_ms;
    });

    if (oddsData.length === 0) {
      return {
        value: 50,
        label: 'INSUFFICIENT_DATA',
        detail: 'No recent odds data available',
        metadata: { reason: 'no_odds' },
      };
    }

    // Get Polymarket price
    const prices = context.market.current_prices as Record<string, number> | null;
    if (!prices || Object.keys(prices).length === 0) {
      return {
        value: 50,
        label: 'INSUFFICIENT_DATA',
        detail: 'No market prices for comparison',
        metadata: { reason: 'no_market_prices' },
      };
    }
    const marketProb = Object.values(prices)[0] ?? 0.5;

    // Extract implied probability from sportsbook odds
    const latest = oddsData[0];
    const value = latest.value as Record<string, unknown>;
    const consensus = value.consensus as Record<string, { implied_prob?: number }> | undefined;

    let bookProb: number | null = null;
    if (consensus) {
      // Try to find the home team / first entry probability
      const entries = Object.values(consensus);
      if (entries.length > 0 && entries[0].implied_prob !== undefined) {
        bookProb = entries[0].implied_prob;
      }
    }

    if (bookProb === null) {
      return {
        value: 50,
        label: 'INSUFFICIENT_DATA',
        detail: 'Could not extract implied probability from odds data',
        metadata: { reason: 'no_implied_prob' },
      };
    }

    const divergence = bookProb - marketProb;
    const absDivergence = Math.abs(divergence);

    const score = Math.max(0, Math.min(100, Math.round(50 + (divergence / params.significant_divergence) * 25)));

    let label: string;
    if (absDivergence > params.significant_divergence * 2) {
      label = divergence > 0 ? 'STRONG_DIVERGENCE_UP' : 'STRONG_DIVERGENCE_DOWN';
    } else if (absDivergence > params.significant_divergence) {
      label = divergence > 0 ? 'MODERATE_DIVERGENCE_UP' : 'MODERATE_DIVERGENCE_DOWN';
    } else if (absDivergence > params.significant_divergence * 0.5) {
      label = 'SLIGHT_DIVERGENCE';
    } else {
      label = 'ALIGNED';
    }

    return {
      value: score,
      label,
      detail: `Books ${(bookProb * 100).toFixed(1)}% vs Market ${(marketProb * 100).toFixed(1)}% · Gap ${(divergence * 100).toFixed(1)}pp · ${oddsData.length} data points`,
      metadata: {
        book_probability: bookProb,
        market_probability: marketProb,
        divergence,
        bookmaker_count: value.bookmaker_count,
        data_points: oddsData.length,
      },
    };
  },

  getRequiredData(): string[] {
    return ['game_odds'];
  },

  validateConfig(params: Record<string, unknown>): { valid: boolean; errors?: string[] } {
    const errors: string[] = [];
    if (params.significant_divergence !== undefined && (typeof params.significant_divergence !== 'number' || params.significant_divergence <= 0))
      errors.push('significant_divergence must be > 0');
    return { valid: errors.length === 0, errors: errors.length > 0 ? errors : undefined };
  },
};
