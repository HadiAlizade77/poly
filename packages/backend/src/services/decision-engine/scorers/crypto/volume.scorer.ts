// ─── Volume Scorer ──────────────────────────────────────────────────────────
// Session-aware normalized volume. 0 = dead, 100 = extreme.

import type { ContextScorer, ScorerInput, ScorerDimension } from '../../scorer.interface.js';

const PARAM_DEFAULTS = {
  high_volume_ratio: 2.0,
  low_volume_ratio: 0.5,
  lookback_count: 10,
};

function cfg(config: Record<string, unknown>) {
  return {
    high_volume_ratio: typeof config.high_volume_ratio === 'number' ? config.high_volume_ratio : PARAM_DEFAULTS.high_volume_ratio,
    low_volume_ratio: typeof config.low_volume_ratio === 'number' ? config.low_volume_ratio : PARAM_DEFAULTS.low_volume_ratio,
    lookback_count: typeof config.lookback_count === 'number' ? config.lookback_count : PARAM_DEFAULTS.lookback_count,
  };
}

function getSessionName(date: Date): string {
  const h = date.getUTCHours();
  const m = date.getUTCMinutes();
  const t = h * 60 + m;
  if (t < 180) return 'asia_open';
  if (t < 540) return 'overnight';
  if (t < 810) return 'europe_open';
  if (t < 930) return 'us_open';
  if (t < 1080) return 'us_midday';
  return 'us_close';
}

export const volumeScorer: ContextScorer = {
  name: 'volume',
  category: 'crypto',

  score(context: ScorerInput): ScorerDimension {
    const params = cfg(context.config);
    const session = getSessionName(new Date());

    // Gather volume from snapshots
    const snapshots = context.snapshots.slice(0, params.lookback_count);
    const volumes = snapshots
      .map((s) => (typeof s.volume_1h === 'number' ? Number(s.volume_1h) : null))
      .filter((v): v is number => v !== null);

    // Also count Binance trade data points
    const tradeData = context.externalData.filter(
      (d) => (d.source as string) === 'binance' && (d.data_type as string) === 'trade',
    );

    if (volumes.length < 3 && tradeData.length < 3) {
      return {
        value: 50,
        label: 'INSUFFICIENT_DATA',
        detail: `${volumes.length} volume snapshots, ${tradeData.length} trade points`,
        metadata: { reason: 'insufficient_data', session },
      };
    }

    let volumeRatio: number;

    if (volumes.length >= 3) {
      const sorted = [...volumes].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      const current = volumes[0]; // newest first in snapshots
      volumeRatio = median > 0 ? current / median : 1.0;
    } else {
      // Use trade count density as proxy
      const tradeVolumes = tradeData.map((d) => {
        const v = (d.value as Record<string, unknown>).quote_volume;
        return typeof v === 'number' ? v : 0;
      });
      const total = tradeVolumes.reduce((a, b) => a + b, 0);
      const avg = tradeVolumes.length > 0 ? total / tradeVolumes.length : 0;
      // Simple ratio: more volume than average = high
      volumeRatio = avg > 0 ? (tradeVolumes[0] ?? avg) / avg : 1.0;
    }

    // Map to 0-100
    let score: number;
    if (volumeRatio <= params.low_volume_ratio * 0.5) {
      score = Math.round((volumeRatio / (params.low_volume_ratio * 0.5)) * 10); // 0–10
    } else if (volumeRatio <= params.low_volume_ratio) {
      const pos = (volumeRatio - params.low_volume_ratio * 0.5) / (params.low_volume_ratio * 0.5);
      score = Math.round(10 + pos * 15); // 10–25
    } else if (volumeRatio <= 1.0) {
      const pos = (volumeRatio - params.low_volume_ratio) / (1.0 - params.low_volume_ratio);
      score = Math.round(25 + pos * 25); // 25–50
    } else if (volumeRatio <= params.high_volume_ratio) {
      const pos = (volumeRatio - 1.0) / (params.high_volume_ratio - 1.0);
      score = Math.round(50 + pos * 25); // 50–75
    } else {
      const excess = Math.min(3, (volumeRatio - params.high_volume_ratio) / params.high_volume_ratio);
      score = Math.round(75 + (excess / 3) * 25); // 75–100
    }

    score = Math.max(0, Math.min(100, score));

    let label: string;
    if (score >= 85) label = 'EXTREME';
    else if (score >= 60) label = 'ABOVE_AVG';
    else if (score >= 35) label = 'NORMAL';
    else if (score >= 15) label = 'BELOW_AVG';
    else label = 'DEAD';

    return {
      value: score,
      label,
      detail: `Volume ${volumeRatio.toFixed(2)}x median · Session: ${session} · ${volumes.length} snapshots`,
      metadata: {
        volume_ratio: volumeRatio,
        session,
        snapshot_count: volumes.length,
        trade_count: tradeData.length,
      },
    };
  },

  getRequiredData(): string[] {
    return ['trade'];
  },

  validateConfig(params: Record<string, unknown>): { valid: boolean; errors?: string[] } {
    const errors: string[] = [];
    if (params.high_volume_ratio !== undefined && (typeof params.high_volume_ratio !== 'number' || params.high_volume_ratio <= 1))
      errors.push('high_volume_ratio must be > 1');
    if (params.low_volume_ratio !== undefined && (typeof params.low_volume_ratio !== 'number' || params.low_volume_ratio <= 0 || params.low_volume_ratio >= 1))
      errors.push('low_volume_ratio must be between 0 and 1');
    return { valid: errors.length === 0, errors: errors.length > 0 ? errors : undefined };
  },
};
