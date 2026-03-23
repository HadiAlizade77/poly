// ─── Exit Monitor ───────────────────────────────────────────────────────────
//
// Runs on a loop checking all open positions for exit conditions:
//   1. Stop-loss: current_price <= stop_loss_price (for longs) or >= (for shorts)
//   2. Time-based: now >= time_exit_at
//   3. Resolution: market resolved → close at resolution price
//
// Uses position.service to read positions and position-manager to close them.

import type { Position, Market } from '@prisma/client';
import logger from '../../config/logger.js';
import prisma from '../../config/database.js';
import * as positionService from '../position.service.js';
import { positionManager } from './position-manager.js';

// ─── Config ─────────────────────────────────────────────────────────────────

const DEFAULT_CHECK_INTERVAL_MS = 30_000; // 30 seconds

// ─── Exit Monitor ───────────────────────────────────────────────────────────

export class ExitMonitor {
  private intervalId: NodeJS.Timeout | null = null;
  private running = false;
  private readonly checkIntervalMs: number;

  constructor(checkIntervalMs = DEFAULT_CHECK_INTERVAL_MS) {
    this.checkIntervalMs = checkIntervalMs;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    logger.info('ExitMonitor: starting', { intervalMs: this.checkIntervalMs });

    // Run immediately, then on interval
    void this.runCheck();
    this.intervalId = setInterval(() => void this.runCheck(), this.checkIntervalMs);
    this.intervalId.unref();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    logger.info('ExitMonitor: stopped');
  }

  private async runCheck(): Promise<void> {
    try {
      const positions = await positionService.findOpen();
      if (positions.length === 0) return;

      // Load markets for resolution check
      const marketIds = [...new Set(positions.map((p) => p.market_id))];
      const markets = await prisma.market.findMany({
        where: { id: { in: marketIds } },
      });
      const marketMap = new Map(markets.map((m) => [m.id, m as Market]));

      let exitCount = 0;
      for (const position of positions) {
        const exited = await this.checkPosition(position as Position, marketMap);
        if (exited) exitCount++;
      }

      if (exitCount > 0) {
        logger.info('ExitMonitor: exits triggered', { count: exitCount, total: positions.length });
      }
    } catch (err) {
      logger.error('ExitMonitor: check failed', { error: (err as Error).message });
    }
  }

  private async checkPosition(
    position: Position,
    marketMap: Map<string, Market>,
  ): Promise<boolean> {
    const market = marketMap.get(position.market_id);

    // ── 1. Resolution exit ──────────────────────────────────────────────────
    if (market && market.status === 'resolved') {
      const resolvedOutcome = market.resolved_outcome;
      // Determine exit price: 1.0 if position matches resolved outcome, 0.0 otherwise
      const exitPrice = resolvedOutcome === position.outcome_token ? 1.0 : 0.0;

      await positionManager.closePosition({
        positionId: position.id,
        exitPrice,
        closeReason: 'resolution',
      });

      logger.info('ExitMonitor: resolution exit', {
        positionId: position.id,
        resolvedOutcome,
        outcomeToken: position.outcome_token,
        exitPrice,
      });
      return true;
    }

    // ── 2. Stop-loss exit ───────────────────────────────────────────────────
    if (
      position.exit_strategy === 'stop_loss' &&
      position.stop_loss_price !== null &&
      position.current_price !== null
    ) {
      const currentPrice = Number(position.current_price);
      const stopLoss = Number(position.stop_loss_price);
      const isLong = position.side === 'long';

      const triggered = isLong
        ? currentPrice <= stopLoss
        : currentPrice >= stopLoss;

      if (triggered) {
        await positionManager.closePosition({
          positionId: position.id,
          exitPrice: currentPrice,
          closeReason: 'stop_loss',
        });

        logger.info('ExitMonitor: stop-loss exit', {
          positionId: position.id,
          side: position.side,
          currentPrice,
          stopLoss,
        });
        return true;
      }
    }

    // ── 3. Time-based exit ──────────────────────────────────────────────────
    if (
      position.exit_strategy === 'time_based' &&
      position.time_exit_at !== null
    ) {
      const now = Date.now();
      const exitTime = (position.time_exit_at as Date).getTime();

      if (now >= exitTime) {
        const currentPrice = position.current_price !== null
          ? Number(position.current_price)
          : Number(position.avg_entry_price); // fallback to entry if no mark

        await positionManager.closePosition({
          positionId: position.id,
          exitPrice: currentPrice,
          closeReason: 'time_exit',
        });

        logger.info('ExitMonitor: time-based exit', {
          positionId: position.id,
          exitTime: position.time_exit_at,
        });
        return true;
      }
    }

    return false;
  }
}

export const exitMonitor = new ExitMonitor();
