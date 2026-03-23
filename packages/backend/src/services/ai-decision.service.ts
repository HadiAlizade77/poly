import {
  type AiDecision,
  type DecisionAction,
  type Prisma,
} from '@prisma/client';
import prisma from '../config/database.js';
import { withPrismaError, NotFoundError } from './errors.js';
import { emitDecisionNew } from '../websocket/emit.js';
import { create as createAuditLog } from './audit-log.service.js';
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
  trades: number;
  holds: number;
  executed: number;
  vetoed: number;
  avg_confidence: number | null;
  avg_edge: null;
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
  void createAuditLog(
    result.action === 'trade' ? 'ai_decision_trade' : 'ai_decision_hold',
    'ai_decision',
    result.id.toString(),
    { category: result.category, action: result.action, confidence: Number(result.confidence), reasoning: result.reasoning?.slice(0, 200) },
    'decision-engine',
  ).catch(() => {});
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
  void createAuditLog(
    'ai_decision_executed',
    'ai_decision',
    result.id.toString(),
    { category: result.category, orderId },
    'execution-engine',
  ).catch(() => {});
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
  void createAuditLog(
    'ai_decision_vetoed',
    'ai_decision',
    result.id.toString(),
    { category: result.category, vetoReason },
    'risk-governor',
  ).catch(() => {});
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
    trades: tradeCount,
    holds: holdCount,
    executed: executedCount,
    vetoed: vetoedCount,
    avg_confidence: avg !== null ? Number(avg) : null,
    avg_edge: null,
  };
}
