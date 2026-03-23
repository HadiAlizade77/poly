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

function positionData(marketId: string, overrides = {}) {
  return {
    market_id: marketId,
    outcome_token: 'yes-token',
    side: 'long' as const,
    size: 100,
    avg_entry_price: 0.65,
    ...overrides,
  };
}

// ─── CREATE ──────────────────────────────────────────────────────────────────

describe('Position CREATE', () => {
  it('creates a position with defaults', async () => {
    const market = await seedMarket();
    const position = await prisma.position.create({ data: positionData(market.id) });

    expect(position.id).toBeTruthy();
    expect(position.realized_pnl.toNumber()).toBe(0);  // default
    expect(position.total_fees.toNumber()).toBe(0);    // default
    expect(position.exit_strategy).toBe('resolution_only'); // default
    expect(position.side).toBe('long');
  });

  it('creates a position with stop-loss and exit settings', async () => {
    const market = await seedMarket();
    const exitTime = new Date('2024-12-31');

    const position = await prisma.position.create({
      data: positionData(market.id, {
        exit_strategy: 'stop_loss',
        stop_loss_price: 0.50,
        time_exit_at: exitTime,
        current_price: 0.68,
        unrealized_pnl: 3.0,
      }),
    });

    expect(position.exit_strategy).toBe('stop_loss');
    expect(position.stop_loss_price?.toNumber()).toBeCloseTo(0.50);
    expect(position.current_price?.toNumber()).toBeCloseTo(0.68);
  });

  it('rejects duplicate (market_id, outcome_token) pair', async () => {
    const market = await seedMarket();

    await prisma.position.create({ data: positionData(market.id, { outcome_token: 'yes-token' }) });

    await expect(
      prisma.position.create({ data: positionData(market.id, { outcome_token: 'yes-token' }) }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('allows different outcome_tokens for the same market', async () => {
    const market = await seedMarket();

    const pos1 = await prisma.position.create({ data: positionData(market.id, { outcome_token: 'yes-token' }) });
    const pos2 = await prisma.position.create({ data: positionData(market.id, { outcome_token: 'no-token' }) });

    expect(pos1.id).not.toBe(pos2.id);
  });

  it('rejects position with non-existent market_id', async () => {
    await expect(
      prisma.position.create({
        data: positionData('00000000-0000-0000-0000-000000000000'),
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });
});

// ─── READ ────────────────────────────────────────────────────────────────────

describe('Position READ', () => {
  it('finds position by market and outcome_token', async () => {
    const market = await seedMarket();
    await prisma.position.create({ data: positionData(market.id) });

    const found = await prisma.position.findUnique({
      where: { market_id_outcome_token: { market_id: market.id, outcome_token: 'yes-token' } },
    });

    expect(found).not.toBeNull();
    expect(found!.market_id).toBe(market.id);
  });

  it('finds all open positions', async () => {
    const m1 = await seedMarket();
    const m2 = await prisma.market.create({ data: marketInput() });

    await prisma.position.create({ data: positionData(m1.id) });
    await prisma.position.create({ data: positionData(m2.id) });

    const positions = await prisma.position.findMany();
    expect(positions.length).toBe(2);
  });

  it('filters positions by exit_strategy', async () => {
    const m1 = await seedMarket();
    const m2 = await prisma.market.create({ data: marketInput() });

    await prisma.position.create({ data: positionData(m1.id, { exit_strategy: 'stop_loss' }) });
    await prisma.position.create({ data: positionData(m2.id, { exit_strategy: 'resolution_only' }) });

    const stopLoss = await prisma.position.findMany({ where: { exit_strategy: 'stop_loss' } });
    expect(stopLoss.length).toBe(1);
  });
});

// ─── UPDATE ──────────────────────────────────────────────────────────────────

describe('Position UPDATE', () => {
  it('updates unrealized_pnl and current_price', async () => {
    const market = await seedMarket();
    const position = await prisma.position.create({ data: positionData(market.id) });

    const updated = await prisma.position.update({
      where: { id: position.id },
      data: { current_price: 0.72, unrealized_pnl: 7.0 },
    });

    expect(updated.current_price?.toNumber()).toBeCloseTo(0.72);
    expect(updated.unrealized_pnl?.toNumber()).toBeCloseTo(7.0);
  });

  it('updates realized_pnl after partial close', async () => {
    const market = await seedMarket();
    const position = await prisma.position.create({ data: positionData(market.id) });

    const updated = await prisma.position.update({
      where: { id: position.id },
      data: { size: 50, realized_pnl: 3.5, total_fees: 0.25 },
    });

    expect(updated.size.toNumber()).toBe(50);
    expect(updated.realized_pnl.toNumber()).toBeCloseTo(3.5);
  });
});

// ─── DELETE ──────────────────────────────────────────────────────────────────

describe('Position DELETE', () => {
  it('deletes a position (closed)', async () => {
    const market = await seedMarket();
    const position = await prisma.position.create({ data: positionData(market.id) });

    await prisma.position.delete({ where: { id: position.id } });

    expect(await prisma.position.findUnique({ where: { id: position.id } })).toBeNull();
  });
});
