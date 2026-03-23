import { type AuditLog, type Prisma } from '@prisma/client';
import prisma from '../config/database.js';
import {
  buildPaginatedResult,
  getPaginationArgs,
  type PaginatedResult,
  type PaginationParams,
} from './utils/pagination.js';

export interface AuditLogFilter {
  entityType?: string;
  entityId?: string;
  action?: string;
  performedBy?: string;
  since?: Date;
}

export async function findMany(
  filter: AuditLogFilter = {},
  pagination: PaginationParams = {},
): Promise<PaginatedResult<AuditLog>> {
  const { skip, take, page, pageSize } = getPaginationArgs(pagination);

  const where: Prisma.AuditLogWhereInput = {
    ...(filter.entityType !== undefined && { entity_type: filter.entityType }),
    ...(filter.entityId !== undefined && { entity_id: filter.entityId }),
    ...(filter.action !== undefined && { action: filter.action }),
    ...(filter.performedBy !== undefined && { performed_by: filter.performedBy }),
    ...(filter.since !== undefined && { timestamp: { gte: filter.since } }),
  };

  const [items, total] = await prisma.$transaction([
    prisma.auditLog.findMany({ where, skip, take, orderBy: { timestamp: 'desc' } }),
    prisma.auditLog.count({ where }),
  ]);

  return buildPaginatedResult(items as AuditLog[], total, page, pageSize);
}

export async function findRecent(limit = 100): Promise<AuditLog[]> {
  return prisma.auditLog.findMany({
    orderBy: { timestamp: 'desc' },
    take: limit,
  }) as Promise<AuditLog[]>;
}

export async function findByEntity(
  entityType: string,
  entityId: string,
  pagination: PaginationParams = {},
): Promise<PaginatedResult<AuditLog>> {
  return findMany({ entityType, entityId }, pagination);
}

export async function create(
  action: string,
  entityType: string,
  entityId?: string,
  changes?: unknown,
  performedBy?: string,
): Promise<AuditLog> {
  return prisma.auditLog.create({
    data: {
      action,
      entity_type: entityType,
      ...(entityId !== undefined && { entity_id: entityId }),
      ...(changes !== undefined && { changes: changes as Prisma.InputJsonValue }),
      ...(performedBy !== undefined && { performed_by: performedBy }),
    },
  }) as Promise<AuditLog>;
}

export async function pruneOlderThan(cutoff: Date): Promise<number> {
  const result = await prisma.auditLog.deleteMany({
    where: { timestamp: { lt: cutoff } },
  });
  return result.count;
}
