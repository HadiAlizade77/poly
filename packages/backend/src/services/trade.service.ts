import { type Trade, type OrderSide, type Prisma } from '@prisma/client';
import prisma from '../config/database.js';
import { withPrismaError, NotFoundError } from './errors.js';
import { create as createAuditLog } from './audit-log.service.js';
import {
  buildPaginatedResult,
  getPaginationArgs,
  type PaginatedResult,
  type PaginationParams,
} from './utils/pagination.js';

export interface TradeFilter {
  marketId?: string;
  orderId?: string;
  side?: OrderSide;
  since?: Date;
  until?: Date;
}

export async function findMany(
  filter: TradeFilter = {},
  pagination: PaginationParams = {},
): Promise<PaginatedResult<Trade>> {
  const { skip, take, page, pageSize } = getPaginationArgs(pagination);

  const where: Prisma.TradeWhereInput = {
    ...(filter.marketId !== undefined && { market_id: filter.marketId }),
    ...(filter.orderId !== undefined && { order_id: filter.orderId }),
    ...(filter.side !== undefined && { side: filter.side }),
    ...((filter.since !== undefined || filter.until !== undefined) && {
      executed_at: {
        ...(filter.since !== undefined && { gte: filter.since }),
        ...(filter.until !== undefined && { lte: filter.until }),
      },
    }),
  };

  const [items, total] = await prisma.$transaction([
    prisma.trade.findMany({ where, skip, take, orderBy: { executed_at: 'desc' } }),
    prisma.trade.count({ where }),
  ]);

  return buildPaginatedResult(items as Trade[], total, page, pageSize);
}

export async function findById(id: string): Promise<Trade> {
  const record = await prisma.trade.findUnique({ where: { id } });
  if (!record) throw new NotFoundError('Trade', id);
  return record as Trade;
}

export async function findByMarket(
  marketId: string,
  pagination: PaginationParams = {},
): Promise<PaginatedResult<Trade>> {
  return findMany({ marketId }, pagination);
}

export async function findByOrder(orderId: string): Promise<Trade[]> {
  return prisma.trade.findMany({
    where: { order_id: orderId },
    orderBy: { executed_at: 'asc' },
  }) as Promise<Trade[]>;
}

export async function getRecentTrades(limit = 50): Promise<Trade[]> {
  return prisma.trade.findMany({
    orderBy: { executed_at: 'desc' },
    take: limit,
  }) as Promise<Trade[]>;
}

export async function create(data: Prisma.TradeUncheckedCreateInput): Promise<Trade> {
  const result = await withPrismaError('Trade', () =>
    prisma.trade.create({ data }) as Promise<Trade>,
  );
  void createAuditLog(
    'trade_executed',
    'trade',
    result.id,
    { side: result.side, outcome_token: result.outcome_token, size: Number(result.size), entry_price: Number(result.entry_price), fees: Number(result.fees) },
    'execution-engine',
  ).catch(() => {});
  return result;
}
