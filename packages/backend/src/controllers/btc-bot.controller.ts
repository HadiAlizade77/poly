/**
 * BTC 5-Min Bot controller
 *
 * POST /api/btc-bot/start  → sets BTC_5MIN_BOT_ACTIVE=true in system_config
 * POST /api/btc-bot/stop   → sets BTC_5MIN_BOT_ACTIVE=false
 * GET  /api/btc-bot/status → returns { active, latest_signals, stats, last_decision }
 */
import type { Request, Response, NextFunction } from 'express';
import { sendItem } from '../utils/response.js';
import logger from '../config/logger.js';
import { redis } from '../config/redis.js';
import prisma from '../config/database.js';
import * as systemConfigService from '../services/system-config.service.js';
import * as aiDecisionService from '../services/ai-decision.service.js';
import type { BtcSignals } from '../services/btc-5min/signals.js';

const BOT_ACTIVE_KEY    = 'BTC_5MIN_BOT_ACTIVE';
const SIGNALS_REDIS_KEY = 'btc-5min:latest-signals';
const STATUS_REDIS_KEY  = 'btc-5min:status';

// ─── Start bot ────────────────────────────────────────────────────────────────

export async function startBot(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await systemConfigService.set(
      BOT_ACTIVE_KEY,
      true,
      'BTC 5-min bot active flag',
      'user',
    );

    logger.info('BtcBotController: bot activated');

    sendItem(res, { active: true, message: 'BTC 5-min bot activated' });
  } catch (err) {
    next(err);
  }
}

// ─── Stop bot ─────────────────────────────────────────────────────────────────

export async function stopBot(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await systemConfigService.set(
      BOT_ACTIVE_KEY,
      false,
      'BTC 5-min bot active flag',
      'user',
    );

    logger.info('BtcBotController: bot deactivated');

    sendItem(res, { active: false, message: 'BTC 5-min bot deactivated' });
  } catch (err) {
    next(err);
  }
}

// ─── Status ───────────────────────────────────────────────────────────────────

export async function getBotStatus(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // Active flag
    const active = Boolean(await systemConfigService.getValue<boolean>(BOT_ACTIVE_KEY));

    // Latest signals from Redis
    let latest_signals: BtcSignals | null = null;
    const rawSignals = await redis.get(SIGNALS_REDIS_KEY);
    if (rawSignals) {
      try {
        latest_signals = JSON.parse(rawSignals) as BtcSignals;
      } catch {
        // Stale or corrupt — ignore
      }
    }

    // Stats: count orders/positions for BTC 5-min markets
    // Identify matching markets first
    const btcMarkets = await prisma.market.findMany({
      where: {
        title: { contains: 'bitcoin', mode: 'insensitive' },
      },
      select: { id: true, title: true },
    });

    const btcMinMarkets = btcMarkets.filter((m) => {
      const l = m.title.toLowerCase();
      return l.includes('5 min') || l.includes('5-min') || l.includes('5 minute');
    });

    const marketIds = btcMinMarkets.map((m) => m.id);

    let stats = {
      total_trades: 0,
      wins:         0,
      losses:       0,
      pnl:          0,
    };

    if (marketIds.length > 0) {
      const [closedPositions, openOrders] = await Promise.all([
        prisma.positionHistory.findMany({
          where: { market_id: { in: marketIds } },
          select: { realized_pnl: true },
        }),
        prisma.order.count({
          where: {
            market_id: { in: marketIds },
            status:    'filled',
          },
        }),
      ]);

      const totalPnl = closedPositions.reduce(
        (s, p) => s + Number(p.realized_pnl),
        0,
      );
      const wins   = closedPositions.filter((p) => Number(p.realized_pnl) > 0).length;
      const losses = closedPositions.filter((p) => Number(p.realized_pnl) <= 0).length;

      stats = {
        total_trades: openOrders,
        wins,
        losses,
        pnl: totalPnl,
      };
    }

    // Last AI decision for a BTC 5-min market
    let last_decision = null;
    if (marketIds.length > 0) {
      const recentDecisions = await aiDecisionService.findMany(
        { marketId: marketIds[0] },
        { page: 1, pageSize: 1 },
      );
      last_decision = recentDecisions.items[0] ?? null;

      // If multiple markets, check all and take the most recent
      if (marketIds.length > 1) {
        for (const mid of marketIds.slice(1)) {
          const d = await aiDecisionService.findMany(
            { marketId: mid },
            { page: 1, pageSize: 1 },
          );
          const candidate = d.items[0];
          if (candidate && (!last_decision || candidate.timestamp > last_decision.timestamp)) {
            last_decision = candidate;
          }
        }
      }
    }

    // Enriched bot-cycle status (signals + active market + window tracking)
    let bot_status: Record<string, unknown> | null = null;
    const rawStatus = await redis.get(STATUS_REDIS_KEY);
    if (rawStatus) {
      try {
        bot_status = JSON.parse(rawStatus) as Record<string, unknown>;
      } catch {
        // Stale or corrupt — ignore
      }
    }

    sendItem(res, {
      active,
      latest_signals,
      bot_status,
      stats,
      last_decision,
    });
  } catch (err) {
    next(err);
  }
}
