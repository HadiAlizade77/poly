// ─── News Impact Scorer ─────────────────────────────────────────────────────
// Recent news relevance and impact.
// 0-100: 50 = neutral, >50 = positive news impact, <50 = negative.

import type { ContextScorer, ScorerInput, ScorerDimension } from '../../scorer.interface.js';

const PARAM_DEFAULTS = {
  lookback_ms: 3_600_000, // 1 hour
  min_headlines: 1,
  decay_half_life_ms: 1_800_000, // 30 min
};

function cfg(config: Record<string, unknown>) {
  return {
    lookback_ms: typeof config.lookback_ms === 'number' ? config.lookback_ms : PARAM_DEFAULTS.lookback_ms,
    min_headlines: typeof config.min_headlines === 'number' ? config.min_headlines : PARAM_DEFAULTS.min_headlines,
    decay_half_life_ms: typeof config.decay_half_life_ms === 'number' ? config.decay_half_life_ms : PARAM_DEFAULTS.decay_half_life_ms,
  };
}

export const newsImpactScorer: ContextScorer = {
  name: 'news_impact',
  category: 'events',

  score(context: ScorerInput): ScorerDimension {
    const params = cfg(context.config);
    const now = Date.now();
    const cutoff = now - params.lookback_ms;

    const headlines = context.externalData.filter((d) => {
      const dt = d.data_type as string;
      return dt === 'headline' && (d.timestamp as Date).getTime() >= cutoff;
    });

    if (headlines.length < params.min_headlines) {
      return {
        value: 50,
        label: 'NO_NEWS',
        detail: `No recent headlines (${headlines.length} in window)`,
        metadata: { reason: 'no_news', count: headlines.length },
      };
    }

    // Time-decay weighted sentiment
    let weightedSentiment = 0;
    let totalWeight = 0;

    for (const h of headlines) {
      const v = h.value as Record<string, unknown>;
      const sentiment = typeof v.sentiment === 'number' ? v.sentiment : 0;
      const age = now - (h.timestamp as Date).getTime();
      const decay = Math.exp(-age * Math.LN2 / params.decay_half_life_ms);

      weightedSentiment += sentiment * decay;
      totalWeight += decay;
    }

    const avgSentiment = totalWeight > 0 ? weightedSentiment / totalWeight : 0;

    // Volume of news as an impact amplifier
    const volumeMultiplier = Math.min(2, 1 + (headlines.length - 1) * 0.2);

    // Score: sentiment (-1..+1) → amplified by volume → mapped to 0-100
    const amplified = avgSentiment * volumeMultiplier;
    const score = Math.max(0, Math.min(100, Math.round(50 + amplified * 40)));

    let label: string;
    if (score >= 80) label = 'STRONG_POSITIVE';
    else if (score >= 60) label = 'MODERATE_POSITIVE';
    else if (score <= 20) label = 'STRONG_NEGATIVE';
    else if (score <= 40) label = 'MODERATE_NEGATIVE';
    else label = 'NEUTRAL';

    // Get the most impactful headline
    const sortedBySentiment = [...headlines].sort((a, b) => {
      const sa = typeof (a.value as Record<string, unknown>).sentiment === 'number'
        ? Math.abs((a.value as Record<string, unknown>).sentiment as number) : 0;
      const sb = typeof (b.value as Record<string, unknown>).sentiment === 'number'
        ? Math.abs((b.value as Record<string, unknown>).sentiment as number) : 0;
      return sb - sa;
    });
    const topHeadline = (sortedBySentiment[0]?.value as Record<string, unknown>)?.title as string | undefined;

    return {
      value: score,
      label,
      detail: `Sentiment ${avgSentiment >= 0 ? '+' : ''}${avgSentiment.toFixed(2)} (${headlines.length} headlines, ${volumeMultiplier.toFixed(1)}x vol)${topHeadline ? ' · "' + topHeadline.slice(0, 50) + '"' : ''}`,
      metadata: {
        avg_sentiment: avgSentiment,
        headline_count: headlines.length,
        volume_multiplier: volumeMultiplier,
        top_headline: topHeadline,
      },
    };
  },

  getRequiredData(): string[] {
    return ['headline'];
  },

  validateConfig(params: Record<string, unknown>): { valid: boolean; errors?: string[] } {
    const errors: string[] = [];
    if (params.lookback_ms !== undefined && (typeof params.lookback_ms !== 'number' || params.lookback_ms <= 0))
      errors.push('lookback_ms must be > 0');
    if (params.decay_half_life_ms !== undefined && (typeof params.decay_half_life_ms !== 'number' || params.decay_half_life_ms <= 0))
      errors.push('decay_half_life_ms must be > 0');
    return { valid: errors.length === 0, errors: errors.length > 0 ? errors : undefined };
  },
};
