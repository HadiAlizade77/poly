// ─── Execution Engine ───────────────────────────────────────────────────────
//
// Orchestrates order placement after risk approval.
// Called by the decision engine when a trade decision passes risk checks.
//
// Pipeline:
//   1. Receive approved decision
//   2. Compute position size (sizing.ts)
//   3. Place order (order-manager.ts)
//   4. On fill → open/update position (position-manager.ts)
//   5. Set exit strategy on position

import type { Market, Bankroll, Position } from '@prisma/client';
import logger from '../../config/logger.js';
import { computeSize, type SizingConfig, type SizingResult } from './sizing.js';
import { orderManager, type PlaceOrderInput } from './order-manager.js';
import { positionManager } from './position-manager.js';
import type { DecisionOutput } from '../ai/decision-maker.js';
import * as systemConfigService from '../system-config.service.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ExecutionInput {
  market: Market;
  decision: DecisionOutput;
  decisionId: bigint;
  bankroll: Bankroll;
  /** Current positions (used for exposure checks). */
  positions: Position[];
  /** Optional sizing config override. */
  sizingConfig?: Partial<SizingConfig>;
}

export interface ExecutionResult {
  executed: boolean;
  orderId: string | null;
  positionId: string | null;
  sizing: SizingResult | null;
  reason: string;
}

// ─── Execution Engine ───────────────────────────────────────────────────────

export class ExecutionEngine {
  /**
   * Execute a risk-approved trade decision.
   */
  async execute(input: ExecutionInput): Promise<ExecutionResult> {
    const { market, decision, decisionId, bankroll } = input;

    logger.info('ExecutionEngine: starting execution', {
      marketId: market.id,
      direction: decision.direction,
      token: decision.outcome_token,
      confidence: decision.confidence,
    });

    // ── 1. Determine market price ──────────────────────────────────────────
    const prices = market.current_prices as Record<string, number> | null;
    const outcomeToken = decision.outcome_token ?? Object.keys(prices ?? {})[0] ?? 'YES';
    const marketPrice = prices ? (prices[outcomeToken] ?? 0.5) : 0.5;

    // ── 2. Compute position size ───────────────────────────────────────────
    const appetite = (await systemConfigService.getValue<number>('RISK_APPETITE')) ?? 5;
    const appetiteScale = appetite / 5; // 1.0 at default, 2.0 at max, 0.2 at min
    const appetiteSizingConfig: Partial<SizingConfig> = {
      kelly_fraction:  Math.min(0.50, Math.max(0.05, 0.25 * appetiteScale)),
      max_position_pct: Math.min(0.10, Math.max(0.01, 0.05 * appetiteScale)),
      min_edge:         Math.min(0.10, Math.max(0.01, 0.02 / appetiteScale)),
    };

    const sizing = computeSize(
      {
        confidence: decision.confidence,
        sizeHint: decision.size_hint ?? null,
        estimatedEdge: decision.estimated_edge ?? null,
        marketPrice,
        bankroll,
      },
      { ...appetiteSizingConfig, ...input.sizingConfig },
    );

    if (!sizing) {
      logger.info('ExecutionEngine: sizing returned null (no trade)', {
        marketId: market.id,
        confidence: decision.confidence,
        edge: decision.estimated_edge,
      });
      return {
        executed: false,
        orderId: null,
        positionId: null,
        sizing: null,
        reason: 'Position sizing returned null (insufficient edge or balance)',
      };
    }

    logger.info('ExecutionEngine: sized trade', {
      marketId: market.id,
      sizeUsd: sizing.sizeUsd,
      fraction: sizing.sizeFraction,
      rawKelly: sizing.rawKelly,
      cappedBy: sizing.cappedBy,
    });

    // ── 3. Determine order parameters ──────────────────────────────────────
    const side = decision.direction === 'sell' ? 'sell' : 'buy';
    const orderPrice = marketPrice; // Limit order at current market price

    const orderInput: PlaceOrderInput = {
      marketId: market.id,
      decisionId,
      side,
      outcomeToken,
      price: orderPrice,
      sizeUsd: sizing.sizeUsd,
      orderType: 'limit',
      confidence: decision.confidence,
      estimatedEdge: decision.estimated_edge ?? null,
      regime: decision.regime_assessment ?? null,
    };

    // ── 4. Place order ─────────────────────────────────────────────────────
    const { order, isMock } = await orderManager.placeOrder(orderInput);

    logger.info('ExecutionEngine: order placed', {
      orderId: order.id,
      status: order.status,
      mock: isMock,
    });

    // ── 5. If filled, open/update position ─────────────────────────────────
    let positionId: string | null = null;

    if (order.status === 'filled') {
      const fillPrice = order.avg_fill_price !== null
        ? Number(order.avg_fill_price)
        : orderPrice;
      const fees = Number(order.fees_paid);

      // Determine exit strategy
      const exitStrategy = this.determineExitStrategy(decision);

      const position = await positionManager.openPosition({
        marketId: market.id,
        outcomeToken,
        side: side === 'buy' ? 'long' : 'short',
        size: sizing.sizeUsd,
        entryPrice: fillPrice,
        fees,
        decisionId,
        exitStrategy: exitStrategy.strategy,
        stopLossPrice: exitStrategy.stopLossPrice,
        timeExitAt: exitStrategy.timeExitAt,
      });

      positionId = position.id;

      logger.info('ExecutionEngine: position opened', {
        positionId,
        marketId: market.id,
        exitStrategy: exitStrategy.strategy,
      });
    }

    return {
      executed: true,
      orderId: order.id,
      positionId,
      sizing,
      reason: order.status === 'filled'
        ? 'Order filled and position opened'
        : `Order placed with status: ${order.status}`,
    };
  }

  /**
   * Determine the exit strategy based on the decision context.
   */
  private determineExitStrategy(decision: DecisionOutput): {
    strategy: 'resolution_only' | 'stop_loss' | 'time_based';
    stopLossPrice?: number;
    timeExitAt?: Date;
  } {
    // High confidence → resolution only (let it ride)
    if (decision.confidence >= 0.8) {
      return { strategy: 'resolution_only' };
    }

    // Medium confidence → stop-loss
    if (decision.confidence >= 0.5) {
      // Stop-loss at 2x the expected edge below entry
      const edge = decision.estimated_edge ?? 0.05;
      const fairValue = decision.fair_value ?? 0.5;
      const stopLossPrice = Math.max(0.01, fairValue - edge * 2);

      return {
        strategy: 'stop_loss',
        stopLossPrice,
      };
    }

    // Lower confidence → time-based exit (24h)
    return {
      strategy: 'time_based',
      timeExitAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    };
  }
}

export const executionEngine = new ExecutionEngine();
