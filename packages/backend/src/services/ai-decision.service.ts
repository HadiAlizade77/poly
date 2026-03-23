import {
  type AiDecision,
  type DecisionAction,
  type Prisma,
} from '@prisma/client';
import prisma from '../config/database.js';
import { withPrismaError, NotFoundError } from './errors.js';
import { emitDecisionNew } from '../websocket/emit.js';
import {
  buildPaginatedResult,
  getPaginationArgs,
  type PaginatedResult,
  type PaginationParams,
} from './utils/pagination.js';

export interface AiDecisionFilter {
  marketId?: string;
  category?: string;
  action?: DecisionAction;
  wasExecuted?: boolean;
  since?: Date;
  until?: Date;
}

export interface AiDecisionStats {
  total: number;
  tradeCount: number;
  holdCount: number;
  executedCount: number;
  vetoedCount: number;
  avgConfidence: number | null;
}

export async function findByMarket(
  marketId: string,
  pagination: PaginationParams = {},
): Promise<PaginatedResult<AiDecision>> {
  return findMany({ marketId }, pagination);
}

export async function findByCategory(
  category: string,
  pagination: PaginationParams = {},
): Promise<PaginatedResult<AiDecision>> {
  return findMany({ category }, pagination);
}

export async function findMany(
  filter: AiDecisionFilter = {},
  pagination: PaginationParams = {},
): Promise<PaginatedResult<AiDecision>> {
  const { skip, take, page, pageSize } = getPaginationArgs(pagination);

  const where: Prisma.AiDecisionWhereInput = {
    ...(filter.marketId !== undefined && { market_id: filter.marketId }),
    ...(filter.category !== undefined && { category: filter.category }),
    ...(filter.action !== undefined && { action: filter.action }),
    ...(filter.wasExecuted !== undefined && { was_executed: filter.wasExecuted }),
    ...((filter.since !== undefined || filter.until !== undefined) && {
      timestamp: {
        ...(filter.since !== undefined && { gte: filter.since }),
        ...(filter.until !== undefined && { lte: filter.until }),
      },
    }),
  };

  const [items, total] = await prisma.$transaction([
    prisma.aiDecision.findMany({ where, skip, take, orderBy: { timestamp: 'desc' } }),
    prisma.aiDecision.count({ where }),
  ]);

  return buildPaginatedResult(items as AiDecision[], total, page, pageSize);
}

export async function findRecent(limit = 50): Promise<AiDecision[]> {
  return prisma.aiDecision.findMany({
    orderBy: { timestamp: 'desc' },
    take: limit,
  }) as Promise<AiDecision[]>;
}

export async function findById(id: bigint): Promise<AiDecision> {
  const record = await prisma.aiDecision.findUnique({ where: { id } });
  if (!record) throw new NotFoundError('AiDecision', id);
  return record as AiDecision;
}

export async function create(
  data: Prisma.AiDecisionUncheckedCreateInput,
): Promise<AiDecision> {
  const result = await withPrismaError('AiDecision', () =>
    prisma.aiDecision.create({ data }) as Promise<AiDecision>,
  );
  emitDecisionNew(result.id.toString(), result.market_id, result.action, result);
  return result;
}

export async function markExecuted(id: bigint, orderId: string): Promise<AiDecision> {
  const result = await withPrismaError('AiDecision', () =>
    prisma.aiDecision.update({
      where: { id },
      data: { was_executed: true, order_id: orderId },
    }) as Promise<AiDecision>,
  );
  emitDecisionNew(result.id.toString(), result.market_id, result.action, result);
  return result;
}

export async function markVetoed(id: bigint, vetoReason: string): Promise<AiDecision> {
  const result = await withPrismaError('AiDecision', () =>
    prisma.aiDecision.update({
      where: { id },
      data: { was_executed: false, veto_reason: vetoReason },
    }) as Promise<AiDecision>,
  );
  emitDecisionNew(result.id.toString(), result.market_id, result.action, result);
  return result;
}

export async function getStats(since?: Date): Promise<AiDecisionStats> {
  const where: Prisma.AiDecisionWhereInput = {
    ...(since !== undefined && { timestamp: { gte: since } }),
  };

  const [total, tradeCount, holdCount, executedCount, vetoedCount, agg] =
    await prisma.$transaction([
      prisma.aiDecision.count({ where }),
      prisma.aiDecision.count({ where: { ...where, action: 'trade' } }),
      prisma.aiDecision.count({ where: { ...where, action: 'hold' } }),
      prisma.aiDecision.count({ where: { ...where, was_executed: true } }),
      prisma.aiDecision.count({
        where: { ...where, veto_reason: { not: null } },
      }),
      prisma.aiDecision.aggregate({ where, _avg: { confidence: true } }),
    ]);

  const avg = (agg as { _avg: { confidence: number | null } })._avg.confidence;

  return {
    total,
    tradeCount,
    holdCount,
    executedCount,
    vetoedCount,
    avgConfidence: avg !== null ? Number(avg) : null,
  };
}
