/**
 * Core interfaces for the context scoring system.
 *
 * Every scorer module implements ContextScorer and is registered in the
 * scorer registry. The engine calls score() for each active market and
 * stores the resulting ScorerDimension in the context_scores table.
 */
import type { Market, MarketSnapshot, ExternalDataPoint } from '@prisma/client';

// ─── Input ────────────────────────────────────────────────────────────────────

export interface ScorerInput {
  /** The market being evaluated. */
  market: Market;
  /** Recent price/spread/volume snapshots for this market. */
  snapshots: MarketSnapshot[];
  /** Recent external data points relevant to the scorer's required data types. */
  externalData: ExternalDataPoint[];
  /** Scorer-specific parameters from scorer_configs.parameters. */
  config: Record<string, unknown>;
}

// ─── Output ───────────────────────────────────────────────────────────────────

export interface ScorerDimension {
  /**
   * Normalised score 0–100.
   *  0–20  : very bearish / very negative signal
   * 20–40  : bearish / weak signal
   * 40–60  : neutral
   * 60–80  : bullish / positive signal
   * 80–100 : very bullish / strong signal
   */
  value: number;
  /** Human-readable label for this dimension, e.g. "Price Momentum". */
  label: string;
  /** One-sentence explanation suitable for the AI dashboard text. */
  detail: string;
  /** Raw data used to derive the score (stored in context_scores.raw_indicators). */
  metadata?: Record<string, unknown>;
}

// ─── Scorer contract ──────────────────────────────────────────────────────────

export interface ContextScorer {
  /** Unique name within the registry, e.g. "price_momentum". */
  readonly name: string;
  /** Category this scorer targets: "crypto" | "politics" | "sports" | "events" | "entertainment" | "other". */
  readonly category: string;

  /**
   * Compute a single score dimension for the given market context.
   * Must be synchronous and must not throw — return a neutral score (50)
   * with an explanatory detail if the input is insufficient.
   */
  score(context: ScorerInput): ScorerDimension;

  /**
   * Return the list of external data type tags this scorer needs,
   * e.g. ["price_history", "order_book", "sentiment"].
   * The engine uses this to filter ExternalDataPoints before passing them in.
   */
  getRequiredData(): string[];

  /**
   * Validate scorer-specific config parameters.
   * Called when a scorer_config row is created or updated.
   */
  validateConfig(params: Record<string, unknown>): { valid: boolean; errors?: string[] };
}

// ─── Stored scores shape ──────────────────────────────────────────────────────

/**
 * Shape stored in context_scores.scores (JSON column).
 * Key = scorer name, value = ScorerDimension.
 */
export type ScoredDimensions = Record<string, ScorerDimension>;
