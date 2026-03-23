// ─── Liquidity Quality Scorer ────────────────────────────────────────────────
// Spread + order book depth analysis. 0 = terrible, 100 = excellent.

import type { ContextScorer, ScorerInput, ScorerDimension } from '../../scorer.interface.js';

const PARAM_DEFAULTS = {
  tight_spread: 0.02,
  wide_spread: 0.10,
  min_liquidity: 5_000,
  good_liquidity: 50_000,
};

function cfg(config: Record<string, unknown>) {
  return {
    tight_spread: typeof config.tight_spread === 'number' ? config.tight_spread : PARAM_DEFAULTS.tight_spread,
    wide_spread: typeof config.wide_spread === 'number' ? config.wide_spread : PARAM_DEFAULTS.wide_spread,
    min_liquidity: typeof config.min_liquidity === 'number' ? config.min_liquidity : PARAM_DEFAULTS.min_liquidity,
    good_liquidity: typeof config.good_liquidity === 'number' ? config.good_liquidity : PARAM_DEFAULTS.good_liquidity,
  };
}

export const liquidityQualityScorer: ContextScorer = {
  name: 'liquidity_quality',
  category: 'crypto',

  score(context: ScorerInput): ScorerDimension {
    const params = cfg(context.config);

    if (context.snapshots.length === 0) {
      return {
        value: 50,
        label: 'INSUFFICIENT_DATA',
        detail: 'No snapshots for liquidity analysis',
        metadata: { reason: 'no_data' },
      };
    }

    const latest = context.snapshots[0]; // newest first

    // ── Spread Component (50% weight) ─────────────────────────────────────
    const spread = typeof latest.spread === 'number' ? Number(latest.spread) : null;
    let spreadScore = 50;

    if (spread !== null) {
      if (spread <= params.tight_spread) {
        spreadScore = Math.round(80 + (1 - spread / params.tight_spread) * 20); // 80–100
      } else if (spread >= params.wide_spread) {
        const excess = Math.min(2, (spread - params.wide_spread) / params.wide_spread);
        spreadScore = Math.round(20 - excess * 10); // 20–0
      } else {
        const range = params.wide_spread - params.tight_spread;
        const pos = 1 - (spread - params.tight_spread) / range;
        spreadScore = Math.round(20 + pos * 60); // 20–80
      }
    }

    // ── Liquidity Component (35% weight) ──────────────────────────────────
    const liquidity = typeof latest.liquidity === 'number'
      ? Number(latest.liquidity)
      : (typeof context.market.liquidity === 'number' ? Number(context.market.liquidity) : null);
    let liqScore = 50;

    if (liquidity !== null) {
      if (liquidity >= params.good_liquidity) {
        const mult = Math.min(5, liquidity / params.good_liquidity);
        liqScore = Math.round(80 + (mult - 1) * 5); // 80–100
      } else if (liquidity <= params.min_liquidity) {
        const ratio = liquidity / params.min_liquidity;
        liqScore = Math.round(ratio * 20); // 0–20
      } else {
        const range = params.good_liquidity - params.min_liquidity;
        const pos = (liquidity - params.min_liquidity) / range;
        liqScore = Math.round(20 + pos * 60); // 20–80
      }
    }

    // ── Depth Component (15% weight) ──────────────────────────────────────
    let depthScore = 50;
    const depth = latest.order_book_depth as Record<string, unknown> | null;
    if (depth) {
      const bidTotal = typeof depth.bid_total === 'number' ? depth.bid_total : 0;
      const askTotal = typeof depth.ask_total === 'number' ? depth.ask_total : 0;
      const total = bidTotal + askTotal;
      if (total > 0) {
        // More total depth = better; balanced = better
        const balance = 1 - Math.abs(bidTotal - askTotal) / total;
        depthScore = Math.round(balance * 100);
      }
    }

    // ── Composite ─────────────────────────────────────────────────────────
    const score = Math.max(0, Math.min(100, Math.round(
      spreadScore * 0.50 + liqScore * 0.35 + depthScore * 0.15,
    )));

    let label: string;
    if (score >= 80) label = 'EXCELLENT';
    else if (score >= 60) label = 'GOOD';
    else if (score >= 40) label = 'FAIR';
    else if (score >= 20) label = 'POOR';
    else label = 'TERRIBLE';

    return {
      value: score,
      label,
      detail: `Spread ${spread !== null ? (spread * 100).toFixed(1) + '%' : '?'} (${spreadScore}) · Liq $${liquidity?.toFixed(0) ?? '?'} (${liqScore}) · Depth (${depthScore})`,
      metadata: {
        spread,
        spread_score: spreadScore,
        liquidity,
        liquidity_score: liqScore,
        depth_score: depthScore,
        snapshot_count: context.snapshots.length,
      },
    };
  },

  getRequiredData(): string[] {
    return []; // Uses snapshot data only
  },

  validateConfig(params: Record<string, unknown>): { valid: boolean; errors?: string[] } {
    const errors: string[] = [];
    if (params.tight_spread !== undefined && (typeof params.tight_spread !== 'number' || params.tight_spread <= 0))
      errors.push('tight_spread must be > 0');
    if (params.wide_spread !== undefined && (typeof params.wide_spread !== 'number' || params.wide_spread <= 0))
      errors.push('wide_spread must be > 0');
    if (params.tight_spread !== undefined && params.wide_spread !== undefined &&
      typeof params.tight_spread === 'number' && typeof params.wide_spread === 'number' &&
      params.tight_spread >= params.wide_spread)
      errors.push('tight_spread must be less than wide_spread');
    return { valid: errors.length === 0, errors: errors.length > 0 ? errors : undefined };
  },
};
