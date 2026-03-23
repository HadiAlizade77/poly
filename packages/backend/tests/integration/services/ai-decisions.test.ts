import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as AiDecisionService from '../../../src/services/ai-decision.service.js';
import { NotFoundError } from '../../../src/services/errors.js';
import { prisma, uid, mkMarketInput, deleteTestMarkets, cleanDatabase } from './helpers.js';

const PREFIX = 'test-ai-svc-';

let marketId: string;

beforeAll(async () => {
  await cleanDatabase();
  const m = await prisma.market.create({
    data: mkMarketInput(`${PREFIX}main-${uid()}`),
  });
  marketId = m.id;
});

afterAll(async () => {
  await deleteTestMarkets(PREFIX);
  await prisma.$disconnect();
});

function decisionInput(overrides = {}) {
  return {
    market_id: marketId,
    category: 'crypto',
    dashboard_text: 'Test decision',
    account_state: { balance: 10000 },
    action: 'trade' as const,
    direction: 'Yes',
    outcome_token: 'yes-token',
    confidence: 0.72,
    reasoning: 'Edge detected.',
    ...overrides,
  };
}

// ─── create ──────────────────────────────────────────────────────────────────

describe('AiDecisionService.create', () => {
  it('creates a trade decision', async () => {
    const d = await AiDecisionService.create(decisionInput());

    expect(d.id).toBeTruthy();
    expect(d.action).toBe('trade');
    expect(d.was_executed).toBe(false);
    expect(Number(d.confidence)).toBeCloseTo(0.72);
    expect(d.market_id).toBe(marketId);
  });

  it('creates a hold decision with no direction', async () => {
    const d = await AiDecisionService.create(
      decisionInput({
        action: 'hold',
        direction: null,
        outcome_token: null,
        confidence: 0.3,
        reasoning: 'No edge.',
      }),
    );

    expect(d.action).toBe('hold');
    expect(d.direction).toBeNull();
  });
});

// ─── findById ─────────────────────────────────────────────────────────────────

describe('AiDecisionService.findById', () => {
  it('returns decision by bigint id', async () => {
    const created = await AiDecisionService.create(decisionInput());
    const found = await AiDecisionService.findById(created.id);

    expect(found.id).toBe(created.id);
    expect(found.category).toBe('crypto');
  });

  it('throws NotFoundError for unknown id', async () => {
    await expect(AiDecisionService.findById(BigInt(999999999))).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

// ─── findMany (filters + pagination) ─────────────────────────────────────────

describe('AiDecisionService.findMany', () => {
  it('returns paginated result', async () => {
    const result = await AiDecisionService.findMany({}, { page: 1, pageSize: 5 });

    expect(Array.isArray(result.items)).toBe(true);
    expect(result.items.length).toBeLessThanOrEqual(5);
    expect(result).toHaveProperty('total');
    expect(result).toHaveProperty('totalPages');
  });

  it('filters by action=trade', async () => {
    await AiDecisionService.create(decisionInput({ action: 'trade' }));

    const result = await AiDecisionService.findMany({ action: 'trade' });
    expect(result.items.every((d) => d.action === 'trade')).toBe(true);
    expect(result.total).toBeGreaterThanOrEqual(1);
  });

  it('filters by action=hold', async () => {
    await AiDecisionService.create(
      decisionInput({ action: 'hold', direction: null, outcome_token: null }),
    );

    const result = await AiDecisionService.findMany({ action: 'hold' });
    expect(result.items.every((d) => d.action === 'hold')).toBe(true);
  });

  it('filters by marketId', async () => {
    const result = await AiDecisionService.findMany({ marketId });
    expect(result.items.every((d) => d.market_id === marketId)).toBe(true);
  });

  it('filters by wasExecuted=false', async () => {
    const result = await AiDecisionService.findMany({ wasExecuted: false });
    expect(result.items.every((d) => d.was_executed === false)).toBe(true);
  });

  it('filters by date range (since/until)', async () => {
    const since = new Date('2025-01-01');
    const until = new Date('2025-12-31');

    await AiDecisionService.create(decisionInput({ timestamp: new Date('2025-06-01') }));

    const result = await AiDecisionService.findMany({ since, until });
    result.items.forEach((d) => {
      expect(new Date(d.timestamp) >= since).toBe(true);
      expect(new Date(d.timestamp) <= until).toBe(true);
    });
  });

  it('paginates to page 2', async () => {
    // Create records with distinct timestamps for stable ordering
    for (let i = 0; i < 3; i++) {
      await AiDecisionService.create(
        decisionInput({ timestamp: new Date(Date.now() + i * 1000) }),
      );
    }

    const page1 = await AiDecisionService.findMany({}, { page: 1, pageSize: 2 });
    const page2 = await AiDecisionService.findMany({}, { page: 2, pageSize: 2 });

    expect(page1.page).toBe(1);
    expect(page2.page).toBe(2);
    expect(page1.total).toBeGreaterThanOrEqual(5);
    expect(page1.items.length).toBeLessThanOrEqual(2);
  });
});

// ─── markExecuted ─────────────────────────────────────────────────────────────

describe('AiDecisionService.markExecuted', () => {
  it('sets was_executed=true and links to an order', async () => {
    const decision = await AiDecisionService.create(decisionInput());

    // Create a real order to satisfy the FK
    const order = await prisma.order.create({
      data: {
        market_id: marketId,
        side: 'buy',
        outcome_token: 'yes-token',
        order_type: 'limit',
        price: 0.65,
        size: 100,
      },
    });

    const updated = await AiDecisionService.markExecuted(decision.id, order.id);

    expect(updated.was_executed).toBe(true);
    expect(updated.order_id).toBe(order.id);
  });
});

// ─── markVetoed ───────────────────────────────────────────────────────────────

describe('AiDecisionService.markVetoed', () => {
  it('sets veto_reason and keeps was_executed=false', async () => {
    const decision = await AiDecisionService.create(decisionInput());

    const updated = await AiDecisionService.markVetoed(
      decision.id,
      'Risk governor: daily drawdown limit exceeded',
    );

    expect(updated.was_executed).toBe(false);
    expect(updated.veto_reason).toBe('Risk governor: daily drawdown limit exceeded');
  });
});

// ─── getStats ─────────────────────────────────────────────────────────────────

describe('AiDecisionService.getStats', () => {
  it('returns aggregate statistics', async () => {
    const stats = await AiDecisionService.getStats();

    expect(typeof stats.total).toBe('number');
    expect(typeof stats.trades).toBe('number');
    expect(typeof stats.holds).toBe('number');
    expect(stats.trades + stats.holds).toBe(stats.total);
    expect(typeof stats.executed).toBe('number');
    expect(typeof stats.vetoed).toBe('number');
    // avg_confidence is null or a number
    expect(stats.avg_confidence === null || typeof stats.avg_confidence === 'number').toBe(true);
  });
});
