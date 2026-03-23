import type { Request, Response, NextFunction } from 'express';
import { sendItem } from '../utils/response.js';
import * as positionService from '../services/position.service.js';
import * as positionHistoryService from '../services/position-history.service.js';
import * as tradeService from '../services/trade.service.js';
import * as orderService from '../services/order.service.js';
import * as alertService from '../services/alert.service.js';
import * as bankrollService from '../services/bankroll.service.js';
import * as aiDecisionService from '../services/ai-decision.service.js';

export async function getSummaryStats(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [
      bankroll,
      positions,
      openOrders,
      unreadAlerts,
      tradeStats24h,
      tradeStats7d,
      tradeStats30d,
      pnlStats30d,
      decisionStats30d,
    ] = await Promise.all([
      bankrollService.get(),
      positionService.findAll(),
      orderService.findOpen(),
      alertService.countUnread(),
      tradeService.findMany({ since: since24h }, { pageSize: 1 }),
      tradeService.findMany({ since: since7d }, { pageSize: 1 }),
      tradeService.findMany({ since: since30d }, { pageSize: 1 }),
      positionHistoryService.getStats(since30d),
      aiDecisionService.getStats(since30d),
    ]);

    sendItem(res, {
      bankroll: bankroll
        ? {
            totalBalance: (bankroll as Record<string, unknown>).total_balance,
            unrealizedPnl: (bankroll as Record<string, unknown>).unrealized_pnl,
            balanceDeltaToday: (bankroll as Record<string, unknown>).balance_delta_today,
            balanceDeltaTotal: (bankroll as Record<string, unknown>).balance_delta_total,
          }
        : null,
      positions: {
        open: positions.length,
      },
      orders: {
        open: openOrders.length,
      },
      alerts: {
        unread: unreadAlerts,
      },
      trades: {
        count24h: tradeStats24h.total,
        count7d: tradeStats7d.total,
        count30d: tradeStats30d.total,
      },
      performance30d: {
        closedPositions: pnlStats30d.count,
        winCount: pnlStats30d.winCount,
        lossCount: pnlStats30d.lossCount,
        winRate:
          pnlStats30d.count > 0
            ? Math.round((pnlStats30d.winCount / pnlStats30d.count) * 10000) / 100
            : null,
        decisions: decisionStats30d.total,
        decisionsExecuted: decisionStats30d.executedCount,
        avgConfidence: decisionStats30d.avgConfidence,
      },
    });
  } catch (err) {
    next(err);
  }
}
