/**
 * E2E Integration Test: Full Pipeline
 *
 * Tests the complete decision pipeline end-to-end with real database:
 *   scanner classify → market upsert → snapshot → external data
 *   → scorer → dashboard → AI decision (mocked Claude) → risk governor
 *   → execution engine → order → position → exit monitor
 *
 * Failure modes: scorer throws, AI returns invalid JSON, risk vetoes,
 * execution fails, exit monitor triggers.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { PrismaClient, type Prisma } from '@prisma/client';
import { cleanDatabase } from '../db/db-helpers.js';

// ── Services under test ──────────────────────────────────────────────────────
import { classifyMarket } from '../../../src/services/market-scanner/classifier.js';
import * as marketService from '../../../src/services/market.service.js';
import * as marketSnapshotService from '../../../src/services/market-snapshot.service.js';
import * as contextScoreService from '../../../src/services/context-score.service.js';
import * as bankrollService from '../../../src/services/bankroll.service.js';
import * as orderService from '../../../src/services/order.service.js';
import * as positionService from '../../../src/services/position.service.js';
import * as aiDecisionService from '../../../src/services/ai-decision.service.js';

// ── Pipeline components ──────────────────────────────────────────────────────
import { scorerRegistry } from '../../../src/services/decision-engine/scorer-registry.js';
import { registerAllScorers } from '../../../src/services/decision-engine/scorers/index.js';
import { buildDashboard } from '../../../src/services/decision-engine/dashboard-builder/builder.js';
import type { ScorerInput, ScoredDimensions } from '../../../src/services/decision-engine/scorer.interface.js';
import { parseAiResponse } from '../../../src/services/ai/response-parser.js';
import { deterministicFallback } from '../../../src/services/ai/deterministic-fallback.js';
import { RiskGovernor, type RiskCheckContext } from '../../../src/services/risk/governor.js';
import { computeSize } from '../../../src/services/execution/sizing.js';
import { OrderManager } from '../../../src/services/execution/order-manager.js';
import { PositionManager } from '../../../src/services/execution/position-manager.js';
import { ExecutionEngine } from '../../../src/services/execution/engine.js';
import { ExitMonitor } from '../../../src/services/execution/exit-monitor.js';

const prisma = new PrismaClient();

// ── Test Data ────────────────────────────────────────────────────────────────

const uid = () => Math.random().toString(36).slice(2, 9);

async function seedBankroll(): Promise<Prisma.BankrollGetPayload<object>> {
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
  });
}

async function seedMarket(overrides: Partial<Prisma.MarketCreateInput> = {}) {
  const id = uid();
  return marketService.create({
    polymarket_id: `pm-e2e-${id}`,
    title: overrides.title ?? `E2E Test Market ${id}`,
    category: overrides.category ?? 'crypto',
    status: 'active',
    is_tradeable: true,
    outcomes: [
      { name: 'Yes', token_id: `yes-${id}` },
      { name: 'No', token_id: `no-${id}` },
    ] as unknown as Prisma.InputJsonValue,
    current_prices: { Yes: 0.65, No: 0.35 } as Prisma.InputJsonValue,
    volume_24h: '50000',
    liquidity: '25000',
    end_date: new Date(Date.now() + 7 * 86_400_000), // 7 days from now
    ...overrides,
  } as Prisma.MarketUncheckedCreateInput);
}

async function seedSnapshots(marketId: string, count = 5) {
  for (let i = 0; i < count; i++) {
    await marketSnapshotService.create({
      market_id: marketId,
      timestamp: new Date(Date.now() - (count - i) * 60_000),
      prices: { Yes: 0.63 + i * 0.01, No: 0.37 - i * 0.01 } as Prisma.InputJsonValue,
      spread: '0.04',
      volume_1h: '5000',
      liquidity: '25000',
    });
  }
}

async function seedExternalData(count = 3) {
  for (let i = 0; i < count; i++) {
    await prisma.externalDataPoint.create({
      data: {
        source: 'binance',
        data_type: 'trade',
        symbol: 'BTCUSDT',
        timestamp: new Date(Date.now() - (count - i) * 30_000),
        value: { price: 67000 + i * 100, volume: 1.5, side: 'buy' } as Prisma.InputJsonValue,
      },
    });
  }
}

/** Realistic mocked Claude response JSON. */
function mockAiTradeResponse(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    action: 'trade',
    direction: 'buy',
    outcome_token: 'Yes',
    confidence: 0.72,
    size_hint: 0.05,
    fair_value: 0.70,
    estimated_edge: 0.05,
    reasoning: 'Strong momentum with exchange divergence. Price below fair value. Entering long.',
    regime_assessment: 'trending',
    ...overrides,
  });
}

function mockAiHoldResponse(): string {
  return JSON.stringify({
    action: 'hold',
    direction: null,
    outcome_token: null,
    confidence: 0.3,
    size_hint: null,
    fair_value: null,
    estimated_edge: null,
    reasoning: 'Insufficient edge. Market price near fair value. Holding.',
    regime_assessment: 'quiet',
  });
}

// ── Setup / Teardown ─────────────────────────────────────────────────────────

beforeAll(async () => {
  // Ensure scorers are registered
  registerAllScorers();
});

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

// ═══════════════════════════════════════════════════════════════════════════════
// HAPPY PATH: Full pipeline end-to-end
// ═══════════════════════════════════════════════════════════════════════════════

describe('Full Pipeline E2E – Happy Path', () => {
  it('scanner → scores → AI trade → risk approve → execute → position opened', async () => {
    // ── 1. Scanner phase: classify + upsert ──────────────────────────────
    const category = classifyMarket('Will Bitcoin exceed $100k by 2025?');
    expect(category).toBe('crypto');

    const market = await seedMarket({
      title: 'Will Bitcoin exceed $100k by 2025?',
      category: category as Prisma.MarketCreateInput['category'],
    });
    expect(market.id).toBeTruthy();
    expect(market.status).toBe('active');

    // ── 2. Snapshots + external data ──────────────────────────────────────
    await seedSnapshots(market.id, 5);
    await seedExternalData(3);

    const snapshotPage = await marketSnapshotService.findByMarket(
      { marketId: market.id },
      { page: 1, pageSize: 20 },
    );
    expect(snapshotPage.items.length).toBe(5);

    // ── 3. Run scorers ───────────────────────────────────────────────────
    const scorers = await scorerRegistry.getEnabledScorers('crypto');
    expect(scorers.length).toBeGreaterThan(0);

    const externalData = await prisma.externalDataPoint.findMany({
      orderBy: { timestamp: 'desc' },
      take: 50,
    });

    const scores: ScoredDimensions = {};
    for (const scorer of scorers) {
      const input: ScorerInput = {
        market: market as any,
        snapshots: snapshotPage.items as any[],
        externalData: externalData as any[],
        config: {},
      };
      const dim = scorer.score(input);
      scores[scorer.name] = dim;
    }

    // All scores should be in 0-100 range
    for (const [name, dim] of Object.entries(scores)) {
      expect(dim.value).toBeGreaterThanOrEqual(0);
      expect(dim.value).toBeLessThanOrEqual(100);
      expect(dim.label).toBeTruthy();
    }

    // ── 4. Build dashboard text ──────────────────────────────────────────
    const bankroll = await seedBankroll();

    const dashboardText = buildDashboard({
      market: market as any,
      scores,
      snapshots: snapshotPage.items as any[],
      bankroll: bankroll as any,
      positions: [],
      recentFeedback: [],
    });
    expect(dashboardText).toBeTruthy();
    expect(dashboardText.length).toBeGreaterThan(50);

    // ── 5. Store context scores ──────────────────────────────────────────
    const contextScore = await contextScoreService.create({
      market_id: market.id,
      category: 'crypto',
      scores: scores as unknown as Prisma.InputJsonValue,
      raw_indicators: {} as Prisma.InputJsonValue,
      dashboard_text: dashboardText,
    });
    expect(contextScore.id).toBeTruthy();

    // ── 6. AI decision (mocked Claude response) ──────────────────────────
    const aiResponseJson = mockAiTradeResponse();
    const parsed = parseAiResponse(aiResponseJson);

    expect(parsed.action).toBe('trade');
    expect(parsed.direction).toBe('buy');
    expect(parsed.confidence).toBeCloseTo(0.72);
    expect(parsed.estimated_edge).toBeCloseTo(0.05);

    // Build DecisionOutput shape
    const decision = {
      ...parsed,
      model: 'claude-sonnet-4-6',
      latencyMs: 850,
      tokensUsed: 2500,
      promptVersion: 'v1.0.0',
      usedFallback: false,
    };

    // Persist AI decision
    const aiRecord = await aiDecisionService.create({
      market_id: market.id,
      category: 'crypto',
      action: decision.action,
      direction: decision.direction ?? null,
      outcome_token: decision.outcome_token ?? null,
      confidence: String(decision.confidence),
      size_hint: decision.size_hint != null ? String(decision.size_hint) : null,
      fair_value: decision.fair_value != null ? String(decision.fair_value) : null,
      estimated_edge: decision.estimated_edge != null ? String(decision.estimated_edge) : null,
      reasoning: decision.reasoning,
      regime_assessment: decision.regime_assessment ?? null,
      model_used: decision.model,
      latency_ms: decision.latencyMs,
      tokens_used: decision.tokensUsed,
      prompt_version: decision.promptVersion,
      dashboard_text: dashboardText,
      account_state: { balance: 10000, positions: 0 } as Prisma.InputJsonValue,
    } as Prisma.AiDecisionUncheckedCreateInput);

    expect(aiRecord.id).toBeTruthy();
    expect(aiRecord.action).toBe('trade');

    // ── 7. Risk governor ─────────────────────────────────────────────────
    const governor = new RiskGovernor();
    const riskResult = await governor.check({
      market: market as any,
      decision: decision as any,
      scores,
      bankroll: bankroll as any,
      positions: [],
      snapshots: snapshotPage.items as any[],
    });

    expect(riskResult.approved).toBe(true);

    // ── 8. Execution engine ──────────────────────────────────────────────
    const engine = new ExecutionEngine();
    const execResult = await engine.execute({
      market: market as any,
      decision: decision as any,
      decisionId: aiRecord.id,
      bankroll: bankroll as any,
      positions: [],
    });

    expect(execResult.executed).toBe(true);
    expect(execResult.orderId).toBeTruthy();
    expect(execResult.sizing).not.toBeNull();
    expect(execResult.sizing!.sizeUsd).toBeGreaterThan(0);

    // ── 9. Verify DB state ───────────────────────────────────────────────
    // Order should exist and be filled (mock mode)
    const order = await orderService.findById(execResult.orderId!);
    expect(order.market_id).toBe(market.id);
    expect(['filled', 'expired']).toContain(order.status);

    if (order.status === 'filled') {
      // Position should exist
      expect(execResult.positionId).toBeTruthy();
      const position = await positionService.findById(execResult.positionId!);
      expect(position.market_id).toBe(market.id);
      expect(position.side).toBe('long');
      expect(Number(position.size)).toBeGreaterThan(0);

      // Trade record should exist
      const trades = await prisma.trade.findMany({
        where: { order_id: order.id },
      });
      expect(trades.length).toBe(1);
      expect(trades[0].market_id).toBe(market.id);

      // AI decision should be marked as executed
      const updatedDecision = await aiDecisionService.findById(aiRecord.id);
      expect(updatedDecision.was_executed).toBe(true);
      expect(updatedDecision.order_id).toBe(order.id);
    }
  });

  it('full pipeline with politics market', async () => {
    const category = classifyMarket('Will the president win reelection in 2026?');
    expect(category).toBe('politics');

    const market = await seedMarket({
      title: 'Will the president win reelection in 2026?',
      category: 'politics',
    });
    await seedSnapshots(market.id, 3);
    const bankroll = await seedBankroll();

    // Run politics scorers
    const scorers = await scorerRegistry.getEnabledScorers('politics');
    expect(scorers.length).toBeGreaterThan(0);

    const scores: ScoredDimensions = {};
    for (const scorer of scorers) {
      const input: ScorerInput = {
        market: market as any,
        snapshots: [],
        externalData: [],
        config: {},
      };
      scores[scorer.name] = scorer.score(input);
    }

    // All politics scores should be valid
    for (const dim of Object.values(scores)) {
      expect(dim.value).toBeGreaterThanOrEqual(0);
      expect(dim.value).toBeLessThanOrEqual(100);
    }

    const dashboardText = buildDashboard({
      market: market as any,
      scores,
      snapshots: [],
      bankroll: bankroll as any,
      positions: [],
      recentFeedback: [],
    });
    expect(dashboardText).toContain('president');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// AI Decision Parsing
// ═══════════════════════════════════════════════════════════════════════════════

describe('AI Response Parsing', () => {
  it('parses valid trade response', () => {
    const parsed = parseAiResponse(mockAiTradeResponse());
    expect(parsed.action).toBe('trade');
    expect(parsed.confidence).toBeGreaterThan(0);
    expect(parsed.confidence).toBeLessThanOrEqual(1);
    expect(parsed.reasoning).toBeTruthy();
  });

  it('parses hold response', () => {
    const parsed = parseAiResponse(mockAiHoldResponse());
    expect(parsed.action).toBe('hold');
    expect(parsed.confidence).toBeCloseTo(0.3);
  });

  it('parses response wrapped in markdown code fences', () => {
    const wrapped = '```json\n' + mockAiTradeResponse() + '\n```';
    const parsed = parseAiResponse(wrapped);
    expect(parsed.action).toBe('trade');
  });

  it('parses response with surrounding prose', () => {
    const withProse = 'Here is my analysis:\n\n' + mockAiTradeResponse() + '\n\nLet me know if you need more.';
    const parsed = parseAiResponse(withProse);
    expect(parsed.action).toBe('trade');
  });

  it('throws on invalid JSON', () => {
    expect(() => parseAiResponse('this is not json at all')).toThrow();
  });

  it('throws on valid JSON but invalid schema', () => {
    expect(() => parseAiResponse(JSON.stringify({ action: 'invalid', confidence: 2 }))).toThrow();
  });

  it('throws on confidence out of range', () => {
    expect(() => parseAiResponse(mockAiTradeResponse({ confidence: 1.5 }))).toThrow();
  });

  it('throws on empty reasoning', () => {
    expect(() => parseAiResponse(mockAiTradeResponse({ reasoning: '' }))).toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Deterministic Fallback
// ═══════════════════════════════════════════════════════════════════════════════

describe('Deterministic Fallback', () => {
  it('returns hold when composite is below threshold', () => {
    const scores: ScoredDimensions = {
      dim_a: { value: 40, label: 'LOW', detail: '' },
      dim_b: { value: 45, label: 'LOW', detail: '' },
      dim_c: { value: 50, label: 'NEUTRAL', detail: '' },
    };
    const result = deterministicFallback(scores, 'crypto');
    expect(result.action).toBe('hold');
    expect(result.fallback).toBe(true);
  });

  it('returns trade when composite exceeds threshold with enough scorers', () => {
    const scores: ScoredDimensions = {
      dim_a: { value: 80, label: 'HIGH', detail: '' },
      dim_b: { value: 75, label: 'HIGH', detail: '' },
      dim_c: { value: 78, label: 'HIGH', detail: '' },
    };
    const result = deterministicFallback(scores, 'crypto');
    expect(result.action).toBe('trade');
    expect(result.confidence).toBeLessThanOrEqual(0.5); // deliberately low
    expect(result.fallback).toBe(true);
  });

  it('returns hold with fewer than 3 scorers even if composite is high', () => {
    const scores: ScoredDimensions = {
      dim_a: { value: 90, label: 'HIGH', detail: '' },
      dim_b: { value: 85, label: 'HIGH', detail: '' },
    };
    const result = deterministicFallback(scores, 'crypto');
    expect(result.action).toBe('hold');
  });

  it('returns hold on empty scores', () => {
    const result = deterministicFallback({}, 'crypto');
    expect(result.action).toBe('hold');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Position Sizing
// ═══════════════════════════════════════════════════════════════════════════════

describe('Position Sizing', () => {
  // computeSize calls Number() on all Decimal fields, so plain numbers work
  const makeBankroll = (active: number, initial: number) => ({
    id: 'test',
    total_balance: active + 2000,
    previous_balance: initial,
    reserved_balance: 0,
    active_balance: active,
    deployed_balance: 2000,
    unrealized_pnl: 0,
    balance_delta_today: 0,
    balance_delta_total: 0,
    initial_deposit: initial,
    updated_at: new Date(),
  });

  it('computes a valid size with good edge and confidence', () => {
    const result = computeSize({
      confidence: 0.72,
      sizeHint: 0.05,
      estimatedEdge: 0.05,
      marketPrice: 0.65,
      bankroll: makeBankroll(8000, 10000) as any,
    });

    expect(result).not.toBeNull();
    expect(result!.sizeUsd).toBeGreaterThanOrEqual(5);
    expect(result!.sizeUsd).toBeLessThanOrEqual(500);
    expect(result!.sizeFraction).toBeGreaterThan(0);
    expect(result!.sizeFraction).toBeLessThanOrEqual(0.05);
    expect(result!.rawKelly).toBeGreaterThan(0);
  });

  it('returns null when edge is below minimum', () => {
    const result = computeSize({
      confidence: 0.72,
      sizeHint: 0.05,
      estimatedEdge: 0.01, // below default 0.02 threshold
      marketPrice: 0.65,
      bankroll: makeBankroll(8000, 10000) as any,
    });

    expect(result).toBeNull();
  });

  it('returns null when active balance is zero', () => {
    const result = computeSize({
      confidence: 0.72,
      sizeHint: 0.05,
      estimatedEdge: 0.05,
      marketPrice: 0.65,
      bankroll: makeBankroll(0, 10000) as any,
    });

    expect(result).toBeNull();
  });

  it('scales down when balance is low', () => {
    const normalResult = computeSize({
      confidence: 0.72,
      sizeHint: 0.05,
      estimatedEdge: 0.05,
      marketPrice: 0.65,
      bankroll: makeBankroll(8000, 10000) as any,
    });

    const lowBalResult = computeSize({
      confidence: 0.72,
      sizeHint: 0.05,
      estimatedEdge: 0.05,
      marketPrice: 0.65,
      bankroll: makeBankroll(3000, 10000) as any, // 30% of initial
    });

    expect(normalResult).not.toBeNull();
    expect(lowBalResult).not.toBeNull();
    // Low balance result should produce a smaller size
    expect(lowBalResult!.sizeFraction).toBeLessThan(normalResult!.sizeFraction);
  });

  it('caps at max_position_usd', () => {
    const result = computeSize(
      {
        confidence: 0.99,
        sizeHint: 0.99,
        estimatedEdge: 0.50,
        marketPrice: 0.10,
        bankroll: makeBankroll(1_000_000, 1_000_000) as any,
      },
      { max_position_usd: 200 },
    );

    expect(result).not.toBeNull();
    expect(result!.sizeUsd).toBeLessThanOrEqual(200);
  });

  it('handles extreme market prices near 1.0 without breaking', () => {
    const result = computeSize({
      confidence: 0.72,
      sizeHint: 0.05,
      estimatedEdge: 0.05,
      marketPrice: 0.99,
      bankroll: makeBankroll(8000, 10000) as any,
    });

    // Should not throw, may return null or a valid result
    if (result) {
      expect(result.sizeUsd).toBeGreaterThan(0);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Risk Governor Checks
// ═══════════════════════════════════════════════════════════════════════════════

describe('Risk Governor', () => {
  it('approves a trade with healthy bankroll and good edge', async () => {
    const market = await seedMarket();
    const bankroll = await seedBankroll();
    await seedSnapshots(market.id, 3);
    const snapshots = await prisma.marketSnapshot.findMany({
      where: { market_id: market.id },
    });

    const governor = new RiskGovernor();
    const result = await governor.check({
      market: market as any,
      decision: {
        action: 'trade',
        direction: 'buy',
        outcome_token: 'Yes',
        confidence: 0.72,
        size_hint: 0.05,
        estimated_edge: 0.05,
        fair_value: 0.70,
        reasoning: 'Test',
        regime_assessment: 'trending',
        model: 'test',
        latencyMs: 500,
        tokensUsed: 1000,
        promptVersion: 'v1',
        usedFallback: false,
      } as any,
      scores: {
        momentum: { value: 70, label: 'BULL', detail: '' },
      },
      bankroll: bankroll as any,
      positions: [],
      snapshots: snapshots as any[],
    });

    expect(result.approved).toBe(true);
  });

  it('vetoes when drawdown exceeds limit', async () => {
    const market = await seedMarket();
    await seedSnapshots(market.id, 3);

    // Bankroll with heavy drawdown: initial 10000, now 7500 = 25% drawdown > 20% limit
    const bankroll = await bankrollService.update({
      total_balance: '7500.000000',
      previous_balance: '10000.000000',
      reserved_balance: '0.000000',
      active_balance: '5500.000000',
      deployed_balance: '2000.000000',
      unrealized_pnl: '0.000000',
      balance_delta_today: '-2500.000000',
      balance_delta_total: '-2500.000000',
      initial_deposit: '10000.000000',
    });

    const snapshots = await prisma.marketSnapshot.findMany({
      where: { market_id: market.id },
    });

    const governor = new RiskGovernor();
    const result = await governor.check({
      market: market as any,
      decision: {
        action: 'trade',
        direction: 'buy',
        outcome_token: 'Yes',
        confidence: 0.72,
        size_hint: 0.05,
        estimated_edge: 0.05,
        reasoning: 'Test',
        model: 'test',
        latencyMs: 500,
        tokensUsed: 1000,
        promptVersion: 'v1',
        usedFallback: false,
      } as any,
      scores: {},
      bankroll: bankroll as any,
      positions: [],
      snapshots: snapshots as any[],
    });

    expect(result.approved).toBe(false);
    expect(result.vetoReason).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Order Manager
// ═══════════════════════════════════════════════════════════════════════════════

describe('Order Manager (mock mode)', () => {
  it('places and fills an order', async () => {
    const market = await seedMarket();
    const bankroll = await seedBankroll();

    // Create an AI decision first (FK requirement)
    const aiRecord = await aiDecisionService.create({
      market_id: market.id,
      category: 'crypto',
      action: 'trade',
      direction: 'buy',
      outcome_token: 'Yes',
      confidence: '0.72',
      reasoning: 'Test decision',
      dashboard_text: 'test',
      account_state: { balance: 10000 } as Prisma.InputJsonValue,
      model_used: 'test',
    } as Prisma.AiDecisionUncheckedCreateInput);

    const manager = new OrderManager();
    const { order, isMock } = await manager.placeOrder({
      marketId: market.id,
      decisionId: aiRecord.id,
      side: 'buy',
      outcomeToken: 'Yes',
      price: 0.65,
      sizeUsd: 50,
      orderType: 'limit',
      confidence: 0.72,
      estimatedEdge: 0.05,
      regime: 'trending',
    });

    expect(isMock).toBe(true);
    expect(order.market_id).toBe(market.id);
    expect(['filled', 'expired']).toContain(order.status);

    if (order.status === 'filled') {
      expect(Number(order.filled_size)).toBeGreaterThan(0);
      expect(order.avg_fill_price).not.toBeNull();

      // Trade record should exist
      const trades = await prisma.trade.findMany({
        where: { order_id: order.id },
      });
      expect(trades.length).toBe(1);
    }
  });

  it('cancels an open order', async () => {
    const market = await seedMarket();

    const aiRecord = await aiDecisionService.create({
      market_id: market.id,
      category: 'crypto',
      action: 'trade',
      direction: 'buy',
      outcome_token: 'Yes',
      confidence: '0.72',
      reasoning: 'Test',
      dashboard_text: 'test',
      account_state: {} as Prisma.InputJsonValue,
      model_used: 'test',
    } as Prisma.AiDecisionUncheckedCreateInput);

    // Create a pending order directly
    const order = await orderService.create({
      market_id: market.id,
      decision_id: aiRecord.id,
      side: 'buy',
      outcome_token: 'Yes',
      order_type: 'limit',
      price: '0.650000',
      size: '50.000000',
      status: 'pending',
    } as Prisma.OrderUncheckedCreateInput);

    const manager = new OrderManager();
    const cancelled = await manager.cancelOrder(order.id);
    expect(cancelled.status).toBe('cancelled');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Position Manager
// ═══════════════════════════════════════════════════════════════════════════════

describe('Position Manager', () => {
  it('opens a new position', async () => {
    const market = await seedMarket();
    const bankroll = await seedBankroll();

    const aiRecord = await aiDecisionService.create({
      market_id: market.id,
      category: 'crypto',
      action: 'trade',
      direction: 'buy',
      outcome_token: 'Yes',
      confidence: '0.72',
      reasoning: 'Test',
      dashboard_text: 'test',
      account_state: {} as Prisma.InputJsonValue,
      model_used: 'test',
    } as Prisma.AiDecisionUncheckedCreateInput);

    const pm = new PositionManager();
    const position = await pm.openPosition({
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

    expect(position.market_id).toBe(market.id);
    expect(position.side).toBe('long');
    expect(Number(position.size)).toBeCloseTo(50);
    expect(Number(position.avg_entry_price)).toBeCloseTo(0.65);
    expect(position.exit_strategy).toBe('stop_loss');
    expect(Number(position.stop_loss_price)).toBeCloseTo(0.55);
  });

  it('averages into existing position', async () => {
    const market = await seedMarket();
    const bankroll = await seedBankroll();

    const aiRecord = await aiDecisionService.create({
      market_id: market.id,
      category: 'crypto',
      action: 'trade',
      direction: 'buy',
      outcome_token: 'Yes',
      confidence: '0.72',
      reasoning: 'Test',
      dashboard_text: 'test',
      account_state: {} as Prisma.InputJsonValue,
      model_used: 'test',
    } as Prisma.AiDecisionUncheckedCreateInput);

    const pm = new PositionManager();

    // First entry: 50 @ 0.65
    await pm.openPosition({
      marketId: market.id,
      outcomeToken: 'Yes',
      side: 'long',
      size: 50,
      entryPrice: 0.65,
      fees: 0.10,
      decisionId: aiRecord.id,
      exitStrategy: 'resolution_only',
    });

    // Second entry: 30 @ 0.70
    const updated = await pm.openPosition({
      marketId: market.id,
      outcomeToken: 'Yes',
      side: 'long',
      size: 30,
      entryPrice: 0.70,
      fees: 0.06,
      decisionId: aiRecord.id,
      exitStrategy: 'resolution_only',
    });

    // Should be averaged: (50*0.65 + 30*0.70) / 80 = 0.66875
    expect(Number(updated.size)).toBeCloseTo(80);
    expect(Number(updated.avg_entry_price)).toBeCloseTo(0.66875, 3);
    expect(Number(updated.total_fees)).toBeCloseTo(0.16);
  });

  it('closes a position and moves to history', async () => {
    const market = await seedMarket();
    const bankroll = await seedBankroll();

    const aiRecord = await aiDecisionService.create({
      market_id: market.id,
      category: 'crypto',
      action: 'trade',
      direction: 'buy',
      outcome_token: 'Yes',
      confidence: '0.72',
      reasoning: 'Test',
      dashboard_text: 'test',
      account_state: {} as Prisma.InputJsonValue,
      model_used: 'test',
    } as Prisma.AiDecisionUncheckedCreateInput);

    const pm = new PositionManager();

    const position = await pm.openPosition({
      marketId: market.id,
      outcomeToken: 'Yes',
      side: 'long',
      size: 50,
      entryPrice: 0.65,
      fees: 0.10,
      decisionId: aiRecord.id,
      exitStrategy: 'resolution_only',
    });

    // Close at a profit
    await pm.closePosition({
      positionId: position.id,
      exitPrice: 0.80,
      closeReason: 'resolution',
    });

    // Position should be gone from active
    const open = await positionService.findOpen();
    const stillExists = open.find((p) => p.id === position.id);
    expect(stillExists).toBeUndefined();

    // Should be in history
    const history = await prisma.positionHistory.findMany({
      where: { market_id: market.id },
    });
    expect(history.length).toBe(1);
    expect(history[0].close_reason).toBe('resolution');
    expect(Number(history[0].realized_pnl)).toBeGreaterThan(0); // profit
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Exit Monitor
// ═══════════════════════════════════════════════════════════════════════════════

describe('Exit Monitor', () => {
  it('closes a position when market is resolved', async () => {
    const market = await seedMarket();
    const bankroll = await seedBankroll();

    const aiRecord = await aiDecisionService.create({
      market_id: market.id,
      category: 'crypto',
      action: 'trade',
      direction: 'buy',
      outcome_token: 'Yes',
      confidence: '0.72',
      reasoning: 'Test',
      dashboard_text: 'test',
      account_state: {} as Prisma.InputJsonValue,
      model_used: 'test',
    } as Prisma.AiDecisionUncheckedCreateInput);

    // Open a position
    const pm = new PositionManager();
    const position = await pm.openPosition({
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
    await marketService.update(market.id, {
      status: 'resolved',
      resolved_outcome: 'Yes',
    });

    // Run exit monitor check (not starting the loop, just one check)
    const monitor = new ExitMonitor(999_999); // long interval, we'll call manually
    // Access the private runCheck via any cast
    await (monitor as any).runCheck();

    // Position should be closed
    const open = await positionService.findOpen();
    expect(open.find((p) => p.id === position.id)).toBeUndefined();

    // History should show resolution close at price 1.0
    const history = await prisma.positionHistory.findMany({
      where: { market_id: market.id },
    });
    expect(history.length).toBe(1);
    expect(history[0].close_reason).toBe('resolution');
    expect(Number(history[0].avg_exit_price)).toBeCloseTo(1.0);
    expect(Number(history[0].realized_pnl)).toBeGreaterThan(0);
  });

  it('closes a position on stop-loss trigger', async () => {
    const market = await seedMarket();
    const bankroll = await seedBankroll();

    const aiRecord = await aiDecisionService.create({
      market_id: market.id,
      category: 'crypto',
      action: 'trade',
      direction: 'buy',
      outcome_token: 'Yes',
      confidence: '0.72',
      reasoning: 'Test',
      dashboard_text: 'test',
      account_state: {} as Prisma.InputJsonValue,
      model_used: 'test',
    } as Prisma.AiDecisionUncheckedCreateInput);

    const pm = new PositionManager();
    const position = await pm.openPosition({
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

    // Mark current price below stop loss
    await positionService.updatePrice(position.id, '0.50', '-7.500000');

    // Run exit check
    const monitor = new ExitMonitor(999_999);
    await (monitor as any).runCheck();

    // Position should be closed via stop-loss
    const open = await positionService.findOpen();
    expect(open.find((p) => p.id === position.id)).toBeUndefined();

    const history = await prisma.positionHistory.findMany({
      where: { market_id: market.id },
    });
    expect(history.length).toBe(1);
    expect(history[0].close_reason).toBe('stop_loss');
  });

  it('closes a position on time-based exit', async () => {
    const market = await seedMarket();
    const bankroll = await seedBankroll();

    const aiRecord = await aiDecisionService.create({
      market_id: market.id,
      category: 'crypto',
      action: 'trade',
      direction: 'buy',
      outcome_token: 'Yes',
      confidence: '0.72',
      reasoning: 'Test',
      dashboard_text: 'test',
      account_state: {} as Prisma.InputJsonValue,
      model_used: 'test',
    } as Prisma.AiDecisionUncheckedCreateInput);

    const pm = new PositionManager();
    const position = await pm.openPosition({
      marketId: market.id,
      outcomeToken: 'Yes',
      side: 'long',
      size: 50,
      entryPrice: 0.65,
      fees: 0.10,
      decisionId: aiRecord.id,
      exitStrategy: 'time_based',
      timeExitAt: new Date(Date.now() - 60_000), // already expired
    });

    // Run exit check
    const monitor = new ExitMonitor(999_999);
    await (monitor as any).runCheck();

    // Position should be closed via time exit
    const open = await positionService.findOpen();
    expect(open.find((p) => p.id === position.id)).toBeUndefined();

    const history = await prisma.positionHistory.findMany({
      where: { market_id: market.id },
    });
    expect(history.length).toBe(1);
    expect(history[0].close_reason).toBe('time_exit');
  });

  it('does not close positions that have not hit exit conditions', async () => {
    const market = await seedMarket();
    const bankroll = await seedBankroll();

    const aiRecord = await aiDecisionService.create({
      market_id: market.id,
      category: 'crypto',
      action: 'trade',
      direction: 'buy',
      outcome_token: 'Yes',
      confidence: '0.72',
      reasoning: 'Test',
      dashboard_text: 'test',
      account_state: {} as Prisma.InputJsonValue,
      model_used: 'test',
    } as Prisma.AiDecisionUncheckedCreateInput);

    const pm = new PositionManager();
    const position = await pm.openPosition({
      marketId: market.id,
      outcomeToken: 'Yes',
      side: 'long',
      size: 50,
      entryPrice: 0.65,
      fees: 0.10,
      decisionId: aiRecord.id,
      exitStrategy: 'stop_loss',
      stopLossPrice: 0.40, // far below current price
    });

    // Current price well above stop
    await positionService.updatePrice(position.id, '0.70', '2.500000');

    // Run exit check
    const monitor = new ExitMonitor(999_999);
    await (monitor as any).runCheck();

    // Position should still be open
    const open = await positionService.findOpen();
    expect(open.find((p) => p.id === position.id)).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Execution Engine
// ═══════════════════════════════════════════════════════════════════════════════

describe('Execution Engine', () => {
  it('skips execution when sizing returns null (insufficient edge)', async () => {
    const market = await seedMarket();
    const bankroll = await seedBankroll();

    const aiRecord = await aiDecisionService.create({
      market_id: market.id,
      category: 'crypto',
      action: 'trade',
      direction: 'buy',
      outcome_token: 'Yes',
      confidence: '0.72',
      reasoning: 'Test',
      dashboard_text: 'test',
      account_state: {} as Prisma.InputJsonValue,
      model_used: 'test',
    } as Prisma.AiDecisionUncheckedCreateInput);

    const engine = new ExecutionEngine();
    const result = await engine.execute({
      market: market as any,
      decision: {
        action: 'trade',
        direction: 'buy',
        outcome_token: 'Yes',
        confidence: 0.72,
        size_hint: 0.05,
        estimated_edge: 0.001, // way too low
        reasoning: 'Test',
        regime_assessment: 'quiet',
        model: 'test',
        latencyMs: 500,
        tokensUsed: 1000,
        promptVersion: 'v1',
        usedFallback: false,
      } as any,
      decisionId: aiRecord.id,
      bankroll: bankroll as any,
      positions: [],
    });

    expect(result.executed).toBe(false);
    expect(result.sizing).toBeNull();
    expect(result.reason).toContain('null');
  });

  it('determines exit strategy based on confidence', async () => {
    const market = await seedMarket();
    const bankroll = await seedBankroll();

    // High confidence → resolution_only
    const aiRecord1 = await aiDecisionService.create({
      market_id: market.id,
      category: 'crypto',
      action: 'trade',
      direction: 'buy',
      outcome_token: 'Yes',
      confidence: '0.85',
      reasoning: 'High confidence test',
      dashboard_text: 'test',
      account_state: {} as Prisma.InputJsonValue,
      model_used: 'test',
    } as Prisma.AiDecisionUncheckedCreateInput);

    const engine = new ExecutionEngine();
    const result = await engine.execute({
      market: market as any,
      decision: {
        action: 'trade',
        direction: 'buy',
        outcome_token: 'Yes',
        confidence: 0.85,
        size_hint: 0.05,
        estimated_edge: 0.05,
        fair_value: 0.70,
        reasoning: 'High confidence test',
        regime_assessment: 'trending',
        model: 'test',
        latencyMs: 500,
        tokensUsed: 1000,
        promptVersion: 'v1',
        usedFallback: false,
      } as any,
      decisionId: aiRecord1.id,
      bankroll: bankroll as any,
      positions: [],
    });

    if (result.executed && result.positionId) {
      const position = await positionService.findById(result.positionId);
      expect(position.exit_strategy).toBe('resolution_only');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Scorer Error Handling
// ═══════════════════════════════════════════════════════════════════════════════

describe('Scorer Error Handling', () => {
  it('scorers return valid output for empty snapshots and external data', () => {
    const categories = scorerRegistry.getCategories();
    const scorers = categories.flatMap((c) => scorerRegistry.getScorersForCategory(c));
    expect(scorers.length).toBeGreaterThan(0);

    for (const scorer of scorers) {
      const input: ScorerInput = {
        market: {
          id: 'test-id',
          category: 'crypto',
          current_prices: { Yes: 0.65, No: 0.35 },
          liquidity: 25000,
          end_date: new Date(Date.now() + 7 * 86_400_000),
          resolution_criteria: 'BTC above $100k',
          title: 'Test market',
          metadata: {},
        } as any,
        snapshots: [],
        externalData: [],
        config: {},
      };

      // Should not throw
      const dim = scorer.score(input);
      expect(dim.value).toBeGreaterThanOrEqual(0);
      expect(dim.value).toBeLessThanOrEqual(100);
      expect(dim.label).toBeTruthy();
    }
  });

  it('scorers handle extreme prices (0.01 and 0.99)', () => {
    const categories = scorerRegistry.getCategories();
    const scorers = categories.flatMap((c) => scorerRegistry.getScorersForCategory(c));

    for (const price of [0.01, 0.99]) {
      for (const scorer of scorers) {
        const input: ScorerInput = {
          market: {
            id: 'test-id',
            category: 'crypto',
            current_prices: { Yes: price, No: 1 - price },
            liquidity: 25000,
            end_date: new Date(Date.now() + 7 * 86_400_000),
            resolution_criteria: 'Test',
            title: 'Test',
            metadata: {},
          } as any,
          snapshots: [],
          externalData: [],
          config: {},
        };

        const dim = scorer.score(input);
        expect(dim.value).toBeGreaterThanOrEqual(0);
        expect(dim.value).toBeLessThanOrEqual(100);
      }
    }
  });
});
