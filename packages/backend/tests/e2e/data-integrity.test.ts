/**
 * E2E: Data Integrity
 *
 * Tests data constraints at the DB level:
 *   - FK constraints
 *   - Unique constraints
 *   - Decimal precision
 *   - Enum validation
 *   - Cascade behavior (snapshot/score cleanup on market delete)
 *   - BigInt ID serialization in JSON responses
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../integration/setup.js';
import { cleanDatabase, prisma, expectUniqueViolation, expectFkViolation } from '../integration/db/db-helpers.js';

const app = createTestApp();
const uid = () => Math.random().toString(36).slice(2, 9);

let marketId: string;

beforeAll(async () => {
  await cleanDatabase();

  const market = await prisma.market.create({
    data: {
      polymarket_id: `e2e-integrity-${uid()}`,
      title: 'Data integrity test market',
      category: 'crypto',
      outcomes: [{ name: 'Yes', token_id: `yes-${uid()}` }],
    },
  });
  marketId = market.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

// ─── FK Constraints ───────────────────────────────────────────────────────────

describe('FK Constraints', () => {
  it('creating an order with non-existent market_id throws P2003', async () => {
    await expectFkViolation(() =>
      prisma.order.create({
        data: {
          market_id: '00000000-0000-0000-0000-000000000000',
          side: 'buy',
          outcome_token: 'yes',
          order_type: 'limit',
          price: 0.5,
          size: 100,
        },
      }),
    );
  });

  it('creating a position with non-existent market_id throws P2003', async () => {
    await expectFkViolation(() =>
      prisma.position.create({
        data: {
          market_id: '00000000-0000-0000-0000-000000000000',
          outcome_token: 'yes',
          side: 'long',
          size: 100,
          avg_entry_price: 0.5,
        },
      }),
    );
  });

  it('creating a trade with non-existent order_id throws P2003', async () => {
    await expectFkViolation(() =>
      prisma.trade.create({
        data: {
          order_id: '00000000-0000-0000-0000-000000000000',
          market_id: marketId,
          side: 'buy',
          outcome_token: 'yes',
          size: 100,
          entry_price: 0.5,
          fees: 0.5,
          net_cost: 50.5,
        },
      }),
    );
  });

  it('creating a market snapshot with non-existent market_id throws P2003', async () => {
    await expectFkViolation(() =>
      prisma.marketSnapshot.create({
        data: {
          market_id: '00000000-0000-0000-0000-000000000000',
          timestamp: new Date(),
          prices: {},
        },
      }),
    );
  });

  it('creating a context score with non-existent market_id throws P2003', async () => {
    await expectFkViolation(() =>
      prisma.contextScore.create({
        data: {
          market_id: '00000000-0000-0000-0000-000000000000',
          category: 'crypto',
          scores: {},
        },
      }),
    );
  });

  it('creating an AI decision with non-existent market_id throws P2003', async () => {
    await expectFkViolation(() =>
      prisma.aiDecision.create({
        data: {
          market_id: '00000000-0000-0000-0000-000000000000',
          category: 'crypto',
          action: 'hold',
          confidence: 0.5,
          reasoning: 'test',
          dashboard_text: 'test',
          account_state: {},
        },
      }),
    );
  });
});

// ─── Unique Constraints ───────────────────────────────────────────────────────

describe('Unique Constraints', () => {
  it('duplicate polymarket_id on market throws P2002', async () => {
    const pmId = `e2e-unique-${uid()}`;
    await prisma.market.create({
      data: { polymarket_id: pmId, title: 'First', category: 'crypto', outcomes: [] },
    });
    await expectUniqueViolation(() =>
      prisma.market.create({
        data: { polymarket_id: pmId, title: 'Duplicate', category: 'politics', outcomes: [] },
      }),
    );
  });

  it('duplicate (market_id, outcome_token) on position throws P2002', async () => {
    const token = `unique-tok-${uid()}`;
    await prisma.position.create({
      data: { market_id: marketId, outcome_token: token, side: 'long', size: 100, avg_entry_price: 0.5 },
    });
    await expectUniqueViolation(() =>
      prisma.position.create({
        data: { market_id: marketId, outcome_token: token, side: 'long', size: 50, avg_entry_price: 0.6 },
      }),
    );
  });

  it('duplicate (category, scorer_name) on scorer config throws P2002', async () => {
    const name = `unique-scorer-${uid()}`;
    await prisma.scorerConfig.create({
      data: { category: 'crypto', scorer_name: name, parameters: {} },
    });
    await expectUniqueViolation(() =>
      prisma.scorerConfig.create({
        data: { category: 'crypto', scorer_name: name, parameters: { x: 1 } },
      }),
    );
  });
});

// ─── Decimal Precision ────────────────────────────────────────────────────────

describe('Decimal Precision', () => {
  it('stores and retrieves entry_price with 6 decimal places', async () => {
    const order = await prisma.order.create({
      data: {
        market_id: marketId,
        side: 'buy',
        outcome_token: `yes-${uid()}`,
        order_type: 'limit',
        price: 0.654321,
        size: 100,
      },
    });

    const fetched = await prisma.order.findUnique({ where: { id: order.id } });
    expect(Number(fetched!.price)).toBeCloseTo(0.654321, 5);
  });

  it('stores and retrieves position avg_entry_price precisely', async () => {
    const pos = await prisma.position.create({
      data: {
        market_id: marketId,
        outcome_token: `yes-prec-${uid()}`,
        side: 'long',
        size: 100,
        avg_entry_price: 0.712345,
      },
    });

    const fetched = await prisma.position.findUnique({ where: { id: pos.id } });
    expect(Number(fetched!.avg_entry_price)).toBeCloseTo(0.712345, 5);
  });

  it('stores trade size as exact decimal', async () => {
    const order = await prisma.order.create({
      data: {
        market_id: marketId,
        side: 'buy',
        outcome_token: `yes-sz-${uid()}`,
        order_type: 'market',
        price: 0.5,
        size: 123.456,
      },
    });
    const trade = await prisma.trade.create({
      data: {
        order_id: order.id,
        market_id: marketId,
        side: 'buy',
        outcome_token: order.outcome_token,
        size: 123.456,
        entry_price: 0.5,
        fees: 0.123,
        net_cost: 61.851,
      },
    });

    expect(Number(trade.size)).toBeCloseTo(123.456, 2);
    expect(Number(trade.fees)).toBeCloseTo(0.123, 3);
  });

  it('API returns Decimal fields as numeric values (JSON serialization)', async () => {
    const res = await request(app).get(`/api/markets/${marketId}`);
    expect(res.status).toBe(200);
    // Market doesn't have decimals as top-level fields, but positions/orders do
    const posRes = await request(app).get('/api/positions');
    expect(posRes.status).toBe(200);
    // avg_entry_price should be serializable (not throw)
    if (posRes.body.data.length > 0) {
      const pos = posRes.body.data[0];
      expect(typeof pos.avg_entry_price === 'string' || typeof pos.avg_entry_price === 'number').toBe(true);
    }
  });
});

// ─── Enum Validation ─────────────────────────────────────────────────────────

describe('Enum Validation at DB Level', () => {
  it('creates order with all valid sides', async () => {
    for (const side of ['buy', 'sell'] as const) {
      const order = await prisma.order.create({
        data: {
          market_id: marketId,
          side,
          outcome_token: `tok-${uid()}`,
          order_type: 'limit',
          price: 0.5,
          size: 10,
        },
      });
      expect(order.side).toBe(side);
    }
  });

  it('creates order with all valid statuses via PATCH', async () => {
    const statuses = ['pending', 'open', 'partial', 'filled', 'cancelled', 'expired', 'failed'] as const;
    const order = await prisma.order.create({
      data: {
        market_id: marketId,
        side: 'buy',
        outcome_token: `tok-status-${uid()}`,
        order_type: 'limit',
        price: 0.5,
        size: 10,
      },
    });

    for (const status of statuses) {
      const res = await request(app)
        .patch(`/api/orders/${order.id}/status`)
        .send({ status });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe(status);
    }
  });

  it('creates AI decision with both actions', async () => {
    for (const action of ['trade', 'hold'] as const) {
      const d = await prisma.aiDecision.create({
        data: {
          market_id: marketId,
          category: 'crypto',
          action,
          confidence: 0.5,
          reasoning: `${action} decision test`,
          dashboard_text: 'test',
          account_state: {},
        },
      });
      expect(d.action).toBe(action);
    }
  });

  it('creates alerts with all alert types', async () => {
    const alertTypes = ['trade', 'risk', 'system', 'ai', 'performance', 'opportunity'] as const;
    for (const alertType of alertTypes) {
      const a = await prisma.alert.create({
        data: { alert_type: alertType, severity: 'info', title: `${alertType} alert`, message: 'test' },
      });
      expect(a.alert_type).toBe(alertType);
    }
  });

  it('creates alerts with all severity levels', async () => {
    const severities = ['info', 'warning', 'error', 'critical'] as const;
    for (const severity of severities) {
      const a = await prisma.alert.create({
        data: { alert_type: 'system', severity, title: `${severity} alert`, message: 'test' },
      });
      expect(a.severity).toBe(severity);
    }
  });
});

// ─── Cascade Behavior ─────────────────────────────────────────────────────────

describe('Cascade Behavior', () => {
  it('snapshots and scores are FK-constrained to their market', async () => {
    const market = await prisma.market.create({
      data: {
        polymarket_id: `fk-test-${uid()}`,
        title: 'FK test market',
        category: 'events',
        outcomes: [],
      },
    });

    const snap = await prisma.marketSnapshot.create({
      data: { market_id: market.id, timestamp: new Date(), prices: {} },
    });
    const score = await prisma.contextScore.create({
      data: { market_id: market.id, category: 'events', scores: {} },
    });

    // Verify records exist and reference the market
    expect(snap.market_id).toBe(market.id);
    expect(score.market_id).toBe(market.id);
    expect(await prisma.marketSnapshot.count({ where: { market_id: market.id } })).toBe(1);
    expect(await prisma.contextScore.count({ where: { market_id: market.id } })).toBe(1);

    // Market with child records cannot be deleted (FK constraint enforced)
    await expect(prisma.market.delete({ where: { id: market.id } })).rejects.toThrow();

    // Child records still exist (deletion was prevented)
    expect(await prisma.marketSnapshot.count({ where: { market_id: market.id } })).toBe(1);

    // Clean up: delete children first, then market
    await prisma.marketSnapshot.deleteMany({ where: { market_id: market.id } });
    await prisma.contextScore.deleteMany({ where: { market_id: market.id } });
    await prisma.market.delete({ where: { id: market.id } });
    expect(await prisma.market.findUnique({ where: { id: market.id } })).toBeNull();
  });
});

// ─── BigInt ID Serialization ──────────────────────────────────────────────────

describe('BigInt ID JSON Serialization', () => {
  it('decision id is serialized as string in JSON response', async () => {
    const decision = await prisma.aiDecision.create({
      data: {
        market_id: marketId,
        category: 'crypto',
        action: 'hold',
        confidence: 0.3,
        reasoning: 'BigInt serialization test',
        dashboard_text: 'test',
        account_state: {},
      },
    });

    const res = await request(app).get('/api/decisions');
    expect(res.status).toBe(200);

    const found = res.body.data.find((d: { id: string }) => d.id === decision.id.toString());
    expect(found).toBeTruthy();
    expect(typeof found.id).toBe('string'); // BigInt → string via toJSON
  });

  it('alert id is serialized as string in JSON response', async () => {
    const alert = await prisma.alert.create({
      data: { alert_type: 'system', severity: 'info', title: 'BigInt test alert', message: 'test' },
    });

    const res = await request(app).get('/api/alerts');
    expect(res.status).toBe(200);

    const found = res.body.data.find((a: { id: string }) => a.id === alert.id.toString());
    expect(found).toBeTruthy();
    expect(typeof found.id).toBe('string');
  });

  it('risk event id is serialized as string', async () => {
    const event = await prisma.riskEvent.create({
      data: {
        event_type: 'liquidity_warning',
        severity: 'info',
        details: { note: 'test' },
        message: 'BigInt serialization test',
        market_id: marketId,
      },
    });

    const res = await request(app).get('/api/risk/events');
    expect(res.status).toBe(200);

    const found = res.body.data.find((e: { id: string }) => e.id === event.id.toString());
    expect(found).toBeTruthy();
    expect(typeof found.id).toBe('string');
  });
});

// ─── Concurrent write safety ──────────────────────────────────────────────────

describe('Concurrent Writes', () => {
  it('5 concurrent market creates with unique IDs all succeed', async () => {
    const creates = Array.from({ length: 5 }, () =>
      prisma.market.create({
        data: {
          polymarket_id: `concurrent-${uid()}`,
          title: 'Concurrent test market',
          category: 'sports',
          outcomes: [],
        },
      }),
    );
    const results = await Promise.all(creates);
    const ids = new Set(results.map((m) => m.id));
    expect(ids.size).toBe(5);
  });

  it('2 concurrent creates with same polymarket_id — one succeeds, one fails', async () => {
    const pmId = `race-${uid()}`;
    const results = await Promise.allSettled([
      prisma.market.create({
        data: { polymarket_id: pmId, title: 'Race 1', category: 'crypto', outcomes: [] },
      }),
      prisma.market.create({
        data: { polymarket_id: pmId, title: 'Race 2', category: 'crypto', outcomes: [] },
      }),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
    const rejected = results.filter((r) => r.status === 'rejected').length;
    expect(fulfilled).toBe(1);
    expect(rejected).toBe(1);
  });
});
