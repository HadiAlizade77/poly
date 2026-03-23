// ─── Shared Time-to-Resolution Scorer ────────────────────────────────────────
// Generic time pressure scorer that works for all categories.
// 0 = plenty of time, 100 = imminent resolution.

import type { ContextScorer, ScorerInput, ScorerDimension } from '../../scorer.interface.js';

const PARAM_DEFAULTS = {
  urgent_minutes: 60,
  soon_minutes: 1_440,
  too_close_minutes: 5,
  no_pressure_days: 30,
};

function cfg(config: Record<string, unknown>) {
  return {
    urgent_minutes: typeof config.urgent_minutes === 'number' ? config.urgent_minutes : PARAM_DEFAULTS.urgent_minutes,
    soon_minutes: typeof config.soon_minutes === 'number' ? config.soon_minutes : PARAM_DEFAULTS.soon_minutes,
    too_close_minutes: typeof config.too_close_minutes === 'number' ? config.too_close_minutes : PARAM_DEFAULTS.too_close_minutes,
    no_pressure_days: typeof config.no_pressure_days === 'number' ? config.no_pressure_days : PARAM_DEFAULTS.no_pressure_days,
  };
}

function makeScorer(category: string): ContextScorer {
  return {
    name: 'time_pressure',
    category,

    score(context: ScorerInput): ScorerDimension {
      const params = cfg(context.config);
      const endDate = context.market.end_date as Date | null;

      if (!endDate) {
        return {
          value: 50,
          label: 'NONE',
          detail: 'No resolution date set — time pressure unknown',
          metadata: { reason: 'no_end_date' },
        };
      }

      const now = Date.now();
      const remainingMs = endDate.getTime() - now;
      const remainingMinutes = remainingMs / 60_000;
      const remainingHours = remainingMinutes / 60;
      const remainingDays = remainingHours / 24;

      if (remainingMs <= 0) {
        return {
          value: 100,
          label: 'IMMINENT',
          detail: `Resolution was ${Math.abs(Math.round(remainingMinutes))} min ago`,
          metadata: { remaining_minutes: remainingMinutes, expired: true },
        };
      }

      let score: number;
      let label: string;

      if (remainingMinutes < params.too_close_minutes) {
        score = 98;
        label = 'IMMINENT';
      } else if (remainingMinutes < params.urgent_minutes) {
        score = Math.round(80 + (1 - remainingMinutes / params.urgent_minutes) * 18);
        label = 'IMMINENT';
      } else if (remainingMinutes < params.soon_minutes) {
        const pos = 1 - (remainingMinutes - params.urgent_minutes) / (params.soon_minutes - params.urgent_minutes);
        score = Math.round(50 + pos * 30);
        label = score >= 70 ? 'HIGH' : 'MODERATE';
      } else if (remainingDays < params.no_pressure_days) {
        const soonDays = params.soon_minutes / 1440;
        const pos = 1 - (remainingDays - soonDays) / (params.no_pressure_days - soonDays);
        score = Math.round(20 + pos * 30);
        label = score >= 35 ? 'MODERATE' : 'LOW';
      } else {
        const ratio = Math.min(3, remainingDays / params.no_pressure_days);
        score = Math.round(20 - (ratio - 1) * 10);
        label = score > 10 ? 'LOW' : 'NONE';
      }

      score = Math.max(0, Math.min(100, score));

      const timeStr = remainingDays >= 1
        ? `${remainingDays.toFixed(1)}d`
        : remainingHours >= 1
          ? `${remainingHours.toFixed(1)}h`
          : `${remainingMinutes.toFixed(0)}min`;

      return {
        value: score,
        label,
        detail: `${timeStr} until resolution · ${endDate.toISOString().slice(0, 16)}Z`,
        metadata: { remaining_minutes: remainingMinutes, remaining_days: remainingDays, end_date: endDate.toISOString() },
      };
    },

    getRequiredData(): string[] {
      return [];
    },

    validateConfig(params: Record<string, unknown>): { valid: boolean; errors?: string[] } {
      const errors: string[] = [];
      if (params.urgent_minutes !== undefined && (typeof params.urgent_minutes !== 'number' || params.urgent_minutes <= 0))
        errors.push('urgent_minutes must be > 0');
      if (params.soon_minutes !== undefined && (typeof params.soon_minutes !== 'number' || params.soon_minutes <= 0))
        errors.push('soon_minutes must be > 0');
      return { valid: errors.length === 0, errors: errors.length > 0 ? errors : undefined };
    },
  };
}

export function createTimePressureScorer(category: string): ContextScorer {
  return makeScorer(category);
}

export const politicsTimeScorer = makeScorer('politics');
export const sportsTimeScorer = makeScorer('sports');
export const eventsTimeScorer = makeScorer('events');
