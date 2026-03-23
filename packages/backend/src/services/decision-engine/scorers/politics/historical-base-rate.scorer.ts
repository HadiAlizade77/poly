// ─── Historical Base Rate Scorer ─────────────────────────────────────────────
// How often similar political events resolve YES historically.
// 0 = very unlikely historically, 100 = almost always happens.

import type { ContextScorer, ScorerInput, ScorerDimension } from '../../scorer.interface.js';

const PARAM_DEFAULTS = {
  /** Default base rate when no specific data available (%) */
  default_base_rate: 50,
};

function cfg(config: Record<string, unknown>) {
  return {
    default_base_rate: typeof config.default_base_rate === 'number' ? config.default_base_rate : PARAM_DEFAULTS.default_base_rate,
  };
}

// Known base rates for common political market types
const BASE_RATES: Record<string, number> = {
  // Presidential
  incumbent_reelection: 67,
  primary_frontrunner_wins: 72,
  party_holds_white_house: 50,
  // Congressional
  incumbent_senator_wins: 84,
  incumbent_house_wins: 90,
  party_holds_senate: 55,
  party_holds_house: 60,
  // Gubernatorial
  incumbent_governor_wins: 76,
  // Policy
  bill_passes: 35,
  executive_order_issued: 65,
  supreme_court_affirms: 60,
  // General
  frontrunner_wins: 70,
  default: 50,
};

function inferMarketType(market: ScorerInput['market']): string {
  const title = ((market.title as string) ?? '').toLowerCase();
  const tags = (market.tags as string[]) ?? [];
  const allText = `${title} ${tags.join(' ')}`;

  if (allText.includes('reelect') || allText.includes('re-elect')) return 'incumbent_reelection';
  if (allText.includes('primary') || allText.includes('nomination')) return 'primary_frontrunner_wins';
  if (allText.includes('senate') && allText.includes('incumbent')) return 'incumbent_senator_wins';
  if (allText.includes('senate')) return 'party_holds_senate';
  if (allText.includes('house') && allText.includes('incumbent')) return 'incumbent_house_wins';
  if (allText.includes('house')) return 'party_holds_house';
  if (allText.includes('governor')) return 'incumbent_governor_wins';
  if (allText.includes('bill') || allText.includes('legislation') || allText.includes('pass')) return 'bill_passes';
  if (allText.includes('executive order')) return 'executive_order_issued';
  if (allText.includes('supreme court')) return 'supreme_court_affirms';
  if (allText.includes('win') || allText.includes('elect')) return 'frontrunner_wins';

  return 'default';
}

export const historicalBaseRateScorer: ContextScorer = {
  name: 'historical_base_rate',
  category: 'politics',

  score(context: ScorerInput): ScorerDimension {
    const params = cfg(context.config);
    const marketType = inferMarketType(context.market);

    // Check if config has a custom base rate for this market
    const customRate = typeof context.config.base_rate === 'number'
      ? context.config.base_rate
      : null;

    const baseRate = customRate ?? BASE_RATES[marketType] ?? params.default_base_rate;
    const score = Math.max(0, Math.min(100, Math.round(baseRate)));

    let label: string;
    if (score >= 80) label = 'VERY_HIGH';
    else if (score >= 60) label = 'HIGH';
    else if (score >= 40) label = 'MODERATE';
    else if (score >= 20) label = 'LOW';
    else label = 'VERY_LOW';

    // Compare to current market price
    const prices = context.market.current_prices as Record<string, number> | null;
    const marketProb = prices ? (Object.values(prices)[0] ?? 0.5) : 0.5;
    const divergence = (baseRate / 100) - marketProb;

    return {
      value: score,
      label,
      detail: `Historical base rate ${baseRate}% for "${marketType}" · Market at ${(marketProb * 100).toFixed(1)}% · Gap ${(divergence * 100).toFixed(1)}pp`,
      metadata: {
        base_rate: baseRate,
        market_type: marketType,
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
    if (params.default_base_rate !== undefined && (typeof params.default_base_rate !== 'number' || params.default_base_rate < 0 || params.default_base_rate > 100))
      errors.push('default_base_rate must be between 0 and 100');
    return { valid: errors.length === 0, errors: errors.length > 0 ? errors : undefined };
  },
};
