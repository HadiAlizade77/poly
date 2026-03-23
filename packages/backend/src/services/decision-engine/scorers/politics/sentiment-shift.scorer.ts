// ─── Sentiment Shift Scorer ──────────────────────────────────────────────────
// Tracks news sentiment changes over time.
// Scale: 0-100 (50 = neutral, >50 = positive shift, <50 = negative shift).

import type { ContextScorer, ScorerInput, ScorerDimension } from '../../scorer.interface.js';

const PARAM_DEFAULTS = {
  recent_window_ms: 1_800_000,  // 30 min
  baseline_window_ms: 7_200_000, // 2 hours
  min_headlines: 2,
};

function cfg(config: Record<string, unknown>) {
  return {
    recent_window_ms: typeof config.recent_window_ms === 'number' ? config.recent_window_ms : PARAM_DEFAULTS.recent_window_ms,
    baseline_window_ms: typeof config.baseline_window_ms === 'number' ? config.baseline_window_ms : PARAM_DEFAULTS.baseline_window_ms,
    min_headlines: typeof config.min_headlines === 'number' ? config.min_headlines : PARAM_DEFAULTS.min_headlines,
  };
}

function extractSentiment(d: { value: unknown }): number | null {
  const v = d.value as Record<string, unknown>;
  return typeof v.sentiment === 'number' ? v.sentiment : null;
}

export const sentimentShiftScorer: ContextScorer = {
  name: 'sentiment_shift',
  category: 'politics',

  score(context: ScorerInput): ScorerDimension {
    const params = cfg(context.config);
    const now = Date.now();

    const headlines = context.externalData.filter(
      (d) => (d.data_type as string) === 'headline',
    );

    if (headlines.length < params.min_headlines) {
      return {
        value: 50,
        label: 'INSUFFICIENT_DATA',
        detail: `Need ${params.min_headlines} headlines, have ${headlines.length}`,
        metadata: { reason: 'insufficient_data', count: headlines.length },
      };
    }

    const recentCutoff = now - params.recent_window_ms;
    const baselineCutoff = now - params.baseline_window_ms;

    const recent = headlines.filter((h) => (h.timestamp as Date).getTime() >= recentCutoff);
    const baseline = headlines.filter(
      (h) => (h.timestamp as Date).getTime() >= baselineCutoff && (h.timestamp as Date).getTime() < recentCutoff,
    );

    const recentSentiments = recent.map(extractSentiment).filter((s): s is number => s !== null);
    const baselineSentiments = baseline.map(extractSentiment).filter((s): s is number => s !== null);

    const recentAvg = recentSentiments.length > 0
      ? recentSentiments.reduce((a, b) => a + b, 0) / recentSentiments.length
      : 0;
    const baselineAvg = baselineSentiments.length > 0
      ? baselineSentiments.reduce((a, b) => a + b, 0) / baselineSentiments.length
      : 0;

    // Shift: difference between recent and baseline sentiment
    const shift = recentAvg - baselineAvg;
    // Current level: overall recent sentiment
    const level = recentAvg;

    // Composite: 70% shift + 30% level, mapped to 0-100
    const composite = shift * 0.7 + level * 0.3;
    const score = Math.max(0, Math.min(100, Math.round(50 + composite * 50)));

    let label: string;
    if (score >= 80) label = 'STRONG_POSITIVE_SHIFT';
    else if (score >= 60) label = 'MODERATE_POSITIVE_SHIFT';
    else if (score <= 20) label = 'STRONG_NEGATIVE_SHIFT';
    else if (score <= 40) label = 'MODERATE_NEGATIVE_SHIFT';
    else label = 'NEUTRAL';

    return {
      value: score,
      label,
      detail: `Recent sentiment ${recentAvg >= 0 ? '+' : ''}${recentAvg.toFixed(2)} (${recentSentiments.length} items) · Shift ${shift >= 0 ? '+' : ''}${shift.toFixed(2)} from baseline (${baselineSentiments.length} items)`,
      metadata: {
        recent_avg: recentAvg,
        baseline_avg: baselineAvg,
        shift,
        recent_count: recentSentiments.length,
        baseline_count: baselineSentiments.length,
      },
    };
  },

  getRequiredData(): string[] {
    return ['headline'];
  },

  validateConfig(params: Record<string, unknown>): { valid: boolean; errors?: string[] } {
    const errors: string[] = [];
    if (params.recent_window_ms !== undefined && (typeof params.recent_window_ms !== 'number' || params.recent_window_ms <= 0))
      errors.push('recent_window_ms must be > 0');
    if (params.min_headlines !== undefined && (typeof params.min_headlines !== 'number' || params.min_headlines < 1))
      errors.push('min_headlines must be >= 1');
    return { valid: errors.length === 0, errors: errors.length > 0 ? errors : undefined };
  },
};
