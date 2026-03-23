import type { Request, Response, NextFunction } from 'express';
import * as systemConfigService from '../services/system-config.service.js';
import * as bankrollService from '../services/bankroll.service.js';
import prisma from '../config/database.js';
import { sendItem } from '../utils/response.js';
import logger from '../config/logger.js';

// ─── Start Sandbox ────────────────────────────────────────────────────────────

export async function startSandbox(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const startingBalance = Number(req.body.starting_balance ?? 1000);
    if (isNaN(startingBalance) || startingBalance <= 0) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_BALANCE', message: 'starting_balance must be a positive number' },
      });
      return;
    }

    const startedAt = new Date().toISOString();

    await Promise.all([
      systemConfigService.set('SANDBOX_ACTIVE', true, 'Whether the system is in sandbox/paper-trading mode'),
      systemConfigService.set('SANDBOX_STARTED_AT', startedAt, 'When the current sandbox session started'),
      systemConfigService.set('SANDBOX_STARTING_BALANCE', startingBalance, 'Starting balance for the current sandbox session'),
      systemConfigService.set('EXECUTION_MODE', 'mock', 'Order execution mode: mock or live'),
    ]);

    await bankrollService.update({
      total_balance: startingBalance.toFixed(6),
      active_balance: startingBalance.toFixed(6),
      deployed_balance: '0',
      reserved_balance: '0',
      previous_balance: startingBalance.toFixed(6),
      unrealized_pnl: '0',
      balance_delta_today: '0',
      balance_delta_total: '0',
      initial_deposit: startingBalance.toFixed(6),
    });

    logger.info('Sandbox session started', { startingBalance, startedAt });

    sendItem(res, {
      sandbox: true,
      starting_balance: startingBalance,
      started_at: startedAt,
    });
  } catch (err) {
    next(err);
  }
}

// ─── Get Sandbox Status ───────────────────────────────────────────────────────

export async function getSandboxStatus(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const [active, startedAt, startingBalance, bankroll] = await Promise.all([
      systemConfigService.getValue<boolean>('SANDBOX_ACTIVE'),
      systemConfigService.getValue<string>('SANDBOX_STARTED_AT'),
      systemConfigService.getValue<number>('SANDBOX_STARTING_BALANCE'),
      bankrollService.get(),
    ]);

    const currentBalance = Number(bankroll?.total_balance ?? 0);
    const starting = Number(startingBalance ?? 0);
    const totalPnl = currentBalance - starting;
    const pnlPercent = starting > 0 ? (totalPnl / starting) * 100 : 0;

    sendItem(res, {
      active: Boolean(active),
      started_at: startedAt ?? null,
      starting_balance: starting,
      current_balance: currentBalance,
      total_pnl: totalPnl,
      pnl_percent: pnlPercent,
      deployed: Number(bankroll?.deployed_balance ?? 0),
      available: Number(bankroll?.active_balance ?? 0),
    });
  } catch (err) {
    next(err);
  }
}

// ─── Reset Sandbox ────────────────────────────────────────────────────────────

export async function resetSandbox(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const fallbackBalance = await systemConfigService.getValue<number>('SANDBOX_STARTING_BALANCE');
    const startingBalance = Number(req.body.starting_balance ?? fallbackBalance ?? 1000);

    if (isNaN(startingBalance) || startingBalance <= 0) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_BALANCE', message: 'starting_balance must be a positive number' },
      });
      return;
    }

    // Delete all trading data in a transaction
    await prisma.$transaction([
      prisma.position.deleteMany({}),
      prisma.positionHistory.deleteMany({}),
      prisma.trade.deleteMany({}),
      prisma.order.deleteMany({}),
      prisma.aiDecision.deleteMany({}),
      prisma.contextScore.deleteMany({}),
      prisma.riskEvent.deleteMany({}),
      prisma.bankrollHistory.deleteMany({}),
    ]);

    await bankrollService.update({
      total_balance: startingBalance.toFixed(6),
      active_balance: startingBalance.toFixed(6),
      deployed_balance: '0',
      reserved_balance: '0',
      previous_balance: startingBalance.toFixed(6),
      unrealized_pnl: '0',
      balance_delta_today: '0',
      balance_delta_total: '0',
      initial_deposit: startingBalance.toFixed(6),
    });

    const startedAt = new Date().toISOString();
    await Promise.all([
      systemConfigService.set('SANDBOX_STARTING_BALANCE', startingBalance),
      systemConfigService.set('SANDBOX_STARTED_AT', startedAt),
    ]);

    logger.info('Sandbox reset', { startingBalance });

    sendItem(res, { reset: true, starting_balance: startingBalance });
  } catch (err) {
    next(err);
  }
}

// ─── Stop Sandbox ─────────────────────────────────────────────────────────────

export async function stopSandbox(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await systemConfigService.set('SANDBOX_ACTIVE', false);
    logger.info('Sandbox session stopped');
    sendItem(res, { active: false });
  } catch (err) {
    next(err);
  }
}

// ─── Sandbox Analytics ────────────────────────────────────────────────────────

export async function getSandboxAnalytics(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const [startingBalance, startedAt, bankroll] = await Promise.all([
      systemConfigService.getValue<number>('SANDBOX_STARTING_BALANCE'),
      systemConfigService.getValue<string>('SANDBOX_STARTED_AT'),
      bankrollService.get(),
    ]);

    const [closedPositions, openPositions, decisionsCount, orders, history] = await Promise.all([
      prisma.positionHistory.findMany({
        include: { market: { select: { category: true } } },
        orderBy: { closed_at: 'desc' },
      }),
      prisma.position.findMany(),
      prisma.aiDecision.count(),
      prisma.order.findMany(),
      prisma.bankrollHistory.findMany({ orderBy: { date: 'asc' } }),
    ]);

    const starting = Number(startingBalance ?? 0);
    const currentBalance = Number(bankroll?.total_balance ?? 0);
    const totalPnl = currentBalance - starting;
    const pnlPercent = starting > 0 ? (totalPnl / starting) * 100 : 0;

    // Orders breakdown
    const filledOrders = orders.filter((o) => o.status === 'filled').length;
    const expiredOrders = orders.filter((o) => o.status === 'expired').length;
    const failedOrders = orders.filter((o) => o.status === 'failed').length;

    // Win/loss analysis
    const wins = closedPositions.filter((p) => Number(p.realized_pnl) > 0);
    const losses = closedPositions.filter((p) => Number(p.realized_pnl) <= 0);
    const winRate =
      closedPositions.length > 0 ? (wins.length / closedPositions.length) * 100 : 0;
    const avgWin =
      wins.length > 0
        ? wins.reduce((s, p) => s + Number(p.realized_pnl), 0) / wins.length
        : 0;
    const avgLoss =
      losses.length > 0
        ? losses.reduce((s, p) => s + Number(p.realized_pnl), 0) / losses.length
        : 0;
    const profitFactor = Math.abs(avgLoss) > 0 ? avgWin / Math.abs(avgLoss) : 0;

    const totalFees = closedPositions.reduce((s, p) => s + Number(p.total_fees), 0);
    const bestTrade =
      closedPositions.length > 0
        ? Math.max(...closedPositions.map((p) => Number(p.realized_pnl)))
        : 0;
    const worstTrade =
      closedPositions.length > 0
        ? Math.min(...closedPositions.map((p) => Number(p.realized_pnl)))
        : 0;

    // Average hold time in hours
    const holdTimes = closedPositions.map((p) => {
      const opened = new Date(p.opened_at).getTime();
      const closed = new Date(p.closed_at).getTime();
      return (closed - opened) / (1000 * 60 * 60);
    });
    const avgHoldTime =
      holdTimes.length > 0 ? holdTimes.reduce((a, b) => a + b, 0) / holdTimes.length : 0;

    // Category breakdown (market category is already included via the join)
    const byCategory: Record<string, { trades: number; wins: number; pnl: number; fees: number }> =
      {};
    for (const p of closedPositions) {
      const cat =
        (p as unknown as { market: { category: string } }).market?.category ?? 'unknown';
      if (!byCategory[cat]) byCategory[cat] = { trades: 0, wins: 0, pnl: 0, fees: 0 };
      byCategory[cat].trades++;
      if (Number(p.realized_pnl) > 0) byCategory[cat].wins++;
      byCategory[cat].pnl += Number(p.realized_pnl);
      byCategory[cat].fees += Number(p.total_fees);
    }

    // Close reason breakdown
    const byCloseReason: Record<string, number> = {};
    for (const p of closedPositions) {
      byCloseReason[p.close_reason] = (byCloseReason[p.close_reason] ?? 0) + 1;
    }

    // Drawdown calculation from balance history
    let maxBalance = starting;
    let maxDrawdown = 0;
    let maxDrawdownPct = 0;
    for (const h of history) {
      const bal = Number(h.closing_balance);
      if (bal > maxBalance) maxBalance = bal;
      const dd = maxBalance - bal;
      const ddPct = maxBalance > 0 ? (dd / maxBalance) * 100 : 0;
      if (ddPct > maxDrawdownPct) {
        maxDrawdown = dd;
        maxDrawdownPct = ddPct;
      }
    }

    // AI token spend
    const tokenSpend = await prisma.aiDecision.aggregate({ _sum: { tokens_used: true } });

    // Session duration
    const startTime = startedAt ? new Date(startedAt).getTime() : Date.now();
    const durationHours = (Date.now() - startTime) / (1000 * 60 * 60);

    sendItem(res, {
      // Overview
      sandbox_duration_hours: durationHours,
      starting_balance: starting,
      current_balance: currentBalance,
      total_pnl: totalPnl,
      pnl_percent: pnlPercent,
      max_drawdown: maxDrawdown,
      max_drawdown_percent: maxDrawdownPct,

      // Decisions
      total_decisions: decisionsCount,
      trade_decisions: orders.length,
      hold_decisions: decisionsCount - orders.length,

      // Orders
      total_orders: orders.length,
      filled_orders: filledOrders,
      expired_orders: expiredOrders,
      failed_orders: failedOrders,
      fill_rate: orders.length > 0 ? (filledOrders / orders.length) * 100 : 0,

      // Positions
      open_positions: openPositions.length,
      closed_positions: closedPositions.length,
      unrealized_pnl: Number(bankroll?.unrealized_pnl ?? 0),

      // Win/loss
      wins: wins.length,
      losses: losses.length,
      win_rate: winRate,
      avg_win: avgWin,
      avg_loss: avgLoss,
      profit_factor: profitFactor,
      best_trade: bestTrade,
      worst_trade: worstTrade,

      // Fees & costs
      total_fees: totalFees,
      total_ai_tokens: tokenSpend._sum.tokens_used ?? 0,

      // Time
      avg_hold_time_hours: avgHoldTime,

      // Breakdowns
      by_category: byCategory,
      by_close_reason: byCloseReason,

      // Balance history
      balance_history: history.map((h) => ({
        date: h.date,
        balance: Number(h.closing_balance),
        pnl: Number(h.trading_pnl),
        trades: h.trades_count,
        win_rate: h.win_rate !== null ? Number(h.win_rate) : null,
      })),
    });
  } catch (err) {
    next(err);
  }
}
