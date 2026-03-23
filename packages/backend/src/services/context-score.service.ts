import { type ContextScore, type Prisma } from '@prisma/client';
import prisma from '../config/database.js';
import { emitScoreUpdate } from '../websocket/emit.js';
import {
  buildPaginatedResult,
  getPaginationArgs,
  type PaginatedResult,
  type PaginationParams,
} from './utils/pagination.js';

export async function findByMarket(
  marketId: string,
  pagination: PaginationParams = {},
): Promise<PaginatedResult<ContextScore>> {
  const { skip, take, page, pageSize } = getPaginationArgs(pagination);
  const where: Prisma.ContextScoreWhereInput = { market_id: marketId };

  const [items, total] = await prisma.$transaction([
    prisma.contextScore.findMany({ where, skip, take, orderBy: { timestamp: 'desc' } }),
    prisma.contextScore.count({ where }),
  ]);

  return buildPaginatedResult(items as ContextScore[], total, page, pageSize);
}

export async function findByCategory(
  category: string,
  since?: Date,
  pagination: PaginationParams = {},
): Promise<PaginatedResult<ContextScore>> {
  const { skip, take, page, pageSize } = getPaginationArgs(pagination);

  const where: Prisma.ContextScoreWhereInput = {
    category,
    ...(since !== undefined && { timestamp: { gte: since } }),
  };

  const [items, total] = await prisma.$transaction([
    prisma.contextScore.findMany({ where, skip, take, orderBy: { timestamp: 'desc' } }),
    prisma.contextScore.count({ where }),
  ]);

  return buildPaginatedResult(items as ContextScore[], total, page, pageSize);
}

export async function getLatestForMarket(
  marketId: string,
): Promise<ContextScore | null> {
  return prisma.contextScore.findFirst({
    where: { market_id: marketId },
    orderBy: { timestamp: 'desc' },
  }) as Promise<ContextScore | null>;
}

export async function create(
  data: Prisma.ContextScoreUncheckedCreateInput,
): Promise<ContextScore> {
  const result = await prisma.contextScore.create({ data }) as ContextScore;
  emitScoreUpdate(result.market_id, result.category, result);
  return result;
}

export async function pruneOlderThan(cutoff: Date): Promise<number> {
  const result = await prisma.contextScore.deleteMany({
    where: { timestamp: { lt: cutoff } },
  });
  return result.count;
}
