/**
 * E2E: AI Decision Pipeline
 *
 * Tests dashboard builder → AI decision (mocked Claude) → fallback logic.
 * Does NOT make real Claude API calls.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { PrismaClient, type Prisma } from '@prisma/client';
import { cleanDatabase } from '../../integration/db/db-helpers.js';
import { scorerRegistry } from '../../../src/services/decision-engine/scorer-registry.js';
import { registerAllScorers } from '../../../src/services/decision-engine/scorers/index.js';
import { buildDashboard } from '../../../src/services/decision-engine/dashboard-builder/builder.js';
import { parseAiResponse } from '../../../src/services/ai/response-parser.js';
import { deterministicFallback } from '../../../src/services/ai/deterministic-fallback.js';
import * as marketService from '../../../src/services/market.service.js';
import * as marketSnapshotService from '../../../src/services/market-snapshot.service.js';
import * as bankrollService from '../../../src/services/bankroll.service.js';
import * as aiDecisionService from '../../../src/services/ai-decision.service.js';
import type { ScorerInput, ScoredDimensions } from '../../../src/services/decision-engine/scorer.interface.js';

const prisma = new PrismaClient();
const uid = () => Math.random().toString(36).slice(2, 9);

// ── Helpers ──────────────────────────────────────────────────────────────────

async function seedMarket(category = 'crypto', title?: string) {
  const id = uid();
  return marketService.create({
    polymarket_id: `pm-dec-${id}`,
    title: title ?? `Decision Test ${id}`,
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
  } as Prisma.MarketUncheckedCreateInput);
}

async function seedBankroll() {
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

async function seedSnapshots(marketId: string, count = 5) {
  const snaps = [];
  for (let i = 0; i < count; i++) {
    snaps.push(
      await marketSnapshotService.create({
        market_id: marketId,
        timestamp: new Date(Date.now() - (count - i) * 60_000),
        prices: { Yes: 0.63 + i * 0.01, No: 0.37 - i * 0.01 } as Prisma.InputJsonValue,
        spread: '0.04',
        volume_1h: '5000',
        liquidity: '25000',
      }),
    );
  }
  return snaps;
}

function mockTradeJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    action: 'trade',
    direction: 'buy',
    outcome_token: 'Yes',
    confidence: 0.75,
    size_hint: 0.3,
    estimated_edge: 0.05,
    fair_value: 0.65,
    reasoning: 'Strong divergence with good liquidity. Price below fair value.',
    regime_assessment: 'trending',
    ...overrides,
  });
}

function mockHoldJson(): string {
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

// ── Setup ────────────────────────────────────────────────────────────────────

beforeAll(() => {
  registerAllScorers();
});

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

// ── Dashboard Builder ────────────────────────────────────────────────────────

describe('Decision Pipeline – Dashboard Builder', () => {
  it('builds a dashboard for crypto market', async () => {
    const market = await seedMarket('crypto', 'Will BTC hit $100k?');
    const snapshots = await seedSnapshots(market.id, 5);
    const bankroll = await seedBankroll();

    const scorers = scorerRegistry.getScorersForCategory('crypto');
    const scores: ScoredDimensions = {};
    for (const scorer of scorers) {
      scores[scorer.name] = scorer.score({
        market: market as any,
        snapshots: snapshots as any[],
        externalData: [],
        config: {},
      });
    }

    const text = buildDashboard({
      market: market as any,
      scores,
      snapshots: snapshots as any[],
      bankroll: bankroll as any,
      positions: [],
      recentFeedback: [],
    });

    expect(text.length).toBeGreaterThan(100);
    // Should contain market info
    expect(text).toContain('BTC');
  });

  it('builds dashboards for all categories', async () => {
    const categories = ['crypto', 'politics', 'sports', 'events'];
    const bankroll = await seedBankroll();

    for (const cat of categories) {
      const market = await seedMarket(cat);
      const text = buildDashboard({
        market: market as any,
        scores: {},
        snapshots: [],
        bankroll: bankroll as any,
        positions: [],
        recentFeedback: [],
      });

      expect(text.length, `${cat} dashboard`).toBeGreaterThan(50);
    }
  });
});

// ── AI Response Parsing ──────────────────────────────────────────────────────

describe('Decision Pipeline – AI Response Parsing', () => {
  it('parses a realistic trade response', () => {
    const parsed = parseAiResponse(mockTradeJson());
    expect(parsed.action).toBe('trade');
    expect(parsed.direction).toBe('buy');
    expect(parsed.outcome_token).toBe('Yes');
    expect(parsed.confidence).toBeCloseTo(0.75);
    expect(parsed.size_hint).toBeCloseTo(0.3);
    expect(parsed.estimated_edge).toBeCloseTo(0.05);
    expect(parsed.fair_value).toBeCloseTo(0.65);
    expect(parsed.reasoning.length).toBeGreaterThan(10);
    expect(parsed.regime_assessment).toBe('trending');
  });

  it('parses a hold response', () => {
    const parsed = parseAiResponse(mockHoldJson());
    expect(parsed.action).toBe('hold');
    expect(parsed.direction).toBeNull();
    expect(parsed.reasoning).toBeTruthy();
  });

  it('handles markdown code fences', () => {
    const fenced = '```json\n' + mockTradeJson() + '\n```';
    expect(parseAiResponse(fenced).action).toBe('trade');
  });

  it('handles prose around JSON', () => {
    const withProse = 'Here is my analysis:\n\n' + mockTradeJson() + '\n\nLet me explain further...';
    expect(parseAiResponse(withProse).action).toBe('trade');
  });

  it('rejects completely invalid text', () => {
    expect(() => parseAiResponse('No JSON here whatsoever')).toThrow();
  });

  it('rejects invalid action value', () => {
    expect(() => parseAiResponse(mockTradeJson({ action: 'yolo' }))).toThrow();
  });

  it('rejects confidence > 1', () => {
    expect(() => parseAiResponse(mockTradeJson({ confidence: 1.5 }))).toThrow();
  });

  it('rejects confidence < 0', () => {
    expect(() => parseAiResponse(mockTradeJson({ confidence: -0.1 }))).toThrow();
  });

  it('rejects empty reasoning', () => {
    expect(() => parseAiResponse(mockTradeJson({ reasoning: '' }))).toThrow();
  });

  it('rejects missing reasoning', () => {
    const obj = JSON.parse(mockTradeJson());
    delete obj.reasoning;
    expect(() => parseAiResponse(JSON.stringify(obj))).toThrow();
  });
});

// ── Deterministic Fallback ───────────────────────────────────────────────────

describe('Decision Pipeline – Deterministic Fallback', () => {
  it('returns hold for low composite', () => {
    const scores: ScoredDimensions = {
      a: { value: 40, label: 'LOW', detail: '' },
      b: { value: 45, label: 'LOW', detail: '' },
      c: { value: 50, label: 'NEUTRAL', detail: '' },
    };
    const result = deterministicFallback(scores, 'crypto');
    expect(result.action).toBe('hold');
    expect(result.fallback).toBe(true);
    expect(result.confidence).toBeLessThanOrEqual(0.5);
  });

  it('returns trade for high composite with 3+ scorers', () => {
    const scores: ScoredDimensions = {
      a: { value: 80, label: 'HIGH', detail: '' },
      b: { value: 75, label: 'HIGH', detail: '' },
      c: { value: 78, label: 'HIGH', detail: '' },
    };
    const result = deterministicFallback(scores, 'crypto');
    expect(result.action).toBe('trade');
    expect(result.direction).toBe('buy');
    expect(result.confidence).toBeLessThanOrEqual(0.5);
    expect(result.fallback).toBe(true);
  });

  it('returns hold with < 3 scorers even if composite is high', () => {
    const scores: ScoredDimensions = {
      a: { value: 90, label: 'VERY_HIGH', detail: '' },
      b: { value: 95, label: 'VERY_HIGH', detail: '' },
    };
    expect(deterministicFallback(scores, 'crypto').action).toBe('hold');
  });

  it('returns hold on empty scores', () => {
    expect(deterministicFallback({}, 'crypto').action).toBe('hold');
  });

  it('includes reasoning text', () => {
    const result = deterministicFallback(
      { a: { value: 50, label: 'NEUTRAL', detail: '' } },
      'crypto',
    );
    expect(result.reasoning).toContain('fallback');
  });
});

// ── AI Decision Persistence ──────────────────────────────────────────────────

describe('Decision Pipeline – Persistence', () => {
  it('stores trade decision in DB', async () => {
    const market = await seedMarket();

    const decision = await aiDecisionService.create({
      market_id: market.id,
      category: 'crypto',
      action: 'trade',
      direction: 'buy',
      outcome_token: 'Yes',
      confidence: '0.75',
      size_hint: '0.30',
      estimated_edge: '0.050000',
      fair_value: '0.6500',
      reasoning: 'Mocked AI decision for E2E test',
      regime_assessment: 'trending',
      model_used: 'claude-sonnet-4-6',
      latency_ms: 850,
      tokens_used: 2500,
      prompt_version: 'v1.0.0',
      dashboard_text: 'test dashboard',
      account_state: { balance: 10000 } as Prisma.InputJsonValue,
    } as Prisma.AiDecisionUncheckedCreateInput);

    expect(decision.id).toBeTruthy();
    expect(decision.action).toBe('trade');
    expect(Number(decision.confidence)).toBeCloseTo(0.75);

    // Retrieve by ID
    const retrieved = await aiDecisionService.findById(decision.id);
    expect(retrieved.market_id).toBe(market.id);
    expect(retrieved.reasoning).toContain('Mocked AI');
  });

  it('stores hold decision in DB', async () => {
    const market = await seedMarket();

    const decision = await aiDecisionService.create({
      market_id: market.id,
      category: 'crypto',
      action: 'hold',
      confidence: '0.30',
      reasoning: 'No edge detected',
      dashboard_text: 'test',
      account_state: {} as Prisma.InputJsonValue,
      model_used: 'fallback',
    } as Prisma.AiDecisionUncheckedCreateInput);

    expect(decision.action).toBe('hold');
    expect(decision.was_executed).toBe(false);
  });

  it('marks decision as vetoed', async () => {
    const market = await seedMarket();

    const decision = await aiDecisionService.create({
      market_id: market.id,
      category: 'crypto',
      action: 'trade',
      direction: 'buy',
      confidence: '0.72',
      reasoning: 'Test',
      dashboard_text: 'test',
      account_state: {} as Prisma.InputJsonValue,
      model_used: 'test',
    } as Prisma.AiDecisionUncheckedCreateInput);

    const vetoed = await aiDecisionService.markVetoed(decision.id, 'DRAWDOWN_LIMIT');
    expect(vetoed.was_executed).toBe(false);
    expect(vetoed.veto_reason).toBe('DRAWDOWN_LIMIT');
  });

  it('marks decision as executed with order_id', async () => {
    const market = await seedMarket();

    const decision = await aiDecisionService.create({
      market_id: market.id,
      category: 'crypto',
      action: 'trade',
      direction: 'buy',
      confidence: '0.72',
      reasoning: 'Test',
      dashboard_text: 'test',
      account_state: {} as Prisma.InputJsonValue,
      model_used: 'test',
    } as Prisma.AiDecisionUncheckedCreateInput);

    // Create a fake order to link
    const order = await prisma.order.create({
      data: {
        market_id: market.id,
        decision_id: decision.id,
        side: 'buy',
        outcome_token: 'Yes',
        order_type: 'limit',
        price: '0.650000',
        size: '50.000000',
        status: 'filled',
      },
    });

    const executed = await aiDecisionService.markExecuted(decision.id, order.id);
    expect(executed.was_executed).toBe(true);
    expect(executed.order_id).toBe(order.id);
  });

  it('getStats returns correct aggregates', async () => {
    const market = await seedMarket();

    // Create mix of trade/hold decisions
    for (let i = 0; i < 3; i++) {
      await aiDecisionService.create({
        market_id: market.id,
        category: 'crypto',
        action: 'trade',
        confidence: '0.70',
        reasoning: `Trade ${i}`,
        dashboard_text: 'test',
        account_state: {} as Prisma.InputJsonValue,
        model_used: 'test',
      } as Prisma.AiDecisionUncheckedCreateInput);
    }
    for (let i = 0; i < 2; i++) {
      await aiDecisionService.create({
        market_id: market.id,
        category: 'crypto',
        action: 'hold',
        confidence: '0.30',
        reasoning: `Hold ${i}`,
        dashboard_text: 'test',
        account_state: {} as Prisma.InputJsonValue,
        model_used: 'test',
      } as Prisma.AiDecisionUncheckedCreateInput);
    }

    const stats = await aiDecisionService.getStats();
    expect(stats.total).toBe(5);
    expect(stats.tradeCount).toBe(3);
    expect(stats.holdCount).toBe(2);
    expect(stats.avgConfidence).not.toBeNull();
  });
});
