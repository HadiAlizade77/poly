import { type MarketSnapshot, type Prisma } from '@prisma/client';
import prisma from '../config/database.js';
import {
  buildPaginatedResult,
  getPaginationArgs,
  type PaginatedResult,
  type PaginationParams,
} from './utils/pagination.js';

export interface MarketSnapshotFilter {
  marketId: string;
  from?: Date;
  to?: Date;
}

export async function findByMarket(
  filter: MarketSnapshotFilter,
  pagination: PaginationParams = {},
): Promise<PaginatedResult<MarketSnapshot>> {
  const { skip, take, page, pageSize } = getPaginationArgs(pagination);

  const where: Prisma.MarketSnapshotWhereInput = {
    market_id: filter.marketId,
    ...((filter.from !== undefined || filter.to !== undefined) && {
      timestamp: {
        ...(filter.from !== undefined && { gte: filter.from }),
        ...(filter.to !== undefined && { lte: filter.to }),
      },
    }),
  };

  const [items, total] = await prisma.$transaction([
    prisma.marketSnapshot.findMany({
      where,
      skip,
      take,
      orderBy: { timestamp: 'desc' },
    }),
    prisma.marketSnapshot.count({ where }),
  ]);

  return buildPaginatedResult(items as MarketSnapshot[], total, page, pageSize);
}

export async function getLatest(marketId: string): Promise<MarketSnapshot | null> {
  return prisma.marketSnapshot.findFirst({
    where: { market_id: marketId },
    orderBy: { timestamp: 'desc' },
  }) as Promise<MarketSnapshot | null>;
}

export async function create(
  data: Prisma.MarketSnapshotUncheckedCreateInput,
): Promise<MarketSnapshot> {
  return prisma.marketSnapshot.create({ data }) as Promise<MarketSnapshot>;
}

export async function createMany(
  data: Prisma.MarketSnapshotUncheckedCreateInput[],
): Promise<number> {
  const result = await prisma.marketSnapshot.createMany({ data, skipDuplicates: true });
  return result.count;
}

export async function pruneOlderThan(marketId: string, cutoff: Date): Promise<number> {
  const result = await prisma.marketSnapshot.deleteMany({
    where: { market_id: marketId, timestamp: { lt: cutoff } },
  });
  return result.count;
}
