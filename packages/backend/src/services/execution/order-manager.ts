// ─── Order Manager ──────────────────────────────────────────────────────────
//
// Creates orders, submits to Polymarket (or mock), tracks lifecycle.
// Delegates DB persistence to order.service.ts.

import type { Order, Market, Prisma } from '@prisma/client';
import logger from '../../config/logger.js';
import * as orderService from '../order.service.js';
import * as tradeService from '../trade.service.js';
import * as aiDecisionService from '../ai-decision.service.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PlaceOrderInput {
  marketId: string;
  decisionId: bigint;
  side: 'buy' | 'sell';
  outcomeToken: string;
  price: number;
  sizeUsd: number;
  orderType: 'limit' | 'market';
  confidence: number;
  estimatedEdge: number | null;
  regime: string | null;
}

export interface PlaceOrderResult {
  order: Order;
  /** Whether the order was placed via mock mode. */
  isMock: boolean;
}

// ─── Mock Mode ──────────────────────────────────────────────────────────────

const MOCK_MODE = process.env.EXECUTION_MODE !== 'live';

function mockFillDelay(): number {
  // Simulate 200-800ms fill latency
  return 200 + Math.random() * 600;
}

function mockFillPrice(requestedPrice: number): number {
  // Simulate slippage: ±0.1% (binary markets with tight spreads)
  const slip = (Math.random() - 0.5) * 0.002;
  return Math.max(0.001, Math.min(0.999, requestedPrice + slip));
}

function mockShouldFill(): boolean {
  // 95% fill rate in mock mode
  return Math.random() < 0.95;
}

// ─── Order Manager ──────────────────────────────────────────────────────────

export class OrderManager {
  /**
   * Place a new order and track its lifecycle.
   */
  async placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult> {
    const startMs = Date.now();

    // ── 1. Create pending order in DB ──────────────────────────────────────
    const order = await orderService.create({
      market_id: input.marketId,
      decision_id: input.decisionId,
      side: input.side,
      outcome_token: input.outcomeToken,
      order_type: input.orderType,
      price: input.price.toFixed(6),
      size: input.sizeUsd.toFixed(6),
      status: 'pending',
    } as Prisma.OrderUncheckedCreateInput);

    logger.info('OrderManager: order created', {
      orderId: order.id,
      marketId: input.marketId,
      side: input.side,
      price: input.price,
      size: input.sizeUsd,
      mock: MOCK_MODE,
    });

    // ── 2. Submit to exchange (or mock) ────────────────────────────────────
    if (MOCK_MODE) {
      await this.mockExecute(order, input);
    } else {
      await this.liveExecute(order, input);
    }

    // ── 3. Link decision → order ───────────────────────────────────────────
    try {
      await aiDecisionService.markExecuted(input.decisionId, order.id);
    } catch (err) {
      logger.warn('OrderManager: failed to mark decision executed', {
        decisionId: input.decisionId.toString(),
        error: (err as Error).message,
      });
    }

    const latencyMs = Date.now() - startMs;
    await orderService.update(order.id, {
      placement_latency_ms: latencyMs,
    });

    const finalOrder = await orderService.findById(order.id);
    return { order: finalOrder, isMock: MOCK_MODE };
  }

  /**
   * Cancel an open order.
   */
  async cancelOrder(orderId: string): Promise<Order> {
    const order = await orderService.findById(orderId);

    if (!['pending', 'open', 'partial'].includes(order.status)) {
      logger.warn('OrderManager: cannot cancel order in terminal state', {
        orderId,
        status: order.status,
      });
      return order;
    }

    if (MOCK_MODE) {
      return orderService.updateStatus(orderId, 'cancelled', {
        cancelledAt: new Date(),
      });
    }

    // Live: would call Polymarket CLOB cancel API
    // For now, just cancel locally
    return orderService.updateStatus(orderId, 'cancelled', {
      cancelledAt: new Date(),
    });
  }

  /**
   * Get all open/pending orders.
   */
  async getOpenOrders(): Promise<Order[]> {
    return orderService.findOpen();
  }

  // ── Mock execution ─────────────────────────────────────────────────────

  private async mockExecute(order: Order, input: PlaceOrderInput): Promise<void> {
    // Move to open
    await orderService.updateStatus(order.id, 'open', {
      polymarketOrderId: `mock-${order.id.slice(0, 8)}`,
    });

    // Simulate async fill
    const delay = mockFillDelay();
    await new Promise((resolve) => setTimeout(resolve, delay));

    if (mockShouldFill()) {
      const fillPrice = mockFillPrice(input.price);
      const fees = input.sizeUsd * 0.001; // 0.1% mock fee (Polymarket actual fee)

      // Update order as filled
      await orderService.updateStatus(order.id, 'filled', {
        filledSize: input.sizeUsd.toFixed(6),
        avgFillPrice: fillPrice.toFixed(6),
        filledAt: new Date(),
      });

      // Record trade
      await tradeService.create({
        order_id: order.id,
        market_id: input.marketId,
        decision_id: input.decisionId,
        side: input.side,
        outcome_token: input.outcomeToken,
        size: input.sizeUsd.toFixed(6),
        entry_price: fillPrice.toFixed(6),
        fees: fees.toFixed(6),
        net_cost: (input.sizeUsd + fees).toFixed(6),
        regime_at_entry: input.regime,
        confidence_at_entry: input.confidence.toFixed(4),
        edge_at_entry: input.estimatedEdge?.toFixed(6) ?? null,
      } as Prisma.TradeUncheckedCreateInput);

      logger.info('OrderManager: mock order filled', {
        orderId: order.id,
        fillPrice,
        fees,
        latencyMs: delay,
      });
    } else {
      // 5% chance: simulate cancel/expire
      await orderService.updateStatus(order.id, 'expired', {
        cancelledAt: new Date(),
        errorMessage: 'Mock: order expired (simulated)',
      });

      logger.info('OrderManager: mock order expired', { orderId: order.id });
    }
  }

  // ── Live execution (placeholder) ───────────────────────────────────────

  private async liveExecute(order: Order, _input: PlaceOrderInput): Promise<void> {
    // TODO: Wire to Polymarket CLOB client
    // 1. polymarketClient.placeOrder({ ... })
    // 2. Poll for fill status or use WebSocket
    // 3. Update order status accordingly
    logger.warn('OrderManager: live execution not yet implemented — falling back to mock', {
      orderId: order.id,
    });
    await this.mockExecute(order, _input);
  }
}

export const orderManager = new OrderManager();
