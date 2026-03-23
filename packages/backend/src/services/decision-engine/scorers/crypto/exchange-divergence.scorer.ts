// ─── Exchange Divergence Scorer ──────────────────────────────────────────────
// Compares Binance spot price to Polymarket implied price.
// Large divergence → opportunity for lag-arb style trades.

import type { ContextScorer, ScorerInput, ScorerDimension } from '../../scorer.interface.js';

const PARAM_DEFAULTS = {
  significance_threshold: 0.02,
  max_data_age_ms: 300_000,
};

function cfg(config: Record<string, unknown>) {
  return {
    significance_threshold:
      typeof config.significance_threshold === 'number'
        ? config.significance_threshold
        : PARAM_DEFAULTS.significance_threshold,
    max_data_age_ms:
      typeof config.max_data_age_ms === 'number'
        ? config.max_data_age_ms
        : PARAM_DEFAULTS.max_data_age_ms,
  };
}

export const exchangeDivergenceScorer: ContextScorer = {
  name: 'exchange_divergence',
  category: 'crypto',

  score(context: ScorerInput): ScorerDimension {
    const params = cfg(context.config);
    const now = Date.now();

    // Get latest Binance trade data
    const binanceTrades = context.externalData.filter((d) => {
      const src = d.source as string;
      const dt = d.data_type as string;
      const ts = (d.timestamp as Date).getTime();
      return src === 'binance' && dt === 'trade' && now - ts < params.max_data_age_ms;
    });

    if (binanceTrades.length === 0) {
      return {
        value: 50,
        label: 'INSUFFICIENT_DATA',
        detail: 'No recent Binance trade data for divergence comparison',
        metadata: { reason: 'no_data' },
      };
    }

    // Get latest Binance price
    const latestValue = binanceTrades[0].value as Record<string, unknown>;
    const binancePrice = latestValue.price as number | undefined;

    if (binancePrice === undefined || binancePrice <= 0) {
      return {
        value: 50,
        label: 'INSUFFICIENT_DATA',
        detail: 'Binance price data missing or invalid',
        metadata: { reason: 'invalid_price' },
      };
    }

    // Get Polymarket implied price
    const prices = context.market.current_prices as Record<string, number> | null;
    if (!prices || Object.keys(prices).length === 0) {
      return {
        value: 50,
        label: 'INSUFFICIENT_DATA',
        detail: 'Polymarket prices unavailable for comparison',
        metadata: { reason: 'no_market_prices', binance_price: binancePrice },
      };
    }

    const yesPrice = Object.values(prices)[0] ?? 0.5;

    // Get reference prices from older data
    const refSnapshot = context.snapshots.find(
      (s) => now - (s.timestamp as Date).getTime() > 60_000,
    );
    const refPolyPrice = refSnapshot
      ? (Object.values((refSnapshot.prices as Record<string, number>) ?? {})[0] ?? yesPrice)
      : yesPrice;

    const oldBinanceTrade = binanceTrades.find(
      (d) => now - (d.timestamp as Date).getTime() > 60_000,
    );
    const oldBinancePrice = oldBinanceTrade
      ? ((oldBinanceTrade.value as Record<string, unknown>).price as number)
      : binancePrice;

    // Calculate returns
    const binanceReturn =
      oldBinancePrice > 0 ? (binancePrice - oldBinancePrice) / oldBinancePrice : 0;
    const polyReturn =
      refPolyPrice > 0 ? (yesPrice - refPolyPrice) / refPolyPrice : 0;

    const divergence = binanceReturn - polyReturn;
    const absDivergence = Math.abs(divergence);

    // Map to 0-100: 50 = aligned, 100 = strong positive divergence, 0 = strong negative
    const rawScore = divergence / params.significance_threshold;
    const score = Math.max(0, Math.min(100, Math.round(50 + rawScore * 25)));

    let label: string;
    if (absDivergence > params.significance_threshold * 2) {
      label = divergence > 0 ? 'STRONG_DIVERGENCE_UP' : 'STRONG_DIVERGENCE_DOWN';
    } else if (absDivergence > params.significance_threshold) {
      label = divergence > 0 ? 'MODERATE_DIVERGENCE_UP' : 'MODERATE_DIVERGENCE_DOWN';
    } else if (absDivergence > params.significance_threshold * 0.5) {
      label = divergence > 0 ? 'SLIGHT_DIVERGENCE_UP' : 'SLIGHT_DIVERGENCE_DOWN';
    } else {
      label = 'ALIGNED';
    }

    return {
      value: score,
      label,
      detail: `Binance ${binanceReturn >= 0 ? '+' : ''}${(binanceReturn * 100).toFixed(2)}% vs Poly ${polyReturn >= 0 ? '+' : ''}${(polyReturn * 100).toFixed(2)}% · divergence ${(divergence * 100).toFixed(3)}%`,
      metadata: {
        binance_price: binancePrice,
        polymarket_price: yesPrice,
        binance_return: binanceReturn,
        poly_return: polyReturn,
        divergence,
        data_points: binanceTrades.length,
      },
    };
  },

  getRequiredData(): string[] {
    return ['trade'];
  },

  validateConfig(params: Record<string, unknown>): { valid: boolean; errors?: string[] } {
    const errors: string[] = [];
    if (params.significance_threshold !== undefined) {
      const v = params.significance_threshold;
      if (typeof v !== 'number' || v <= 0 || v > 1)
        errors.push('significance_threshold must be a number between 0 and 1');
    }
    if (params.max_data_age_ms !== undefined) {
      const v = params.max_data_age_ms;
      if (typeof v !== 'number' || v < 1000)
        errors.push('max_data_age_ms must be >= 1000');
    }
    return { valid: errors.length === 0, errors: errors.length > 0 ? errors : undefined };
  },
};
