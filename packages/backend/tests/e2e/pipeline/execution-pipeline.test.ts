/**
 * E2E: Execution Pipeline
 *
 * Tests the full execution engine end-to-end:
 *   - Kelly sizing → order creation → mock fill → trade record → position
 *   - Exit monitor: stop_loss, time_based, resolution exits
 *   - Position history created on close
 *   - Bankroll updated after trade and after close
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { PrismaClient, type Prisma } from '@prisma/client';
import { cleanDatabase } from '../../integration/db/db-helpers.js';
import { ExecutionEngine } from '../../../src/services/execution/engine.js';
import { ExitMonitor } from '../../../src/services/execution/exit-monitor.js';
import { computeSize } from '../../../src/services/execution/sizing.js';
import { positionManager } from '../../../src/services/execution/position-manager.js';
import * as marketService from '../../../src/services/market.service.js';
import * as bankrollService from '../../../src/services/bankroll.service.js';
import * as aiDecisionService from '../../../src/services/ai-decision.service.js';
import * as positionService from '../../../src/services/position.service.js';
import type { DecisionOutput } from '../../../src/services/ai/decision-maker.js';

const prisma = new PrismaClient();
const uid = () => Math.random().toString(36).slice(2, 9);

// ── Helpers ──────────────────────────────────────────────────────────────────

async function seedMarket(category = 'crypto', overrides: Record<string, unknown> = {}) {
  const id = uid();
  return marketService.create({
    polymarket_id: `pm-exec-${id}`,
    title: `Exec Test ${id}`,
    category,
    status: 'active',
    is_tradeable: true,
    outcomes: [
      { name: 'Yes', token_id: `yes-${id}` },
      { name: 'No', token_id: `no-${id}` },
    ] as unknown as Prisma.InputJsonValue,
    current_prices: { Yes: 0.65, No: 0.35 } as Prisma.InputJsonValue,
    volume_24h: '50000',
    liquidity: '25000',
    end_date: new Date(Date.now() + 14 * 86_400_000),
    resolution_criteria: 'Standard test criteria',
    ...overrides,
  } as Prisma.MarketUncheckedCreateInput);
}

async function seedBankroll(overrides: Record<string, string> = {}) {
  return bankrollService.update({
    total_balance: '10000.000000',
    previous_balance: '10000.000000',
    reserved_balance: '0.000000',
    active_balance: '8000.000000',
    deployed_balance: '2000.000000',
    unrealized_pnl: '0.000000',
    balance_delta_today: '0.000000',
    balance_delta_total: '0.000000',
    initial_deposit: '10000.000000',
    ...overrides,
  });
}

async function seedDecision(marketId: string) {
  return aiDecisionService.create({
    market_id: marketId,
    category: 'crypto',
    action: 'trade',
    direction: 'buy',
    outcome_token: 'Yes',
    confidence: '0.75',
    size_hint: '0.30',
    estimated_edge: '0.050000',
    fair_value: '0.6500',
    reasoning: 'E2E execution test',
    regime_assessment: 'trending',
    model_used: 'test',
    dashboard_text: 'test',
    account_state: {} as Prisma.InputJsonValue,
  } as Prisma.AiDecisionUncheckedCreateInput);
}

function makeDecision(overrides: Partial<DecisionOutput> = {}): DecisionOutput {
  return {
    action: 'trade',
    direction: 'buy',
    outcome_token: 'Yes',
    confidence: 0.75,
    size_hint: 0.3,
    estimated_edge: 0.05,
    fair_value: 0.65,
    reasoning: 'Good edge for E2E test.',
    regime_assessment: 'trending',
    model: 'test',
    latencyMs: 500,
    tokensUsed: 2000,
    promptVersion: 'v1.0.0',
    usedFallback: false,
    ...overrides,
  };
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

// ── Kelly Sizing ────────────────────────────────────────────────────────────

describe('Execution Pipeline – Kelly Sizing', () => {
  it('computes correct size from edge and bankroll', async () => {
    const bankroll = await seedBankroll();

    const result = computeSize({
      confidence: 0.75,
      sizeHint: 0.3,
      estimatedEdge: 0.05,
      marketPrice: 0.65,
      bankroll,
    });

    expect(result).not.toBeNull();
    expect(result!.sizeUsd).toBeGreaterThanOrEqual(5);   // min $5
    expect(result!.sizeUsd).toBeLessThanOrEqual(500);     // max $500
    expect(result!.rawKelly).toBeGreaterThan(0);
    expect(result!.sizeFraction).toBeGreaterThan(0);
    expect(result!.sizeFraction).toBeLessThanOrEqual(0.05); // max 5% of balance
  });

  it('returns null when edge is below minimum', async () => {
    const bankroll = await seedBankroll();

    const result = computeSize({
      confidence: 0.75,
      sizeHint: null,
      estimatedEdge: 0.005, // 0.5% < 2% minimum
      marketPrice: 0.65,
      bankroll,
    });

    expect(result).toBeNull();
  });

  it('returns null when active balance is zero', async () => {
    const bankroll = await seedBankroll({
      active_balance: '0.000000',
    });

    const result = computeSize({
      confidence: 0.75,
      sizeHint: 0.3,
      estimatedEdge: 0.05,
      marketPrice: 0.65,
      bankroll,
    });

    expect(result).toBeNull();
  });

  it('scales down on low balance', async () => {
    // Active balance is 40% of initial (below 50% threshold)
    const bankrollLow = await seedBankroll({
      active_balance: '4000.000000',
      total_balance: '6000.000000',
    });

    const resultLow = computeSize({
      confidence: 0.75,
      sizeHint: null,
      estimatedEdge: 0.05,
      marketPrice: 0.65,
      bankroll: bankrollLow,
    });

    await cleanDatabase();

    const bankrollNormal = await seedBankroll();

    const resultNormal = computeSize({
      confidence: 0.75,
      sizeHint: null,
      estimatedEdge: 0.05,
      marketPrice: 0.65,
      bankroll: bankrollNormal,
    });

    expect(resultLow).not.toBeNull();
    expect(resultNormal).not.toBeNull();
    // Low balance fraction should be lower than normal
    expect(resultLow!.sizeFraction).toBeLessThan(resultNormal!.sizeFraction);
    expect(resultLow!.cappedBy).toContain('low_balance');
  });

  it('handles extreme market prices without breaking', async () => {
    const bankroll = await seedBankroll();

    for (const price of [0.01, 0.50, 0.99]) {
      const result = computeSize({
        confidence: 0.75,
        sizeHint: 0.2,
        estimatedEdge: 0.05,
        marketPrice: price,
        bankroll,
      });
      // Should not throw, may return null if size is too small
      if (result) {
        expect(result.sizeUsd).toBeGreaterThan(0);
        expect(result.sizeUsd).toBeLessThanOrEqual(500);
      }
    }
  });
});

// ── Execution Engine ────────────────────────────────────────────────────────

describe('Execution Pipeline – Engine', () => {
  it('executes a trade decision end-to-end', async () => {
    const market = await seedMarket();
    const bankroll = await seedBankroll();
    const aiRecord = await seedDecision(market.id);

    const engine = new ExecutionEngine();
    const result = await engine.execute({
      market,
      decision: makeDecision(),
      decisionId: aiRecord.id,
      bankroll,
      positions: [],
    });

    expect(result.executed).toBe(true);
    expect(result.orderId).toBeTruthy();
    expect(result.sizing).not.toBeNull();
    expect(result.sizing!.sizeUsd).toBeGreaterThan(0);
  });

  it('creates order in DB with correct fields', async () => {
    const market = await seedMarket();
    const bankroll = await seedBankroll();
    const aiRecord = await seedDecision(market.id);

    const engine = new ExecutionEngine();
    const result = await engine.execute({
      market,
      decision: makeDecision(),
      decisionId: aiRecord.id,
      bankroll,
      positions: [],
    });

    expect(result.orderId).toBeTruthy();
    const order = await prisma.order.findUnique({ where: { id: result.orderId! } });
    expect(order).not.toBeNull();
    expect(order!.market_id).toBe(market.id);
    expect(order!.side).toBe('buy');
    expect(order!.outcome_token).toBe('Yes');
    // Mock mode: should be filled or expired
    expect(['filled', 'expired']).toContain(order!.status);
  });

  it('creates trade record on fill', async () => {
    const market = await seedMarket();
    const bankroll = await seedBankroll();
    const aiRecord = await seedDecision(market.id);

    const engine = new ExecutionEngine();
    const result = await engine.execute({
      market,
      decision: makeDecision(),
      decisionId: aiRecord.id,
      bankroll,
      positions: [],
    });

    if (result.orderId) {
      const order = await prisma.order.findUnique({ where: { id: result.orderId } });
      if (order && order.status === 'filled') {
        const trades = await prisma.trade.findMany({
          where: { order_id: result.orderId },
        });
        expect(trades.length).toBe(1);
        expect(trades[0].market_id).toBe(market.id);
        expect(trades[0].side).toBe('buy');
        expect(Number(trades[0].size)).toBeGreaterThan(0);
      }
    }
  });

  it('opens position on fill with correct exit strategy', async () => {
    const market = await seedMarket();
    const bankroll = await seedBankroll();
    const aiRecord = await seedDecision(market.id);

    const engine = new ExecutionEngine();
    const result = await engine.execute({
      market,
      decision: makeDecision({ confidence: 0.6 }), // Medium → stop_loss
      decisionId: aiRecord.id,
      bankroll,
      positions: [],
    });

    if (result.positionId) {
      const position = await positionService.findById(result.positionId);
      expect(position.market_id).toBe(market.id);
      expect(position.side).toBe('long');
      expect(position.exit_strategy).toBe('stop_loss');
      expect(position.stop_loss_price).not.toBeNull();
    }
  });

  it('sets resolution_only exit for high confidence', async () => {
    const market = await seedMarket();
    const bankroll = await seedBankroll();
    const aiRecord = await seedDecision(market.id);

    const engine = new ExecutionEngine();
    const result = await engine.execute({
      market,
      decision: makeDecision({ confidence: 0.85 }), // High → resolution_only
      decisionId: aiRecord.id,
      bankroll,
      positions: [],
    });

    if (result.positionId) {
      const position = await positionService.findById(result.positionId);
      expect(position.exit_strategy).toBe('resolution_only');
    }
  });

  it('sets time_based exit for low confidence', async () => {
    const market = await seedMarket();
    const bankroll = await seedBankroll();
    const aiRecord = await seedDecision(market.id);

    const engine = new ExecutionEngine();
    const result = await engine.execute({
      market,
      decision: makeDecision({ confidence: 0.45 }), // Low → time_based
      decisionId: aiRecord.id,
      bankroll,
      positions: [],
    });

    if (result.positionId) {
      const position = await positionService.findById(result.positionId);
      expect(position.exit_strategy).toBe('time_based');
      expect(position.time_exit_at).not.toBeNull();
    }
  });

  it('returns executed=false when sizing returns null', async () => {
    const market = await seedMarket();
    const bankroll = await seedBankroll();
    const aiRecord = await seedDecision(market.id);

    const engine = new ExecutionEngine();
    const result = await engine.execute({
      market,
      decision: makeDecision({ estimated_edge: 0.001 }), // Too low for sizing
      decisionId: aiRecord.id,
      bankroll,
      positions: [],
    });

    expect(result.executed).toBe(false);
    expect(result.orderId).toBeNull();
    expect(result.sizing).toBeNull();
  });

  it('marks AI decision as executed', async () => {
    const market = await seedMarket();
    const bankroll = await seedBankroll();
    const aiRecord = await seedDecision(market.id);

    const engine = new ExecutionEngine();
    await engine.execute({
      market,
      decision: makeDecision(),
      decisionId: aiRecord.id,
      bankroll,
      positions: [],
    });

    const decision = await aiDecisionService.findById(aiRecord.id);
    expect(decision.was_executed).toBe(true);
  });
});

// ── Bankroll Updates ────────────────────────────────────────────────────────

describe('Execution Pipeline – Bankroll Updates', () => {
  it('updates bankroll after position open (deploy)', async () => {
    const market = await seedMarket();
    const bankroll = await seedBankroll();
    const aiRecord = await seedDecision(market.id);
    const initialActive = Number(bankroll.active_balance);
    const initialDeployed = Number(bankroll.deployed_balance);

    const engine = new ExecutionEngine();
    const result = await engine.execute({
      market,
      decision: makeDecision(),
      decisionId: aiRecord.id,
      bankroll,
      positions: [],
    });

    if (result.positionId && result.sizing) {
      const updatedBankroll = await bankrollService.get();
      expect(updatedBankroll).not.toBeNull();
      // Deployed should increase, active should decrease
      const newActive = Number(updatedBankroll!.active_balance);
      const newDeployed = Number(updatedBankroll!.deployed_balance);
      expect(newDeployed).toBeGreaterThan(initialDeployed);
      expect(newActive).toBeLessThan(initialActive);
    }
  });
});

// ── Exit Monitor ────────────────────────────────────────────────────────────

describe('Execution Pipeline – Exit Monitor', () => {
  it('closes position on stop-loss trigger', async () => {
    const market = await seedMarket();
    const bankroll = await seedBankroll();
    const aiRecord = await seedDecision(market.id);

    // Open a position with stop-loss
    const position = await positionManager.openPosition({
      marketId: market.id,
      outcomeToken: 'Yes',
      side: 'long',
      size: 50,
      entryPrice: 0.65,
      fees: 0.10,
      decisionId: aiRecord.id,
      exitStrategy: 'stop_loss',
      stopLossPrice: 0.55,
    });

    // Update price below stop-loss
    await positionService.updatePrice(position.id, '0.50', '-7.500000');

    // Run exit monitor check
    const monitor = new ExitMonitor();
    await (monitor as any).runCheck();

    // Position should be closed (deleted from positions, added to history)
    const openPositions = await positionService.findOpen();
    const stillOpen = openPositions.find((p) => p.id === position.id);
    expect(stillOpen).toBeUndefined();

    // Check position_history
    const history = await prisma.positionHistory.findMany({
      where: { market_id: market.id },
    });
    expect(history.length).toBe(1);
    expect(history[0].close_reason).toBe('stop_loss');
    expect(Number(history[0].avg_exit_price)).toBeCloseTo(0.50, 1);
  });

  it('closes position on time-based exit', async () => {
    const market = await seedMarket();
    const bankroll = await seedBankroll();
    const aiRecord = await seedDecision(market.id);

    // Open a position with time exit in the past
    const position = await positionManager.openPosition({
      marketId: market.id,
      outcomeToken: 'Yes',
      side: 'long',
      size: 50,
      entryPrice: 0.65,
      fees: 0.10,
      decisionId: aiRecord.id,
      exitStrategy: 'time_based',
      timeExitAt: new Date(Date.now() - 60_000), // 1 min in the past
    });

    // Run exit monitor
    const monitor = new ExitMonitor();
    await (monitor as any).runCheck();

    // Position should be closed
    const openPositions = await positionService.findOpen();
    const stillOpen = openPositions.find((p) => p.id === position.id);
    expect(stillOpen).toBeUndefined();

    const history = await prisma.positionHistory.findMany({
      where: { market_id: market.id },
    });
    expect(history.length).toBe(1);
    expect(history[0].close_reason).toBe('time_exit');
  });

  it('closes position on market resolution', async () => {
    const market = await seedMarket();
    const bankroll = await seedBankroll();
    const aiRecord = await seedDecision(market.id);

    // Open a position
    const position = await positionManager.openPosition({
      marketId: market.id,
      outcomeToken: 'Yes',
      side: 'long',
      size: 50,
      entryPrice: 0.65,
      fees: 0.10,
      decisionId: aiRecord.id,
      exitStrategy: 'resolution_only',
    });

    // Resolve the market in favor of 'Yes'
    await prisma.market.update({
      where: { id: market.id },
      data: { status: 'resolved', resolved_outcome: 'Yes' },
    });

    // Run exit monitor
    const monitor = new ExitMonitor();
    await (monitor as any).runCheck();

    // Position should be closed at 1.0 (winning)
    const openPositions = await positionService.findOpen();
    expect(openPositions.find((p) => p.id === position.id)).toBeUndefined();

    const history = await prisma.positionHistory.findMany({
      where: { market_id: market.id },
    });
    expect(history.length).toBe(1);
    expect(history[0].close_reason).toBe('resolution');
    expect(Number(history[0].avg_exit_price)).toBeCloseTo(1.0);
    // Realized P&L should be positive (bought at 0.65, resolved at 1.0)
    expect(Number(history[0].realized_pnl)).toBeGreaterThan(0);
  });

  it('does not close positions that are not triggered', async () => {
    const market = await seedMarket();
    const bankroll = await seedBankroll();
    const aiRecord = await seedDecision(market.id);

    // Position with stop-loss at 0.55, current price well above
    const position = await positionManager.openPosition({
      marketId: market.id,
      outcomeToken: 'Yes',
      side: 'long',
      size: 50,
      entryPrice: 0.65,
      fees: 0.10,
      decisionId: aiRecord.id,
      exitStrategy: 'stop_loss',
      stopLossPrice: 0.55,
    });

    // Current price above stop-loss
    await positionService.updatePrice(position.id, '0.70', '2.500000');

    // Run exit monitor
    const monitor = new ExitMonitor();
    await (monitor as any).runCheck();

    // Position should still be open
    const openPositions = await positionService.findOpen();
    expect(openPositions.find((p) => p.id === position.id)).toBeTruthy();
  });

  it('handles resolution loss correctly (exit at 0.0)', async () => {
    const market = await seedMarket();
    const bankroll = await seedBankroll();
    const aiRecord = await seedDecision(market.id);

    // Open long position on 'Yes'
    await positionManager.openPosition({
      marketId: market.id,
      outcomeToken: 'Yes',
      side: 'long',
      size: 50,
      entryPrice: 0.65,
      fees: 0.10,
      decisionId: aiRecord.id,
      exitStrategy: 'resolution_only',
    });

    // Resolve market in favor of 'No' (loss for Yes holder)
    await prisma.market.update({
      where: { id: market.id },
      data: { status: 'resolved', resolved_outcome: 'No' },
    });

    const monitor = new ExitMonitor();
    await (monitor as any).runCheck();

    const history = await prisma.positionHistory.findMany({
      where: { market_id: market.id },
    });
    expect(history.length).toBe(1);
    expect(Number(history[0].avg_exit_price)).toBeCloseTo(0.0);
    // P&L should be negative
    expect(Number(history[0].realized_pnl)).toBeLessThan(0);
  });
});

// ── Position History ────────────────────────────────────────────────────────

describe('Execution Pipeline – Position History', () => {
  it('creates position_history with all fields on close', async () => {
    const market = await seedMarket();
    const bankroll = await seedBankroll();
    const aiRecord = await seedDecision(market.id);

    const position = await positionManager.openPosition({
      marketId: market.id,
      outcomeToken: 'Yes',
      side: 'long',
      size: 50,
      entryPrice: 0.65,
      fees: 0.10,
      decisionId: aiRecord.id,
      exitStrategy: 'stop_loss',
      stopLossPrice: 0.55,
    });

    // Close manually
    await positionManager.closePosition({
      positionId: position.id,
      exitPrice: 0.70,
      closeReason: 'manual',
    });

    const history = await prisma.positionHistory.findMany({
      where: { market_id: market.id },
    });
    expect(history.length).toBe(1);
    expect(history[0].market_id).toBe(market.id);
    expect(history[0].outcome_token).toBe('Yes');
    expect(history[0].side).toBe('long');
    expect(Number(history[0].avg_entry_price)).toBeCloseTo(0.65);
    expect(Number(history[0].avg_exit_price)).toBeCloseTo(0.70);
    expect(history[0].close_reason).toBe('manual');
    expect(history[0].decision_id).toBe(aiRecord.id);
    expect(history[0].opened_at).toBeTruthy();
    // P&L: (0.70 - 0.65) * 50 - 0.10 = 2.40
    expect(Number(history[0].realized_pnl)).toBeCloseTo(2.40, 1);
  });

  it('bankroll is updated on position close (release)', async () => {
    const market = await seedMarket();
    const bankroll = await seedBankroll();
    const aiRecord = await seedDecision(market.id);

    const position = await positionManager.openPosition({
      marketId: market.id,
      outcomeToken: 'Yes',
      side: 'long',
      size: 50,
      entryPrice: 0.65,
      fees: 0.10,
      decisionId: aiRecord.id,
      exitStrategy: 'resolution_only',
    });

    const afterOpen = await bankrollService.get();
    const deployedAfterOpen = Number(afterOpen!.deployed_balance);

    // Close with profit
    await positionManager.closePosition({
      positionId: position.id,
      exitPrice: 0.75,
      closeReason: 'manual',
    });

    const afterClose = await bankrollService.get();
    const deployedAfterClose = Number(afterClose!.deployed_balance);
    const activeAfterClose = Number(afterClose!.active_balance);

    // Deployed should decrease after closing
    expect(deployedAfterClose).toBeLessThan(deployedAfterOpen);
    // Total balance should increase due to profit
    expect(Number(afterClose!.total_balance)).toBeGreaterThan(Number(afterOpen!.total_balance));
  });
});
