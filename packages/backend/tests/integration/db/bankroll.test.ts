import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { prisma, cleanDatabase } from './db-helpers.js';

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

function bankrollData(overrides = {}) {
  return {
    total_balance: 10000,
    previous_balance: 10000,
    reserved_balance: 0,
    active_balance: 10000,
    deployed_balance: 0,
    unrealized_pnl: 0,
    balance_delta_today: 0,
    balance_delta_total: 0,
    initial_deposit: 10000,
    ...overrides,
  };
}

// ─── CREATE ──────────────────────────────────────────────────────────────────

describe('Bankroll CREATE', () => {
  it('creates a bankroll record', async () => {
    const bankroll = await prisma.bankroll.create({ data: bankrollData() });

    expect(bankroll.id).toBeTruthy();
    expect(bankroll.total_balance.toNumber()).toBe(10000);
    expect(bankroll.active_balance.toNumber()).toBe(10000);
    expect(bankroll.deployed_balance.toNumber()).toBe(0);
    expect(bankroll.updated_at).toBeInstanceOf(Date);
  });

  it('supports multiple bankroll records (multi-account)', async () => {
    await prisma.bankroll.create({ data: bankrollData({ initial_deposit: 5000, total_balance: 5000, previous_balance: 5000, active_balance: 5000 }) });
    await prisma.bankroll.create({ data: bankrollData({ initial_deposit: 15000, total_balance: 15000, previous_balance: 15000, active_balance: 15000 }) });

    const count = await prisma.bankroll.count();
    expect(count).toBe(2);
  });
});

// ─── READ ────────────────────────────────────────────────────────────────────

describe('Bankroll READ', () => {
  it('finds bankroll by id', async () => {
    const bankroll = await prisma.bankroll.create({ data: bankrollData() });
    const found = await prisma.bankroll.findUnique({ where: { id: bankroll.id } });

    expect(found).not.toBeNull();
    expect(found!.initial_deposit.toNumber()).toBe(10000);
  });

  it('finds first bankroll (singleton pattern)', async () => {
    await prisma.bankroll.create({ data: bankrollData() });
    const found = await prisma.bankroll.findFirst();

    expect(found).not.toBeNull();
  });
});

// ─── UPDATE ──────────────────────────────────────────────────────────────────

describe('Bankroll UPDATE', () => {
  it('updates balance after a trade', async () => {
    const bankroll = await prisma.bankroll.create({ data: bankrollData() });

    const updated = await prisma.bankroll.update({
      where: { id: bankroll.id },
      data: {
        deployed_balance: 250,
        active_balance: 9750,
        unrealized_pnl: 12.5,
        balance_delta_today: -250,
      },
    });

    expect(updated.deployed_balance.toNumber()).toBe(250);
    expect(updated.active_balance.toNumber()).toBe(9750);
    expect(updated.unrealized_pnl.toNumber()).toBe(12.5);
  });

  it('updates updated_at on write', async () => {
    const bankroll = await prisma.bankroll.create({ data: bankrollData() });
    const before = bankroll.updated_at;

    // Slight delay to ensure updated_at changes
    await new Promise((r) => setTimeout(r, 5));

    const updated = await prisma.bankroll.update({
      where: { id: bankroll.id },
      data: { balance_delta_today: 50 },
    });

    expect(updated.updated_at.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });
});

// ─── DELETE ──────────────────────────────────────────────────────────────────

describe('Bankroll DELETE', () => {
  it('deletes a bankroll record', async () => {
    const bankroll = await prisma.bankroll.create({ data: bankrollData() });

    await prisma.bankroll.delete({ where: { id: bankroll.id } });

    expect(await prisma.bankroll.findUnique({ where: { id: bankroll.id } })).toBeNull();
  });
});

// ─── HISTORY ─────────────────────────────────────────────────────────────────

describe('BankrollHistory', () => {
  it('creates daily history entries', async () => {
    await prisma.bankrollHistory.createMany({
      data: [
        { date: new Date('2024-06-01'), opening_balance: 10000, closing_balance: 10050, trading_pnl: 50 },
        { date: new Date('2024-06-02'), opening_balance: 10050, closing_balance: 10030, trading_pnl: -20 },
        { date: new Date('2024-06-03'), opening_balance: 10030, closing_balance: 10100, trading_pnl: 70 },
      ],
    });

    const count = await prisma.bankrollHistory.count();
    expect(count).toBe(3);
  });

  it('rejects duplicate date (unique constraint)', async () => {
    await prisma.bankrollHistory.create({
      data: { date: new Date('2024-06-01'), opening_balance: 10000, closing_balance: 10050, trading_pnl: 50 },
    });

    await expect(
      prisma.bankrollHistory.create({
        data: { date: new Date('2024-06-01'), opening_balance: 10000, closing_balance: 10100, trading_pnl: 100 },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('paginates history ordered by date desc', async () => {
    await prisma.bankrollHistory.createMany({
      data: Array.from({ length: 5 }, (_, i) => ({
        date: new Date(`2024-06-0${i + 1}`),
        opening_balance: 10000 + i * 100,
        closing_balance: 10000 + (i + 1) * 100,
        trading_pnl: 100,
      })),
    });

    const page = await prisma.bankrollHistory.findMany({
      take: 3,
      skip: 0,
      orderBy: { date: 'desc' },
    });

    expect(page.length).toBe(3);
    expect(page[0].date > page[1].date).toBe(true);
  });

  it('aggregates total trading_pnl', async () => {
    await prisma.bankrollHistory.createMany({
      data: [
        { date: new Date('2024-07-01'), opening_balance: 10000, closing_balance: 10050, trading_pnl: 50 },
        { date: new Date('2024-07-02'), opening_balance: 10050, closing_balance: 10020, trading_pnl: -30 },
        { date: new Date('2024-07-03'), opening_balance: 10020, closing_balance: 10070, trading_pnl: 50 },
      ],
    });

    const agg = await prisma.bankrollHistory.aggregate({
      _sum: { trading_pnl: true },
      _count: { id: true },
    });

    expect(agg._sum.trading_pnl?.toNumber()).toBe(70);
    expect(agg._count.id).toBe(3);
  });
});
