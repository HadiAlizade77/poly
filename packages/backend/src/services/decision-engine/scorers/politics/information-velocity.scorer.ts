// ─── Information Velocity Scorer ─────────────────────────────────────────────
// Rate of new information arrival. 0 = stale/quiet, 100 = fast-moving situation.

import type { ContextScorer, ScorerInput, ScorerDimension } from '../../scorer.interface.js';

const PARAM_DEFAULTS = {
  recent_window_ms: 3_600_000,   // 1 hour
  baseline_window_ms: 86_400_000, // 24 hours
  high_velocity_ratio: 3.0,
};

function cfg(config: Record<string, unknown>) {
  return {
    recent_window_ms: typeof config.recent_window_ms === 'number' ? config.recent_window_ms : PARAM_DEFAULTS.recent_window_ms,
    baseline_window_ms: typeof config.baseline_window_ms === 'number' ? config.baseline_window_ms : PARAM_DEFAULTS.baseline_window_ms,
    high_velocity_ratio: typeof config.high_velocity_ratio === 'number' ? config.high_velocity_ratio : PARAM_DEFAULTS.high_velocity_ratio,
  };
}

export const informationVelocityScorer: ContextScorer = {
  name: 'information_velocity',
  category: 'politics',

  score(context: ScorerInput): ScorerDimension {
    const params = cfg(context.config);
    const now = Date.now();

    // Count data points in recent vs baseline window
    const recentCutoff = now - params.recent_window_ms;
    const baselineCutoff = now - params.baseline_window_ms;

    const allData = context.externalData;
    const recent = allData.filter((d) => (d.timestamp as Date).getTime() >= recentCutoff);
    const baseline = allData.filter(
      (d) => (d.timestamp as Date).getTime() >= baselineCutoff && (d.timestamp as Date).getTime() < recentCutoff,
    );

    // Also factor in snapshot frequency (price updates = information)
    const recentSnapshots = context.snapshots.filter(
      (s) => (s.timestamp as Date).getTime() >= recentCutoff,
    );

    // Calculate rate per hour
    const recentHours = params.recent_window_ms / 3_600_000;
    const baselineHours = (params.baseline_window_ms - params.recent_window_ms) / 3_600_000;

    const recentRate = (recent.length + recentSnapshots.length) / recentHours;
    const baselineRate = baselineHours > 0
      ? baseline.length / baselineHours
      : 0;

    // Velocity ratio
    const velocityRatio = baselineRate > 0 ? recentRate / baselineRate : (recentRate > 0 ? 2.0 : 1.0);

    // Diversity of sources in recent window
    const recentSources = new Set(recent.map((d) => d.source as string));
    const sourceDiversity = Math.min(1, recentSources.size / 3); // 3+ sources = max diversity

    // Price movement velocity from snapshots
    let priceVelocity = 0;
    if (context.snapshots.length >= 2) {
      const sorted = [...context.snapshots]
        .sort((a, b) => (a.timestamp as Date).getTime() - (b.timestamp as Date).getTime());
      const priceSeries = sorted.map((s) => {
        const p = s.prices as Record<string, number> | null;
        return p ? (Object.values(p)[0] ?? 0.5) : 0.5;
      });
      const changes = [];
      for (let i = 1; i < priceSeries.length; i++) {
        if (priceSeries[i - 1] > 0) {
          changes.push(Math.abs((priceSeries[i] - priceSeries[i - 1]) / priceSeries[i - 1]));
        }
      }
      priceVelocity = changes.length > 0
        ? changes.reduce((a, b) => a + b, 0) / changes.length
        : 0;
    }

    // Composite
    const ratioComponent = Math.min(1, velocityRatio / params.high_velocity_ratio);
    const priceComponent = Math.min(1, priceVelocity * 50); // 2% avg move → max
    const composite = ratioComponent * 0.5 + sourceDiversity * 0.2 + priceComponent * 0.3;
    const score = Math.max(0, Math.min(100, Math.round(composite * 100)));

    let label: string;
    if (score >= 80) label = 'VERY_HIGH';
    else if (score >= 60) label = 'HIGH';
    else if (score >= 40) label = 'MODERATE';
    else if (score >= 20) label = 'LOW';
    else label = 'QUIET';

    return {
      value: score,
      label,
      detail: `${recentRate.toFixed(1)}/hr recent vs ${baselineRate.toFixed(1)}/hr baseline (${velocityRatio.toFixed(1)}x) · ${recentSources.size} sources · Price velocity ${(priceVelocity * 100).toFixed(2)}%`,
      metadata: {
        recent_rate: recentRate,
        baseline_rate: baselineRate,
        velocity_ratio: velocityRatio,
        source_diversity: sourceDiversity,
        price_velocity: priceVelocity,
        recent_count: recent.length,
        baseline_count: baseline.length,
        sources: [...recentSources],
      },
    };
  },

  getRequiredData(): string[] {
    return ['headline', 'poll_result'];
  },

  validateConfig(params: Record<string, unknown>): { valid: boolean; errors?: string[] } {
    const errors: string[] = [];
    if (params.recent_window_ms !== undefined && (typeof params.recent_window_ms !== 'number' || params.recent_window_ms <= 0))
      errors.push('recent_window_ms must be > 0');
    if (params.high_velocity_ratio !== undefined && (typeof params.high_velocity_ratio !== 'number' || params.high_velocity_ratio <= 1))
      errors.push('high_velocity_ratio must be > 1');
    return { valid: errors.length === 0, errors: errors.length > 0 ? errors : undefined };
  },
};
