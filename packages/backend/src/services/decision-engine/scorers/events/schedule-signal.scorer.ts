// ─── Schedule Signal Scorer ──────────────────────────────────────────────────
// Scheduled dates/deadlines approaching.
// 0 = no deadline, 100 = imminent scheduled event.

import type { ContextScorer, ScorerInput, ScorerDimension } from '../../scorer.interface.js';

const PARAM_DEFAULTS = {
  /** Days before a deadline/event considered "imminent" */
  imminent_days: 1,
  /** Days before considered "soon" */
  soon_days: 7,
  /** Days before considered "approaching" */
  approaching_days: 30,
};

function cfg(config: Record<string, unknown>) {
  return {
    imminent_days: typeof config.imminent_days === 'number' ? config.imminent_days : PARAM_DEFAULTS.imminent_days,
    soon_days: typeof config.soon_days === 'number' ? config.soon_days : PARAM_DEFAULTS.soon_days,
    approaching_days: typeof config.approaching_days === 'number' ? config.approaching_days : PARAM_DEFAULTS.approaching_days,
  };
}

export const scheduleSignalScorer: ContextScorer = {
  name: 'schedule_signal',
  category: 'events',

  score(context: ScorerInput): ScorerDimension {
    const params = cfg(context.config);

    // Check market end_date as primary scheduled event
    const endDate = context.market.end_date as Date | null;

    // Also check metadata for scheduled dates
    const metadata = (context.market.metadata as Record<string, unknown>) ?? {};
    const scheduledDateStr = metadata.scheduled_date as string | undefined;
    const scheduledDate = scheduledDateStr ? new Date(scheduledDateStr) : null;

    // Also scan external data for schedule-related data
    const scheduleData = context.externalData.filter(
      (d) => (d.data_type as string) === 'schedule' || (d.data_type as string) === 'deadline',
    );

    // Collect all known dates
    const dates: Array<{ date: Date; source: string }> = [];
    if (endDate) dates.push({ date: endDate, source: 'market_end_date' });
    if (scheduledDate && !isNaN(scheduledDate.getTime())) dates.push({ date: scheduledDate, source: 'metadata' });
    for (const d of scheduleData) {
      const v = d.value as Record<string, unknown>;
      const dateVal = v.date as string | undefined;
      if (dateVal) {
        const parsed = new Date(dateVal);
        if (!isNaN(parsed.getTime())) dates.push({ date: parsed, source: 'external_data' });
      }
    }

    if (dates.length === 0) {
      return {
        value: 50,
        label: 'NO_SCHEDULE',
        detail: 'No scheduled dates or deadlines found',
        metadata: { reason: 'no_dates' },
      };
    }

    // Find nearest future date
    const now = Date.now();
    const futureDates = dates
      .filter((d) => d.date.getTime() > now)
      .sort((a, b) => a.date.getTime() - b.date.getTime());

    if (futureDates.length === 0) {
      // All dates are in the past — event may have occurred
      return {
        value: 90,
        label: 'PAST_DUE',
        detail: 'Scheduled date has passed — awaiting resolution',
        metadata: { dates: dates.map((d) => ({ date: d.date.toISOString(), source: d.source })) },
      };
    }

    const nearest = futureDates[0];
    const daysUntil = (nearest.date.getTime() - now) / 86_400_000;

    let score: number;
    let label: string;

    if (daysUntil <= params.imminent_days) {
      score = Math.round(85 + (1 - daysUntil / params.imminent_days) * 15); // 85-100
      label = 'IMMINENT';
    } else if (daysUntil <= params.soon_days) {
      const pos = 1 - (daysUntil - params.imminent_days) / (params.soon_days - params.imminent_days);
      score = Math.round(55 + pos * 30); // 55-85
      label = 'SOON';
    } else if (daysUntil <= params.approaching_days) {
      const pos = 1 - (daysUntil - params.soon_days) / (params.approaching_days - params.soon_days);
      score = Math.round(25 + pos * 30); // 25-55
      label = 'APPROACHING';
    } else {
      const ratio = Math.min(3, daysUntil / params.approaching_days);
      score = Math.round(25 - (ratio - 1) * 12.5); // 25-0
      label = score > 10 ? 'DISTANT' : 'FAR_OFF';
    }

    score = Math.max(0, Math.min(100, score));

    const timeStr = daysUntil >= 1
      ? `${daysUntil.toFixed(1)}d`
      : `${(daysUntil * 24).toFixed(1)}h`;

    return {
      value: score,
      label,
      detail: `Nearest: ${timeStr} away (${nearest.date.toISOString().slice(0, 10)}) via ${nearest.source} · ${dates.length} scheduled dates`,
      metadata: {
        days_until: daysUntil,
        nearest_date: nearest.date.toISOString(),
        nearest_source: nearest.source,
        total_dates: dates.length,
      },
    };
  },

  getRequiredData(): string[] {
    return ['schedule', 'deadline'];
  },

  validateConfig(params: Record<string, unknown>): { valid: boolean; errors?: string[] } {
    const errors: string[] = [];
    if (params.imminent_days !== undefined && (typeof params.imminent_days !== 'number' || params.imminent_days <= 0))
      errors.push('imminent_days must be > 0');
    if (params.soon_days !== undefined && (typeof params.soon_days !== 'number' || params.soon_days <= 0))
      errors.push('soon_days must be > 0');
    return { valid: errors.length === 0, errors: errors.length > 0 ? errors : undefined };
  },
};
