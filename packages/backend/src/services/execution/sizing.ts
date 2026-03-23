// ─── Position Sizing (Kelly Criterion Inspired) ────────────────────────────────
//
// Computes position size as fraction of active balance.
// Uses a fractional Kelly formula tempered by AI size_hint and risk config.
//
// Kelly fraction: f = (edge / (odds - 1)) clamped by fractional multiplier
// Final size = min(kelly_fraction, ai_size_hint, max_position_pct) * active_balance

import type { Bankroll } from '@prisma/client';
import logger from '../../config/logger.js';

// ─── Config ─────────────────────────────────────────────────────────────────

export interface SizingConfig {
  /** Kelly fraction multiplier (0.25 = quarter-Kelly). Default 0.25. */
  kelly_fraction: number;
  /** Maximum position size as % of active balance. Default 0.05 (5%). */
  max_position_pct: number;
  /** Minimum position size in USDC. Default 5. */
  min_position_usd: number;
  /** Maximum position size in USDC. Default 500. */
  max_position_usd: number;
  /** Minimum edge required to size a trade. Default 0.02 (2%). */
  min_edge: number;
  /** Scale down when balance is low (below this % of initial deposit). Default 0.50. */
  low_balance_threshold: number;
  /** Scale factor when balance is low. Default 0.5. */
  low_balance_scale: number;
}

export const DEFAULT_SIZING_CONFIG: SizingConfig = {
  kelly_fraction: 0.25,
  max_position_pct: 0.05,
  min_position_usd: 5,
  max_position_usd: 500,
  min_edge: 0.02,
  low_balance_threshold: 0.50,
  low_balance_scale: 0.5,
};

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SizingInput {
  /** AI confidence (0-1). */
  confidence: number;
  /** AI suggested size as fraction (0-1), nullable. */
  sizeHint: number | null;
  /** Estimated edge as decimal (e.g., 0.05 for 5%). */
  estimatedEdge: number | null;
  /** Market price of the outcome token (0-1). */
  marketPrice: number;
  /** Current bankroll state. */
  bankroll: Bankroll;
}

export interface SizingResult {
  /** Size in USDC to deploy. */
  sizeUsd: number;
  /** Size as fraction of active balance. */
  sizeFraction: number;
  /** Kelly fraction before tempering. */
  rawKelly: number;
  /** Reason the size was capped or adjusted. */
  cappedBy: string | null;
}

// ─── Sizing Logic ───────────────────────────────────────────────────────────

export function computeSize(
  input: SizingInput,
  config: Partial<SizingConfig> = {},
): SizingResult | null {
  const cfg = { ...DEFAULT_SIZING_CONFIG, ...config };
  const { confidence, sizeHint, estimatedEdge, marketPrice, bankroll } = input;

  const activeBalance = Number(bankroll.active_balance);
  const initialDeposit = Number(bankroll.initial_deposit);

  // Guard: no balance to trade with
  if (activeBalance <= 0) {
    logger.debug('Sizing: zero active balance');
    return null;
  }

  // Guard: no edge or below minimum
  const edge = estimatedEdge ?? 0;
  if (edge < cfg.min_edge) {
    logger.debug('Sizing: edge below minimum', { edge, min: cfg.min_edge });
    return null;
  }

  // ── Kelly Criterion ──────────────────────────────────────────────────────
  // For binary markets: odds = 1/p where p = market price
  // Kelly: f = (p_model * odds - 1) / (odds - 1)
  //       = (edge) / (1 - marketPrice)   for a buy
  // We use a simplified form: f = edge / (1 - marketPrice) clamped to [0, 1]
  const denom = Math.max(0.01, 1 - marketPrice); // avoid division by zero near price=1
  const rawKelly = Math.max(0, edge / denom);

  // Apply fractional Kelly
  let fraction = rawKelly * cfg.kelly_fraction;

  // Blend with AI size_hint if provided (50/50 blend)
  if (sizeHint !== null && sizeHint > 0) {
    fraction = fraction * 0.5 + sizeHint * 0.5;
  }

  // Scale by confidence (lower confidence → smaller position)
  fraction *= confidence;

  // Cap at max_position_pct
  let cappedBy: string | null = null;
  if (fraction > cfg.max_position_pct) {
    fraction = cfg.max_position_pct;
    cappedBy = 'max_position_pct';
  }

  // ── Low balance protection ───────────────────────────────────────────────
  if (initialDeposit > 0 && activeBalance < initialDeposit * cfg.low_balance_threshold) {
    fraction *= cfg.low_balance_scale;
    cappedBy = cappedBy ? `${cappedBy}+low_balance` : 'low_balance';
  }

  // ── Convert to USD ───────────────────────────────────────────────────────
  let sizeUsd = fraction * activeBalance;

  // Floor
  if (sizeUsd < cfg.min_position_usd) {
    // If even the min position is too big for the balance, skip
    if (cfg.min_position_usd > activeBalance * cfg.max_position_pct) {
      logger.debug('Sizing: min_position_usd exceeds max allowed from balance');
      return null;
    }
    sizeUsd = cfg.min_position_usd;
    fraction = sizeUsd / activeBalance;
    cappedBy = cappedBy ? `${cappedBy}+min_floor` : 'min_floor';
  }

  // Ceiling
  if (sizeUsd > cfg.max_position_usd) {
    sizeUsd = cfg.max_position_usd;
    fraction = sizeUsd / activeBalance;
    cappedBy = cappedBy ? `${cappedBy}+max_ceiling` : 'max_ceiling';
  }

  return {
    sizeUsd: Math.round(sizeUsd * 100) / 100, // round to cents
    sizeFraction: Math.round(fraction * 10000) / 10000,
    rawKelly: Math.round(rawKelly * 10000) / 10000,
    cappedBy,
  };
}
