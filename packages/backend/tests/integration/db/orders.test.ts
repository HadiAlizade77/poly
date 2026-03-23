import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { prisma, cleanDatabase, marketInput } from './db-helpers.js';

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function seedMarket() {
  return prisma.market.create({ data: marketInput() });
}

function orderData(marketId: string, overrides = {}) {
  return {
    market_id: marketId,
    side: 'buy' as const,
    outcome_token: 'yes-token',
    order_type: 'limit' as const,
    price: 0.65,
    size: 100,
    ...overrides,
  };
}

// ─── CREATE ──────────────────────────────────────────────────────────────────

describe('Order CREATE', () => {
  it('creates a pending buy order with defaults', async () => {
    const market = await seedMarket();

    const order = await prisma.order.create({ data: orderData(market.id) });

    expect(order.id).toBeTruthy();
    expect(order.status).toBe('pending');         // default
    expect(order.filled_size.toNumber()).toBe(0); // default
    expect(order.fees_paid.toNumber()).toBe(0);   // default
    expect(order.side).toBe('buy');
  });

  it('creates an order linked to a decision', async () => {
    const market = await seedMarket();
    const decision = await prisma.aiDecision.create({
      data: {
        market_id: market.id,
        category: 'crypto',
        dashboard_text: 'x',
        account_state: {},
        action: 'trade',
        confidence: 0.7,
        reasoning: 'edge detected',
      },
    });

    const order = await prisma.order.create({
      data: orderData(market.id, { decision_id: decision.id }),
    });

    expect(order.decision_id).toBe(decision.id);
  });

  it('rejects order with non-existent market_id', async () => {
    await expect(
      prisma.order.create({
        data: orderData('00000000-0000-0000-0000-000000000000'),
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });
});

// ─── READ ────────────────────────────────────────────────────────────────────

describe('Order READ', () => {
  it('finds orders by market_id', async () => {
    const m1 = await seedMarket();
    const m2 = await prisma.market.create({ data: marketInput() });

    await prisma.order.createMany({
      data: [orderData(m1.id), orderData(m1.id), orderData(m2.id)],
    });

    const m1Orders = await prisma.order.findMany({ where: { market_id: m1.id } });
    expect(m1Orders.length).toBe(2);
  });

  it('filters orders by status', async () => {
    const market = await seedMarket();

    const pendingOrder = await prisma.order.create({ data: orderData(market.id) });
    const openOrder = await prisma.order.create({ data: orderData(market.id) });
    await prisma.order.update({ where: { id: openOrder.id }, data: { status: 'open' } });

    const pending = await prisma.order.findMany({ where: { status: 'pending' } });
    const open = await prisma.order.findMany({ where: { status: 'open' } });

    expect(pending.some((o) => o.id === pendingOrder.id)).toBe(true);
    expect(open.some((o) => o.id === openOrder.id)).toBe(true);
  });

  it('paginates orders by created_at desc', async () => {
    const market = await seedMarket();
    await Promise.all(Array.from({ length: 4 }, () => prisma.order.create({ data: orderData(market.id) })));

    const page1 = await prisma.order.findMany({ take: 2, skip: 0, orderBy: { created_at: 'desc' } });
    const page2 = await prisma.order.findMany({ take: 2, skip: 2, orderBy: { created_at: 'desc' } });

    expect(page1.length).toBe(2);
    expect(page2.length).toBe(2);
    expect(new Set([...page1.map((o) => o.id), ...page2.map((o) => o.id)]).size).toBe(4);
  });
});

// ─── UPDATE ──────────────────────────────────────────────────────────────────

describe('Order UPDATE', () => {
  it('transitions status from pending → filled', async () => {
    const market = await seedMarket();
    const order = await prisma.order.create({ data: orderData(market.id) });

    const updated = await prisma.order.update({
      where: { id: order.id },
      data: {
        status: 'filled',
        filled_size: 100,
        avg_fill_price: 0.651,
        filled_at: new Date(),
      },
    });

    expect(updated.status).toBe('filled');
    expect(updated.filled_size.toNumber()).toBe(100);
    expect(updated.filled_at).toBeInstanceOf(Date);
  });

  it('records a polymarket order id after placement', async () => {
    const market = await seedMarket();
    const order = await prisma.order.create({ data: orderData(market.id) });

    const updated = await prisma.order.update({
      where: { id: order.id },
      data: { polymarket_order_id: 'ext-order-abc123', status: 'open' },
    });

    expect(updated.polymarket_order_id).toBe('ext-order-abc123');
  });

  it('records cancellation timestamp', async () => {
    const market = await seedMarket();
    const order = await prisma.order.create({ data: orderData(market.id) });
    const cancelTime = new Date();

    const updated = await prisma.order.update({
      where: { id: order.id },
      data: { status: 'cancelled', cancelled_at: cancelTime },
    });

    expect(updated.status).toBe('cancelled');
    expect(updated.cancelled_at).toBeInstanceOf(Date);
  });
});

// ─── DELETE ──────────────────────────────────────────────────────────────────

describe('Order DELETE', () => {
  it('deletes an order', async () => {
    const market = await seedMarket();
    const order = await prisma.order.create({ data: orderData(market.id) });

    await prisma.order.delete({ where: { id: order.id } });

    expect(await prisma.order.findUnique({ where: { id: order.id } })).toBeNull();
  });
});
