// ─── Momentum Scorer ────────────────────────────────────────────────────────
// Trend strength via EMA crossover, RSI, and MACD using technicalindicators.

import { EMA, RSI, MACD } from 'technicalindicators';
import type { ContextScorer, ScorerInput, ScorerDimension } from '../../scorer.interface.js';

const PARAM_DEFAULTS = {
  ema_short: 9,
  ema_long: 21,
  rsi_period: 14,
  macd_fast: 12,
  macd_slow: 26,
  macd_signal: 9,
  min_data_points: 10,
};

function cfg(config: Record<string, unknown>) {
  return {
    ema_short: typeof config.ema_short === 'number' ? config.ema_short : PARAM_DEFAULTS.ema_short,
    ema_long: typeof config.ema_long === 'number' ? config.ema_long : PARAM_DEFAULTS.ema_long,
    rsi_period: typeof config.rsi_period === 'number' ? config.rsi_period : PARAM_DEFAULTS.rsi_period,
    macd_fast: typeof config.macd_fast === 'number' ? config.macd_fast : PARAM_DEFAULTS.macd_fast,
    macd_slow: typeof config.macd_slow === 'number' ? config.macd_slow : PARAM_DEFAULTS.macd_slow,
    macd_signal: typeof config.macd_signal === 'number' ? config.macd_signal : PARAM_DEFAULTS.macd_signal,
    min_data_points: typeof config.min_data_points === 'number' ? config.min_data_points : PARAM_DEFAULTS.min_data_points,
  };
}

function extractPrices(snapshots: ScorerInput['snapshots']): number[] {
  return [...snapshots]
    .sort((a, b) => (a.timestamp as Date).getTime() - (b.timestamp as Date).getTime())
    .map((s) => {
      const p = s.prices as Record<string, number> | null;
      return p ? (Object.values(p)[0] ?? 0.5) : 0.5;
    });
}

export const momentumScorer: ContextScorer = {
  name: 'momentum',
  category: 'crypto',

  score(context: ScorerInput): ScorerDimension {
    const params = cfg(context.config);
    const prices = extractPrices(context.snapshots);

    if (prices.length < params.min_data_points) {
      return {
        value: 50,
        label: 'INSUFFICIENT_DATA',
        detail: `Need ${params.min_data_points} snapshots, have ${prices.length}`,
        metadata: { reason: 'insufficient_data', count: prices.length },
      };
    }

    // ── EMA Crossover (weight: 40%) ─────────────────────────────────────
    const emaShort = EMA.calculate({ period: params.ema_short, values: prices });
    const emaLong = EMA.calculate({ period: params.ema_long, values: prices });

    let emaCross = 0; // -1 to +1
    if (emaShort.length > 0 && emaLong.length > 0) {
      const s = emaShort[emaShort.length - 1];
      const l = emaLong[emaLong.length - 1];
      emaCross = l !== 0 ? Math.max(-1, Math.min(1, ((s - l) / l) * 20)) : 0;
    }

    // ── RSI (weight: 30%) ───────────────────────────────────────────────
    const rsiValues = RSI.calculate({ period: params.rsi_period, values: prices });
    let rsiNorm = 0; // -1 to +1
    let rsiValue: number | null = null;

    if (rsiValues.length > 0) {
      rsiValue = rsiValues[rsiValues.length - 1];
      rsiNorm = (rsiValue - 50) / 50; // 0→-1, 50→0, 100→+1
    }

    // ── MACD Histogram (weight: 30%) ────────────────────────────────────
    const macdResult = MACD.calculate({
      fastPeriod: params.macd_fast,
      slowPeriod: params.macd_slow,
      signalPeriod: params.macd_signal,
      SimpleMAOscillator: false,
      SimpleMASignal: false,
      values: prices,
    });

    let macdNorm = 0; // -1 to +1
    let macdHistogram: number | null = null;

    if (macdResult.length > 0) {
      const latest = macdResult[macdResult.length - 1];
      macdHistogram = latest.histogram ?? null;
      if (macdHistogram !== null) {
        macdNorm = Math.max(-1, Math.min(1, macdHistogram * 100));
      }
    }

    // ── Composite: map -1..+1 → 0..100 ─────────────────────────────────
    const composite = emaCross * 0.4 + rsiNorm * 0.3 + macdNorm * 0.3;
    const score = Math.max(0, Math.min(100, Math.round(50 + composite * 50)));

    let label: string;
    if (score >= 80) label = 'STRONG_BULL';
    else if (score >= 60) label = 'MODERATE_BULL';
    else if (score <= 20) label = 'STRONG_BEAR';
    else if (score <= 40) label = 'MODERATE_BEAR';
    else label = 'NEUTRAL';

    const rsiLabel = rsiValue !== null
      ? rsiValue > 70 ? ' (overbought)' : rsiValue < 30 ? ' (oversold)' : ''
      : '';

    return {
      value: score,
      label,
      detail: `EMA${params.ema_short}/${params.ema_long}: ${emaCross >= 0 ? '+' : ''}${(emaCross * 100).toFixed(0)}% · RSI ${rsiValue?.toFixed(1) ?? '?'}${rsiLabel} · MACD hist ${macdHistogram?.toFixed(4) ?? '?'}`,
      metadata: {
        ema_cross: emaCross,
        rsi_value: rsiValue,
        macd_histogram: macdHistogram,
        composite,
        data_points: prices.length,
      },
    };
  },

  getRequiredData(): string[] {
    return ['trade', 'kline_1m'];
  },

  validateConfig(params: Record<string, unknown>): { valid: boolean; errors?: string[] } {
    const errors: string[] = [];
    for (const key of ['ema_short', 'ema_long', 'rsi_period', 'macd_fast', 'macd_slow', 'macd_signal', 'min_data_points'] as const) {
      if (params[key] !== undefined && (typeof params[key] !== 'number' || (params[key] as number) < 2))
        errors.push(`${key} must be a number >= 2`);
    }
    return { valid: errors.length === 0, errors: errors.length > 0 ? errors : undefined };
  },
};
