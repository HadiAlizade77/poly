/**
 * Risk Governor.
 *
 * Runs a series of pre-trade checks before any order is placed.
 * All checks are synchronous after data is loaded. Creates RiskEvent
 * records for any triggered checks.
 *
 * Checks (in order):
 *   1. Kill switch
 *   2. Drawdown limit
 *   3. Exposure limit
 *   4. Consecutive loss guard
 *   5. Trade rate limit
 *   6. Liquidity quality
 *   7. Spread quality
 *   8. AI decision latency
 *   9. Per-market cooldown
 *  10. Minimum edge requirement
 *  11. Data freshness
 */
import type { Market, Position, Bankroll, MarketSnapshot } from '@prisma/client';
import logger from '../../config/logger.js';
import prisma from '../../config/database.js';
import * as riskEventService from '../risk-event.service.js';
import * as systemConfigService from '../system-config.service.js';
import { isActive as isKillSwitchActive } from './kill-switch.js';
import type { DecisionOutput } from '../ai/decision-maker.js';
import type { ScoredDimensions } from '../decision-engine/scorer.interface.js';

// ─── Default limits (overridable via system_config / risk_config) ─────────────

const DEFAULTS = {
  maxDrawdownPct:        0.20,  // 20% drawdown from peak
  maxExposurePct:        0.80,  // 80% of active balance deployed
  maxConsecutiveLosses:  5,
  tradeRateWindowMs:     60_000,  // 1 min
  maxTradesPerWindow:    10,
  minLiquidityScore:     40,
  maxSpreadScore:        70,       // spread score < 30 (inverted: high spread = high score → bad)
  maxLatencyMs:          8_000,
  cooldownMs:            120_000,  // 2 min between trades on same market
  minEdge:               0.02,     // 2% minimum estimated edge
  maxSnapshotAgeMs:      600_000,  // 10 min
};

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RiskCheckContext {
  market:     Market;
  decision:   DecisionOutput;
  scores:     ScoredDimensions;
  bankroll:   Bankroll | null;
  positions:  Position[];
  snapshots:  MarketSnapshot[];
}

export interface RiskCheckResult {
  approved:       boolean;
  vetoReason:     string | null;
  triggeredChecks: string[];
  warnings:       string[];
}

// ─── In-memory trade rate tracker ─────────────────────────────────────────────

/** Records of recent trade timestamps per category. */
const recentTrades = new Map<string, number[]>();

function recordTrade(category: string): void {
  if (!recentTrades.has(category)) recentTrades.set(category, []);
  recentTrades.get(category)!.push(Date.now());
}

function getRecentTradeCount(category: string, windowMs: number): number {
  const now    = Date.now();
  const cutoff = now - windowMs;
  const trades = recentTrades.get(category) ?? [];
  const recent = trades.filter((t) => t > cutoff);
  recentTrades.set(category, recent); // prune old
  return recent.length;
}

// ─── Per-market cooldown tracker ──────────────────────────────────────────────

const lastTradeTime = new Map<string, number>();

function getLastTradeMs(marketId: string): number | null {
  const t = lastTradeTime.get(marketId);
  return t !== undefined ? Date.now() - t : null;
}

export function recordMarketTrade(marketId: string, category: string): void {
  lastTradeTime.set(marketId, Date.now());
  recordTrade(category);
}

// ─── Config loader ────────────────────────────────────────────────────────────

type Limits = typeof DEFAULTS;

async function loadLimits(): Promise<Limits> {
  try {
    const val = await systemConfigService.getValue<Partial<Limits>>('RISK_LIMITS');
    if (val && typeof val === 'object') {
      return { ...DEFAULTS, ...val };
    }
  } catch { /* use defaults */ }
  return { ...DEFAULTS };
}

// ─── Governor ────────────────────────────────────────────────────────────────

export class RiskGovernor {

  async check(ctx: RiskCheckContext): Promise<RiskCheckResult> {
    const limits   = await loadLimits();
    const vetoes:  string[] = [];
    const warnings: string[] = [];

    // ── 1. Kill switch ────────────────────────────────────────────────────────
    if (await isKillSwitchActive()) {
      return this.veto('KILL_SWITCH_ACTIVE', ctx, 'Global kill switch is active');
    }

    // ── 2. Drawdown limit ─────────────────────────────────────────────────────
    if (ctx.bankroll) {
      const b = ctx.bankroll as unknown as Record<string, string>;
      const initial  = parseFloat(b.initial_deposit ?? '0');
      const total    = parseFloat(b.total_balance ?? '0');
      const drawdown = initial > 0 ? (initial - total) / initial : 0;
      if (drawdown > limits.maxDrawdownPct) {
        vetoes.push(`DRAWDOWN_LIMIT: ${(drawdown * 100).toFixed(1)}% > ${(limits.maxDrawdownPct * 100).toFixed(0)}%`);
      } else if (drawdown > limits.maxDrawdownPct * 0.75) {
        warnings.push(`Drawdown warning: ${(drawdown * 100).toFixed(1)}%`);
      }
    }

    // ── 3. Exposure limit ─────────────────────────────────────────────────────
    if (ctx.bankroll) {
      const b        = ctx.bankroll as unknown as Record<string, string>;
      const active   = parseFloat(b.active_balance ?? '0');
      const deployed = parseFloat(b.deployed_balance ?? '0');
      const exposure = active > 0 ? deployed / active : 0;
      if (exposure > limits.maxExposurePct) {
        vetoes.push(`EXPOSURE_LIMIT: ${(exposure * 100).toFixed(1)}% > ${(limits.maxExposurePct * 100).toFixed(0)}%`);
      }
    }

    // ── 4. Consecutive losses ─────────────────────────────────────────────────
    try {
      const recentDecisions = await prisma.aiDecision.findMany({
        where: {
          category:     ctx.market.category,
          was_executed: true,
        },
        orderBy: { timestamp: 'desc' },
        take:    limits.maxConsecutiveLosses + 2,
        select:  { action: true, veto_reason: true },
      });
      const consecutive = countConsecutiveVetoed(recentDecisions);
      if (consecutive >= limits.maxConsecutiveLosses) {
        vetoes.push(`CONSECUTIVE_LOSSES: ${consecutive} consecutive vetoed/failed trades`);
      }
    } catch { /* non-fatal */ }

    // ── 5. Trade rate limit ───────────────────────────────────────────────────
    const recentCount = getRecentTradeCount(ctx.market.category, limits.tradeRateWindowMs);
    if (recentCount >= limits.maxTradesPerWindow) {
      vetoes.push(`TRADE_RATE_LIMIT: ${recentCount} trades in last ${limits.tradeRateWindowMs / 1000}s`);
    }

    // ── 6. Liquidity quality ──────────────────────────────────────────────────
    const liqScore = ctx.scores.liquidity_quality?.value;
    if (liqScore !== undefined && liqScore < limits.minLiquidityScore) {
      vetoes.push(`LIQUIDITY_POOR: score=${liqScore} < ${limits.minLiquidityScore}`);
    }

    // ── 7. Spread quality (high spread score = wide spread = bad) ─────────────
    // liquidity_quality scorer already captures spread; check explicitly from snapshot
    if (ctx.snapshots.length > 0) {
      const spread = Number(ctx.snapshots[0].spread ?? 0);
      if (spread > 0.15) {  // > 15% spread is prohibitive
        vetoes.push(`SPREAD_TOO_WIDE: ${(spread * 100).toFixed(1)}%`);
      } else if (spread > 0.10) {
        warnings.push(`Wide spread: ${(spread * 100).toFixed(1)}%`);
      }
    }

    // ── 8. AI decision latency ────────────────────────────────────────────────
    if (ctx.decision.latencyMs > limits.maxLatencyMs && !ctx.decision.usedFallback) {
      warnings.push(`High AI latency: ${ctx.decision.latencyMs}ms`);
    }

    // ── 9. Per-market cooldown ────────────────────────────────────────────────
    const sinceLastMs = getLastTradeMs(ctx.market.id);
    if (sinceLastMs !== null && sinceLastMs < limits.cooldownMs) {
      vetoes.push(`MARKET_COOLDOWN: ${Math.round(sinceLastMs / 1000)}s since last trade (min ${limits.cooldownMs / 1000}s)`);
    }

    // ── 10. Minimum edge ──────────────────────────────────────────────────────
    if (ctx.decision.estimated_edge !== null && ctx.decision.estimated_edge !== undefined) {
      if (ctx.decision.estimated_edge < limits.minEdge) {
        vetoes.push(`INSUFFICIENT_EDGE: ${(ctx.decision.estimated_edge * 100).toFixed(2)}% < ${(limits.minEdge * 100).toFixed(0)}%`);
      }
    } else if (ctx.decision.action === 'trade' && !ctx.decision.usedFallback) {
      // AI didn't compute edge — require high confidence as substitute
      if (ctx.decision.confidence < 0.65) {
        vetoes.push(`NO_EDGE_ESTIMATE: confidence ${ctx.decision.confidence.toFixed(2)} too low without edge data`);
      }
    }

    // ── 11. Data freshness ────────────────────────────────────────────────────
    if (ctx.snapshots.length > 0) {
      const snapshotAge = Date.now() - (ctx.snapshots[0].timestamp as Date).getTime();
      if (snapshotAge > limits.maxSnapshotAgeMs) {
        vetoes.push(`STALE_DATA: snapshot ${Math.round(snapshotAge / 60_000)}min old`);
      }
    } else {
      vetoes.push('NO_DATA: no market snapshots available');
    }

    // ── Persist risk events for vetoes ────────────────────────────────────────
    if (vetoes.length > 0) {
      const vetoReason = vetoes[0];
      await this.recordVeto(ctx, vetoReason, vetoes);
      return { approved: false, vetoReason, triggeredChecks: vetoes, warnings };
    }

    logger.debug('RiskGovernor: approved', {
      marketId: ctx.market.id,
      warnings: warnings.length,
    });

    return { approved: true, vetoReason: null, triggeredChecks: [], warnings };
  }

  private async veto(
    checkName: string,
    ctx: RiskCheckContext,
    message: string,
  ): Promise<RiskCheckResult> {
    const vetoReason = `${checkName}: ${message}`;
    await this.recordVeto(ctx, vetoReason, [vetoReason]);
    return { approved: false, vetoReason, triggeredChecks: [vetoReason], warnings: [] };
  }

  private async recordVeto(
    ctx: RiskCheckContext,
    primaryReason: string,
    allReasons: string[],
  ): Promise<void> {
    try {
      await riskEventService.create({
        event_type:  'trade_vetoed',
        severity:    'warning',
        market_id:   ctx.market.id,
        message:     `Trade vetoed: ${primaryReason}`,
        details:     { reasons: allReasons, marketId: ctx.market.id, category: ctx.market.category },
        auto_resolved: true,
      });
    } catch (err) {
      logger.warn('RiskGovernor: failed to record risk event', { error: (err as Error).message });
    }
  }
}

// ─── Module singleton ─────────────────────────────────────────────────────────

export const riskGovernor = new RiskGovernor();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function countConsecutiveVetoed(decisions: { action: string; veto_reason: string | null }[]): number {
  let count = 0;
  for (const d of decisions) {
    if (d.veto_reason !== null) count++;
    else break;
  }
  return count;
}
