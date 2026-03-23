import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as BankrollService from '../../../src/services/bankroll.service.js';
import { prisma, cleanDatabase } from './helpers.js';

// Far-future dates to avoid clashing with any seed BankrollHistory entries
const TEST_DATE_1 = new Date('2099-01-01T00:00:00Z');
const TEST_DATE_2 = new Date('2099-01-02T00:00:00Z');
const TEST_DATE_3 = new Date('2099-01-03T00:00:00Z');

async function cleanTestHistory() {
  await prisma.bankrollHistory.deleteMany({
    where: { date: { gte: new Date('2099-01-01') } },
  });
}

beforeAll(async () => {
  await cleanDatabase();
  // Ensure singleton bankroll exists (create via Prisma to avoid service UUID bug)
  const count = await prisma.bankroll.count();
  if (count === 0) {
    await prisma.bankroll.create({
      data: {
        total_balance: 1000,
        previous_balance: 1000,
        reserved_balance: 0,
        active_balance: 1000,
        deployed_balance: 0,
        unrealized_pnl: 0,
        balance_delta_today: 0,
        balance_delta_total: 0,
        initial_deposit: 1000,
      },
    });
  }
});

afterAll(async () => {
  await cleanTestHistory();
  await prisma.$disconnect();
});

// ─── getBankroll ──────────────────────────────────────────────────────────────

describe('BankrollService.getBankroll', () => {
  it('returns the singleton bankroll', async () => {
    const bankroll = await BankrollService.get();

    expect(bankroll).not.toBeNull();
    expect(bankroll!.id).toBeTruthy();
    expect(typeof bankroll!.total_balance.toNumber()).toBe('number');
    expect(bankroll!.updated_at).toBeInstanceOf(Date);
  });
});

// ─── upsertBankroll ───────────────────────────────────────────────────────────

describe('BankrollService.upsertBankroll', () => {
  it('updates the existing singleton without creating a duplicate', async () => {
    const before = await BankrollService.get();
    const originalBalance = before!.total_balance;

    // Update to a known test value
    await BankrollService.update({
      total_balance: 99999.99,
      previous_balance: Number(originalBalance),
      reserved_balance: 0,
      active_balance: 99999.99,
      deployed_balance: 0,
      unrealized_pnl: 0,
      balance_delta_today: 0,
      balance_delta_total: 0,
      initial_deposit: Number(originalBalance),
    });

    const updated = await BankrollService.get();
    expect(Number(updated!.total_balance)).toBeCloseTo(99999.99);

    // Restore original value so we don't pollute other tests
    await BankrollService.update({
      total_balance: Number(originalBalance),
      previous_balance: Number(originalBalance),
      reserved_balance: 0,
      active_balance: Number(originalBalance),
      deployed_balance: 0,
      unrealized_pnl: 0,
      balance_delta_today: 0,
      balance_delta_total: 0,
      initial_deposit: Number(originalBalance),
    });

    // Count remains 1 (singleton)
    const count = await prisma.bankroll.count();
    expect(count).toBe(1);
  });
});

// ─── getBankrollHistory ───────────────────────────────────────────────────────

describe('BankrollService.getBankrollHistory', () => {
  it('returns paginated history', async () => {
    // Insert test history entries
    await prisma.bankrollHistory.createMany({
      data: [
        { date: TEST_DATE_1, opening_balance: 10000, closing_balance: 10050, trading_pnl: 50 },
        { date: TEST_DATE_2, opening_balance: 10050, closing_balance: 10030, trading_pnl: -20 },
        { date: TEST_DATE_3, opening_balance: 10030, closing_balance: 10100, trading_pnl: 70 },
      ],
    });

    const result = await BankrollService.getHistory({ page: 1, pageSize: 2 });

    expect(Array.isArray(result.items)).toBe(true);
    expect(result.items.length).toBeLessThanOrEqual(2);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(2);
    expect(result.total).toBeGreaterThanOrEqual(3);
  });

  it('orders by date descending', async () => {
    const result = await BankrollService.getHistory({ pageSize: 10 });
    for (let i = 0; i < result.items.length - 1; i++) {
      expect(result.items[i].date >= result.items[i + 1].date).toBe(true);
    }
  });
});

// ─── upsertTodaysBankrollHistory ──────────────────────────────────────────────

describe('BankrollService.upsertTodaysBankrollHistory', () => {
  it('creates a history entry for a new date', async () => {
    const testDate = new Date('2099-02-01T12:00:00Z'); // noon — will be normalized to midnight
    const entry = await BankrollService.createDailySnapshot(testDate, {
      opening_balance: 10000,
      closing_balance: 10100,
      trading_pnl: 100,
      trades_count: 5,
    });

    expect(Number(entry.trading_pnl)).toBe(100);
    expect(entry.date.toISOString()).toBe('2099-02-01T00:00:00.000Z');

    // Clean up
    await prisma.bankrollHistory.deleteMany({ where: { date: { gte: new Date('2099-02-01') } } });
  });

  it('updates the same date on second call (upsert)', async () => {
    const date = new Date('2099-03-01');
    const payload = { opening_balance: 10000, closing_balance: 10100, trading_pnl: 100 };

    await BankrollService.createDailySnapshot(date, payload);
    await BankrollService.createDailySnapshot(date, { ...payload, trading_pnl: 200 });

    const count = await prisma.bankrollHistory.count({
      where: { date: new Date('2099-03-01') },
    });
    expect(count).toBe(1);

    const entry = await prisma.bankrollHistory.findUnique({ where: { date: new Date('2099-03-01') } });
    expect(Number(entry!.trading_pnl)).toBe(200);

    await prisma.bankrollHistory.deleteMany({ where: { date: new Date('2099-03-01') } });
  });
});

// ─── getBankrollHistoryByDateRange ────────────────────────────────────────────

describe('BankrollService.getBankrollHistoryByDateRange', () => {
  it('returns entries within the date range', async () => {
    const from = new Date('2099-01-01');
    const to = new Date('2099-01-02');

    const entries = await BankrollService.getHistoryByDateRange(from, to);

    expect(entries.length).toBeGreaterThanOrEqual(2); // TEST_DATE_1 and TEST_DATE_2
    entries.forEach((e) => {
      expect(e.date >= from).toBe(true);
      expect(e.date <= to).toBe(true);
    });
  });
});
