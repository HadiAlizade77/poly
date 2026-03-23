// ─── Event Base Rate Scorer ──────────────────────────────────────────────────
// Base rate for this type of event resolving YES.
// 0 = very unlikely historically, 100 = almost always happens.

import type { ContextScorer, ScorerInput, ScorerDimension } from '../../scorer.interface.js';

const PARAM_DEFAULTS = {
  default_base_rate: 50,
};

function cfg(config: Record<string, unknown>) {
  return {
    default_base_rate: typeof config.default_base_rate === 'number' ? config.default_base_rate : PARAM_DEFAULTS.default_base_rate,
  };
}

// Base rates for common event types
const EVENT_BASE_RATES: Record<string, number> = {
  // Natural events
  earthquake: 15,
  hurricane: 25,
  volcanic_eruption: 5,
  flood: 30,
  // Tech / product
  product_launch: 70,
  acquisition: 35,
  ipo: 55,
  regulation_passed: 40,
  // Cultural / entertainment
  award_winner: 20, // per-nominee
  record_broken: 15,
  // Economic
  rate_cut: 45,
  rate_hike: 45,
  recession: 20,
  // General deadlines
  deadline_met: 60,
  goal_achieved: 40,
  default: 50,
};

function inferEventType(market: ScorerInput['market']): string {
  const title = ((market.title as string) ?? '').toLowerCase();
  const tags = (market.tags as string[]) ?? [];
  const text = `${title} ${tags.join(' ')}`;

  if (text.includes('earthquake')) return 'earthquake';
  if (text.includes('hurricane') || text.includes('cyclone')) return 'hurricane';
  if (text.includes('volcano') || text.includes('eruption')) return 'volcanic_eruption';
  if (text.includes('flood')) return 'flood';
  if (text.includes('launch') || text.includes('release') || text.includes('ship')) return 'product_launch';
  if (text.includes('acqui') || text.includes('merger') || text.includes('buyout')) return 'acquisition';
  if (text.includes('ipo') || text.includes('public offering')) return 'ipo';
  if (text.includes('regulation') || text.includes('law') || text.includes('legislation')) return 'regulation_passed';
  if (text.includes('award') || text.includes('oscar') || text.includes('grammy') || text.includes('emmy')) return 'award_winner';
  if (text.includes('record') || text.includes('milestone')) return 'record_broken';
  if (text.includes('rate cut') || text.includes('lower rate')) return 'rate_cut';
  if (text.includes('rate hike') || text.includes('raise rate')) return 'rate_hike';
  if (text.includes('recession') || text.includes('downturn')) return 'recession';
  if (text.includes('deadline')) return 'deadline_met';

  return 'default';
}

export const baseRateScorer: ContextScorer = {
  name: 'base_rate',
  category: 'events',

  score(context: ScorerInput): ScorerDimension {
    const params = cfg(context.config);
    const eventType = inferEventType(context.market);

    const customRate = typeof context.config.base_rate === 'number' ? context.config.base_rate : null;
    const baseRate = customRate ?? EVENT_BASE_RATES[eventType] ?? params.default_base_rate;
    const score = Math.max(0, Math.min(100, Math.round(baseRate)));

    const prices = context.market.current_prices as Record<string, number> | null;
    const marketProb = prices ? (Object.values(prices)[0] ?? 0.5) : 0.5;
    const divergence = (baseRate / 100) - marketProb;

    let label: string;
    if (score >= 80) label = 'VERY_HIGH';
    else if (score >= 60) label = 'HIGH';
    else if (score >= 40) label = 'MODERATE';
    else if (score >= 20) label = 'LOW';
    else label = 'VERY_LOW';

    return {
      value: score,
      label,
      detail: `Base rate ${baseRate}% for "${eventType}" · Market at ${(marketProb * 100).toFixed(1)}% · Gap ${(divergence * 100).toFixed(1)}pp`,
      metadata: {
        base_rate: baseRate,
        event_type: eventType,
        market_probability: marketProb,
        divergence,
        source: customRate !== null ? 'config' : 'lookup',
      },
    };
  },

  getRequiredData(): string[] {
    return [];
  },

  validateConfig(params: Record<string, unknown>): { valid: boolean; errors?: string[] } {
    const errors: string[] = [];
    if (params.base_rate !== undefined && (typeof params.base_rate !== 'number' || params.base_rate < 0 || params.base_rate > 100))
      errors.push('base_rate must be between 0 and 100');
    return { valid: errors.length === 0, errors: errors.length > 0 ? errors : undefined };
  },
};
