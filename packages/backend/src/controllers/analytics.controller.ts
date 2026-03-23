import type { Request, Response, NextFunction } from 'express';
import { sendItem } from '../utils/response.js';
import prisma from '../config/database.js';

export async function getSummaryStats(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // Fetch all closed positions with their market category
    const positions = await prisma.positionHistory.findMany({
      include: { market: { select: { category: true } } },
    });

    const total_trades = positions.length;
    const winning_trades = positions.filter((p) => Number(p.realized_pnl) > 0).length;
    const losing_trades = positions.filter((p) => Number(p.realized_pnl) <= 0).length;
    const win_rate = total_trades > 0 ? winning_trades / total_trades : null;

    const total_pnl = positions.reduce((sum, p) => sum + Number(p.realized_pnl), 0);
    const total_fees = positions.reduce((sum, p) => sum + Number(p.total_fees), 0);
    const avg_pnl_per_trade = total_trades > 0 ? total_pnl / total_trades : null;

    const pnls = positions.map((p) => Number(p.realized_pnl));
    const best_trade_pnl = pnls.length > 0 ? Math.max(...pnls) : null;
    const worst_trade_pnl = pnls.length > 0 ? Math.min(...pnls) : null;

    // Average hold time in hours
    const holdTimes = positions.map((p) => {
      const ms = new Date(p.closed_at).getTime() - new Date(p.opened_at).getTime();
      return ms / (1000 * 60 * 60);
    });
    const avg_hold_time_hours =
      holdTimes.length > 0 ? holdTimes.reduce((a, b) => a + b, 0) / holdTimes.length : null;

    // Group by category
    const categoryMap: Record<string, { trades: number; wins: number; pnl: number }> = {};
    for (const p of positions) {
      const cat = (p as unknown as { market: { category: string } }).market?.category ?? 'unknown';
      if (!categoryMap[cat]) categoryMap[cat] = { trades: 0, wins: 0, pnl: 0 };
      categoryMap[cat].trades++;
      if (Number(p.realized_pnl) > 0) categoryMap[cat].wins++;
      categoryMap[cat].pnl += Number(p.realized_pnl);
    }

    const by_category: Record<string, { trades: number; win_rate: number | null; pnl: number }> =
      {};
    for (const [cat, stats] of Object.entries(categoryMap)) {
      by_category[cat] = {
        trades: stats.trades,
        win_rate: stats.trades > 0 ? stats.wins / stats.trades : null,
        pnl: stats.pnl,
      };
    }

    sendItem(res, {
      total_trades,
      winning_trades,
      losing_trades,
      win_rate,
      total_pnl,
      total_fees,
      avg_pnl_per_trade,
      best_trade_pnl,
      worst_trade_pnl,
      avg_hold_time_hours,
      by_category,
    });
  } catch (err) {
    next(err);
  }
}
