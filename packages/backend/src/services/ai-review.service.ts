import { type AiReview, type ReviewType, type Prisma } from '@prisma/client';
import prisma from '../config/database.js';
import { withPrismaError, NotFoundError } from './errors.js';
import {
  buildPaginatedResult,
  getPaginationArgs,
  type PaginatedResult,
  type PaginationParams,
} from './utils/pagination.js';

export interface AiReviewFilter {
  reviewType?: ReviewType;
  category?: string;
  wasApplied?: boolean;
  since?: Date;
}

export async function findByType(
  reviewType: ReviewType,
  pagination: PaginationParams = {},
): Promise<PaginatedResult<AiReview>> {
  return findMany({ reviewType }, pagination);
}

export async function findMany(
  filter: AiReviewFilter = {},
  pagination: PaginationParams = {},
): Promise<PaginatedResult<AiReview>> {
  const { skip, take, page, pageSize } = getPaginationArgs(pagination);

  const where: Prisma.AiReviewWhereInput = {
    ...(filter.reviewType !== undefined && { review_type: filter.reviewType }),
    ...(filter.category !== undefined && { category: filter.category }),
    ...(filter.wasApplied !== undefined && { was_applied: filter.wasApplied }),
    ...(filter.since !== undefined && { timestamp: { gte: filter.since } }),
  };

  const [items, total] = await prisma.$transaction([
    prisma.aiReview.findMany({ where, skip, take, orderBy: { timestamp: 'desc' } }),
    prisma.aiReview.count({ where }),
  ]);

  return buildPaginatedResult(items as AiReview[], total, page, pageSize);
}

export async function getRecent(limit = 20): Promise<AiReview[]> {
  return prisma.aiReview.findMany({
    orderBy: { timestamp: 'desc' },
    take: limit,
  }) as Promise<AiReview[]>;
}

export async function findById(id: bigint): Promise<AiReview> {
  const record = await prisma.aiReview.findUnique({ where: { id } });
  if (!record) throw new NotFoundError('AiReview', id);
  return record as AiReview;
}

export async function create(
  data: Prisma.AiReviewUncheckedCreateInput,
): Promise<AiReview> {
  return withPrismaError('AiReview', () =>
    prisma.aiReview.create({ data }) as Promise<AiReview>,
  );
}

export async function markApplied(
  id: bigint,
  appliedBy?: string,
): Promise<AiReview> {
  return withPrismaError('AiReview', () =>
    prisma.aiReview.update({
      where: { id },
      data: {
        was_applied: true,
        applied_at: new Date(),
        ...(appliedBy !== undefined && { applied_by: appliedBy }),
      },
    }) as Promise<AiReview>,
  );
}
