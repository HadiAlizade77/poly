import {
  type Alert,
  type AlertType,
  type AlertSeverity,
  type Prisma,
} from '@prisma/client';
import prisma from '../config/database.js';
import { withPrismaError, NotFoundError } from './errors.js';
import { emitAlertNew } from '../websocket/emit.js';
import { create as createAuditLog } from './audit-log.service.js';
import {
  buildPaginatedResult,
  getPaginationArgs,
  type PaginatedResult,
  type PaginationParams,
} from './utils/pagination.js';

export interface AlertFilter {
  alertType?: AlertType;
  severity?: AlertSeverity;
  isRead?: boolean;
  isDismissed?: boolean;
}

export async function findMany(
  filter: AlertFilter = {},
  pagination: PaginationParams = {},
): Promise<PaginatedResult<Alert>> {
  const { skip, take, page, pageSize } = getPaginationArgs(pagination);

  const where: Prisma.AlertWhereInput = {
    ...(filter.alertType !== undefined && { alert_type: filter.alertType }),
    ...(filter.severity !== undefined && { severity: filter.severity }),
    ...(filter.isRead !== undefined && { is_read: filter.isRead }),
    ...(filter.isDismissed !== undefined && { is_dismissed: filter.isDismissed }),
  };

  const [items, total] = await prisma.$transaction([
    prisma.alert.findMany({ where, skip, take, orderBy: { created_at: 'desc' } }),
    prisma.alert.count({ where }),
  ]);

  return buildPaginatedResult(items as Alert[], total, page, pageSize);
}

export async function findById(id: bigint): Promise<Alert> {
  const record = await prisma.alert.findUnique({ where: { id } });
  if (!record) throw new NotFoundError('Alert', id);
  return record as Alert;
}

export async function findUnread(
  pagination: PaginationParams = {},
): Promise<PaginatedResult<Alert>> {
  return findMany({ isRead: false, isDismissed: false }, pagination);
}

export async function countUnread(): Promise<number> {
  return prisma.alert.count({ where: { is_read: false, is_dismissed: false } });
}

export async function create(
  data: Prisma.AlertUncheckedCreateInput,
): Promise<Alert> {
  const result = await withPrismaError('Alert', () =>
    prisma.alert.create({ data }) as Promise<Alert>,
  );
  emitAlertNew(result.id.toString(), result.alert_type, result.severity, result);
  void createAuditLog(
    'alert_created',
    'alert',
    result.id.toString(),
    { alert_type: result.alert_type, severity: result.severity, title: result.title, message: result.message },
    'system',
  ).catch(() => {});
  return result;
}

export async function markRead(id: bigint): Promise<Alert> {
  return withPrismaError('Alert', () =>
    prisma.alert.update({
      where: { id },
      data: { is_read: true, read_at: new Date() },
    }) as Promise<Alert>,
  );
}

export async function dismiss(id: bigint): Promise<Alert> {
  return withPrismaError('Alert', () =>
    prisma.alert.update({
      where: { id },
      data: { is_dismissed: true },
    }) as Promise<Alert>,
  );
}

export async function markAllRead(): Promise<number> {
  const result = await prisma.alert.updateMany({
    where: { is_read: false },
    data: { is_read: true, read_at: new Date() },
  });
  return result.count;
}

export async function remove(id: bigint): Promise<Alert> {
  return withPrismaError('Alert', () =>
    prisma.alert.delete({ where: { id } }) as Promise<Alert>,
  );
}
