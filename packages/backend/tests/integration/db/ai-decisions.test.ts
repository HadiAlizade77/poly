import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { prisma, cleanDatabase, marketInput } from './db-helpers.js';

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function seedMarket() {
  return prisma.market.create({ data: marketInput({ category: 'crypto' }) });
}

function decisionData(marketId: string, overrides = {}) {
  return {
    market_id: marketId,
    category: 'crypto',
    dashboard_text: 'Test decision',
    account_state: { balance: 10000 },
    action: 'trade' as const,
    direction: 'Yes',
    outcome_token: 'yes-token',
    confidence: 0.72,
    reasoning: 'Strong edge detected.',
    ...overrides,
  };
}

// ─── CREATE ──────────────────────────────────────────────────────────────────

describe('AiDecision CREATE', () => {
  it('creates a trade decision with full fields', async () => {
    const market = await seedMarket();

    const decision = await prisma.aiDecision.create({
      data: decisionData(market.id, {
        size_hint: 0.25,
        estimated_edge: 0.05,
        estimated_cost: 0.025,
        fair_value: 0.70,
        market_price: 0.65,
        regime_assessment: 'trending',
        regime_confidence: 0.80,
        model_used: 'claude-sonnet-4-6',
        latency_ms: 1200,
        tokens_used: 3500,
      }),
    });

    expect(decision.id).toBeTruthy();
    expect(decision.action).toBe('trade');
    expect(decision.was_executed).toBe(false);
    expect(decision.confidence.toNumber()).toBeCloseTo(0.72);
    expect(decision.regime_assessment).toBe('trending');
  });

  it('creates a hold decision without trade fields', async () => {
    const market = await seedMarket();

    const decision = await prisma.aiDecision.create({
      data: {
        market_id: market.id,
        category: 'crypto',
        dashboard_text: 'Insufficient edge.',
        account_state: {},
        action: 'hold',
        confidence: 0.30,
        reasoning: 'No actionable edge at current price.',
      },
    });

    expect(decision.action).toBe('hold');
    expect(decision.direction).toBeNull();
    expect(decision.outcome_token).toBeNull();
  });

  it('rejects decision with non-existent market_id', async () => {
    await expect(
      prisma.aiDecision.create({
        data: {
          market_id: '00000000-0000-0000-0000-000000000000',
          category: 'crypto',
          dashboard_text: 'x',
          account_state: {},
          action: 'hold',
          confidence: 0.5,
          reasoning: 'x',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });
});

// ─── READ ────────────────────────────────────────────────────────────────────

describe('AiDecision READ', () => {
  it('finds decision by id', async () => {
    const market = await seedMarket();
    const created = await prisma.aiDecision.create({ data: decisionData(market.id) });

    const found = await prisma.aiDecision.findUnique({ where: { id: created.id } });
    expect(found?.id).toBe(created.id);
    expect(found?.category).toBe('crypto');
  });

  it('filters decisions by action', async () => {
    const market = await seedMarket();

    await prisma.aiDecision.createMany({
      data: [
        decisionData(market.id, { action: 'trade' }),
        decisionData(market.id, { action: 'hold', direction: null, outcome_token: null }),
        decisionData(market.id, { action: 'trade' }),
      ],
    });

    const trades = await prisma.aiDecision.findMany({ where: { action: 'trade' } });
    const holds = await prisma.aiDecision.findMany({ where: { action: 'hold' } });

    expect(trades.length).toBe(2);
    expect(holds.length).toBe(1);
  });

  it('filters decisions by market_id', async () => {
    const m1 = await seedMarket();
    const m2 = await prisma.market.create({ data: marketInput() });

    await prisma.aiDecision.create({ data: decisionData(m1.id) });
    await prisma.aiDecision.create({ data: decisionData(m1.id) });
    await prisma.aiDecision.create({ data: decisionData(m2.id) });

    const m1Decisions = await prisma.aiDecision.findMany({ where: { market_id: m1.id } });
    expect(m1Decisions.length).toBe(2);
  });

  it('filters decisions by was_executed', async () => {
    const market = await seedMarket();
    await prisma.aiDecision.create({ data: decisionData(market.id, { was_executed: false }) });
    await prisma.aiDecision.create({ data: decisionData(market.id, { was_executed: true }) });

    const executed = await prisma.aiDecision.findMany({ where: { was_executed: true } });
    expect(executed.length).toBe(1);
  });

  it('paginates decisions', async () => {
    const market = await seedMarket();

    await Promise.all(
      Array.from({ length: 5 }, () =>
        prisma.aiDecision.create({ data: decisionData(market.id) }),
      ),
    );

    const page = await prisma.aiDecision.findMany({
      take: 3,
      skip: 0,
      orderBy: { timestamp: 'desc' },
    });
    expect(page.length).toBe(3);
  });
});

// ─── UPDATE ──────────────────────────────────────────────────────────────────

describe('AiDecision UPDATE', () => {
  it('marks a decision as executed with a veto reason', async () => {
    const market = await seedMarket();
    const decision = await prisma.aiDecision.create({ data: decisionData(market.id) });

    const updated = await prisma.aiDecision.update({
      where: { id: decision.id },
      data: { was_executed: false, veto_reason: 'Risk governor blocked: drawdown limit' },
    });

    expect(updated.was_executed).toBe(false);
    expect(updated.veto_reason).toBe('Risk governor blocked: drawdown limit');
  });

  it('sets cycle_number and model_used', async () => {
    const market = await seedMarket();
    const decision = await prisma.aiDecision.create({ data: decisionData(market.id) });

    const updated = await prisma.aiDecision.update({
      where: { id: decision.id },
      data: { cycle_number: 42, model_used: 'claude-opus-4-6' },
    });

    expect(updated.cycle_number).toBe(42);
    expect(updated.model_used).toBe('claude-opus-4-6');
  });
});

// ─── DELETE ──────────────────────────────────────────────────────────────────

describe('AiDecision DELETE', () => {
  it('deletes a decision', async () => {
    const market = await seedMarket();
    const decision = await prisma.aiDecision.create({ data: decisionData(market.id) });

    await prisma.aiDecision.delete({ where: { id: decision.id } });

    expect(await prisma.aiDecision.findUnique({ where: { id: decision.id } })).toBeNull();
  });
});
