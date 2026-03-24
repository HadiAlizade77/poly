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

const BOT_ACTIVE_KEY      = 'BTC_5MIN_BOT_ACTIVE';
const SIGNALS_REDIS_KEY   = 'btc-5min:latest-signals';
const STATUS_REDIS_KEY    = 'btc-5min:status';
const ACTIVITY_LOG_KEY    = 'btc-5min:activity-log';
const ACTIVITY_LOG_MAX    = 200; // Redis list cap

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

// ─── Trade log ────────────────────────────────────────────────────────────────

/**
 * GET /api/btc-bot/trades
 *
 * Returns the last 50 trades from BTC-related markets (title contains 'btc' or
 * 'bitcoin'), joined with their source AI decision for reasoning data.
 * Each row is shaped into a unified entry with: timestamp, action, side, price,
 * size, pnl (if a closed position exists for the same market/token), and
 * ai_reasoning.
 */
export async function getTrades(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // 1. Find BTC-related markets.
    const btcMarkets = await prisma.market.findMany({
      where: {
        OR: [
          { title: { contains: 'btc',     mode: 'insensitive' } },
          { title: { contains: 'bitcoin', mode: 'insensitive' } },
        ],
      },
      select: { id: true },
    });

    const marketIds = btcMarkets.map((m) => m.id);

    if (marketIds.length === 0) {
      sendItem(res, { trades: [], ai_decisions: [] });
      return;
    }

    // 2. Query trades with order + decision data.
    const trades = await prisma.trade.findMany({
      where:   { market_id: { in: marketIds } },
      orderBy: { executed_at: 'desc' },
      take:    50,
      include: {
        order:    { select: { side: true, outcome_token: true, status: true } },
        decision: {
          select: {
            action:    true,
            direction: true,
            reasoning: true,
            confidence: true,
          },
        },
      },
    });

    // 3. Fetch closed-position PnL for the same markets (keyed by market_id + outcome_token).
    const closedPositions = await prisma.positionHistory.findMany({
      where:   { market_id: { in: marketIds } },
      select:  { market_id: true, outcome_token: true, realized_pnl: true },
    });

    const pnlMap = new Map<string, number>();
    for (const p of closedPositions) {
      const key = `${p.market_id}:${p.outcome_token}`;
      pnlMap.set(key, Number(p.realized_pnl));
    }

    // 4. Shape output.
    const tradeEntries = trades.map((t) => {
      const pnlKey = `${t.market_id}:${t.outcome_token}`;
      return {
        timestamp:    t.executed_at,
        action:       t.decision?.action ?? 'trade',
        side:         t.outcome_token,               // YES / NO token name
        order_side:   t.order.side,                  // buy / sell
        price:        Number(t.entry_price),
        size:         Number(t.size),
        pnl:          pnlMap.get(pnlKey) ?? null,
        ai_reasoning: t.decision?.reasoning ?? null,
        confidence:   t.decision ? Number(t.decision.confidence) : null,
      };
    });

    // 5. Query recent AI decisions for BTC markets (hold + trade).
    const aiDecisions = await prisma.aiDecision.findMany({
      where:   { market_id: { in: marketIds } },
      orderBy: { timestamp: 'desc' },
      take:    50,
      select:  {
        id:           true,
        timestamp:    true,
        action:       true,
        direction:    true,
        outcome_token: true,
        confidence:   true,
        reasoning:    true,
        was_executed: true,
        market_price: true,
        estimated_edge: true,
      },
    });

    const decisionEntries = aiDecisions.map((d) => ({
      timestamp:      d.timestamp,
      action:         d.action,
      side:           d.outcome_token ?? null,
      direction:      d.direction ?? null,
      price:          d.market_price ? Number(d.market_price) : null,
      size:           null,
      pnl:            null,
      ai_reasoning:   d.reasoning,
      confidence:     Number(d.confidence),
      was_executed:   d.was_executed,
      estimated_edge: d.estimated_edge ? Number(d.estimated_edge) : null,
    }));

    sendItem(res, { trades: tradeEntries, ai_decisions: decisionEntries });
  } catch (err) {
    next(err);
  }
}

// ─── Activity log (Redis) ─────────────────────────────────────────────────────

/**
 * GET /api/btc-bot/logs
 *
 * Returns the bot's recent activity log from Redis list `btc-5min:activity-log`.
 * The list is populated by the bot process itself via LPUSH + LTRIM.
 * Entries are stored as JSON strings; this endpoint parses and returns them.
 */
export async function getLogs(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const raw = await redis.lrange(ACTIVITY_LOG_KEY, 0, ACTIVITY_LOG_MAX - 1);

    const entries = raw.map((item) => {
      try {
        return JSON.parse(item) as unknown;
      } catch {
        // If an entry is not valid JSON just pass it through as a string.
        return { message: item };
      }
    });

    sendItem(res, { log: entries, count: entries.length });
  } catch (err) {
    next(err);
  }
}
