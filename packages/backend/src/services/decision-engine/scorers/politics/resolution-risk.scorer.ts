// ─── Resolution Risk Scorer ──────────────────────────────────────────────────
// Ambiguity in resolution criteria. Higher = more ambiguous/risky.
// 0 = very clear criteria, 100 = extremely ambiguous.

import type { ContextScorer, ScorerInput, ScorerDimension } from '../../scorer.interface.js';

const PARAM_DEFAULTS = {
  /** Minimum description length considered "well-defined" */
  min_description_length: 100,
};

function cfg(config: Record<string, unknown>) {
  return {
    min_description_length: typeof config.min_description_length === 'number' ? config.min_description_length : PARAM_DEFAULTS.min_description_length,
  };
}

const AMBIGUOUS_KEYWORDS = [
  'may', 'might', 'could', 'likely', 'probably', 'approximately', 'around',
  'roughly', 'some', 'certain', 'unclear', 'tbd', 'discretion', 'judgment',
  'subjective', 'interpreted', 'opinion',
];

const CLEAR_KEYWORDS = [
  'official', 'certified', 'confirmed', 'announced', 'published', 'reported by',
  'according to', 'as measured by', 'defined as', 'source:', 'resolution source',
  'deadline', 'exactly', 'precisely',
];

export const resolutionRiskScorer: ContextScorer = {
  name: 'resolution_risk',
  category: 'politics',

  score(context: ScorerInput): ScorerDimension {
    const params = cfg(context.config);

    const criteria = (context.market.resolution_criteria as string | null) ?? '';
    const description = (context.market.description as string | null) ?? '';
    const source = (context.market.resolution_source as string | null) ?? '';
    const fullText = `${criteria} ${description}`.toLowerCase();

    // Factor 1: Has resolution criteria at all?
    let criteriaScore = 0;
    if (!criteria && !source) {
      criteriaScore = 80; // No criteria = very risky
    } else if (criteria.length < params.min_description_length && !source) {
      criteriaScore = 60; // Short criteria
    } else if (source) {
      criteriaScore = 20; // Has a named source
    } else {
      criteriaScore = 40; // Has criteria but no named source
    }

    // Factor 2: Ambiguous vs clear keywords
    let ambiguousCount = 0;
    let clearCount = 0;
    for (const kw of AMBIGUOUS_KEYWORDS) {
      if (fullText.includes(kw)) ambiguousCount++;
    }
    for (const kw of CLEAR_KEYWORDS) {
      if (fullText.includes(kw)) clearCount++;
    }

    const keywordBalance = ambiguousCount - clearCount;
    const keywordScore = Math.max(0, Math.min(100, 50 + keywordBalance * 10));

    // Factor 3: Multiple outcomes can make resolution clearer or murkier
    const outcomes = (context.market.outcomes as unknown[]) ?? [];
    const outcomeScore = outcomes.length === 2 ? 30 : Math.min(70, 30 + (outcomes.length - 2) * 10);

    // Composite: criteria weight 50%, keywords 30%, outcomes 20%
    const score = Math.max(0, Math.min(100, Math.round(
      criteriaScore * 0.50 + keywordScore * 0.30 + outcomeScore * 0.20,
    )));

    let label: string;
    if (score >= 80) label = 'VERY_HIGH';
    else if (score >= 60) label = 'HIGH';
    else if (score >= 40) label = 'MODERATE';
    else if (score >= 20) label = 'LOW';
    else label = 'VERY_LOW';

    return {
      value: score,
      label,
      detail: `Criteria (${criteriaScore}) · Keywords: ${ambiguousCount} ambiguous / ${clearCount} clear (${keywordScore}) · Outcomes: ${outcomes.length} (${outcomeScore})`,
      metadata: {
        criteria_score: criteriaScore,
        keyword_score: keywordScore,
        outcome_score: outcomeScore,
        ambiguous_keywords: ambiguousCount,
        clear_keywords: clearCount,
        has_resolution_source: !!source,
        criteria_length: criteria.length,
      },
    };
  },

  getRequiredData(): string[] {
    return [];
  },

  validateConfig(params: Record<string, unknown>): { valid: boolean; errors?: string[] } {
    const errors: string[] = [];
    if (params.min_description_length !== undefined && (typeof params.min_description_length !== 'number' || params.min_description_length < 0))
      errors.push('min_description_length must be >= 0');
    return { valid: errors.length === 0, errors: errors.length > 0 ? errors : undefined };
  },
};
