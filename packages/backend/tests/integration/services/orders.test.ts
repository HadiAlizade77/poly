import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as OrderService from '../../../src/services/order.service.js';
import { NotFoundError } from '../../../src/services/errors.js';
import { prisma, uid, mkMarketInput, deleteTestMarkets, cleanDatabase } from './helpers.js';

const PREFIX = 'test-ord-svc-';

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

function orderInput(overrides = {}) {
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

// ─── create ──────────────────────────────────────────────────────────────────

describe('OrderService.create', () => {
  it('creates a buy order with defaults', async () => {
    const order = await OrderService.create(orderInput());

    expect(order.id).toBeTruthy();
    expect(order.market_id).toBe(marketId);
    expect(order.side).toBe('buy');
    expect(order.status).toBe('pending');
    expect(Number(order.filled_size)).toBe(0);
    expect(Number(order.fees_paid)).toBe(0);
  });

  it('creates a sell order', async () => {
    const order = await OrderService.create(orderInput({ side: 'sell', price: 0.80 }));

    expect(order.side).toBe('sell');
    expect(Number(order.price)).toBeCloseTo(0.80);
  });
});

// ─── findById ─────────────────────────────────────────────────────────────────

describe('OrderService.findById', () => {
  it('returns order by uuid', async () => {
    const created = await OrderService.create(orderInput());
    const found = await OrderService.findById(created.id);

    expect(found.id).toBe(created.id);
    expect(found.market_id).toBe(marketId);
  });

  it('throws NotFoundError for unknown id', async () => {
    await expect(
      OrderService.findById('00000000-0000-0000-0000-000000000000'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

// ─── findMany ─────────────────────────────────────────────────────────────────

describe('OrderService.findMany', () => {
  it('filters by marketId', async () => {
    await OrderService.create(orderInput());

    const result = await OrderService.findMany({ marketId });
    expect(result.items.every((o) => o.market_id === marketId)).toBe(true);
    expect(result.total).toBeGreaterThanOrEqual(1);
  });

  it('filters by status', async () => {
    const result = await OrderService.findMany({ status: 'pending' });
    expect(result.items.every((o) => o.status === 'pending')).toBe(true);
  });

  it('filters by side', async () => {
    await OrderService.create(orderInput({ side: 'sell' }));

    const buys = await OrderService.findMany({ side: 'buy' });
    const sells = await OrderService.findMany({ side: 'sell' });
    expect(buys.items.every((o) => o.side === 'buy')).toBe(true);
    expect(sells.items.every((o) => o.side === 'sell')).toBe(true);
  });

  it('paginates results', async () => {
    // Create sequentially to ensure distinct created_at timestamps for stable ordering
    for (let i = 0; i < 3; i++) {
      await OrderService.create(orderInput());
    }

    const page1 = await OrderService.findMany({}, { page: 1, pageSize: 2 });
    const page2 = await OrderService.findMany({}, { page: 2, pageSize: 2 });

    expect(page1.page).toBe(1);
    expect(page2.page).toBe(2);
    expect(page1.total).toBeGreaterThanOrEqual(5);
    expect(page1.items.length).toBeLessThanOrEqual(2);
  });
});

// ─── findOpen ─────────────────────────────────────────────────────────────────

describe('OrderService.findOpen', () => {
  it('returns pending, open, and partial orders', async () => {
    const pending = await OrderService.create(orderInput());
    const openOrder = await OrderService.create(orderInput());
    await OrderService.updateStatus(openOrder.id, 'open');

    const open = await OrderService.findOpen();

    expect(open.some((o) => o.id === pending.id)).toBe(true);
    expect(open.some((o) => o.id === openOrder.id)).toBe(true);
    expect(open.every((o) => ['pending', 'open', 'partial'].includes(o.status))).toBe(true);
  });
});

// ─── updateStatus ─────────────────────────────────────────────────────────────

describe('OrderService.updateStatus', () => {
  it('transitions to filled with fill data', async () => {
    const order = await OrderService.create(orderInput());

    const updated = await OrderService.updateStatus(order.id, 'filled', {
      polymarketOrderId: 'pm-ext-abc123',
      filledSize: '100',
      avgFillPrice: '0.651',
      filledAt: new Date(),
    });

    expect(updated.status).toBe('filled');
    expect(updated.polymarket_order_id).toBe('pm-ext-abc123');
    expect(Number(updated.filled_size)).toBe(100);
    expect(Number(updated.avg_fill_price)).toBeCloseTo(0.651);
    expect(updated.filled_at).toBeInstanceOf(Date);
  });

  it('transitions to cancelled with timestamp', async () => {
    const order = await OrderService.create(orderInput());
    const cancelTime = new Date();

    const updated = await OrderService.updateStatus(order.id, 'cancelled', {
      cancelledAt: cancelTime,
    });

    expect(updated.status).toBe('cancelled');
    expect(updated.cancelled_at).toBeInstanceOf(Date);
  });

  it('transitions to failed with error message', async () => {
    const order = await OrderService.create(orderInput());

    const updated = await OrderService.updateStatus(order.id, 'failed', {
      errorMessage: 'Insufficient balance',
    });

    expect(updated.status).toBe('failed');
    expect(updated.error_message).toBe('Insufficient balance');
  });

  it('throws NotFoundError for unknown order id', async () => {
    await expect(
      OrderService.updateStatus('00000000-0000-0000-0000-000000000000', 'open'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
