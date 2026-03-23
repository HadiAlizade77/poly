/**
 * Deterministic fallback.
 *
 * Used when the Claude API is unavailable or returns an invalid response.
 * Applies simple score-threshold rules rather than calling Claude.
 * Always prefers safety — defaults to 'hold' when in doubt.
 */
import type { ScoredDimensions } from '../decision-engine/scorer.interface.js';
import type { ParsedDecision } from './response-parser.js';

// ─── Thresholds ──────────────────────────────────────────────────────────────

// Minimum composite score to consider a 'trade'
const MIN_COMPOSITE_FOR_TRADE = 72;
// Must have at least this many scorers to trust composite
const MIN_SCORER_COUNT = 3;

// ─── Fallback ────────────────────────────────────────────────────────────────

/**
 * Compute a simple composite from available scored dimensions.
 * All scorers weighted equally.
 */
function computeComposite(scores: ScoredDimensions): { composite: number; count: number } {
  const values = Object.values(scores).map((d) => d.value);
  if (values.length === 0) return { composite: 50, count: 0 };
  const composite = values.reduce((a, b) => a + b, 0) / values.length;
  return { composite, count: values.length };
}

/**
 * Deterministic fallback decision — no AI call.
 *
 * Logic:
 *   - Composite < MIN_COMPOSITE_FOR_TRADE → hold
 *   - Composite ≥ threshold + sufficient scorers → trade buy at low confidence
 *   - Otherwise → hold
 */
export function deterministicFallback(
  scores: ScoredDimensions,
  category: string,
): ParsedDecision & { fallback: true } {
  const { composite, count } = computeComposite(scores);

  const shouldTrade =
    composite >= MIN_COMPOSITE_FOR_TRADE &&
    count >= MIN_SCORER_COUNT;

  if (!shouldTrade) {
    return {
      action:            'hold',
      direction:         null,
      outcome_token:     null,
      confidence:        0.3,
      size_hint:         null,
      fair_value:        null,
      estimated_edge:    null,
      reasoning:         `Deterministic fallback (AI unavailable): composite=${composite.toFixed(1)}, scorers=${count}. Holding conservatively.`,
      regime_assessment: `${category} market — fallback regime (composite ${composite.toFixed(0)}/100)`,
      fallback:          true,
    };
  }

  return {
    action:            'trade',
    direction:         'buy',
    outcome_token:     'YES',
    confidence:        0.4,  // deliberately low — no AI reasoning
    size_hint:         0.05, // minimum size
    fair_value:        null,
    estimated_edge:    null,
    reasoning:         `Deterministic fallback (AI unavailable): composite=${composite.toFixed(1)}/100 across ${count} scorers exceeds threshold. Low-confidence speculative entry.`,
    regime_assessment: `${category} market — strong composite signal but fallback regime`,
    fallback:          true,
  };
}
