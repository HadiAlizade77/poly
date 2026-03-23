// ─── Injury Impact Scorer ───────────────────────────────────────────────────
// Factors in injury news and its impact on game outcomes.
// 0 = no injury impact, 100 = major injury impact.

import type { ContextScorer, ScorerInput, ScorerDimension } from '../../scorer.interface.js';

const PARAM_DEFAULTS = {
  max_data_age_ms: 86_400_000, // 24 hours
};

function cfg(config: Record<string, unknown>) {
  return {
    max_data_age_ms: typeof config.max_data_age_ms === 'number' ? config.max_data_age_ms : PARAM_DEFAULTS.max_data_age_ms,
  };
}

const IMPACT_KEYWORDS: Record<string, number> = {
  // Very high impact
  'out for season': 90, 'season-ending': 90, 'acl': 85, 'torn': 85,
  'surgery': 80, 'fracture': 80,
  // High impact
  'ruled out': 70, 'will not play': 70, 'out indefinitely': 75,
  'concussion': 65, 'hamstring': 55,
  // Moderate impact
  'questionable': 45, 'game-time decision': 50, 'day-to-day': 40,
  'limited practice': 35, 'ankle': 40, 'knee': 45,
  // Low impact
  'probable': 20, 'expected to play': 15, 'full practice': 10,
  'cleared': 5, 'returned to practice': 10,
};

const STAR_PLAYER_KEYWORDS = [
  'mvp', 'all-star', 'all-pro', 'starter', 'star', 'key player',
  'quarterback', 'qb1', 'ace', 'captain',
];

export const injuryImpactScorer: ContextScorer = {
  name: 'injury_impact',
  category: 'sports',

  score(context: ScorerInput): ScorerDimension {
    const params = cfg(context.config);
    const now = Date.now();

    // Look for injury-related headlines
    const headlines = context.externalData.filter((d) => {
      const dt = d.data_type as string;
      return dt === 'headline' && now - (d.timestamp as Date).getTime() < params.max_data_age_ms;
    });

    // Also check for explicit injury data type
    const injuryReports = context.externalData.filter((d) => {
      const dt = d.data_type as string;
      return dt === 'injury_report' && now - (d.timestamp as Date).getTime() < params.max_data_age_ms;
    });

    // Scan headlines for injury keywords
    let maxImpact = 0;
    let starPlayerMultiplier = 1.0;
    const detectedInjuries: string[] = [];

    for (const item of [...headlines, ...injuryReports]) {
      const title = ((item.value as Record<string, unknown>).title as string ?? '').toLowerCase();
      const text = `${title} ${((item.value as Record<string, unknown>).description as string) ?? ''}`.toLowerCase();

      for (const [keyword, impact] of Object.entries(IMPACT_KEYWORDS)) {
        if (text.includes(keyword)) {
          if (impact > maxImpact) maxImpact = impact;
          detectedInjuries.push(keyword);
        }
      }

      // Check if it's a star player
      for (const sp of STAR_PLAYER_KEYWORDS) {
        if (text.includes(sp)) {
          starPlayerMultiplier = 1.3;
          break;
        }
      }
    }

    // If explicit injury data exists, use its severity
    for (const report of injuryReports) {
      const v = report.value as Record<string, unknown>;
      const severity = typeof v.severity === 'number' ? v.severity : 0;
      if (severity > maxImpact) maxImpact = severity;
    }

    const rawScore = maxImpact * starPlayerMultiplier;
    const score = Math.max(0, Math.min(100, Math.round(rawScore)));

    let label: string;
    if (score >= 80) label = 'CRITICAL';
    else if (score >= 60) label = 'HIGH';
    else if (score >= 40) label = 'MODERATE';
    else if (score >= 20) label = 'LOW';
    else label = 'NONE';

    const uniqueInjuries = [...new Set(detectedInjuries)];

    return {
      value: score,
      label,
      detail: score > 0
        ? `Injury keywords: ${uniqueInjuries.slice(0, 3).join(', ')} · ${starPlayerMultiplier > 1 ? 'Star player involved' : 'Role player'} · ${headlines.length + injuryReports.length} reports`
        : `No injury signals in ${headlines.length} headlines`,
      metadata: {
        max_impact: maxImpact,
        star_player: starPlayerMultiplier > 1,
        detected_injuries: uniqueInjuries,
        headline_count: headlines.length,
        injury_report_count: injuryReports.length,
      },
    };
  },

  getRequiredData(): string[] {
    return ['headline', 'injury_report'];
  },

  validateConfig(params: Record<string, unknown>): { valid: boolean; errors?: string[] } {
    const errors: string[] = [];
    if (params.max_data_age_ms !== undefined && (typeof params.max_data_age_ms !== 'number' || params.max_data_age_ms <= 0))
      errors.push('max_data_age_ms must be > 0');
    return { valid: errors.length === 0, errors: errors.length > 0 ? errors : undefined };
  },
};
