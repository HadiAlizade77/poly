import { type TradeFeedback, type Prisma } from '@prisma/client';
import prisma from '../config/database.js';
import { withPrismaError } from './errors.js';
import {
  buildPaginatedResult,
  getPaginationArgs,
  type PaginatedResult,
  type PaginationParams,
} from './utils/pagination.js';

export interface TradeFeedbackFilter {
  category?: string;
  since?: Date;
}

export async function findMany(
  filter: TradeFeedbackFilter = {},
  pagination: PaginationParams = {},
): Promise<PaginatedResult<TradeFeedback>> {
  const { skip, take, page, pageSize } = getPaginationArgs(pagination);

  const where: Prisma.TradeFeedbackWhereInput = {
    ...(filter.category !== undefined && { category: filter.category }),
    ...(filter.since !== undefined && { timestamp: { gte: filter.since } }),
  };

  const [items, total] = await prisma.$transaction([
    prisma.tradeFeedback.findMany({ where, skip, take, orderBy: { timestamp: 'desc' } }),
    prisma.tradeFeedback.count({ where }),
  ]);

  return buildPaginatedResult(items as TradeFeedback[], total, page, pageSize);
}

export async function findByCategory(
  category: string,
  pagination: PaginationParams = {},
): Promise<PaginatedResult<TradeFeedback>> {
  return findMany({ category }, pagination);
}

export async function getLatestForCategory(
  category: string,
): Promise<TradeFeedback | null> {
  return prisma.tradeFeedback.findFirst({
    where: { category },
    orderBy: { timestamp: 'desc' },
  }) as Promise<TradeFeedback | null>;
}

export async function create(
  data: Prisma.TradeFeedbackUncheckedCreateInput,
): Promise<TradeFeedback> {
  return withPrismaError('TradeFeedback', () =>
    prisma.tradeFeedback.create({ data }) as Promise<TradeFeedback>,
  );
}
