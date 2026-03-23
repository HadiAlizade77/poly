// ─── Poll Divergence Scorer ──────────────────────────────────────────────────
// Compares polling data vs Polymarket price.
// Positive = market underpricing YES relative to polls.
// Scale: 0-100 (50 = aligned, >50 = polls more bullish, <50 = polls more bearish).

import type { ContextScorer, ScorerInput, ScorerDimension } from '../../scorer.interface.js';

const PARAM_DEFAULTS = {
  significant_divergence: 0.05,
  max_data_age_ms: 3_600_000, // 1 hour
};

function cfg(config: Record<string, unknown>) {
  return {
    significant_divergence: typeof config.significant_divergence === 'number' ? config.significant_divergence : PARAM_DEFAULTS.significant_divergence,
    max_data_age_ms: typeof config.max_data_age_ms === 'number' ? config.max_data_age_ms : PARAM_DEFAULTS.max_data_age_ms,
  };
}

export const pollDivergenceScorer: ContextScorer = {
  name: 'poll_divergence',
  category: 'politics',

  score(context: ScorerInput): ScorerDimension {
    const params = cfg(context.config);
    const now = Date.now();

    // Get polling data
    const polls = context.externalData.filter((d) => {
      const src = d.source as string;
      const dt = d.data_type as string;
      return src === 'polling' && dt === 'poll_result' && now - (d.timestamp as Date).getTime() < params.max_data_age_ms;
    });

    if (polls.length === 0) {
      return {
        value: 50,
        label: 'INSUFFICIENT_DATA',
        detail: 'No recent polling data available',
        metadata: { reason: 'no_polls' },
      };
    }

    // Get Polymarket implied probability (Yes price)
    const prices = context.market.current_prices as Record<string, number> | null;
    if (!prices || Object.keys(prices).length === 0) {
      return {
        value: 50,
        label: 'INSUFFICIENT_DATA',
        detail: 'No market prices for comparison',
        metadata: { reason: 'no_market_prices', poll_count: polls.length },
      };
    }

    const marketProb = Object.values(prices)[0] ?? 0.5;

    // Extract poll-implied probability: average "leading candidate support / 100"
    const pollProbs: number[] = [];
    for (const poll of polls) {
      const value = poll.value as Record<string, unknown>;
      const results = value.results as Array<{ support: number }> | undefined;
      if (results && results.length > 0) {
        // Use the leading candidate's support as implied probability
        const sorted = [...results].sort((a, b) => b.support - a.support);
        pollProbs.push(sorted[0].support / 100);
      }
    }

    if (pollProbs.length === 0) {
      return {
        value: 50,
        label: 'INSUFFICIENT_DATA',
        detail: 'Polling data missing support values',
        metadata: { reason: 'no_support_data' },
      };
    }

    // Weighted average of polls (more recent = higher weight)
    const avgPollProb = pollProbs.reduce((a, b) => a + b, 0) / pollProbs.length;

    // Divergence: positive = polls higher than market (market underpricing)
    const divergence = avgPollProb - marketProb;
    const absDivergence = Math.abs(divergence);

    // Map to 0-100: 50 = aligned
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
      detail: `Polls ${(avgPollProb * 100).toFixed(1)}% vs Market ${(marketProb * 100).toFixed(1)}% · Divergence ${(divergence * 100).toFixed(1)}pp · ${polls.length} polls`,
      metadata: {
        poll_probability: avgPollProb,
        market_probability: marketProb,
        divergence,
        poll_count: polls.length,
        poll_probs: pollProbs,
      },
    };
  },

  getRequiredData(): string[] {
    return ['poll_result'];
  },

  validateConfig(params: Record<string, unknown>): { valid: boolean; errors?: string[] } {
    const errors: string[] = [];
    if (params.significant_divergence !== undefined && (typeof params.significant_divergence !== 'number' || params.significant_divergence <= 0))
      errors.push('significant_divergence must be > 0');
    return { valid: errors.length === 0, errors: errors.length > 0 ? errors : undefined };
  },
};
