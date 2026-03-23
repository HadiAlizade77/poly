import { type Bankroll, type BankrollHistory, type Prisma } from '@prisma/client';
import prisma from '../config/database.js';
import { emitBankrollUpdate } from '../websocket/emit.js';
import {
  buildPaginatedResult,
  getPaginationArgs,
  type PaginatedResult,
  type PaginationParams,
} from './utils/pagination.js';

const SINGLETON_ID = 'singleton';

/** Return the single bankroll record, or null if not yet seeded. */
export async function get(): Promise<Bankroll | null> {
  const rows = await prisma.bankroll.findMany({ take: 1 });
  return rows.length > 0 ? (rows[0] as Bankroll) : null;
}

/** Create or update the singleton bankroll row. */
export async function update(
  data: Omit<Prisma.BankrollUncheckedCreateInput, 'id'>,
): Promise<Bankroll> {
  const existing = await prisma.bankroll.findMany({ take: 1 });
  let result: Bankroll;
  if (existing.length > 0) {
    const id = (existing[0] as { id: string }).id;
    result = await prisma.bankroll.update({ where: { id }, data }) as Bankroll;
  } else {
    result = await prisma.bankroll.create({
      data: { id: SINGLETON_ID, ...data },
    }) as Bankroll;
  }
  emitBankrollUpdate(result);
  return result;
}

/** Paginated bankroll history, newest first. */
export async function getHistory(
  pagination: PaginationParams = {},
): Promise<PaginatedResult<BankrollHistory>> {
  const { skip, take, page, pageSize } = getPaginationArgs(pagination);

  const [items, total] = await prisma.$transaction([
    prisma.bankrollHistory.findMany({ skip, take, orderBy: { date: 'desc' } }),
    prisma.bankrollHistory.count(),
  ]);

  return buildPaginatedResult(items as BankrollHistory[], total, page, pageSize);
}

/** History for a given date range. */
export async function getHistoryByDateRange(
  from: Date,
  to: Date,
): Promise<BankrollHistory[]> {
  return prisma.bankrollHistory.findMany({
    where: { date: { gte: from, lte: to } },
    orderBy: { date: 'asc' },
  }) as Promise<BankrollHistory[]>;
}

/**
 * Upsert today's daily snapshot. Normalises the date to midnight UTC so
 * repeated calls in the same day update rather than insert.
 */
export async function createDailySnapshot(
  date: Date,
  data: Omit<Prisma.BankrollHistoryUncheckedCreateInput, 'date'>,
): Promise<BankrollHistory> {
  const dayDate = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );

  return prisma.bankrollHistory.upsert({
    where: { date: dayDate },
    create: { date: dayDate, ...data },
    update: data,
  }) as Promise<BankrollHistory>;
}
