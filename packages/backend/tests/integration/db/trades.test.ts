import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { prisma, cleanDatabase, marketInput } from './db-helpers.js';

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function seedMarketAndOrder() {
  const market = await prisma.market.create({ data: marketInput() });
  const order = await prisma.order.create({
    data: {
      market_id: market.id,
      side: 'buy',
      outcome_token: 'yes-token',
      order_type: 'limit',
      price: 0.65,
      size: 100,
    },
  });
  return { market, order };
}

function tradeData(orderId: string, marketId: string, overrides = {}) {
  return {
    order_id: orderId,
    market_id: marketId,
    side: 'buy' as const,
    outcome_token: 'yes-token',
    size: 100,
    entry_price: 0.651,
    fees: 0.5,
    net_cost: 65.6,
    ...overrides,
  };
}

// ─── CREATE ──────────────────────────────────────────────────────────────────

describe('Trade CREATE', () => {
  it('creates a trade linked to an order and market', async () => {
    const { market, order } = await seedMarketAndOrder();

    const trade = await prisma.trade.create({
      data: tradeData(order.id, market.id),
    });

    expect(trade.id).toBeTruthy();
    expect(trade.order_id).toBe(order.id);
    expect(trade.market_id).toBe(market.id);
    expect(trade.size.toNumber()).toBe(100);
    expect(trade.fees.toNumber()).toBe(0.5);
    expect(trade.executed_at).toBeInstanceOf(Date);
  });

  it('stores regime and confidence context at entry', async () => {
    const { market, order } = await seedMarketAndOrder();

    const trade = await prisma.trade.create({
      data: tradeData(order.id, market.id, {
        regime_at_entry: 'trending',
        confidence_at_entry: 0.72,
        edge_at_entry: 0.05,
      }),
    });

    expect(trade.regime_at_entry).toBe('trending');
    expect(trade.confidence_at_entry?.toNumber()).toBeCloseTo(0.72);
    expect(trade.edge_at_entry?.toNumber()).toBeCloseTo(0.05);
  });

  it('rejects trade with non-existent order_id', async () => {
    const { market } = await seedMarketAndOrder();

    await expect(
      prisma.trade.create({
        data: tradeData('00000000-0000-0000-0000-000000000000', market.id),
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('rejects trade with non-existent market_id', async () => {
    const { order } = await seedMarketAndOrder();

    await expect(
      prisma.trade.create({
        data: tradeData(order.id, '00000000-0000-0000-0000-000000000000'),
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });
});

// ─── READ ────────────────────────────────────────────────────────────────────

describe('Trade READ', () => {
  it('finds trades by market_id', async () => {
    const { market, order } = await seedMarketAndOrder();
    const { market: m2, order: o2 } = await seedMarketAndOrder();

    await prisma.trade.create({ data: tradeData(order.id, market.id) });
    await prisma.trade.create({ data: tradeData(order.id, market.id) });
    await prisma.trade.create({ data: tradeData(o2.id, m2.id) });

    const trades = await prisma.trade.findMany({ where: { market_id: market.id } });
    expect(trades.length).toBe(2);
  });

  it('finds trades by order_id', async () => {
    const { market, order } = await seedMarketAndOrder();

    await prisma.trade.createMany({
      data: [
        tradeData(order.id, market.id, { size: 50 }),
        tradeData(order.id, market.id, { size: 50 }),
      ],
    });

    const trades = await prisma.trade.findMany({ where: { order_id: order.id } });
    expect(trades.length).toBe(2);
  });

  it('paginates trades ordered by executed_at desc', async () => {
    const { market, order } = await seedMarketAndOrder();

    await Promise.all(
      Array.from({ length: 5 }, () =>
        prisma.trade.create({ data: tradeData(order.id, market.id) }),
      ),
    );

    const page1 = await prisma.trade.findMany({
      take: 3,
      skip: 0,
      orderBy: { executed_at: 'desc' },
    });
    expect(page1.length).toBe(3);
  });

  it('filters trades by side', async () => {
    const { market, order } = await seedMarketAndOrder();
    const sellOrder = await prisma.order.create({
      data: { market_id: market.id, side: 'sell', outcome_token: 'yes-token', order_type: 'limit', price: 0.80, size: 100 },
    });

    await prisma.trade.create({ data: tradeData(order.id, market.id, { side: 'buy' }) });
    await prisma.trade.create({ data: tradeData(sellOrder.id, market.id, { side: 'sell' }) });

    const buys = await prisma.trade.findMany({ where: { side: 'buy' } });
    const sells = await prisma.trade.findMany({ where: { side: 'sell' } });
    expect(buys.length).toBe(1);
    expect(sells.length).toBe(1);
  });
});

// ─── DELETE ──────────────────────────────────────────────────────────────────

describe('Trade DELETE', () => {
  it('deletes a trade', async () => {
    const { market, order } = await seedMarketAndOrder();
    const trade = await prisma.trade.create({ data: tradeData(order.id, market.id) });

    await prisma.trade.delete({ where: { id: trade.id } });

    expect(await prisma.trade.findUnique({ where: { id: trade.id } })).toBeNull();
  });
});
