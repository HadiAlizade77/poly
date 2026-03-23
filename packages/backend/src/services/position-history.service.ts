import { type PositionHistory, type CloseReason, type Prisma } from '@prisma/client';
import prisma from '../config/database.js';
import { withPrismaError } from './errors.js';
import {
  buildPaginatedResult,
  getPaginationArgs,
  type PaginatedResult,
  type PaginationParams,
} from './utils/pagination.js';

export interface PositionHistoryFilter {
  marketId?: string;
  closeReason?: CloseReason;
  since?: Date;
  until?: Date;
}

export async function findMany(
  filter: PositionHistoryFilter = {},
  pagination: PaginationParams = {},
): Promise<PaginatedResult<PositionHistory>> {
  const { skip, take, page, pageSize } = getPaginationArgs(pagination);

  const where: Prisma.PositionHistoryWhereInput = {
    ...(filter.marketId !== undefined && { market_id: filter.marketId }),
    ...(filter.closeReason !== undefined && { close_reason: filter.closeReason }),
    ...((filter.since !== undefined || filter.until !== undefined) && {
      closed_at: {
        ...(filter.since !== undefined && { gte: filter.since }),
        ...(filter.until !== undefined && { lte: filter.until }),
      },
    }),
  };

  const [items, total] = await prisma.$transaction([
    prisma.positionHistory.findMany({ where, skip, take, orderBy: { closed_at: 'desc' } }),
    prisma.positionHistory.count({ where }),
  ]);

  return buildPaginatedResult(items as PositionHistory[], total, page, pageSize);
}

export async function findByMarket(
  marketId: string,
  pagination: PaginationParams = {},
): Promise<PaginatedResult<PositionHistory>> {
  return findMany({ marketId }, pagination);
}

export async function create(
  data: Prisma.PositionHistoryUncheckedCreateInput,
): Promise<PositionHistory> {
  return withPrismaError('PositionHistory', () =>
    prisma.positionHistory.create({ data }) as Promise<PositionHistory>,
  );
}

export async function getStats(since?: Date): Promise<{
  count: number;
  winCount: number;
  lossCount: number;
}> {
  const where: Prisma.PositionHistoryWhereInput = {
    ...(since !== undefined && { closed_at: { gte: since } }),
  };

  const [total, wins] = await prisma.$transaction([
    prisma.positionHistory.count({ where }),
    prisma.positionHistory.count({ where: { ...where, realized_pnl: { gt: 0 } } }),
  ]);

  return { count: total, winCount: wins, lossCount: total - wins };
}
