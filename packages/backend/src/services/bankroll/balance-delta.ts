/**
 * Bankroll balance-delta P&L tracker.
 *
 * Computes actual P&L from balance changes and maintains daily snapshots
 * in the bankroll_history table.
 */
import type { Bankroll } from '@prisma/client';
import logger from '../../config/logger.js';
import * as bankrollService from '../bankroll.service.js';
import prisma from '../../config/database.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BalanceDelta {
  previousBalance: number;
  currentBalance:  number;
  delta:           number;       // absolute change
  deltaPct:        number;       // % change (0.05 = +5%)
  isGain:          boolean;
}

export interface DailyPnlSummary {
  date:              string;     // YYYY-MM-DD
  openingBalance:    number;
  currentBalance:    number;
  tradingPnl:        number;     // balance_delta_today (set by order executor)
  balanceDeltaTotal: number;     // all-time P&L
  tradesCount:       number;
  winRate:           number | null;
}

// ─── Balance delta ────────────────────────────────────────────────────────────

export function computeBalanceDelta(previous: number, current: number): BalanceDelta {
  const delta    = current - previous;
  const deltaPct = previous !== 0 ? delta / previous : 0;
  return {
    previousBalance: previous,
    currentBalance:  current,
    delta,
    deltaPct,
    isGain: delta >= 0,
  };
}

// ─── Daily snapshot ───────────────────────────────────────────────────────────

/**
 * Upsert today's bankroll_history row from the live bankroll record.
 * Called by the daily-review scheduler job.
 */
export async function snapshotDailyBalance(bankroll: Bankroll): Promise<void> {
  const b = bankroll as unknown as Record<string, string>;

  const totalBalance  = parseFloat(b.total_balance ?? '0');
  const prevBalance   = parseFloat(b.previous_balance ?? totalBalance.toString());
  const tradingPnl    = parseFloat(b.balance_delta_today ?? '0');
  const totalDelta    = parseFloat(b.balance_delta_total ?? '0');
  const deployedBal   = parseFloat(b.deployed_balance ?? '0');

  // Today's opening balance = current - today's P&L delta
  const openingBalance = totalBalance - tradingPnl;

  // Get trade stats for today
  const today    = new Date();
  const dayStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

  const [tradesCount, winningTrades] = await Promise.all([
    prisma.trade.count({ where: { executed_at: { gte: dayStart } } }),
    prisma.aiDecision.count({
      where: {
        timestamp:   { gte: dayStart },
        was_executed: true,
        confidence:   { gte: '0.6' },
      },
    }),
  ]).catch(() => [0, 0]);

  const winRate = tradesCount > 0 ? winningTrades / tradesCount : null;

  await bankrollService.createDailySnapshot(today, {
    opening_balance: String(openingBalance.toFixed(6)),
    closing_balance: String(totalBalance.toFixed(6)),
    trading_pnl:     String(tradingPnl.toFixed(6)),
    fees_total:      '0.000000',
    trades_count:    tradesCount,
    win_rate:        winRate !== null ? String(winRate.toFixed(4)) : undefined,
  } as Parameters<typeof bankrollService.createDailySnapshot>[1]);

  logger.info('BankrollDelta: daily snapshot saved', {
    date:           dayStart.toISOString().slice(0, 10),
    openingBalance,
    closingBalance: totalBalance,
    tradingPnl,
    tradesCount,
  });
}

/**
 * Today's P&L summary — reads from live bankroll + today's history row.
 */
export async function getTodayPnl(): Promise<DailyPnlSummary | null> {
  const bankroll = await bankrollService.get();
  if (!bankroll) return null;

  const b = bankroll as unknown as Record<string, string>;

  const today     = new Date();
  const todayStr  = today.toISOString().slice(0, 10);
  const dayStart  = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

  const historyRow = await prisma.bankrollHistory.findUnique({
    where: { date: dayStart },
  });

  const totalBalance  = parseFloat(b.total_balance ?? '0');
  const tradingPnl    = parseFloat(b.balance_delta_today ?? '0');
  const totalDelta    = parseFloat(b.balance_delta_total ?? '0');
  const openingBalance = historyRow
    ? parseFloat((historyRow as unknown as Record<string, string>).opening_balance ?? '0')
    : totalBalance - tradingPnl;

  const tradesCount = historyRow
    ? (historyRow as unknown as Record<string, number>).trades_count ?? 0
    : 0;

  const winRate = historyRow
    ? ((historyRow as unknown as Record<string, string | null>).win_rate != null
        ? parseFloat((historyRow as unknown as Record<string, string>).win_rate)
        : null)
    : null;

  return {
    date:              todayStr,
    openingBalance,
    currentBalance:    totalBalance,
    tradingPnl,
    balanceDeltaTotal: totalDelta,
    tradesCount,
    winRate,
  };
}

/**
 * Update bankroll's balance_delta_today after a trade resolves.
 * Called by the order executor when a position is closed.
 */
export async function recordTradeOutcome(pnlDelta: number): Promise<void> {
  const bankroll = await bankrollService.get();
  if (!bankroll) return;

  const b = bankroll as unknown as Record<string, string>;
  const currentDeltaToday = parseFloat(b.balance_delta_today ?? '0');
  const currentDeltaTotal = parseFloat(b.balance_delta_total ?? '0');
  const currentTotal      = parseFloat(b.total_balance ?? '0');

  await bankrollService.update({
    total_balance:       String((currentTotal + pnlDelta).toFixed(6)),
    balance_delta_today: String((currentDeltaToday + pnlDelta).toFixed(6)),
    balance_delta_total: String((currentDeltaTotal + pnlDelta).toFixed(6)),
    previous_balance:    b.previous_balance ?? b.total_balance,
    reserved_balance:    b.reserved_balance ?? '0',
    active_balance:      b.active_balance ?? b.total_balance,
    deployed_balance:    b.deployed_balance ?? '0',
    unrealized_pnl:      b.unrealized_pnl ?? '0',
    initial_deposit:     b.initial_deposit ?? b.total_balance,
  } as Parameters<typeof bankrollService.update>[0]);

  logger.info('BankrollDelta: trade outcome recorded', { pnlDelta });
}
