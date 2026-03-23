// ─── Model Edge Scorer ──────────────────────────────────────────────────────
// Statistical model edge estimate based on available signals.
// 0-100: 50 = no edge, >50 = positive edge, <50 = negative edge.

import type { ContextScorer, ScorerInput, ScorerDimension } from '../../scorer.interface.js';

const PARAM_DEFAULTS = {
  odds_weight: 0.40,
  line_weight: 0.30,
  volume_weight: 0.15,
  recency_weight: 0.15,
  min_signals: 1,
};

function cfg(config: Record<string, unknown>) {
  return {
    odds_weight: typeof config.odds_weight === 'number' ? config.odds_weight : PARAM_DEFAULTS.odds_weight,
    line_weight: typeof config.line_weight === 'number' ? config.line_weight : PARAM_DEFAULTS.line_weight,
    volume_weight: typeof config.volume_weight === 'number' ? config.volume_weight : PARAM_DEFAULTS.volume_weight,
    recency_weight: typeof config.recency_weight === 'number' ? config.recency_weight : PARAM_DEFAULTS.recency_weight,
    min_signals: typeof config.min_signals === 'number' ? config.min_signals : PARAM_DEFAULTS.min_signals,
  };
}

export const modelEdgeScorer: ContextScorer = {
  name: 'model_edge',
  category: 'sports',

  score(context: ScorerInput): ScorerDimension {
    const params = cfg(context.config);

    const prices = context.market.current_prices as Record<string, number> | null;
    const marketProb = prices ? (Object.values(prices)[0] ?? 0.5) : 0.5;

    let signalCount = 0;
    let compositeEdge = 0; // -1 to +1

    // ── Signal 1: Odds-based edge ─────────────────────────────────────────
    let oddsEdge = 0;
    const oddsData = context.externalData.filter(
      (d) => (d.data_type as string) === 'game_odds',
    );
    if (oddsData.length > 0) {
      const consensus = (oddsData[0].value as Record<string, unknown>).consensus as Record<string, { implied_prob?: number }> | undefined;
      if (consensus) {
        const bookProb = Object.values(consensus)[0]?.implied_prob;
        if (bookProb !== undefined) {
          // Edge = book-implied probability - market price
          oddsEdge = bookProb - marketProb;
          compositeEdge += oddsEdge * params.odds_weight;
          signalCount++;
        }
      }
    }

    // ── Signal 2: Line movement direction ─────────────────────────────────
    let lineEdge = 0;
    if (context.snapshots.length >= 3) {
      const sorted = [...context.snapshots]
        .sort((a, b) => (a.timestamp as Date).getTime() - (b.timestamp as Date).getTime());
      const priceSeries = sorted.map((s) => {
        const p = s.prices as Record<string, number> | null;
        return p ? (Object.values(p)[0] ?? 0.5) : 0.5;
      });
      const first = priceSeries[0];
      const last = priceSeries[priceSeries.length - 1];
      lineEdge = last - first; // Positive = price rising
      compositeEdge += lineEdge * params.line_weight;
      signalCount++;
    }

    // ── Signal 3: Volume confirmation ─────────────────────────────────────
    let volumeEdge = 0;
    const volumes = context.snapshots
      .map((s) => (typeof s.volume_1h === 'number' ? Number(s.volume_1h) : null))
      .filter((v): v is number => v !== null);
    if (volumes.length >= 2) {
      const recent = volumes[0];
      const avg = volumes.reduce((a, b) => a + b, 0) / volumes.length;
      const ratio = avg > 0 ? recent / avg : 1;
      // High volume confirms direction, low volume weakens it
      volumeEdge = (ratio - 1) * Math.sign(lineEdge || oddsEdge) * 0.5;
      volumeEdge = Math.max(-1, Math.min(1, volumeEdge));
      compositeEdge += volumeEdge * params.volume_weight;
      signalCount++;
    }

    // ── Signal 4: Data recency ────────────────────────────────────────────
    let recencyEdge = 0;
    if (context.externalData.length > 0) {
      const newestAge = Date.now() - (context.externalData[0].timestamp as Date).getTime();
      // Fresh data = stronger signal
      const freshness = Math.max(0, 1 - newestAge / 3_600_000); // decays over 1 hour
      recencyEdge = freshness * Math.sign(compositeEdge) * 0.5;
      compositeEdge += recencyEdge * params.recency_weight;
      signalCount++;
    }

    if (signalCount < params.min_signals) {
      return {
        value: 50,
        label: 'INSUFFICIENT_DATA',
        detail: `Need ${params.min_signals} signals, have ${signalCount}`,
        metadata: { reason: 'insufficient_signals', signal_count: signalCount },
      };
    }

    // Map composite edge (-1..+1) to 0-100
    const score = Math.max(0, Math.min(100, Math.round(50 + compositeEdge * 200)));

    let label: string;
    if (score >= 80) label = 'STRONG_POSITIVE_EDGE';
    else if (score >= 60) label = 'MODERATE_POSITIVE_EDGE';
    else if (score <= 20) label = 'STRONG_NEGATIVE_EDGE';
    else if (score <= 40) label = 'MODERATE_NEGATIVE_EDGE';
    else label = 'NO_EDGE';

    return {
      value: score,
      label,
      detail: `Composite edge ${compositeEdge >= 0 ? '+' : ''}${(compositeEdge * 100).toFixed(2)}% · Odds ${(oddsEdge * 100).toFixed(1)}pp · Line ${(lineEdge * 100).toFixed(1)}pp · ${signalCount} signals`,
      metadata: {
        composite_edge: compositeEdge,
        odds_edge: oddsEdge,
        line_edge: lineEdge,
        volume_edge: volumeEdge,
        recency_edge: recencyEdge,
        market_probability: marketProb,
        signal_count: signalCount,
      },
    };
  },

  getRequiredData(): string[] {
    return ['game_odds'];
  },

  validateConfig(params: Record<string, unknown>): { valid: boolean; errors?: string[] } {
    const errors: string[] = [];
    for (const key of ['odds_weight', 'line_weight', 'volume_weight', 'recency_weight'] as const) {
      if (params[key] !== undefined && (typeof params[key] !== 'number' || (params[key] as number) < 0 || (params[key] as number) > 1))
        errors.push(`${key} must be between 0 and 1`);
    }
    return { valid: errors.length === 0, errors: errors.length > 0 ? errors : undefined };
  },
};
