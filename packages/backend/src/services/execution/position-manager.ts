// ─── Position Manager ───────────────────────────────────────────────────────
//
// Opens, updates, and closes positions. Tracks P&L.
// Delegates DB persistence to position.service.ts.
// Moves closed positions to position_history.

import type { Order, Position, Prisma } from '@prisma/client';
import logger from '../../config/logger.js';
import prisma from '../../config/database.js';
import * as positionService from '../position.service.js';
import * as bankrollService from '../bankroll.service.js';
import { create as createAuditLog } from '../audit-log.service.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface OpenPositionInput {
  marketId: string;
  outcomeToken: string;
  side: 'long' | 'short';
  size: number;
  entryPrice: number;
  fees: number;
  decisionId: bigint;
  exitStrategy: 'resolution_only' | 'stop_loss' | 'time_based';
  stopLossPrice?: number;
  timeExitAt?: Date;
}

export interface ClosePositionInput {
  positionId: string;
  exitPrice: number;
  closeReason: 'resolution' | 'stop_loss' | 'time_exit' | 'manual' | 'risk_veto';
  regime?: string;
}

// ─── Position Manager ───────────────────────────────────────────────────────

export class PositionManager {
  /**
   * Open a new position or add to an existing one for the same market+token.
   */
  async openPosition(input: OpenPositionInput): Promise<Position> {
    const existing = await positionService.findByMarketAndToken(
      input.marketId,
      input.outcomeToken,
    );

    if (existing) {
      // Add to existing position (average entry price)
      const oldSize = Number(existing.size);
      const oldEntry = Number(existing.avg_entry_price);
      const newSize = oldSize + input.size;
      const newEntry = (oldEntry * oldSize + input.entryPrice * input.size) / newSize;
      const newFees = Number(existing.total_fees) + input.fees;

      const updated = await positionService.update(existing.id, {
        size: newSize.toFixed(6),
        avg_entry_price: newEntry.toFixed(6),
        total_fees: newFees.toFixed(6),
        current_price: input.entryPrice.toFixed(6),
        unrealized_pnl: '0', // reset on add
      });

      logger.info('PositionManager: added to existing position', {
        positionId: existing.id,
        marketId: input.marketId,
        oldSize,
        addedSize: input.size,
        newSize,
        newEntry,
      });

      return updated;
    }

    // Create new position
    const position = await positionService.create({
      market_id: input.marketId,
      outcome_token: input.outcomeToken,
      side: input.side,
      size: input.size.toFixed(6),
      avg_entry_price: input.entryPrice.toFixed(6),
      current_price: input.entryPrice.toFixed(6),
      unrealized_pnl: '0',
      total_fees: input.fees.toFixed(6),
      decision_id: input.decisionId,
      exit_strategy: input.exitStrategy,
      ...(input.stopLossPrice !== undefined && {
        stop_loss_price: input.stopLossPrice.toFixed(6),
      }),
      ...(input.timeExitAt !== undefined && { time_exit_at: input.timeExitAt }),
    } as Prisma.PositionUncheckedCreateInput);

    logger.info('PositionManager: new position opened', {
      positionId: position.id,
      marketId: input.marketId,
      side: input.side,
      size: input.size,
      entryPrice: input.entryPrice,
      exitStrategy: input.exitStrategy,
    });

    // Update bankroll: increase deployed_balance
    await this.adjustBankroll(input.size, 'deploy');

    return position;
  }

  /**
   * Close a position, move to position_history, update bankroll.
   */
  async closePosition(input: ClosePositionInput): Promise<void> {
    const position = await positionService.findById(input.positionId);

    const size = Number(position.size);
    const entryPrice = Number(position.avg_entry_price);
    const exitPrice = input.exitPrice;
    const fees = Number(position.total_fees);

    // P&L calculation
    const isLong = position.side === 'long';
    const grossPnl = isLong
      ? (exitPrice - entryPrice) * size
      : (entryPrice - exitPrice) * size;
    const realizedPnl = grossPnl - fees;

    // ── Move to position_history ───────────────────────────────────────────
    await prisma.positionHistory.create({
      data: {
        market_id: position.market_id,
        outcome_token: position.outcome_token,
        side: position.side,
        size: position.size,
        avg_entry_price: position.avg_entry_price,
        avg_exit_price: exitPrice.toFixed(6),
        realized_pnl: realizedPnl.toFixed(6),
        total_fees: position.total_fees,
        decision_id: position.decision_id,
        regime_at_entry: null, // could be enriched later
        regime_at_exit: input.regime ?? null,
        opened_at: position.opened_at,
        close_reason: input.closeReason,
      },
    });

    // ── Remove live position ───────────────────────────────────────────────
    await positionService.remove(position.id);

    void createAuditLog(
      'position_closed',
      'position',
      input.positionId,
      { side: position.side, outcome_token: position.outcome_token, close_reason: input.closeReason, entry_price: entryPrice, exit_price: exitPrice, realized_pnl: realizedPnl, size },
      input.closeReason === 'manual' ? 'user' : 'exit-monitor',
    ).catch(() => {});

    logger.info('PositionManager: position closed', {
      positionId: position.id,
      marketId: position.market_id,
      closeReason: input.closeReason,
      entryPrice,
      exitPrice,
      realizedPnl,
    });

    // ── Update bankroll ────────────────────────────────────────────────────
    await this.adjustBankroll(size, 'release', realizedPnl);
  }

  /**
   * Update current price and unrealized P&L for a position.
   */
  async updateMark(positionId: string, currentPrice: number): Promise<Position> {
    const position = await positionService.findById(positionId);
    const size = Number(position.size);
    const entryPrice = Number(position.avg_entry_price);
    const isLong = position.side === 'long';

    const unrealizedPnl = isLong
      ? (currentPrice - entryPrice) * size
      : (entryPrice - currentPrice) * size;

    return positionService.updatePrice(
      positionId,
      currentPrice.toFixed(6),
      unrealizedPnl.toFixed(6),
    );
  }

  /**
   * Get all open positions.
   */
  async getOpenPositions(): Promise<Position[]> {
    return positionService.findOpen();
  }

  /**
   * Get open positions for a specific market.
   */
  async getPositionsByMarket(marketId: string): Promise<Position[]> {
    return positionService.findByMarket(marketId);
  }

  // ── Bankroll helpers ──────────────────────────────────────────────────────

  private async adjustBankroll(
    amountUsd: number,
    action: 'deploy' | 'release',
    pnl = 0,
  ): Promise<void> {
    try {
      const bankroll = await bankrollService.get();
      if (!bankroll) return;

      const deployed = Number(bankroll.deployed_balance);
      const active = Number(bankroll.active_balance);
      const total = Number(bankroll.total_balance);

      if (action === 'deploy') {
        await bankrollService.update({
          deployed_balance: (deployed + amountUsd).toFixed(6),
          active_balance: (active - amountUsd).toFixed(6),
          total_balance: bankroll.total_balance,
          previous_balance: bankroll.previous_balance,
          reserved_balance: bankroll.reserved_balance,
          unrealized_pnl: bankroll.unrealized_pnl,
          balance_delta_today: bankroll.balance_delta_today,
          balance_delta_total: bankroll.balance_delta_total,
          initial_deposit: bankroll.initial_deposit,
        });
      } else {
        // Release: return capital + pnl to active balance
        const newDeployed = Math.max(0, deployed - amountUsd);
        const newActive = active + amountUsd + pnl;
        const deltaToday = Number(bankroll.balance_delta_today) + pnl;
        const deltaTotal = Number(bankroll.balance_delta_total) + pnl;

        await bankrollService.update({
          deployed_balance: newDeployed.toFixed(6),
          active_balance: newActive.toFixed(6),
          total_balance: (total + pnl).toFixed(6),
          previous_balance: bankroll.previous_balance,
          reserved_balance: bankroll.reserved_balance,
          unrealized_pnl: bankroll.unrealized_pnl,
          balance_delta_today: deltaToday.toFixed(6),
          balance_delta_total: deltaTotal.toFixed(6),
          initial_deposit: bankroll.initial_deposit,
        });
      }
    } catch (err) {
      logger.error('PositionManager: bankroll adjustment failed', {
        error: (err as Error).message,
        action,
        amountUsd,
        pnl,
      });
    }
  }
}

export const positionManager = new PositionManager();
