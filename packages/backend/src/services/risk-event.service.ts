import {
  type RiskEvent,
  type RiskEventType,
  type Severity,
  type Prisma,
} from '@prisma/client';
import prisma from '../config/database.js';
import { withPrismaError, NotFoundError } from './errors.js';
import { emitRiskEvent } from '../websocket/emit.js';
import {
  buildPaginatedResult,
  getPaginationArgs,
  type PaginatedResult,
  type PaginationParams,
} from './utils/pagination.js';

export interface RiskEventFilter {
  eventType?: RiskEventType;
  severity?: Severity;
  marketId?: string;
  resolved?: boolean;
  since?: Date;
}

export async function findMany(
  filter: RiskEventFilter = {},
  pagination: PaginationParams = {},
): Promise<PaginatedResult<RiskEvent>> {
  const { skip, take, page, pageSize } = getPaginationArgs(pagination);

  const where: Prisma.RiskEventWhereInput = {
    ...(filter.eventType !== undefined && { event_type: filter.eventType }),
    ...(filter.severity !== undefined && { severity: filter.severity }),
    ...(filter.marketId !== undefined && { market_id: filter.marketId }),
    ...(filter.resolved !== undefined && { auto_resolved: filter.resolved }),
    ...(filter.since !== undefined && { timestamp: { gte: filter.since } }),
  };

  const [items, total] = await prisma.$transaction([
    prisma.riskEvent.findMany({ where, skip, take, orderBy: { timestamp: 'desc' } }),
    prisma.riskEvent.count({ where }),
  ]);

  return buildPaginatedResult(items as RiskEvent[], total, page, pageSize);
}

export async function findById(id: bigint): Promise<RiskEvent> {
  const record = await prisma.riskEvent.findUnique({ where: { id } });
  if (!record) throw new NotFoundError('RiskEvent', id);
  return record as RiskEvent;
}

export async function findByType(
  eventType: RiskEventType,
  pagination: PaginationParams = {},
): Promise<PaginatedResult<RiskEvent>> {
  return findMany({ eventType }, pagination);
}

export async function findBySeverity(
  severity: Severity,
  pagination: PaginationParams = {},
): Promise<PaginatedResult<RiskEvent>> {
  return findMany({ severity }, pagination);
}

export async function findRecent(limit = 50): Promise<RiskEvent[]> {
  return prisma.riskEvent.findMany({
    orderBy: { timestamp: 'desc' },
    take: limit,
  }) as Promise<RiskEvent[]>;
}

export async function create(
  data: Prisma.RiskEventUncheckedCreateInput,
): Promise<RiskEvent> {
  const result = await withPrismaError('RiskEvent', () =>
    prisma.riskEvent.create({ data }) as Promise<RiskEvent>,
  );
  emitRiskEvent(result.event_type, result.severity, result);
  return result;
}

export async function resolve(id: bigint): Promise<RiskEvent> {
  return withPrismaError('RiskEvent', () =>
    prisma.riskEvent.update({
      where: { id },
      data: { auto_resolved: true, resolved_at: new Date() },
    }) as Promise<RiskEvent>,
  );
}
